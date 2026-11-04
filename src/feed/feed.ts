import { parseMessage, type FeedEvent } from './protocol';

export type FeedStatus = 'connecting' | 'live' | 'stale' | 'reconnecting' | 'offline';

export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}
export type SocketCtor = new (url: string) => SocketLike;

export interface FeedOptions {
  /** Base URLs tried round-robin, one per connection attempt. */
  hosts: string[];
  /** Lower-case symbol, e.g. "btcusdt". */
  symbol: string;
  onEvent: (event: FeedEvent) => void;
  onStatus: (status: FeedStatus) => void;
  WebSocketImpl?: SocketCtor;
  /** No frame for this long => the connection is considered dead. */
  staleAfterMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
}

export interface Feed {
  stop(): void;
}

/**
 * One multiplexed socket (trade + depth + 24h ticker) with:
 *  - exponential backoff with jitter, reset once data actually flows,
 *  - host rotation between attempts,
 *  - a watchdog that kills half-open sockets that stop delivering frames,
 *  - stale-socket protection: events from a replaced socket are ignored.
 */
export function startFeed(opts: FeedOptions): Feed {
  const Ctor = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as SocketCtor);
  const staleAfterMs = opts.staleAfterMs ?? 5_000;
  const baseBackoffMs = opts.baseBackoffMs ?? 1_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 15_000;
  const random = opts.random ?? Math.random;
  const streams = `${opts.symbol}@trade/${opts.symbol}@depth20@100ms/${opts.symbol}@ticker`;

  let socket: SocketLike | null = null;
  let stopped = false;
  let attempt = 0; // consecutive failed attempts
  let hostIndex = 0;
  let lastFrameAt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let status: FeedStatus | null = null;

  const setStatus = (next: FeedStatus) => {
    if (next !== status) {
      status = next;
      opts.onStatus(next);
    }
  };

  const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  function detach(sock: SocketLike) {
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try {
      sock.close();
    } catch {
      /* already closed */
    }
  }

  function scheduleRetry() {
    if (stopped || retryTimer !== undefined) return;
    attempt++;
    hostIndex++;
    const ceiling = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));
    const delay = ceiling / 2 + (random() * ceiling) / 2; // "equal jitter"
    if (isOffline()) setStatus('offline');
    else if (status !== 'stale') setStatus('reconnecting');
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      open();
    }, delay);
  }

  function open() {
    if (stopped || socket) return;
    const host = opts.hosts[hostIndex % opts.hosts.length];
    if (!host) return;
    setStatus(attempt === 0 ? 'connecting' : isOffline() ? 'offline' : 'reconnecting');

    let sock: SocketLike;
    try {
      sock = new Ctor(`${host}/stream?streams=${streams}`);
    } catch {
      scheduleRetry();
      return;
    }
    socket = sock;
    lastFrameAt = Date.now(); // connecting time counts toward the watchdog too

    sock.onopen = () => {
      if (socket !== sock) return;
      lastFrameAt = Date.now();
    };
    sock.onmessage = (ev) => {
      if (socket !== sock) return;
      lastFrameAt = Date.now();
      if (status !== 'live') {
        attempt = 0; // healthy again: data is flowing
        setStatus('live');
      }
      if (typeof ev.data !== 'string') return;
      const event = parseMessage(ev.data);
      if (event) opts.onEvent(event);
    };
    sock.onerror = () => {
      /* a close event always follows; handled there */
    };
    sock.onclose = () => {
      if (socket !== sock) return;
      socket = null;
      scheduleRetry();
    };
  }

  const watchdog = setInterval(() => {
    if (stopped || !socket) return;
    if (Date.now() - lastFrameAt <= staleAfterMs) return;
    if (status === 'live') setStatus('stale');
    detach(socket);
    socket = null;
    scheduleRetry();
  }, 1_000);

  const onOnline = () => {
    if (stopped) return;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    attempt = 0;
    if (!socket) open();
  };
  const onOffline = () => {
    if (!stopped) setStatus('offline');
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  open();

  return {
    stop() {
      stopped = true;
      clearInterval(watchdog);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
      if (socket) detach(socket);
      socket = null;
    },
  };
}
