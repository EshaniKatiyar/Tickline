import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarket } from '../store/market';
import { MockWebSocket, depthFrame, tickerFrame, tradeFrame } from '../test/mockSocket';
import type { Gateway } from './gateway';
import { createTrading } from './model';

/** Gateway whose acknowledgements the test resolves or rejects by hand. */
function manualGateway() {
  const calls: { id: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  const gateway: Gateway = {
    send: (id) => new Promise<void>((resolve, reject) => calls.push({ id, resolve, reject })),
  };
  return { gateway, calls };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup() {
  MockWebSocket.reset();
  const market = createMarket({ WebSocketImpl: MockWebSocket, schedule: (cb) => cb() });
  const stop = market.start();
  const sock = MockWebSocket.last;
  const push = (bid: number, ask: number, size = 1) => {
    sock.serverSend('btcusdt@trade', tradeFrame((bid + ask) / 2));
    sock.serverSend('btcusdt@ticker', tickerFrame((bid + ask) / 2));
    sock.serverSend('btcusdt@depth20@100ms', depthFrame(bid, ask, size));
  };
  push(99, 101);
  const { gateway, calls } = manualGateway();
  let n = 0;
  const trading = createTrading({ market, gateway, newId: () => `o${++n}` });
  return { market, trading, calls, push, stop };
}

const buy = (qty: string) => ({ side: 'buy' as const, type: 'market' as const, qty, price: '' });

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});
afterEach(() => {
  ctx.trading.dispose();
  ctx.stop();
});

describe('placing orders', () => {
  it('refuses to trade without live data', () => {
    const market = createMarket({ WebSocketImpl: MockWebSocket, schedule: (cb) => cb() });
    const { gateway } = manualGateway();
    const t = createTrading({ market, gateway });
    expect(t.place(buy('0.1'))).toEqual({ ok: false, error: 'Waiting for market data' });
    t.dispose();
  });

  it('surfaces validation errors without creating an order', () => {
    expect(ctx.trading.place(buy('abc'))).toMatchObject({ ok: false });
    expect(ctx.trading.store.get().orders).toHaveLength(0);
  });

  it('market buy fills at the ask after the venue acks', async () => {
    const r = ctx.trading.place(buy('0.5'));
    expect(r).toEqual({ ok: true, id: 'o1' });
    expect(ctx.trading.store.get().orders[0]?.status).toBe('submitting');
    expect(ctx.trading.store.get().account.qty).toBe(0); // nothing happens before the ack

    ctx.calls[0]?.resolve();
    await flush();
    const s = ctx.trading.store.get();
    expect(s.orders[0]).toMatchObject({ status: 'filled', fillPrice: 101 });
    expect(s.account.qty).toBeCloseTo(0.5);
    expect(s.account.avgPrice).toBeCloseTo(101);
  });

  it('market order walks the book for a VWAP fill', async () => {
    ctx.trading.place(buy('2.5')); // asks: 101, 102, 103 @ size 1 each
    ctx.calls[0]?.resolve();
    await flush();
    expect(ctx.trading.store.get().orders[0]?.fillPrice).toBeCloseTo((101 + 102 + 0.5 * 103) / 2.5);
  });

  it('rejects a market order the visible book cannot fill', async () => {
    ctx.trading.place(buy('9')); // only 5 levels × 1 BTC visible
    ctx.calls[0]?.resolve();
    await flush();
    expect(ctx.trading.store.get().orders[0]).toMatchObject({ status: 'rejected', reason: expect.stringContaining('liquidity') });
    expect(ctx.trading.store.get().account.qty).toBe(0);
  });

  it('realizes P&L on a round trip', async () => {
    ctx.trading.place(buy('1'));
    ctx.calls[0]?.resolve();
    await flush();
    ctx.push(109, 111); // market rallies
    ctx.trading.place({ side: 'sell', type: 'market', qty: '1', price: '' });
    ctx.calls[1]?.resolve();
    await flush();
    const { account } = ctx.trading.store.get();
    expect(account.qty).toBe(0);
    expect(account.realized).toBeCloseTo(109 - 101);
  });
});

