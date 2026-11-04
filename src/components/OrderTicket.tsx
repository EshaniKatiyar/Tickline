import { useState, type FormEvent } from 'react';
import { fmtUsd, toInputString } from '../lib/format';
import { useStore } from '../store/createStore';
import { market } from '../store/market';
import { FEE_RATE, QTY_DECIMALS, floorTo } from '../trading/account';
import { trading } from '../trading/model';
import { maxQty } from '../trading/orders';
import { ticket, type TicketState } from '../trading/ticket';

const PRESETS = ['0.001', '0.01', '0.1'];
const PERCENTS = [25, 50, 100];

export function OrderTicket() {
  const t = useStore(ticket, (s) => s);
  const bestBid = useStore(market.store, (s) => s.bestBid);
  const bestAsk = useStore(market.store, (s) => s.bestAsk);
  const live = useStore(market.store, (s) => s.status === 'live');
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<TicketState>) => {
    ticket.set((s) => ({ ...s, ...p }));
    setError(null);
  };

  const limitPrice = Number(t.price);
  const refPrice = t.type === 'limit' && limitPrice > 0 ? limitPrice : t.side === 'buy' ? bestAsk : bestBid;
  const qtyNum = Number(t.qty);
  const notional = refPrice && qtyNum > 0 ? qtyNum * refPrice : null;
  const fee = notional === null ? null : notional * FEE_RATE;

  const applyPercent = (pct: number) => {
    if (!refPrice) return;
    const max = maxQty(t.side, trading.store.get().account, refPrice);
    patch({ qty: toInputString(floorTo((max * pct) / 100, QTY_DECIMALS), QTY_DECIMALS) });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = trading.place({ side: t.side, type: t.type, qty: t.qty, price: t.price });
    setError(result.ok ? null : result.error);
  };

  const buy = t.side === 'buy';

  return (
    <section className="panel ticket" aria-label="Order ticket">
      <h2>
        Order ticket <span className="hint">simulated · 0.1% fee</span>
      </h2>

      <form onSubmit={onSubmit} noValidate>
        <div className="row">
          <div className="seg" role="group" aria-label="Side">
            <button type="button" aria-pressed={buy} className={buy ? 'on buy' : ''} onClick={() => patch({ side: 'buy' })}>
              Buy <kbd>B</kbd>
            </button>
            <button type="button" aria-pressed={!buy} className={!buy ? 'on sell' : ''} onClick={() => patch({ side: 'sell' })}>
              Sell <kbd>S</kbd>
            </button>
          </div>
          <div className="seg" role="group" aria-label="Order type">
            <button type="button" aria-pressed={t.type === 'market'} className={t.type === 'market' ? 'on' : ''} onClick={() => patch({ type: 'market' })}>
              Market <kbd>M</kbd>
            </button>
            <button type="button" aria-pressed={t.type === 'limit'} className={t.type === 'limit' ? 'on' : ''} onClick={() => patch({ type: 'limit' })}>
              Limit <kbd>L</kbd>
            </button>
          </div>
        </div>

        <div className="fields">
          <label>
            <span>Size (BTC) <kbd>Q</kbd></span>
            <input
              id="qty"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={t.qty}
              onChange={(e) => patch({ qty: e.target.value })}
              onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
              aria-invalid={error !== null}
            />
          </label>
          {t.type === 'limit' && (
            <label>
              <span>Limit price (USDT)</span>
              <input
                id="price"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder={bestBid && bestAsk ? ((bestBid + bestAsk) / 2).toFixed(2) : ''}
                value={t.price}
                onChange={(e) => patch({ price: e.target.value })}
                onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
                aria-invalid={error !== null}
              />
            </label>
          )}
        </div>

        <div className="chips" aria-label="Quick size">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => patch({ qty: p })}>
              {p}
            </button>
          ))}
          <span className="chip-gap" />
          {PERCENTS.map((pct) => (
            <button key={pct} type="button" className="chip" onClick={() => applyPercent(pct)} disabled={!refPrice}>
              {pct}%
            </button>
          ))}
        </div>

        <div className="estimate">
          <span>Est. {t.type === 'market' ? 'value' : 'notional'}</span>
          <span>{fmtUsd(notional)}</span>
          <span>Est. fee</span>
          <span>{fmtUsd(fee)}</span>
        </div>

        <button type="submit" className={`submit ${buy ? 'buy' : 'sell'}`} disabled={!live}>
          {live ? `${buy ? 'Buy' : 'Sell'} BTC · ${t.type}` : 'Waiting for live data…'}
        </button>
        <p className="form-error" role="alert">
          {error}
        </p>
      </form>
    </section>
  );
}
