import { memo } from 'react';
import { fmtClock, fmtPrice, fmtQty } from '../lib/format';
import { useStore } from '../store/createStore';
import { trading } from '../trading/model';
import type { Order, OrderStatus } from '../trading/orders';

const STATUS_LABEL: Record<OrderStatus, string> = {
  submitting: 'Sending…',
  open: 'Open',
  filled: 'Filled',
  rejected: 'Rejected',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const OrderRow = memo(function OrderRow({ order }: { order: Order }) {
  const price = order.status === 'filled' ? order.fillPrice : order.limit;
  return (
    <li className="order-row">
      <span className="o-time">{fmtClock(order.createdAt)}</span>
      <span className={`o-side ${order.side}`}>{order.side.toUpperCase()}</span>
      <span className="o-desc">
        {fmtQty(order.qty)} <em>{order.type}</em>
        {price !== undefined && <> @ {fmtPrice(price)}</>}
        {order.attempts > 1 && <small> · attempt {order.attempts}</small>}
        {order.reason && <small className="o-reason"> · {order.reason}</small>}
      </span>
      <span className={`status ${order.status}`}>{STATUS_LABEL[order.status]}</span>
      <span className="o-actions">
        {order.status === 'failed' && (
          <button type="button" className="mini" onClick={() => trading.retry(order.id)}>
            Retry
          </button>
        )}
        {(order.status === 'open' || order.status === 'failed') && (
          <button type="button" className="mini" onClick={() => trading.cancel(order.id)}>
            {order.status === 'open' ? 'Cancel' : 'Dismiss'}
          </button>
        )}
      </span>
    </li>
  );
});

export function Blotter() {
  const orders = useStore(trading.store, (s) => s.orders);

  return (
    <section className="panel blotter" aria-label="Orders">
      <h2>Orders</h2>
      {orders.length === 0 ? (
        <p className="empty-note">No orders yet. Click a price in the book or use the ticket.</p>
      ) : (
        <ul className="orders">
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </ul>
      )}
    </section>
  );
}
