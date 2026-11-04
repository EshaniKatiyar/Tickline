import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring';

describe('RingBuffer', () => {
  it('rejects invalid capacities', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(1.5)).toThrow(RangeError);
  });

  it('keeps insertion order below capacity', () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    expect(r.length).toBe(2);
    expect([r.at(0), r.at(1), r.at(2)]).toEqual([1, 2, undefined]);
    expect(r.last()).toBe(2);
  });

  it('overwrites the oldest element once full', () => {
    const r = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) r.push(n);
    expect(r.length).toBe(3);
    expect([r.at(0), r.at(1), r.at(2)]).toEqual([3, 4, 5]);
    expect(r.last()).toBe(5);
  });

  it('handles out-of-range and clear', () => {
    const r = new RingBuffer<number>(2);
    r.push(1);
    expect(r.at(-1)).toBeUndefined();
    expect(r.at(1)).toBeUndefined();
    r.clear();
    expect(r.length).toBe(0);
    expect(r.last()).toBeUndefined();
  });
});
