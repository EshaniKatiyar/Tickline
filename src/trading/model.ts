import type { MarketModel, MarketState } from '../store/market';
import { market as defaultMarket } from '../store/market';
import { createStore } from '../store/createStore';
import { applyFill, checkFill, initialAccount, type Account } from './account';
import { createSimulatedGateway, type Gateway } from './gateway';
import { isTerminal, validateOrder, walkBook, type Order, type OrderInput } from './orders';

export interface TradingState {
  account: Account;
  /** Newest first. */
  orders: Order[];
}

export type PlaceResult = { ok: true; id: string } | { ok: false; error: string };

export interface TradingDeps {
  market: MarketModel;
  gateway: Gateway;
  now?: () => number;
  newId?: () => string;
}

const MAX_TERMINAL_ORDERS = 100;

/** Keep every live order, but cap the history of finished ones. */
function prune(orders: Order[]): Order[] {
  let terminal = 0;
  return orders.filter((o) => !isTerminal(o.status) || ++terminal <= MAX_TERMINAL_ORDERS);
}

export function createTrading(deps: TradingDeps) {
  const { market, gateway } = deps;
  const now = deps.now ?? Date.now;
  let seq = 0;
  const newId = deps.newId ?? (() => `ord_${now().toString(36)}_${(++seq).toString(36)}`);

  const store = createStore<TradingState>({ account: initialAccount, orders: [] });

  const find = (id: string) => store.get().orders.find((o) => o.id === id);
  const update = (id: string, patch: Partial<Order>) =>
    store.set((s) => ({
      ...s,
      orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: now() } : o)),
    }));

  /** Would this order execute right now against the visible book, and at what average price? */
  function tryMatch(o: Order, m: MarketState): number | null {
    const book = o.side === 'buy' ? m.asks : m.bids;
    const accepts =
      o.type === 'limit' && o.limit !== undefined
        ? o.side === 'buy'
          ? (p: number) => p <= o.limit!
          : (p: number) => p >= o.limit!
        : undefined;
    return walkBook(book, o.qty, accepts)?.avg ?? null;
  }

  function fill(o: Order, price: number) {
    const error = checkFill(store.get().account, o.side, o.qty, price);
    if (error) {
      update(o.id, { status: 'rejected', reason: error });
      return;
    }
    store.set((s) => ({ ...s, account: applyFill(s.account, o.side, o.qty, price) }));
    update(o.id, { status: 'filled', fillPrice: price });
  }

  /** The venue has acknowledged the order: match it now, or rest it. */
  function settle(o: Order) {
    const m = market.store.get();
    if (m.status !== 'live') {
      if (o.type === 'market') update(o.id, { status: 'rejected', reason: 'Market data not live — order rejected' });
      else update(o.id, { status: 'open' });
      return;
    }
    const price = tryMatch(o, m);
    if (price !== null) fill(o, price);
    else if (o.type === 'market') update(o.id, { status: 'rejected', reason: 'Insufficient liquidity in visible book' });
    else update(o.id, { status: 'open' });
  }

  async function dispatch(id: string) {
    try {
      await gateway.send(id);
    } catch (e) {
      // Only an order still waiting for its ack can fail; anything else was already resolved.
      if (find(id)?.status === 'submitting') {
        update(id, { status: 'failed', reason: e instanceof Error ? e.message : 'Network error' });
      }
      return;
    }
    const o = find(id);
    if (!o || o.status !== 'submitting') return; // idempotency guard: never settle twice
    settle(o);
  }

  function place(input: OrderInput): PlaceResult {
    const m = market.store.get();
    const ref = m.mid ?? m.last;
    if (ref === null) return { ok: false, error: 'Waiting for market data' };
    if (m.status !== 'live') return { ok: false, error: 'Market data is not live — trading paused' };

    const v = validateOrder(input, { ref, bestAsk: m.bestAsk, account: store.get().account });
    if (!v.ok) return v;

    const t = now();
    const order: Order = {
      id: newId(),
      side: input.side,
      type: input.type,
      qty: v.qty,
      ...(v.limit !== undefined ? { limit: v.limit } : {}),
      status: 'submitting',
      attempts: 1,
      createdAt: t,
      updatedAt: t,
    };
    store.set((s) => ({ ...s, orders: prune([order, ...s.orders]) }));
    void dispatch(order.id);
    return { ok: true, id: order.id };
  }

  /** Re-send a failed order under the SAME id. Ignored unless it is currently `failed`. */
  function retry(id: string): boolean {
    const o = find(id);
    if (!o || o.status !== 'failed') return false;
    update(id, { status: 'submitting', attempts: o.attempts + 1, reason: undefined });
    void dispatch(id);
    return true;
  }

  /** Cancel a resting order, or dismiss a failed one. */
  function cancel(id: string): boolean {
    const o = find(id);
    if (!o || (o.status !== 'open' && o.status !== 'failed')) return false;
    update(id, { status: 'cancelled', reason: undefined });
    return true;
  }

  function reset() {
    store.set({ account: initialAccount, orders: [] });
  }

  // Resting limit orders are re-evaluated whenever the book changes.
  const unsubscribe = market.store.subscribe(() => {
    if (market.store.get().status !== 'live') return;
    const resting = store.get().orders.filter((o) => o.status === 'open');
    for (const o of resting) {
      const current = find(o.id);
      if (!current || current.status !== 'open') continue;
      const price = tryMatch(current, market.store.get());
      if (price !== null) fill(current, price);
    }
  });

  return { store, place, retry, cancel, reset, dispose: unsubscribe };
}

export type TradingModel = ReturnType<typeof createTrading>;

export const gateway = createSimulatedGateway();
export const trading = createTrading({ market: defaultMarket, gateway });
