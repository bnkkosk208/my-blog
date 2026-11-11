// 간이 백테스트 (순수 함수). 매번 사용 가능 KRW 전액(수수료 제외)으로 매수한다고 가정
import { sma, rsiWilder } from './indicators.js';
import { STRATEGIES, maCross, rsiCross, vbTarget, dipBuyLine, dipTakeProfit, dipStopLine, atOrAbove, atOrBelow } from './strategies.js';
import { FEE_RATE, simulateBuy, simulateSell, realizedPnl, MIN_ORDER_KRW } from './market-rules.js';

// 백테스트 체결 가정(화면에 그대로 표시)
export const BACKTEST_ASSUMPTIONS = {
  dip: [
    '장중 저가가 매수가격선(전일 종가 × (1 − 하락폭)) 이하면 매수가격선에 매수 체결(시가가 이미 아래면 시가)',
    '보유 중 고가가 익절선 이상이면 익절선에, 저가가 손절선 이하면 손절선에 매도 체결(시가가 이미 넘으면 시가)',
    '같은 캔들에서 익절선·손절선에 둘 다 닿으면 손절로 처리(보수적)',
    '매수한 캔들에서는 익절하지 않고 손절선만 확인, 매도한 캔들에서는 다시 매수하지 않음(하루 1회 진입)'
  ],
  vb: ['당일 고가가 목표가 이상이면 목표가에 매수, 다음 일봉 시가에 매도'],
  ma: ['신호가 난 캔들의 다음 캔들 시가에 체결'],
  rsi: ['신호가 난 캔들의 다음 캔들 시가에 체결']
};

/**
 * @param {Array} candles 과거→최신, 마감 캔들
 * @param {'dip'|'vb'|'ma'|'rsi'} strategyId
 * @param {object} params
 * @param {{initialKrw?:number, feeRate?:number, slippage?:number}} opts
 */
export function runBacktest(candles, strategyId, params = {}, opts = {}) {
  const p = { ...STRATEGIES[strategyId].defaults, ...params };
  const initialKrw = opts.initialKrw ?? 1000000;
  const feeRate = opts.feeRate ?? FEE_RATE;
  const slippage = opts.slippage ?? 0;
  const n = candles.length;

  let krw = initialKrw;
  let pos = null;
  const trades = [];
  const markers = [];
  const equity = new Array(n).fill(initialKrw);
  const assumptions = BACKTEST_ASSUMPTIONS[strategyId] || [];

  const buy = (i, price) => {
    const amount = Math.floor(krw / (1 + feeRate));
    if (amount < MIN_ORDER_KRW || pos) return;
    const f = simulateBuy({ krw: amount, price, feeRate, slippage });
    krw -= f.cost;
    pos = { qty: f.qty, cost: f.cost, entryT: candles[i].t, entryPrice: f.price };
    markers.push({ t: candles[i].t, side: 'buy', price: f.price });
  };
  const sell = (i, price) => {
    if (!pos) return;
    const f = simulateSell({ qty: pos.qty, price, feeRate, slippage });
    krw += f.net;
    const pnl = realizedPnl({ net: f.net, cost: pos.cost, soldQty: pos.qty, boughtQty: pos.qty });
    trades.push({ ...pos, exitT: candles[i].t, exitPrice: f.price, pnl, pnlPct: pnl / pos.cost, open: false });
    markers.push({ t: candles[i].t, side: 'sell', price: f.price });
    pos = null;
  };

  if (strategyId === 'dip') {
    // 일봉 OHLC만으로는 장중 순서를 모르므로 BACKTEST_ASSUMPTIONS.dip의 보수적 가정을 쓴다
    for (let i = 1; i < n; i++) {
      const c = candles[i];
      let exited = false;
      if (pos) {
        const tp = dipTakeProfit(pos.entryPrice, p.risePct);
        const sl = dipStopLine(pos.entryPrice, p.stopPct);
        if (atOrBelow(c.l, sl)) { sell(i, Math.min(c.o, sl)); exited = true; } // 같은 캔들에서 둘 다 닿으면 손절 우선
        else if (atOrAbove(c.h, tp)) { sell(i, Math.max(c.o, tp)); exited = true; }
      }
      if (!pos && !exited) {
        const line = dipBuyLine(candles[i - 1].c, p.dropPct);
        if (atOrBelow(c.l, line)) {
          buy(i, Math.min(c.o, line));
          // 진입한 캔들에서는 이후 저가가 손절선에 닿았다고 보수적으로 가정(익절은 다음 캔들부터)
          if (pos && atOrBelow(c.l, dipStopLine(pos.entryPrice, p.stopPct))) sell(i, dipStopLine(pos.entryPrice, p.stopPct));
        }
      }
      equity[i] = krw + (pos ? pos.qty * c.c : 0);
    }
  } else if (strategyId === 'vb') {
    const closes = candles.map((c) => c.c);
    for (let i = 1; i < n; i++) {
      const c = candles[i];
      if (pos) sell(i, c.o);
      const target = vbTarget(c.o, candles[i - 1].h, candles[i - 1].l, p.k);
      let pass = true;
      if (p.maFilter) {
        if (i < 5) pass = false;
        else pass = c.o > closes.slice(i - 5, i).reduce((a, b) => a + b, 0) / 5;
      }
      if (pass && c.h >= target) buy(i, target);
      equity[i] = krw + (pos ? pos.qty * c.c : 0);
    }
  } else {
    const closes = candles.map((c) => c.c);
    let signalAt;
    if (strategyId === 'ma') {
      const s = sma(closes, p.short);
      const l = sma(closes, p.long);
      signalAt = (i) => {
        const x = maCross(s[i - 1], l[i - 1], s[i], l[i]);
        return x === 'golden' ? 'buy' : x === 'dead' ? 'sell' : null;
      };
    } else {
      const r = rsiWilder(closes, p.period);
      signalAt = (i) => rsiCross(r[i - 1], r[i], p.low, p.high);
    }
    let pending = null;
    for (let i = 1; i < n; i++) {
      const c = candles[i];
      // 직전 캔들 신호는 이번 캔들 시가에 체결
      if (pending === 'buy') buy(i, c.o);
      else if (pending === 'sell') sell(i, c.o);
      pending = signalAt(i);
      equity[i] = krw + (pos ? pos.qty * c.c : 0);
    }
  }

  const lastClose = n ? candles[n - 1].c : 0;
  if (pos) {
    const value = pos.qty * lastClose;
    trades.push({ ...pos, exitT: null, exitPrice: lastClose, pnl: value - pos.cost, pnlPct: (value - pos.cost) / pos.cost, open: true });
  }
  const finalEquity = n ? equity[n - 1] : initialKrw;

  let peak = -Infinity;
  let mdd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    if (peak > 0) mdd = Math.max(mdd, (peak - e) / peak);
  }

  const closed = trades.filter((t) => !t.open);
  const wins = closed.filter((t) => t.pnl > 0).length;

  let buyHold = 0;
  if (n > 1) {
    const amount = Math.floor(initialKrw / (1 + feeRate));
    const f = simulateBuy({ krw: amount, price: candles[0].o, feeRate, slippage });
    buyHold = (initialKrw - f.cost + f.qty * lastClose) / initialKrw - 1;
  }

  return {
    initialKrw,
    finalEquity,
    totalReturn: finalEquity / initialKrw - 1,
    tradeCount: closed.length,
    winRate: closed.length ? wins / closed.length : null,
    mdd,
    buyHoldReturn: buyHold,
    trades,
    markers,
    equity,
    from: n ? candles[0].t : null,
    to: n ? candles[n - 1].t : null,
    assumptions
  };
}
