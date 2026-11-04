import { memo, useMemo } from 'react';
import type { Level } from '../feed/protocol';
import { fmtPrice, fmtQty } from '../lib/format';
import { useStore } from '../store/createStore';
import { market } from '../store/market';
import { pickPrice } from '../trading/ticket';

const ROWS = 10;

interface BookRow {
  price: number;
  size: number;
  total: number;
}

/** Top-N levels with a running cumulative size, best level first. */
function build(levels: readonly Level[]): BookRow[] {
  const rows: BookRow[] = [];
  let total = 0;
  for (let i = 0; i < Math.min(ROWS, levels.length); i++) {
    const level = levels[i];
    if (!level) break;
    total += level[1];
    rows.push({ price: level[0], size: level[1], total });
  }
  return rows;
}

interface RowProps {
  side: 'ask' | 'bid';
  /** NaN renders an empty placeholder row so the panel never changes height. */
  price: number;
  size: number;
  total: number;
  depth: number;
}

const Row = memo(function Row({ side, price, size, total, depth }: RowProps) {
  if (Number.isNaN(price)) {
    return (
      <div className="book-row empty" aria-hidden="true">
        <span>—</span>
        <span>—</span>
        <span>—</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`book-row ${side}`}
      onClick={() => pickPrice(price)}
      title={`Set limit price to ${fmtPrice(price)}`}
    >
      <span className="depth" style={{ transform: `scaleX(${depth})` }} />
      <span className="p">{fmtPrice(price)}</span>
      <span>{fmtQty(size)}</span>
      <span>{fmtQty(total)}</span>
    </button>
  );
});

const EMPTY: BookRow = { price: NaN, size: NaN, total: NaN };

export function OrderBook() {
  const asksRaw = useStore(market.store, (s) => s.asks);
  const bidsRaw = useStore(market.store, (s) => s.bids);
  const mid = useStore(market.store, (s) => s.mid);
  const spread = useStore(market.store, (s) => s.spread);
  const live = useStore(market.store, (s) => s.status === 'live');

  const { asks, bids, maxTotal } = useMemo(() => {
    const a = build(asksRaw);
    const b = build(bidsRaw);
    const pad = (rows: BookRow[]) => [...rows, ...Array.from({ length: ROWS - rows.length }, () => EMPTY)];
    const top = Math.max(a.at(-1)?.total ?? 0, b.at(-1)?.total ?? 0, 1e-9);
    // Asks are displayed worst → best so the best ask sits against the spread.
    return { asks: pad(a).reverse(), bids: pad(b), maxTotal: top };
  }, [asksRaw, bidsRaw]);

  const spreadBps = mid && spread !== null ? (spread / mid) * 10_000 : null;

  return (
    <section className={`panel book ${live ? '' : 'dim'}`} aria-label="Order book">
      <h2>
        Order book <span className="hint">click a price to use it</span>
      </h2>
      <div className="book-head" aria-hidden="true">
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </div>
      <div className="book-side">
        {asks.map((r, i) => (
          <Row key={`a${i}`} side="ask" price={r.price} size={r.size} total={r.total} depth={r.total / maxTotal} />
        ))}
      </div>
      <div className="book-mid">
        <span className="mid-price">{fmtPrice(mid)}</span>
        <span className="mid-spread">
          spread {fmtPrice(spread)}
          {spreadBps !== null ? ` · ${spreadBps.toFixed(2)} bps` : ''}
        </span>
      </div>
      <div className="book-side">
        {bids.map((r, i) => (
          <Row key={`b${i}`} side="bid" price={r.price} size={r.size} total={r.total} depth={r.total / maxTotal} />
        ))}
      </div>
    </section>
  );
}
