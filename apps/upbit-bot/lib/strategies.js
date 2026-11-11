// 전략: 같은 입력 → 같은 출력인 순수 함수 (DOM·시간·네트워크 의존 없음)
import { sma, rsiWilder } from './indicators.js';
import { dayStartUtc } from './candles.js';

export const STRATEGIES = {
  dip: {
    id: 'dip',
    name: '조정 매수',
    candle: 'days',
    defaults: { dropPct: 10, risePct: 10, stopPct: 10 },
    minCandles: 2,
    desc: '현재가가 전일 종가(업비트 일봉, KST 09:00 기준)보다 설정한 비율 이상 떨어지면 매수하고, 매수가 대비 설정한 비율 이상 오르면 익절, 설정한 비율 이상 떨어지면 손절합니다. 하루(일봉) 1회만 진입하고 보유 기간 제한은 없습니다. BTC 같은 대형 코인은 하루 10% 하락이 드물어 몇 주·몇 달 동안 매수가 없을 수 있습니다.'
  },
  vb: {
    id: 'vb',
    name: '변동성 돌파',
    candle: 'days',
    defaults: { k: 0.5, maFilter: false },
    minCandles: 2,
    desc: '당일 시가 + 전일 변동폭 × K를 넘으면 매수하고, 다음 일봉 시작(KST 09:00) 후 매도합니다. 하루 1회만 진입합니다.'
  },
  ma: {
    id: 'ma',
    name: '이동평균 교차',
    candle: 'minutes/60',
    defaults: { short: 5, long: 20, unit: 'minutes/60' },
    minCandles: 21,
    desc: '마감 캔들 기준 단기 이동평균이 장기 이동평균을 위로 뚫으면(골든크로스) 매수, 아래로 뚫으면(데드크로스) 매도합니다.'
  },
  rsi: {
    id: 'rsi',
    name: 'RSI',
    candle: 'minutes/60',
    defaults: { period: 14, low: 30, high: 70, unit: 'minutes/60' },
    minCandles: 15,
    desc: 'RSI가 과매도 기준을 위로 회복하면 매수, 과매수 기준 아래로 내려오면 매도합니다. 하락장에서는 오래 청산되지 않을 수 있으니 설정 탭의 손절 사용을 고려하세요.'
  }
};

// 숫자 파라미터 범위 (UI 입력과 검증에 같이 사용)
export const PARAM_SPECS = {
  dip: [
    { key: 'dropPct', label: '매수 하락폭(%)', min: 1, max: 50, step: 0.5 },
    { key: 'risePct', label: '익절 상승폭(%)', min: 1, max: 100, step: 0.5 },
    { key: 'stopPct', label: '손절 하락폭(%)', min: 1, max: 50, step: 0.5 }
  ],
  vb: [
    { key: 'k', label: 'K', min: 0.1, max: 1, step: 0.05 }
  ],
  ma: [
    { key: 'short', label: '단기', min: 2, max: 100, step: 1, int: true },
    { key: 'long', label: '장기', min: 2, max: 100, step: 1, int: true }
  ],
  rsi: [
    { key: 'period', label: '기간', min: 2, max: 100, step: 1, int: true },
    { key: 'low', label: '과매도', min: 1, max: 99, step: 1 },
    { key: 'high', label: '과매수', min: 1, max: 99, step: 1 }
  ]
};

export const STRATEGY_UNITS = ['minutes/15', 'minutes/60', 'minutes/240', 'days'];

// 가격 수신마다 판정하고 형성 중인 당일 일봉을 포함해 쓰는 전략(ma/rsi는 마감 캔들 기준)
export function isPriceBased(strategyId) {
  return strategyId === 'vb' || strategyId === 'dip';
}

export function candleUnitOf(strategyId, params = {}) {
  if (isPriceBased(strategyId)) return 'days';
  return params.unit || STRATEGIES[strategyId].candle;
}

export function minCandlesFor(strategyId, params = {}) {
  if (strategyId === 'vb') return params.maFilter ? 6 : 2;
  if (strategyId === 'dip') return 2;
  if (strategyId === 'ma') return (params.long || 20) + 1;
  // 직전·현재 RSI 두 값이 필요하다
  return (params.period || 14) + 2;
}

