// canvas 캔들 차트 (교체 가능 경계: setData / updateLastPrice / redraw / setMessage / destroy)
import { formatKst, unitMs } from '../lib/candles.js';
import { roundToTick } from '../lib/market-rules.js';

const VISIBLE = 120;
const RSI_H = 80;
const GAP = 10;
const AXIS_BOTTOM = 18;

function shortNum(v) {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(a >= 1e10 ? 0 : 2)}억`;
  if (a >= 1e6) return `${(v / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}만`;
  if (a >= 1000) return Math.round(v).toLocaleString('ko-KR');
  return String(roundToTick(v));
}

export function createChart(canvas) {
  const ctx = canvas.getContext('2d');
  let data = { candles: [] };
  let message = '차트 데이터를 불러오는 중…';
  let frame = 0;

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
  if (ro) ro.observe(canvas);

  function colors() {
    const cs = getComputedStyle(canvas);
    const v = (n, f) => cs.getPropertyValue(n).trim() || f;
    return {
      text: v('--text-muted', '#59636e'),
      grid: v('--border', '#e3e6ea'),
      up: v('--up', '#d63a3a'),
      down: v('--down', '#2458d6'),
      flat: v('--text-muted', '#888'),
      ma1: v('--ma1', '#e69a00'),
      ma2: v('--ma2', '#8a4fd6'),
      target: v('--target', '#13915f'),
      bg: v('--bg', '#fff')
    };
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const c = colors();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    const all = data.candles || [];
    if (!all.length) {
      ctx.fillStyle = c.text;
      ctx.textAlign = 'center';
      ctx.fillText(message || '', w / 2, h / 2);
      return;
    }

    const start = Math.max(0, all.length - VISIBLE);
    const cs = all.slice(start);
    const sliceArr = (arr) => (arr ? arr.slice(start) : null);
    const ma1 = sliceArr(data.ma?.short);
    const ma2 = sliceArr(data.ma?.long);
    const rsi = sliceArr(data.rsi?.values);
    const showRsi = !!rsi;

    const axisW = w < 480 ? 52 : 64;
    const plotW = w - axisW - 4;
    const priceH = (showRsi ? h - RSI_H - GAP : h) - AXIS_BOTTOM;
    const slot = plotW / cs.length;
    const body = Math.max(1, Math.min(12, slot * 0.7));

    let lo = Infinity;
    let hi = -Infinity;
    for (const k of cs) {
      lo = Math.min(lo, k.l);
      hi = Math.max(hi, k.h);
    }
    for (const arr of [ma1, ma2]) {
      if (arr) for (const x of arr) if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    // 점선 가격선: data.levels [{price, label, color:'target'|'up'|'down'}], data.target(vb 목표가)는 호환용
    const levels = (data.levels || []).filter((lv) => lv && lv.price > 0);
    if (data.target > 0) levels.push({ price: data.target, label: '목표가', color: 'target' });
    for (const lv of levels) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); }
    if (hi === lo) { hi += hi * 0.01 || 1; lo -= lo * 0.01 || 1; }
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const y = (p) => 6 + (1 - (p - lo) / (hi - lo)) * (priceH - 12);
    const x = (i) => i * slot + slot / 2;

    // 가격 눈금
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = c.text;
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const p = lo + ((hi - lo) * i) / 4;
      const yy = Math.round(y(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.fillText(shortNum(p), plotW + 6, yy);
    }

    // 캔들
    cs.forEach((k, i) => {
      const color = k.c > k.o ? c.up : k.c < k.o ? c.down : c.flat;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const cx = Math.round(x(i)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, y(k.h));
      ctx.lineTo(cx, y(k.l));
      ctx.stroke();
      const top = y(Math.max(k.o, k.c));
      const bh = Math.max(1, y(Math.min(k.o, k.c)) - top);
      ctx.fillRect(x(i) - body / 2, top, body, bh);
    });

    // 이동평균선
    const line = (arr, color, yfn) => {
      if (!arr) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      arr.forEach((v, i) => {
        if (v == null) return;
        if (!started) { ctx.moveTo(x(i), yfn(v)); started = true; } else ctx.lineTo(x(i), yfn(v));
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    line(ma1, c.ma1, y);
    line(ma2, c.ma2, y);

    // 점선 가격선(변동성 돌파 목표가, 조정 매수 매수가격선·익절선·손절선)
    for (const lv of levels) {
      const yy = Math.round(y(lv.price)) + 0.5;
      const color = c[lv.color] || c.target;
      ctx.strokeStyle = color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(lv.label || '', 4, yy - 8);
    }

    // 매수/매도 마커
    const um = data.unit ? unitMs(data.unit) : 0;
    for (const m of data.markers || []) {
      const i = cs.findIndex((k) => m.t >= k.t && m.t < k.t + um);
      if (i < 0) continue;
      const k = cs[i];
      const cx = x(i);
      ctx.fillStyle = m.side === 'buy' ? c.up : c.down;
      ctx.beginPath();
      if (m.side === 'buy') {
        const yy = y(k.l) + 4;
        ctx.moveTo(cx, yy);
        ctx.lineTo(cx - 5, yy + 8);
        ctx.lineTo(cx + 5, yy + 8);
      } else {
        const yy = y(k.h) - 4;
        ctx.moveTo(cx, yy);
        ctx.lineTo(cx - 5, yy - 8);
        ctx.lineTo(cx + 5, yy - 8);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 시간 축(KST)
    ctx.fillStyle = c.text;
    ctx.textAlign = 'center';
    const style = data.unit === 'days' ? 'date' : 'datetime';
    const ticks = w < 480 ? 3 : 4;
    for (let j = 0; j < ticks; j++) {
      const i = Math.round(((cs.length - 1) * (j + 0.5)) / ticks);
      ctx.fillText(formatKst(cs[i].t, style), Math.min(Math.max(x(i), 30), plotW - 30), priceH + AXIS_BOTTOM / 2 + 2);
    }

    // RSI 패널
    if (showRsi) {
      const top = priceH + AXIS_BOTTOM + GAP;
      const ry = (v) => top + (1 - v / 100) * RSI_H;
      ctx.strokeStyle = c.grid;
      ctx.strokeRect(0.5, top + 0.5, plotW, RSI_H - 1);
      ctx.setLineDash([3, 3]);
      ctx.fillStyle = c.text;
      ctx.textAlign = 'left';
      for (const g of [data.rsi.low ?? 30, data.rsi.high ?? 70]) {
        ctx.beginPath();
        ctx.moveTo(0, ry(g));
        ctx.lineTo(plotW, ry(g));
        ctx.stroke();
        ctx.fillText(String(g), plotW + 6, ry(g));
      }
      ctx.setLineDash([]);
      ctx.fillText('RSI', 4, top + 9);
      line(rsi, c.ma2, ry);
    }
  }

  return {
    setData(d) {
      data = d || { candles: [] };
      schedule();
    },
    // 형성 중인 마지막 캔들을 실시간 가격으로 갱신
    updateLastPrice(price, now = Date.now()) {
      const cs = data.candles;
      if (!cs || !cs.length || !data.unit || !(price > 0)) return;
      const k = cs[cs.length - 1];
      if (now >= k.t + unitMs(data.unit) || now < k.t) return;
      k.c = price;
      k.h = Math.max(k.h, price);
      k.l = Math.min(k.l, price);
      schedule();
    },
    setMessage(msg) {
      message = msg;
      if (!data.candles?.length) schedule();
    },
    redraw: schedule,
    destroy() {
      if (ro) ro.disconnect();
    }
  };
}