describe('failure and retry', () => {
  it('a failed send changes nothing and is retried under the same id exactly once', async () => {
    ctx.trading.place(buy('0.1'));
    ctx.calls[0]?.reject(new Error('timeout'));
    await flush();
    expect(ctx.trading.store.get().orders[0]).toMatchObject({ id: 'o1', status: 'failed', reason: 'timeout' });
    expect(ctx.trading.store.get().account.qty).toBe(0);

    expect(ctx.trading.retry('o1')).toBe(true);
    expect(ctx.trading.retry('o1')).toBe(false); // double-click: ignored while in flight
    expect(ctx.calls).toHaveLength(2);
    expect(ctx.calls[1]?.id).toBe('o1');

    ctx.calls[1]?.resolve();
    await flush();
    const s = ctx.trading.store.get();
    expect(s.orders).toHaveLength(1); // no duplicate row
    expect(s.orders[0]).toMatchObject({ status: 'filled', attempts: 2 });
    expect(s.account.qty).toBeCloseTo(0.1);
  });

  it('a late ack for an order that already failed does not fill it twice', async () => {
    ctx.trading.place(buy('0.1'));
    ctx.calls[0]?.reject(new Error('timeout'));
    await flush();
    ctx.trading.retry('o1');
    ctx.calls[1]?.resolve();
    await flush();
    ctx.calls[0]?.resolve(); // stale resolution of the first attempt
    await flush();
    expect(ctx.trading.store.get().account.qty).toBeCloseTo(0.1);
  });

  it('only failed orders can be retried', async () => {
    ctx.trading.place(buy('0.1'));
    expect(ctx.trading.retry('o1')).toBe(false); // still submitting
    ctx.calls[0]?.resolve();
    await flush();
    expect(ctx.trading.retry('o1')).toBe(false); // filled
    expect(ctx.trading.retry('nope')).toBe(false);
  });

  it('a failed order can be dismissed, and then cannot be retried', async () => {
    ctx.trading.place(buy('0.1'));
    ctx.calls[0]?.reject(new Error('x'));
    await flush();
    expect(ctx.trading.cancel('o1')).toBe(true);
    expect(ctx.trading.retry('o1')).toBe(false);
    expect(ctx.trading.store.get().orders[0]?.status).toBe('cancelled');
  });
});

describe('limit orders', () => {
  const limitBuy = (price: string) => ({ side: 'buy' as const, type: 'limit' as const, qty: '1', price });

  it('rests when not marketable, then fills when the market comes to it', async () => {
    ctx.trading.place(limitBuy('98'));
    ctx.calls[0]?.resolve();
    await flush();
    expect(ctx.trading.store.get().orders[0]?.status).toBe('open');

    ctx.push(96, 98, 1); // ask drops to 98
    const o = ctx.trading.store.get().orders[0];
    expect(o).toMatchObject({ status: 'filled', fillPrice: 98 });
    expect(ctx.trading.store.get().account.qty).toBeCloseTo(1);
  });

  it('a marketable limit fills immediately at the book price, never worse than the limit', async () => {
    ctx.trading.place(limitBuy('105'));
    ctx.calls[0]?.resolve();
    await flush();
    expect(ctx.trading.store.get().orders[0]).toMatchObject({ status: 'filled', fillPrice: 101 });
  });

  it('can be cancelled while resting and then never fills', async () => {
    ctx.trading.place(limitBuy('98'));
    ctx.calls[0]?.resolve();
    await flush();
    expect(ctx.trading.cancel('o1')).toBe(true);
    ctx.push(96, 97);
    expect(ctx.trading.store.get().orders[0]?.status).toBe('cancelled');
    expect(ctx.trading.store.get().account.qty).toBe(0);
  });

  it('a resting order does not fill from a stale feed', async () => {
    ctx.trading.place(limitBuy('98'));
    ctx.calls[0]?.resolve();
    await flush();
    ctx.market.store.set((s) => ({ ...s, status: 'reconnecting', bestAsk: 97, asks: [[97, 5]] }));
    expect(ctx.trading.store.get().orders[0]?.status).toBe('open');
  });
});

describe('reset', () => {
  it('clears state and ignores acks that arrive afterwards', async () => {
    ctx.trading.place(buy('0.1'));
    ctx.trading.reset();
    ctx.calls[0]?.resolve();
    await flush();
    expect(ctx.trading.store.get().orders).toHaveLength(0);
    expect(ctx.trading.store.get().account.qty).toBe(0);
  });
});

describe('market model', () => {
  it('coalesces a burst of frames into one state change per flush', () => {
    vi.useFakeTimers();
    MockWebSocket.reset();
    const frames: (() => void)[] = [];
    const m = createMarket({ WebSocketImpl: MockWebSocket, schedule: (cb) => frames.push(cb) });
    const stop = m.start();
    // The first frame legitimately flips status to "live"; get that out of the way first.
    MockWebSocket.last.serverSend('btcusdt@trade', tradeFrame(99));
    frames.shift()?.();
    expect(m.store.get().status).toBe('live');

    let changes = 0;
    m.store.subscribe(() => changes++);
    const base = changes;
    for (let i = 0; i < 500; i++) MockWebSocket.last.serverSend('btcusdt@trade', tradeFrame(100 + i));
    expect(frames).toHaveLength(1);
    expect(changes).toBe(base);
    frames[0]?.();
    expect(changes).toBe(base + 1);
    expect(m.store.get().last).toBe(599);
    expect(m.ticks.length).toBe(501);
    stop();
    vi.useRealTimers();
  });

  it('keeps the last good book when a corrupt crossed book arrives', () => {
    MockWebSocket.reset();
    const m = createMarket({ WebSocketImpl: MockWebSocket, schedule: (cb) => cb() });
    const stop = m.start();
    MockWebSocket.last.serverSend('btcusdt@depth20@100ms', depthFrame(99, 101));
    MockWebSocket.last.serverSend('btcusdt@depth20@100ms', depthFrame(105, 100)); // crossed
    expect(m.store.get()).toMatchObject({ bestBid: 99, bestAsk: 101, mid: 100, spread: 2 });
    stop();
  });
});
