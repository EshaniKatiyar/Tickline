import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { MockWebSocket, depthFrame, tickerFrame, tradeFrame } from './test/mockSocket';

beforeAll(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  // jsdom has no canvas implementation; the chart must degrade gracefully.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

beforeEach(() => {
  MockWebSocket.reset();
});
afterEach(() => cleanup());

function goLive(bid = 66_999, ask = 67_001) {
  const sock = MockWebSocket.last;
  act(() => {
    sock.serverOpen();
    sock.serverSend('btcusdt@trade', tradeFrame(67_000));
    sock.serverSend('btcusdt@ticker', tickerFrame(67_000));
    sock.serverSend('btcusdt@depth20@100ms', depthFrame(bid, ask, 2));
  });
}

describe('<App />', () => {
  it('opens exactly one socket and renders live data', async () => {
    render(<App />);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toContain('Connecting');

    goLive();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Live'));
    expect(screen.getByLabelText('Last price').textContent).toBe('67,000.00');
    expect(screen.getByText('+1.25%')).toBeTruthy();
    // 5 levels per side from the mock frame; the other rows are inert placeholders
    expect(screen.getAllByTitle(/Set limit price/)).toHaveLength(10);
  });

  it('closes the socket on unmount', () => {
    const { unmount } = render(<App />);
    const sock = MockWebSocket.last;
    unmount();
    expect(sock.closed).toBe(true);
  });

  it('disables trading until the feed is live', () => {
    render(<App />);
    const submit = screen.getByRole('button', { name: /Waiting for live data/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('places a market order from the ticket and shows it fill', async () => {
    render(<App />);
    goLive();
    fireEvent.change(document.getElementById('qty') as HTMLInputElement, { target: { value: '0.25' } });
    fireEvent.click(screen.getByRole('button', { name: /Buy BTC · market/ }));

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Sending…')).toBeTruthy();
    await waitFor(() => expect(within(list).getByText('Filled')).toBeTruthy(), { timeout: 3_000 });
    expect(screen.getByText('0.25000 BTC')).toBeTruthy(); // position
  });

  it('shows validation errors inline', async () => {
    render(<App />);
    goLive();
    fireEvent.change(document.getElementById('qty') as HTMLInputElement, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Buy BTC/ }));
    const alert = await screen.findByText(/Minimum size/);
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('clicking a book level switches to limit and prefills the price', async () => {
    render(<App />);
    goLive();
    fireEvent.click(screen.getAllByTitle('Set limit price to 67,001.00')[0] as HTMLElement);
    const price = (await screen.findByLabelText(/Limit price/)) as HTMLInputElement;
    expect(price.value).toBe('67001.00');
  });

  it('keyboard shortcuts drive the ticket', async () => {
    render(<App />);
    goLive();
    fireEvent.keyDown(window, { key: 's' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Sell BTC/ })).toBeTruthy());
    fireEvent.keyDown(window, { key: 'l' });
    expect(await screen.findByLabelText(/Limit price/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'b' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Buy BTC/ })).toBeTruthy());
  });
});
