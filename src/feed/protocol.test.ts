import { describe, expect, it } from 'vitest';
import { parseMessage } from './protocol';

const wrap = (stream: string, data: unknown) => JSON.stringify({ stream, data });

describe('parseMessage', () => {
  it('parses a trade', () => {
    expect(parseMessage(wrap('btcusdt@trade', { p: '67000.10', q: '0.5', T: 123 }))).toEqual({
      type: 'trade',
      price: 67000.1,
      qty: 0.5,
      ts: 123,
    });
  });

  it('parses depth and sorts best-first', () => {
    const e = parseMessage(
      wrap('btcusdt@depth20@100ms', {
        bids: [['99', '1'], ['100', '2']],
        asks: [['102', '1'], ['101', '3']],
      }),
    );
    expect(e).toEqual({
      type: 'depth',
      bids: [[100, 2], [99, 1]],
      asks: [[101, 3], [102, 1]],
    });
  });

  it('drops invalid depth levels and empty books', () => {
    const e = parseMessage(
      wrap('btcusdt@depth20@100ms', {
        bids: [['x', '1'], ['100', '0'], ['99', '1']],
        asks: [['101', '1']],
      }),
    );
    expect(e).toMatchObject({ type: 'depth', bids: [[99, 1]] });
    expect(parseMessage(wrap('btcusdt@depth20@100ms', { bids: [], asks: [['1', '1']] }))).toBeNull();
  });

  it('parses the 24h ticker', () => {
    expect(parseMessage(wrap('btcusdt@ticker', { c: '67000', P: '-1.5', h: '68000', l: '66000', v: '999' }))).toEqual({
      type: 'ticker',
      last: 67000,
      changePct: -1.5,
      high: 68000,
      low: 66000,
      volume: 999,
    });
  });

  it('never throws on garbage', () => {
    for (const raw of ['', 'not json', 'null', '42', '[]', '{}', wrap('btcusdt@trade', { p: 'abc', q: '1' }), wrap('btcusdt@trade', null), wrap('btcusdt@mystery', {})]) {
      expect(parseMessage(raw)).toBeNull();
    }
  });

  it('rejects non-positive trade prices', () => {
    expect(parseMessage(wrap('btcusdt@trade', { p: '0', q: '1', T: 1 }))).toBeNull();
    expect(parseMessage(wrap('btcusdt@trade', { p: '-5', q: '1', T: 1 }))).toBeNull();
  });
});
