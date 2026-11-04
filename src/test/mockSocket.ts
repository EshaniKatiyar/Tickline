import type { SocketLike } from '../feed/feed';

/** Controllable stand-in for WebSocket. Tests drive it with serverOpen / serverSend / serverClose. */
export class MockWebSocket implements SocketLike {
  static instances: MockWebSocket[] = [];

  static reset() {
    MockWebSocket.instances = [];
  }
  static get last(): MockWebSocket {
    const sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!sock) throw new Error('no socket has been created');
    return sock;
  }

  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  serverOpen() {
    this.onopen?.({});
  }
  serverSend(stream: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ stream, data }) });
  }
  serverClose() {
    this.onclose?.({});
  }
}

export const tradeFrame = (price: number, qty = 0.01) => ({ e: 'trade', p: String(price), q: String(qty), T: 1 });

export const depthFrame = (bestBid: number, bestAsk: number, size = 1) => ({
  lastUpdateId: 1,
  bids: Array.from({ length: 5 }, (_, i) => [String(bestBid - i), String(size)]),
  asks: Array.from({ length: 5 }, (_, i) => [String(bestAsk + i), String(size)]),
});

export const tickerFrame = (last: number) => ({ c: String(last), P: '1.25', h: String(last + 100), l: String(last - 100), v: '1234.5' });
