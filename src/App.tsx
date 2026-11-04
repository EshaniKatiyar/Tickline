import { useEffect } from 'react';
import { Account } from './components/Account';
import { Blotter } from './components/Blotter';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { OrderBook } from './components/OrderBook';
import { OrderTicket } from './components/OrderTicket';
import { PriceChart } from './components/PriceChart';
import { fmtCompact } from './lib/format';
import { gateway } from './trading/model';
import { market } from './store/market';
import { useStore } from './store/createStore';
import { ticket } from './trading/ticket';

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'b':
          ticket.set((s) => ({ ...s, side: 'buy' }));
          break;
        case 's':
          ticket.set((s) => ({ ...s, side: 'sell' }));
          break;
        case 'm':
          ticket.set((s) => ({ ...s, type: 'market' }));
          break;
        case 'l':
          ticket.set((s) => ({ ...s, type: 'limit' }));
          break;
        case 'q':
          e.preventDefault();
          document.getElementById('qty')?.focus();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useDocumentTitle() {
  // Whole-dollar granularity: the title changes a few times a minute, not on every tick.
  const dollars = useStore(market.store, (s) => (s.last === null ? null : Math.round(s.last)));
  useEffect(() => {
    document.title = dollars === null ? 'Tickline' : `$${fmtCompact(dollars)} - Tickline`;
  }, [dollars]);
}

export function App() {
  useEffect(() => market.start(), []);
  useHotkeys();
  useDocumentTitle();

  return (
    <div className="terminal">
      <Header />
      <main className="grid">
        <div className="area-chart">
          <ErrorBoundary label="Chart">
            <PriceChart />
          </ErrorBoundary>
        </div>
        <div className="area-book">
          <ErrorBoundary label="Order book">
            <OrderBook />
          </ErrorBoundary>
        </div>
        <div className="area-ticket">
          <ErrorBoundary label="Order ticket">
            <Account />
            <OrderTicket />
          </ErrorBoundary>
        </div>
        <div className="area-orders">
          <ErrorBoundary label="Orders">
            <Blotter />
          </ErrorBoundary>
        </div>
      </main>
      <footer className="foot">
        <span>
          <kbd>B</kbd> buy · <kbd>S</kbd> sell · <kbd>M</kbd> market · <kbd>L</kbd> limit · <kbd>Q</kbd> size · <kbd>Enter</kbd> submit
        </span>
        <label className="flaky">
          <input
            type="checkbox"
            onChange={(e) => {
              gateway.failureRate = e.target.checked ? 0.3 : 0;
            }}
          />
          Simulate flaky network
        </label>
      </footer>
    </div>
  );
}
