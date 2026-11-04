import { fmtQty, fmtSignedUsd, fmtUsd } from '../lib/format';
import { useStore } from '../store/createStore';
import { market } from '../store/market';
import { equity, unrealized } from '../trading/account';
import { trading } from '../trading/model';

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'flat' }) {
  return (
    <div className="cell">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

const tone = (n: number) => (n > 0.005 ? 'up' : n < -0.005 ? 'down' : 'flat');

export function Account() {
  const account = useStore(trading.store, (s) => s.account);
  const last = useStore(market.store, (s) => s.last);

  const mark = last ?? account.avgPrice;
  const unreal = unrealized(account, mark);
  const total = equity(account, mark);

  return (
    <section className="panel account" aria-label="Account">
      <h2>
        Account{' '}
        <button type="button" className="link" onClick={() => trading.reset()}>
          reset
        </button>
      </h2>
      <div className="cells">
        <Cell label="Equity" value={fmtUsd(total)} />
        <Cell label="Cash" value={fmtUsd(account.cash)} />
        <Cell label="Position" value={`${fmtQty(account.qty)} BTC`} />
        <Cell label="Avg entry" value={account.qty > 0 ? fmtUsd(account.avgPrice) : '—'} />
        <Cell label="Unrealized" value={fmtSignedUsd(unreal)} tone={tone(unreal)} />
        <Cell label="Realized" value={fmtSignedUsd(account.realized)} tone={tone(account.realized)} />
        <Cell label="Fees paid" value={fmtUsd(account.fees)} />
      </div>
    </section>
  );
}
