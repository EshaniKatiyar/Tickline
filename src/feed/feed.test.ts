import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockWebSocket, tradeFrame } from '../test/mockSocket';
import { startFeed, type FeedStatus } from './feed';
import type { FeedEvent } from './protocol';

function setup(extra: { hosts?: string[] } = {}) {
  const events: FeedEvent[] = [];
  const statuses: FeedStatus[] = [];
  const feed = startFeed({
    hosts: extra.hosts ?? ['wss://a.test', 'wss://b.test'],
    symbol: 'btcusdt',
    WebSocketImpl: MockWebSocket,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    random: () => 1, // no jitter reduction: delay == full ceiling
    baseBackoffMs: 1_000,
    maxBackoffMs: 8_000,
    staleAfterMs: 5_000,
  });
  return { feed, events, statuses };
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startFeed', () => {
  it('connects, goes live on first frame, and forwards parsed events', () => {
    const { events, statuses } = setup();
    expect(statuses).toEqual(['connecting']);
    expect(MockWebSocket.last.url).toContain('wss://a.test/stream?streams=btcusdt@trade/btcusdt@depth20@100ms/btcusdt@ticker');

    MockWebSocket.last.serverOpen();
    MockWebSocket.last.serverSend('btcusdt@trade', tradeFrame(100));
    expect(statuses).toEqual(['connecting', 'live']);
    expect(events).toEqual([{ type: 'trade', price: 100, qty: 0.01, ts: 1 }]);
  });

  it('reconnects with exponential backoff, rotating hosts', () => {
    const { statuses } = setup();
    MockWebSocket.last.serverClose(); // attempt 1 -> 1000ms
    expect(statuses.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.last.url).toContain('wss://b.test');

    MockWebSocket.last.serverClose(); // attempt 2 -> 2000ms
    vi.advanceTimersByTime(1_999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(MockWebSocket.last.url).toContain('wss://a.test');
  });

  it('caps the backoff and resets it once data flows again', () => {
    setup();
    for (let i = 0; i < 6; i++) {
      MockWebSocket.last.serverClose();
      vi.advanceTimersByTime(8_000);
    }
    const count = MockWebSocket.instances.length;
    MockWebSocket.last.serverClose();
    vi.advanceTimersByTime(7_999);
    expect(MockWebSocket.instances).toHaveLength(count); // still capped at 8s, not larger
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(count + 1);

    MockWebSocket.last.serverSend('btcusdt@trade', tradeFrame(1)); // healthy -> reset
    MockWebSocket.last.serverClose();
    vi.advanceTimersByTime(1_000);
    expect(MockWebSocket.instances).toHaveLength(count + 2);
  });

  it('never opens two sockets for one close event', () => {
    setup();
    const first = MockWebSocket.last;
    first.serverClose();
    first.serverClose(); // duplicate close from the same socket
    vi.advanceTimersByTime(1_500); // past the backoff, well inside the stale window
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('ignores frames from a replaced socket', () => {
    const { events } = setup();
    const old = MockWebSocket.last;
    old.serverClose();
    vi.advanceTimersByTime(1_000);
    old.serverSend('btcusdt@trade', tradeFrame(111)); // late frame from the dead socket
    expect(events).toHaveLength(0);
  });

  it('watchdog kills a silent socket, marks it stale, and reconnects', () => {
    const { statuses } = setup();
    MockWebSocket.last.serverOpen();
    MockWebSocket.last.serverSend('btcusdt@trade', tradeFrame(1));
    const silent = MockWebSocket.last;

    vi.advanceTimersByTime(6_000);
    expect(silent.closed).toBe(true);
    expect(statuses).toContain('stale');

    vi.advanceTimersByTime(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);
    MockWebSocket.last.serverSend('btcusdt@trade', tradeFrame(2));
    expect(statuses.at(-1)).toBe('live');
  });

  it('watchdog also recovers a socket that never connects', () => {
    setup();
    vi.advanceTimersByTime(6_000 + 1_000);
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('stop() closes the socket and cancels every timer', () => {
    const { feed } = setup();
    const sock = MockWebSocket.last;
    feed.stop();
    expect(sock.closed).toBe(true);
    sock.serverClose();
    vi.advanceTimersByTime(120_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() during a pending retry prevents the reconnect', () => {
    const { feed } = setup();
    MockWebSocket.last.serverClose();
    feed.stop();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
