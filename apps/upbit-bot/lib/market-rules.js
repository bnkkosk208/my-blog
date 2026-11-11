// 업비트 KRW 마켓 거래 규칙 (DOM 없는 순수 모듈)
// 공식 문서 확인 필요(spec 11장 6·7번): 수수료·최소 주문금액·호가 단위는 이 파일 상수만 바꾸면 된다.

export const FEE_RATE = 0.0005;
export const MIN_ORDER_KRW = 5000;
export const QTY_DECIMALS = 8;

// [하한가격, 호가단위] — 위에서부터 처음 만족하는 구간을 쓴다. 공식 문서 확인 필요
export const TICK_TABLE = [
  [2000000, 1000],
  [1000000, 1000],
  [500000, 500],
  [100000, 100],
  [10000, 10],
  [1000, 1],
  [100, 0.1],
  [10, 0.01],
  [1, 0.001],
  [0.1, 0.0001],
  [0, 0.00001]
];

export function tickSize(price) {
  for (const [min, tick] of TICK_TABLE) {
    if (price >= min) return tick;
  }
  return TICK_TABLE[TICK_TABLE.length - 1][1];
}

export function decimalsOf(n) {
  const s = String(n);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

// 표시·모의 체결가 정규화용 호가 단위 반올림
export function roundToTick(price, mode = 'round') {
  if (!Number.isFinite(price) || price <= 0) return price;
  const tick = tickSize(price);
  const fn = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
  return Number((fn(price / tick) * tick).toFixed(decimalsOf(tick)));
}

// 수량 소수 8자리 버림 (부동소수 오차 보정 포함)
export function floor8(x) {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Number((Math.floor(x * 1e8 + 1e-6) / 1e8).toFixed(QTY_DECIMALS));
}

// 금액 부동소수 잡음 제거(소수 6자리)
export function money(x) {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * 실제 주문액 = min(설정액, 사용 가능 KRW ÷ (1+수수료), 1회 최대 주문금액)
 * @returns {{ ok:boolean, krw:number, reason?:string }}
 */
export function calcOrderKrw({ type = 'fixed', amount = 0, ratio = 0, availableKrw = 0, maxOrderKrw = 0, feeRate = FEE_RATE }) {
  const want = type === 'ratio' ? availableKrw * ratio / 100 : amount;
  const cap = availableKrw / (1 + feeRate);
  const limit = maxOrderKrw > 0 ? maxOrderKrw : Infinity;
  const krw = Math.floor(Math.min(want, cap, limit) + 1e-9);
  if (!(krw >= MIN_ORDER_KRW)) {
    return { ok: false, krw: Math.max(0, krw || 0), reason: '최소 주문금액 미달' };
  }
  return { ok: true, krw };
}

export function canSell(qty, price) {
  return qty * price >= MIN_ORDER_KRW;
}

// 모의 시장가 매수: 금액 A → 수수료 A×fee, KRW 차감 A+fee, 수량 floor8(A/체결가)
export function simulateBuy({ krw, price, feeRate = FEE_RATE, slippage = 0 }) {
  const execPrice = price * (1 + slippage);
  const qty = floor8(krw / execPrice);
  const fee = money(krw * feeRate);
  return { price: execPrice, qty, krw: money(krw), fee, cost: money(krw + fee) };
}

// 모의 시장가 매도: 총액 V×체결가, 수수료 총액×fee, 수령액 총액−수수료
export function simulateSell({ qty, price, feeRate = FEE_RATE, slippage = 0 }) {
  const execPrice = price * (1 - slippage);
  const gross = money(qty * execPrice);
  const fee = money(gross * feeRate);
  return { price: execPrice, qty, krw: gross, fee, net: money(gross - fee) };
}

// 실현 손익 = 매도 순수령액 − 매수 KRW 차감액 × (매도수량/매수수량)
export function realizedPnl({ net, cost, soldQty, boughtQty }) {
  const ratio = boughtQty > 0 ? Math.min(1, soldQty / boughtQty) : 1;
  return money(net - cost * ratio);
}