export function validateParams(strategyId, params = {}) {
  const errors = [];
  const specs = PARAM_SPECS[strategyId];
  if (!specs) return { ok: false, errors: ['알 수 없는 전략'] };
  for (const s of specs) {
    const v = params[s.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${s.label} 값을 입력하세요`);
    } else if (v < s.min || v > s.max) {
      errors.push(`${s.label}은(는) ${s.min}~${s.max} 사이여야 합니다`);
    } else if (s.int && !Number.isInteger(v)) {
      errors.push(`${s.label}은(는) 정수여야 합니다`);
    }
  }
  if (strategyId === 'ma' && params.short >= params.long) errors.push('단기는 장기보다 작아야 합니다');
  if (strategyId === 'rsi' && params.low >= params.high) errors.push('과매도는 과매수보다 작아야 합니다');
  return { ok: errors.length === 0, errors };
}

// 교차 판정 (이전 값 → 현재 값 변화)
export function maCross(prevShort, prevLong, curShort, curLong) {
  if ([prevShort, prevLong, curShort, curLong].some((x) => x == null)) return null;
  if (prevShort <= prevLong && curShort > curLong) return 'golden';
  if (prevShort >= prevLong && curShort < curLong) return 'dead';
  return null;
}

export function rsiCross(prevRsi, rsi, low, high) {
  if (prevRsi == null || rsi == null) return null;
  if (prevRsi < low && rsi >= low) return 'buy';
  if (prevRsi > high && rsi <= high) return 'sell';
  return null;
}

export function vbTarget(todayOpen, prevHigh, prevLow, k) {
  return todayOpen + (prevHigh - prevLow) * k;
}

// 조정 매수 가격선. 부동소수 오차로 정확히 −N% 경계가 어긋나지 않게 ×(100±N)/100 순서로 계산
export function dipBuyLine(prevClose, dropPct) {
  return (prevClose * (100 - dropPct)) / 100;
}
export function dipTakeProfit(entryPrice, risePct) {
  return (entryPrice * (100 + risePct)) / 100;
}
export function dipStopLine(entryPrice, stopPct) {
  return (entryPrice * (100 - stopPct)) / 100;
}

// 가격선 비교: 0.27 × 1.1 = 0.29700000000000004 같은 부동소수 오차로 정확한 경계값을 놓치지 않게 상대 오차 1e-12 허용
export function atOrAbove(price, line) {
  return price >= line - Math.abs(line) * 1e-12;
}
export function atOrBelow(price, line) {
  return price <= line + Math.abs(line) * 1e-12;
}

function hold(reason, memo, indicators = {}) {
  return { action: 'hold', reason, memo, indicators };
}

function evalVb({ candles, price, now, position, memo, params }) {
  const m = { ...memo };
  const day = dayStartUtc(now);
  if (position && (position.enteredAt ?? 0) < day) {
    return { action: 'sell', reason: '새 일봉 시작 — 청산', memo: m, indicators: {} };
  }
  const today = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!today || !prev || today.t !== day) return hold('당일 일봉 대기', m);
  const target = vbTarget(today.o, prev.h, prev.l, params.k);
  const ind = { target, open: today.o, range: prev.h - prev.l };
  if (params.maFilter) {
    const closes = candles.slice(0, -1).map((c) => c.c);
    if (closes.length < 5) return hold('데이터 부족(이동평균 필터)', m, ind);
    const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    ind.ma5 = ma5;
    if (!(today.o > ma5)) return hold('이동평균 필터 미충족', m, ind);
  }
  if (position) return hold('보유 중 · 다음 일봉에 청산', m, ind);
  if (m.enteredDay === day) return hold('오늘 이미 진입함', m, ind);
  if (typeof price === 'number' && price >= target) {
    m.enteredDay = day;
    return { action: 'buy', reason: '목표가 돌파', memo: m, indicators: ind };
  }
  return hold('목표가 대기', m, ind);
}

// 조정 매수(dip): 일봉(마지막에 당일 형성 캔들 포함) + 실시간 가격으로 판정
// 매수가 = position.avgPrice(체결 평균가, 수수료 미포함 — 수수료는 position.cost에 따로 반영).
// 따라서 익절·손절선은 수수료를 빼기 전 가격 기준이다.
function evalDip({ candles, price, now, position, memo, params }) {
  const m = { ...memo };
  const day = dayStartUtc(now);
  const { dropPct, risePct, stopPct } = params;
  const today = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const ind = {};
  if (today && prev && today.t === day) {
    ind.prevClose = prev.c;
    ind.buyLine = dipBuyLine(prev.c, dropPct);
  }
  if (position) {
    const entry = position.avgPrice;
    ind.entry = entry;
    ind.takeProfit = dipTakeProfit(entry, risePct);
    ind.stopLine = dipStopLine(entry, stopPct);
    if (typeof price === 'number' && price > 0) {
      if (atOrAbove(price, ind.takeProfit)) return { action: 'sell', reason: `목표 수익 도달 +${risePct}%`, memo: m, indicators: ind };
      if (atOrBelow(price, ind.stopLine)) return { action: 'sell', reason: `손절 −${stopPct}%`, memo: m, indicators: ind };
    }
    return hold('보유 중 · 익절/손절 대기', m, ind);
  }
  if (ind.prevClose == null) return hold('당일 일봉 대기', m, ind);
  if (m.enteredDay === day) return hold('오늘 이미 진입함', m, ind);
  if (typeof price === 'number' && price > 0 && atOrBelow(price, ind.buyLine)) {
    m.enteredDay = day;
    return { action: 'buy', reason: `전일 종가 대비 −${dropPct}% 조정`, memo: m, indicators: ind };
  }
  return hold('매수가격선 대기', m, ind);
}

function evalMa({ candles, position, memo, params }) {
  const m = { ...memo };
  const { short, long } = params;
  if (candles.length < long + 1) return hold('데이터 부족', m);
  const closes = candles.map((c) => c.c);
  const s = sma(closes, short);
  const l = sma(closes, long);
  const n = closes.length;
  const ind = { smaShort: s[n - 1], smaLong: l[n - 1], prevShort: s[n - 2], prevLong: l[n - 2] };
  ind.zone = ind.smaShort > ind.smaLong ? 'golden' : ind.smaShort < ind.smaLong ? 'dead' : 'flat';
  const lastT = candles[n - 1].t;
  const zoneText = ind.zone === 'golden' ? '골든 구간(교차 대기)' : ind.zone === 'dead' ? '데드 구간(교차 대기)' : '교차 대기';
  if (m.lastT === lastT) return hold(zoneText, m, ind);
  m.lastT = lastT;
  const cross = maCross(ind.prevShort, ind.prevLong, ind.smaShort, ind.smaLong);
  if (cross === 'golden') {
    return position ? hold('골든크로스(이미 보유 중)', m, ind) : { action: 'buy', reason: '골든크로스', memo: m, indicators: ind };
  }
  if (cross === 'dead') {
    return position ? { action: 'sell', reason: '데드크로스', memo: m, indicators: ind } : hold('데드크로스(미보유)', m, ind);
  }
  return hold(zoneText, m, ind);
}

function evalRsi({ candles, position, memo, params }) {
  const m = { ...memo };
  const { period, low, high } = params;
  if (candles.length < period + 2) return hold('데이터 부족', m);
  const r = rsiWilder(candles.map((c) => c.c), period);
  const n = r.length;
  const ind = { rsi: r[n - 1], prevRsi: r[n - 2] };
  const lastT = candles[n - 1].t;
  if (m.lastT === lastT) return hold('교차 대기', m, ind);
  m.lastT = lastT;
  const cross = rsiCross(ind.prevRsi, ind.rsi, low, high);
  if (cross === 'buy') {
    return position ? hold('과매도 탈출(이미 보유 중)', m, ind) : { action: 'buy', reason: '과매도 탈출', memo: m, indicators: ind };
  }
  if (cross === 'sell') {
    return position ? { action: 'sell', reason: '과매수 이탈', memo: m, indicators: ind } : hold('과매수 이탈(미보유)', m, ind);
  }
  return hold('교차 대기', m, ind);
}

/**
 * @param {'dip'|'vb'|'ma'|'rsi'} strategyId
 * @param {{candles, price, now, position, memo, params}} input
 *   candles: 과거→최신. ma/rsi는 마감 캔들만, dip/vb는 마지막에 당일 형성 캔들 포함
 * @returns {{action:'buy'|'sell'|'hold', reason:string, memo:object, indicators:object}}
 */
export function evaluate(strategyId, input) {
  const base = { candles: [], memo: {}, position: null, ...input };
  base.params = { ...STRATEGIES[strategyId].defaults, ...(input.params || {}) };
  if (strategyId === 'dip') return evalDip(base);
  if (strategyId === 'vb') return evalVb(base);
  if (strategyId === 'ma') return evalMa(base);
  if (strategyId === 'rsi') return evalRsi(base);
  throw new Error(`알 수 없는 전략: ${strategyId}`);
}
