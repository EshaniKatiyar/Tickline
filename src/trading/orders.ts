import type { Level } from '../feed/protocol';
import { FEE_RATE, PRICE_DECIMALS, QTY_DECIMALS, floorTo, type Account, type Side } from './account';

export type OrderType = 'market' | 'limit';
/**
 * submitting : sent, awaiting acknowledgement
 * open       : acknowledged limit order resting on the book
 * filled     : done
 * rejected   : refused for a business reason (not retryable)
 * failed     : never acknowledged (network); safe to retry with the same id
 * cancelled  : cancelled / dismissed by the user
 */
export type OrderStatus = 'submitting' | 'open' | 'filled' | 'rejected' | 'failed' | 'cancelled';

export interface Order {
  id: string;
  side: Side;
  type: OrderType;
  qty: number;
  limit?: number;
  status: OrderStatus;
  fillPrice?: number;
  reason?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export const isTerminal = (s: OrderStatus): boolean => s === 'filled' || s === 'rejected' || s === 'cancelled';

export const MIN_QTY = 0.00001;
export const MAX_QTY = 10;
/** Fat-finger guard: limit prices further than this from the mid are refused. */
export const PRICE_BAND = 0.1;

const EPS = 1e-9;

/**
 * Volume-weighted average price for taking `qty` from best-first `levels`.
 * `accepts` filters levels by price (for limit orders). Returns null if the visible book can't fill it all.
 */
export function walkBook(
  levels: readonly Level[],
  qty: number,
  accepts?: (price: number) => boolean,
): { avg: number } | null {
  if (!(qty > 0)) return null;
  let remaining = qty;
  let notional = 0;
  for (const [price, size] of levels) {
    if (accepts && !accepts(price)) break; // levels are best-first, so everything after is worse
    const take = Math.min(remaining, size);
    notional += take * price;
    remaining -= take;
    if (remaining <= EPS) return { avg: notional / qty };
  }
  return null;
}

export interface OrderInput {
  side: Side;
  type: OrderType;
  qty: string;
  price: string;
}

export interface ValidationContext {
  ref: number;
  bestAsk: number | null;
  account: Account;
}

export type Validation = { ok: true; qty: number; limit?: number } | { ok: false; error: string };

const DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

function parseDecimal(s: string): number | null {
  const t = s.trim();
  if (!DECIMAL.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const decimalsOk = (n: number, d: number) => Math.abs(n * 10 ** d - Math.round(n * 10 ** d)) < 1e-6;

export function validateOrder(input: OrderInput, ctx: ValidationContext): Validation {
  if (input.qty.trim() === '') return { ok: false, error: 'Enter a quantity' };
  const qty = parseDecimal(input.qty);
  if (qty === null) return { ok: false, error: 'Quantity must be a positive number' };
  if (qty < MIN_QTY) return { ok: false, error: `Minimum size is ${MIN_QTY} BTC` };
  if (qty > MAX_QTY) return { ok: false, error: `Maximum size is ${MAX_QTY} BTC` };
  if (!decimalsOk(qty, QTY_DECIMALS)) return { ok: false, error: `Size supports at most ${QTY_DECIMALS} decimals` };

  let limit: number | undefined;
  if (input.type === 'limit') {
    if (input.price.trim() === '') return { ok: false, error: 'Enter a limit price' };
    const p = parseDecimal(input.price);
    if (p === null || p <= 0) return { ok: false, error: 'Price must be a positive number' };
    if (!decimalsOk(p, PRICE_DECIMALS)) return { ok: false, error: `Price supports at most ${PRICE_DECIMALS} decimals` };
    if (Math.abs(p - ctx.ref) / ctx.ref > PRICE_BAND) {
      return { ok: false, error: `Price is more than ${PRICE_BAND * 100}% away from the market` };
    }
    limit = p;
  }

  if (input.side === 'buy') {
    const est = limit ?? ctx.bestAsk ?? ctx.ref;
    const need = qty * est * (1 + FEE_RATE);
    if (need > ctx.account.cash + EPS) {
      return { ok: false, error: `Insufficient funds (need $${need.toFixed(2)}, have $${ctx.account.cash.toFixed(2)})` };
    }
  } else if (qty > ctx.account.qty + EPS) {
    return { ok: false, error: `Insufficient position (have ${ctx.account.qty} BTC)` };
  }

  return limit === undefined ? { ok: true, qty } : { ok: true, qty, limit };
}

/** Largest size the account can place on `side` at `price`, floored to the size grid. */
export function maxQty(side: Side, account: Account, price: number): number {
  if (!(price > 0)) return 0;
  const raw = side === 'buy' ? account.cash / (price * (1 + FEE_RATE)) : account.qty;
  return Math.min(MAX_QTY, floorTo(raw, QTY_DECIMALS));
}
