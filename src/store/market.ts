import { startFeed, type FeedStatus, type SocketCtor } from '../feed/feed';
import type { FeedEvent, Level, TickerEvent } from '../feed/protocol';
import { RingBuffer } from '../lib/ring';
import { createStore } from './createStore';

export interface Tick {
  /** Client receive time (ms). Used for the chart axis so exchange/client clock skew can't distort it. */
  t: number;
  p: number;
}

export interface MarketState {
  status: FeedStatus;
  last: number | null;
  tick: 'up' | 'down' | 'flat';
  changePct: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  bids: Level[];
  asks: Level[];
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  spread: number | null;
  /** Bumped whenever new trades land in `ticks`; the chart redraws off this. */
  seriesVersion: number;
}

export const initialMarketState: MarketState = {
  status: 'connecting',
  last: null,
  tick: 'flat',
  changePct: null,
  high: null,
  low: null,
  volume: null,
  bids: [],
  asks: [],
  bestBid: null,
  bestAsk: null,
  mid: null,
  spread: null,
  seriesVersion: 0,
};

export interface MarketOptions {
  symbol?: string;
  hosts?: string[];
  WebSocketImpl?: SocketCtor;
  /** Frame scheduler; defaults to requestAnimationFrame. */
  schedule?: (cb: () => void) => void;
  now?: () => number;
}

const DEFAULT_HOSTS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];

type Pending = { trade?: number; depth?: { bids: Level[]; asks: Level[] }; ticker?: TickerEvent };

/**
 * Market data model. Socket frames arrive at up to hundreds per second; they are coalesced
 * so React sees at most one state change per animation frame. Raw trades go straight into a
 * ring buffer that the canvas chart reads directly (no React involvement).
 */
export function createMarket(opts: MarketOptions = {}) {
  const symbol = (opts.symbol ?? 'btcusdt').toLowerCase();
  const now = opts.now ?? Date.now;
  const schedule =
    opts.schedule ??
    ((cb: () => void) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb);
      else setTimeout(cb, 16);
    });

  const store = createStore<MarketState>(initialMarketState);
  const ticks = new RingBuffer<Tick>(4_000);

  let pending: Pending = {};
  let scheduled = false;
  let running = false;
  let stopFeed: (() => void) | null = null;

  function flush() {
    scheduled = false;
    if (!running) return;
    const p = pending;
    pending = {};

    store.set((prev) => {
      const next: MarketState = { ...prev };

      if (p.trade !== undefined) {
        if (prev.last !== null && p.trade !== prev.last) next.tick = p.trade > prev.last ? 'up' : 'down';
        next.last = p.trade;
        next.seriesVersion = prev.seriesVersion + 1;
      }

      if (p.ticker) {
        next.changePct = p.ticker.changePct;
        next.high = p.ticker.high;
        next.low = p.ticker.low;
        next.volume = p.ticker.volume;
        if (next.last === null) next.last = p.ticker.last;
      }

      if (p.depth) {
        const bestBid = p.depth.bids[0];
        const bestAsk = p.depth.asks[0];
        // A crossed or empty book is a corrupt frame: keep the previous good book.
        if (bestBid && bestAsk && bestBid[0] < bestAsk[0]) {
          next.bids = p.depth.bids;
          next.asks = p.depth.asks;
          next.bestBid = bestBid[0];
          next.bestAsk = bestAsk[0];
          next.mid = (bestBid[0] + bestAsk[0]) / 2;
          next.spread = bestAsk[0] - bestBid[0];
        }
      }
      return next;
    });
  }

  function onEvent(event: FeedEvent) {
    switch (event.type) {
      case 'trade':
        ticks.push({ t: now(), p: event.price });
        pending.trade = event.price;
        break;
      case 'depth':
        pending.depth = event;
        break;
      case 'ticker':
        pending.ticker = event;
        break;
    }
    if (!scheduled) {
      scheduled = true;
      schedule(flush);
    }
  }

  function stop() {
    running = false;
    stopFeed?.();
    stopFeed = null;
    pending = {};
  }

  /** Start (or restart) the feed. Returns a stop function; safe under React StrictMode double-mount. */
  function start(): () => void {
    stop();
    running = true;
    store.set((s) => ({ ...s, status: 'connecting' }));
    const feed = startFeed({
      hosts: opts.hosts ?? DEFAULT_HOSTS,
      symbol,
      WebSocketImpl: opts.WebSocketImpl,
      onEvent,
      onStatus: (status) => store.set((s) => ({ ...s, status })),
    });
    stopFeed = feed.stop;
    return stop;
  }

  return { store, ticks, start, symbol };
}

export type MarketModel = ReturnType<typeof createMarket>;

export const market = createMarket();
