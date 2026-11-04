import { describe, expect, it } from 'vitest';
import { FEE_RATE, START_CASH, applyFill, checkFill, equity, floorTo, initialAccount, unrealized } from './account';

describe('applyFill', () => {
  it('buys: debits cash + fee, sets average entry', () => {
    const a = applyFill(initialAccount, 'buy', 1, 100);
    expect(a.qty).toBe(1);
    expect(a.avgPrice).toBe(100);
    expect(a.cash).toBeCloseTo(START_CASH - 100 - 100 * FEE_RATE);
    expect(a.fees).toBeCloseTo(100 * FEE_RATE);
  });

  it('averages the entry price across buys', () => {
    let a = applyFill(initialAccount, 'buy', 1, 100);
    a = applyFill(a, 'buy', 3, 200);
    expect(a.qty).toBe(4);
    expect(a.avgPrice).toBeCloseTo(175);
  });

  it('partial sell realizes P&L and keeps the average entry', () => {
    let a = applyFill(initialAccount, 'buy', 2, 100);
    a = applyFill(a, 'sell', 1, 130);
    expect(a.qty).toBe(1);
    expect(a.avgPrice).toBe(100);
    expect(a.realized).toBeCloseTo(30);
  });

  it('closing the position resets quantity and entry', () => {
    let a = applyFill(initialAccount, 'buy', 0.3, 100);
    a = applyFill(a, 'sell', 0.3, 90);
    expect(a.qty).toBe(0);
    expect(a.avgPrice).toBe(0);
    expect(a.realized).toBeCloseTo(-3);
  });

  it('conserves value: equity − start = realized + unrealized − fees', () => {
    let a = applyFill(initialAccount, 'buy', 1.5, 20_000);
    a = applyFill(a, 'sell', 0.5, 21_000);
    a = applyFill(a, 'buy', 0.25, 19_500);
    const mark = 20_250;
    expect(equity(a, mark) - START_CASH).toBeCloseTo(a.realized + unrealized(a, mark) - a.fees, 6);
  });

  it('throws on impossible fills and leaves the input untouched', () => {
    const before = { ...initialAccount };
    expect(() => applyFill(initialAccount, 'sell', 1, 100)).toThrow(RangeError);
    expect(() => applyFill(initialAccount, 'buy', 1_000, 100_000)).toThrow(RangeError);
    expect(initialAccount).toEqual(before);
  });
});

describe('checkFill', () => {
  it('reports why a fill is impossible', () => {
    expect(checkFill(initialAccount, 'buy', 0, 100)).toBe('Invalid fill');
    expect(checkFill(initialAccount, 'buy', 10, 100_000)).toMatch(/Insufficient funds/);
    expect(checkFill(initialAccount, 'sell', 1, 100)).toMatch(/Insufficient position/);
    expect(checkFill(initialAccount, 'buy', 1, 100)).toBeNull();
  });

  it('allows spending exactly all cash including fee', () => {
    const price = 1_000;
    const qty = START_CASH / (price * (1 + FEE_RATE));
    expect(checkFill(initialAccount, 'buy', qty, price)).toBeNull();
  });
});

describe('floorTo', () => {
  it('floors without float noise', () => {
    expect(floorTo(0.3, 5)).toBe(0.3);
    expect(floorTo(0.123456, 5)).toBe(0.12345);
    expect(floorTo(1.00000999, 5)).toBe(1);
  });
});
