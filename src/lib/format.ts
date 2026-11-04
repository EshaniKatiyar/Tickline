// Intl.NumberFormat construction is expensive; build each shape once and reuse it.
const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let fmt = numberFormats.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormats.set(key, fmt);
  }
  return fmt;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const DASH = '—';

export function fmtPrice(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? DASH : numberFormat(2, 2).format(n);
}

export function fmtQty(n: number | null | undefined, decimals = 5): string {
  return n == null || !Number.isFinite(n) ? DASH : numberFormat(decimals, decimals).format(n);
}

export function fmtUsd(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? DASH : `$${numberFormat(2, 2).format(n)}`;
}

export function fmtSignedUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${numberFormat(2, 2).format(Math.abs(n))}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function fmtCompact(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? DASH : compact.format(n);
}

export function fmtClock(ts: number): string {
  return clock.format(new Date(ts));
}

/** Render a number for a text input: max `decimals` places, no trailing zeros. */
export function toInputString(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}
