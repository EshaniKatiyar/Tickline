import type { FeedStatus } from '../feed/feed';
import { fmtCompact, fmtPct, fmtPrice } from '../lib/format';
import { useStore } from '../store/createStore';
import { market } from '../store/market';

const STATUS_LABEL: Record<FeedStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  stale: 'Data stale',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export function Header() {
  const status = useStore(market.store, (s) => s.status);
  const last = useStore(market.store, (s) => s.last);
  const tick = useStore(market.store, (s) => s.tick);
  const changePct = useStore(market.store, (s) => s.changePct);
  const high = useStore(market.store, (s) => s.high);
  const low = useStore(market.store, (s) => s.low);
  const volume = useStore(market.store, (s) => s.volume);

  const live = status === 'live';
  const changeDir = changePct === null ? 'flat' : changePct >= 0 ? 'up' : 'down';

  return (
    <header className="header panel">
      <div className="brand">
        TickLine <span>BTC/USDT</span>
      </div>

      <div className="header-price">
        <span className={`price ${live ? tick : 'flat'} ${live ? '' : 'dim'}`} aria-label="Last price">
          {fmtPrice(last)}
        </span>
        <span className={`pill ${changeDir}`} title="24h change">
          {fmtPct(changePct)}
        </span>
      </div>

      <div className="header-stats">
        <Stat label="24h high" value={fmtPrice(high)} />
        <Stat label="24h low" value={fmtPrice(low)} />
        <Stat label="24h volume" value={volume === null ? '—' : `${fmtCompact(volume)} BTC`} />
      </div>

      <div className={`conn ${status}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />
        {STATUS_LABEL[status]}
      </div>
    </header>
  );
}
