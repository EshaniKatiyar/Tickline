export type Level = readonly [price: number, qty: number];

export type TradeEvent = { type: 'trade'; price: number; qty: number; ts: number };
export type DepthEvent = { type: 'depth'; bids: Level[]; asks: Level[] };
export type TickerEvent = {
  type: 'ticker';
  last: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
};
export type FeedEvent = TradeEvent | DepthEvent | TickerEvent;

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseLevels(v: unknown): Level[] {
  if (!Array.isArray(v)) return [];
  const out: Level[] = [];
  for (const row of v) {
    if (!Array.isArray(row)) continue;
    const price = num(row[0]);
    const qty = num(row[1]);
    if (price !== null && qty !== null && price > 0 && qty > 0) out.push([price, qty]);
  }
  return out;
}

/**
 * Parse one frame from Binance's combined stream (`{ stream, data }`).
 * Never throws: anything malformed or unrecognised returns null.
 * Depth levels are returned best-first (bids descending, asks ascending).
 */
export function parseMessage(raw: string): FeedEvent | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;

  const { stream, data } = msg as { stream?: unknown; data?: unknown };
  if (typeof stream !== 'string' || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const channel = stream.split('@')[1] ?? '';

  if (channel === 'trade') {
    const price = num(d.p);
    const qty = num(d.q);
    if (price === null || qty === null || price <= 0) return null;
    return { type: 'trade', price, qty, ts: num(d.T) ?? Date.now() };
  }

  if (channel.startsWith('depth')) {
    const bids = parseLevels(d.bids).sort((a, b) => b[0] - a[0]);
    const asks = parseLevels(d.asks).sort((a, b) => a[0] - b[0]);
    if (bids.length === 0 || asks.length === 0) return null;
    return { type: 'depth', bids, asks };
  }

  if (channel === 'ticker') {
    const last = num(d.c);
    const changePct = num(d.P);
    const high = num(d.h);
    const low = num(d.l);
    const volume = num(d.v);
    if (last === null || changePct === null || high === null || low === null || volume === null) return null;
    return { type: 'ticker', last, changePct, high, low, volume };
  }

  return null;
}
