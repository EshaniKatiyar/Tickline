export type Side = 'buy' | 'sell';

export const FEE_RATE = 0.001; // 0.1% per fill
export const START_CASH = 100_000;
export const QTY_DECIMALS = 5;
export const PRICE_DECIMALS = 2;
const EPS = 1e-9;

export interface Account {
  cash: number;
  qty: number;
  avgPrice: number;
  /** Gross realized P&L (before fees). */
  realized: number;
  fees: number;
}

export const initialAccount: Account = { cash: START_CASH, qty: 0, avgPrice: 0, realized: 0, fees: 0 };

export function floorTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(n * f + 1e-9) / f;
}

/** Returns a human-readable reason the fill cannot happen, or null if it can. */
export function checkFill(a: Account, side: Side, qty: number, price: number): string | null {
  if (!(qty > 0) || !(price > 0)) return 'Invalid fill';
  if (side === 'buy') {
    const need = qty * price * (1 + FEE_RATE);
    return need <= a.cash + EPS ? null : `Insufficient funds (need $${need.toFixed(2)})`;
  }
  return qty <= a.qty + EPS ? null : `Insufficient position (have ${a.qty} BTC)`;
}

/** Spot account only: no shorting, no leverage. Pure; throws RangeError if the fill is impossible. */
export function applyFill(a: Account, side: Side, qty: number, price: number): Account {
  const error = checkFill(a, side, qty, price);
  if (error) throw new RangeError(error);

  const notional = qty * price;
  const fee = notional * FEE_RATE;

  if (side === 'buy') {
    const newQty = a.qty + qty;
    return {
      cash: a.cash - notional - fee,
      qty: newQty,
      avgPrice: (a.avgPrice * a.qty + notional) / newQty,
      realized: a.realized,
      fees: a.fees + fee,
    };
  }

  const remaining = a.qty - qty;
  const closed = remaining <= EPS;
  return {
    cash: a.cash + notional - fee,
    qty: closed ? 0 : remaining,
    avgPrice: closed ? 0 : a.avgPrice,
    realized: a.realized + (price - a.avgPrice) * qty,
    fees: a.fees + fee,
  };
}

export const equity = (a: Account, mark: number): number => a.cash + a.qty * mark;
export const unrealized = (a: Account, mark: number): number => (a.qty > 0 ? a.qty * (mark - a.avgPrice) : 0);
