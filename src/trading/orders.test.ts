import { describe, expect, it } from 'vitest';
import type { Level } from '../feed/protocol';
import { initialAccount } from './account';
import { MAX_QTY, maxQty, validateOrder, walkBook, type OrderInput } from './orders';

const asks: Level[] = [
  [101, 1],
  [102, 2],
  [105, 5],
];

describe('walkBook', () => {
  it('fills at a single level', () => {
    expect(walkBook(asks, 0.5)).toEqual({ avg: 101 });
  });

  it('computes VWAP across levels', () => {
    // 1 @ 101 + 2 @ 102 = 305 / 3
    expect(walkBook(asks, 3)?.avg).toBeCloseTo(305 / 3);
  });

  it('returns null when the visible book is too thin', () => {
    expect(walkBook(asks, 8.5)).toBeNull();
    expect(walkBook([], 1)).toBeNull();
    expect(walkBook(asks, 0)).toBeNull();
  });

  it('respects a price filter and stops at the first rejected level', () => {
    const cap = (p: number) => p <= 102;
    expect(walkBook(asks, 3, cap)?.avg).toBeCloseTo(305 / 3);
    expect(walkBook(asks, 3.5, cap)).toBeNull();
  });
});

const base: OrderInput = { side: 'buy', type: 'market', qty: '0.1', price: '' };
const ctx = { ref: 100, bestAsk: 100.5, account: initialAccount };

describe('validateOrder', () => {
  it('accepts a valid market order', () => {
    expect(validateOrder(base, ctx)).toEqual({ ok: true, qty: 0.1 });
  });

  it('accepts a valid limit order', () => {
    expect(validateOrder({ ...base, type: 'limit', price: '99.5' }, ctx)).toEqual({ ok: true, qty: 0.1, limit: 99.5 });
  });

  it.each([
    ['', 'Enter a quantity'],
    ['abc', 'Quantity must be a positive number'],
    ['-1', 'Quantity must be a positive number'],
    ['1e3', 'Quantity must be a positive number'],
    ['0', 'Minimum size'],
    ['0.000001', 'Minimum size'],
    [String(MAX_QTY + 1), 'Maximum size'],
    ['0.123456', 'at most 5 decimals'],
  ])('rejects quantity %j', (qty, message) => {
    const r = validateOrder({ ...base, qty }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it('validates limit prices: required, positive, tick size and fat-finger band', () => {
    const limit = (price: string) => validateOrder({ ...base, type: 'limit', price }, ctx);
    expect(limit('')).toMatchObject({ ok: false, error: 'Enter a limit price' });
    expect(limit('0')).toMatchObject({ ok: false });
    expect(limit('99.999')).toMatchObject({ ok: false, error: expect.stringContaining('decimals') });
    expect(limit('150')).toMatchObject({ ok: false, error: expect.stringContaining('away from the market') });
    expect(limit('89')).toMatchObject({ ok: false, error: expect.stringContaining('away from the market') });
    expect(limit('91')).toMatchObject({ ok: true });
  });

  it('checks buying power and position', () => {
    expect(validateOrder({ ...base, qty: '5' }, { ...ctx, ref: 50_000, bestAsk: 50_000 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Insufficient funds'),
    });
    expect(validateOrder({ ...base, side: 'sell' }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Insufficient position'),
    });
    const holding = { ...initialAccount, qty: 0.5, avgPrice: 90 };
    expect(validateOrder({ ...base, side: 'sell' }, { ...ctx, account: holding })).toMatchObject({ ok: true });
  });
});

describe('maxQty', () => {
  it('sizes buys from cash including fee, and sells from position', () => {
    const q = maxQty('buy', initialAccount, 50_000);
    expect(q).toBeGreaterThan(1.99);
    expect(q * 50_000 * 1.001).toBeLessThanOrEqual(initialAccount.cash);
    expect(maxQty('sell', { ...initialAccount, qty: 0.25 }, 50_000)).toBe(0.25);
    expect(maxQty('buy', initialAccount, 0)).toBe(0);
  });
});
