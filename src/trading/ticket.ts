import { createStore } from '../store/createStore';
import type { Side } from './account';
import type { OrderType } from './orders';

export interface TicketState {
  side: Side;
  type: OrderType;
  qty: string;
  price: string;
}

/** Order-ticket form state lives outside React so the order book can prefill it with a click. */
export const ticket = createStore<TicketState>({ side: 'buy', type: 'market', qty: '0.01', price: '' });

export function pickPrice(price: number): void {
  ticket.set((s) => ({ ...s, type: 'limit', price: price.toFixed(2) }));
}
