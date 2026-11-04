import { useEffect, useRef } from 'react';
import { fmtPrice } from '../lib/format';
import { market } from '../store/market';

const WINDOW_MS = 120_000;
const GUTTER_RIGHT = 74;
const GUTTER_BOTTOM = 20;
const PAD_TOP = 10;
const TIME_MARKS = [90, 60, 30];

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Canvas line chart of the last two minutes of trades. It reads the market ring buffer directly
 * and redraws on animation frames, so streaming data never triggers a React render.
 */
export function PriceChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const up = token('--green', '#17c783');
    const down = token('--red', '#ff4d5e');
    const grid = token('--border', '#1c2027');
    const muted = token('--muted', '#7b8494');
    const fg = token('--text', '#edf0f3');
    const mono = token('--mono', 'monospace');

    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let disposed = false;

    const draw = () => {
      frame = 0;
      if (disposed || width < 120 || height < 80) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = `11px ${mono}`;
      ctx.textBaseline = 'middle';

      const ticks = market.ticks;
      const n = ticks.length;
      const plotW = width - GUTTER_RIGHT;
      const plotBottom = height - GUTTER_BOTTOM;
      const plotH = plotBottom - PAD_TOP;
      const tEnd = Date.now();
      const tStart = tEnd - WINDOW_MS;

      // Walk back from the newest tick to find where the visible window begins.
      let first = n;
      for (let i = n - 1; i >= 0; i--) {
        const tk = ticks.at(i);
        if (!tk || tk.t < tStart) break;
        first = i;
      }

      if (n - first < 2) {
        ctx.fillStyle = muted;
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for trades…', plotW / 2, plotH / 2);
        return;
      }

      let min = Infinity;
      let max = -Infinity;
      for (let i = first; i < n; i++) {
        const tk = ticks.at(i);
        if (!tk) continue;
        if (tk.p < min) min = tk.p;
        if (tk.p > max) max = tk.p;
      }
      const pad = (max - min) * 0.12 || max * 0.0004;
      const lo = min - pad;
      const hi = max + pad;
      const xOf = (t: number) => ((t - tStart) / WINDOW_MS) * plotW;
      const yOf = (p: number) => PAD_TOP + ((hi - p) / (hi - lo)) * plotH;

      // Grid + axes
      ctx.lineWidth = 1;
      ctx.strokeStyle = grid;
      ctx.fillStyle = muted;
      ctx.textAlign = 'left';
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) {
        const price = lo + ((hi - lo) * k) / 4;
        const y = Math.round(yOf(price)) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.fillText(fmtPrice(price), plotW + 8, y);
      }
      ctx.stroke();
      ctx.textAlign = 'center';
      for (const s of TIME_MARKS) {
        const x = Math.round(plotW * (1 - (s * 1000) / WINDOW_MS)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, PAD_TOP);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();
        ctx.fillText(`−${s}s`, x, plotBottom + 11);
      }

      // Series
      const firstTick = ticks.at(first);
      const lastTick = ticks.last();
      if (!firstTick || !lastTick) return;
      const rising = lastTick.p >= firstTick.p;
      const color = rising ? up : down;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, plotW, plotBottom);
      ctx.clip();

      ctx.beginPath();
      for (let i = first; i < n; i++) {
        const tk = ticks.at(i);
        if (!tk) continue;
        const x = xOf(tk.t);
        const y = yOf(tk.p);
        if (i === first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = 'round';
      ctx.stroke();

      ctx.lineTo(xOf(lastTick.t), plotBottom);
      ctx.lineTo(xOf(firstTick.t), plotBottom);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, PAD_TOP, 0, plotBottom);
      fill.addColorStop(0, withAlpha(color, 0.22));
      fill.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();

      // Last-price marker
      const yLast = yOf(lastTick.p);
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = withAlpha(color, 0.6);
      ctx.beginPath();
      ctx.moveTo(0, yLast);
      ctx.lineTo(plotW, yLast);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(plotW + 2, yLast - 9, GUTTER_RIGHT - 4, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#04120c';
      ctx.textAlign = 'left';
      ctx.font = `600 11px ${mono}`;
      ctx.fillText(fmtPrice(lastTick.p), plotW + 8, yLast);
      ctx.fillStyle = fg;
    };

    const request = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(draw);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      width = Math.floor(rect.width);
      height = Math.floor(rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      request();
    };

    resize();
    const unsubscribe = market.store.subscribe(request);
    const heartbeat = setInterval(request, 1_000); // keep the time axis moving through quiet periods
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(canvas);
    else window.addEventListener('resize', resize);

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      clearInterval(heartbeat);
      unsubscribe();
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <section className="panel chart-panel" aria-label="Price chart">
      <h2>Price · last 2 min</h2>
      <canvas ref={canvasRef} className="chart" role="img" aria-label="Live BTC/USDT price chart for the last two minutes" />
    </section>
  );
}
