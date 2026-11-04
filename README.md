# TickLine

A live BTC/USDT trading terminal built with React + TypeScript: streaming order book, canvas chart, and a simulated execution flow with positions and P&L.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 69 tests
npm run build      # typecheck + production build
```

Market data comes from Binance's public combined WebSocket stream (trades, top-20 depth at 100 ms, 24h ticker). Orders are **simulated** against the live book; nothing is sent anywhere.

## What it does

- **Live market**: last price with tick direction, true 24h change/high/low/volume, connection status.
- **Chart**: last two minutes of trades on a canvas with axes, grid and a last-price marker.
- **Order book**: 10 levels per side with cumulative depth, spread in bps, click a level to prefill a limit price.
- **Execution**: market and limit orders, fills walk the visible book (VWAP), limit orders rest and fill when the market crosses, 0.1% fees, spot-only account with average entry, realized/unrealized P&L.
- **Keyboard-first**: `B` buy, `S` sell, `M` market, `L` limit, `Q` focus size, `Enter` submit.

## Architecture

```
feed/      protocol.ts  pure parser, never throws
           feed.ts      socket lifecycle: backoff + jitter, host rotation, stale watchdog
store/     createStore  tiny external store + useSyncExternalStore hook
           market.ts    frame-coalesced market state + trade ring buffer
trading/   account.ts   pure fill/P&L math
           orders.ts    validation, book walking (pure)
           model.ts     order state machine, retry/cancel, resting-order matching
components/             thin views over the stores
```

Rules I held to: logic lives in pure functions with tests; components only read slices of state through selectors; the hot path never allocates per tick beyond one small object.

## Hardest technical decision

Streaming data at hundreds of frames per second versus a UI that has to stay at 60 fps. The first version re-rendered everything on every message. The design now has three layers:

1. Socket frames are parsed and coalesced, so React sees **at most one state change per animation frame** (tested: 500 trades in a burst produce one notification).
2. Trades go straight into a fixed-size ring buffer. The canvas chart reads that buffer on its own `requestAnimationFrame` loop, so **the chart causes zero React renders**.
3. The order book rows are memoized by primitive props, so only rows whose price or size changed re-render.

The second hard problem was retries. Resending a failed order must never create a second order or fill twice. Orders are a small state machine (`submitting → open | filled | rejected | failed → submitting …`) keyed by a stable id; only `failed` can be retried, and a late acknowledgement for an order that has already moved on is ignored. Both behaviours are covered by tests.

## Reliability details

- One multiplexed socket, not three. Reconnect uses exponential backoff with jitter, resets only after data flows, and alternates between `stream.binance.com` and `data-stream.binance.vision`.
- A watchdog drops sockets that stay open but go silent for 5 s, and the UI shows the feed state. Trading is disabled and resting orders are frozen while the feed is not live.
- Corrupt frames (malformed JSON, non-positive prices, crossed books) are dropped and the last good book is kept.
- Fat-finger guard: limit prices more than 10% from the mid are refused.
- Per-panel error boundaries; `prefers-reduced-motion` respected; controls are keyboard-reachable.
- "Simulate flaky network" in the footer makes 30% of sends time out so you can exercise retry.

## Not measured yet

I have not profiled this in a real browser. Before sharing, add your own numbers here (React Profiler commits per second, frame time in the Performance tab, heap after 10 minutes) rather than trusting the design alone.

## What I would improve next

- Replace partial-depth snapshots with the diff stream plus sequence-gap detection and resync, for a locally maintained full book.
- Move parsing and book maintenance into a Web Worker.
- Swap the data source for Polymarket (Gamma API for discovery, CLOB socket for the book) with Yes/No pricing in cents and implied probability.
- Persist the paper account, add a positions history and PnL curve.
- Playwright end-to-end tests against a recorded stream.
