// spec 8장 계산 케이스. Node: `node --test apps/upbit-bot/tests/` / 브라우저: tests/index.html
import { sma, rsiWilder, round } from '../lib/indicators.js';
import { evaluate, validateParams, rsiCross, vbTarget, dipBuyLine, dipTakeProfit, dipStopLine, candleUnitOf, isPriceBased, STRATEGIES } from '../lib/strategies.js';
import { normalizeCandles, closedOnly, nextCloseTime, isClosed } from '../lib/candles.js';
import { calcOrderKrw, floor8, tickSize, roundToTick, simulateBuy, simulateSell, realizedPnl, canSell } from '../lib/market-rules.js';
import { PaperBroker } from '../lib/brokers.js';
import { BotEngine } from '../lib/bot.js';
import { runBacktest } from '../lib/backtest.js';
import { parseRemainingReq } from '../lib/upbit-public.js';

function fail(msg) {
  throw new Error(msg);
}
function eq(a, b, msg = '') {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) fail(`${msg} 기대 ${jb}, 실제 ${ja}`);
}
function approx(a, b, eps = 1e-6, msg = '') {
  if (!(Math.abs(a - b) <= eps)) fail(`${msg} 기대 ${b}, 실제 ${a}`);
}

const H = 3600 * 1000;
const D = 24 * H;
const T0 = Date.UTC(2026, 10, 9); // 2026-11-09 00:00 UTC = KST 09:00
const mk = (closes, unitMs = H, start = T0) => closes.map((c, i) => ({ t: start + i * unitMs, o: c, h: c, l: c, c, v: 1 }));

export const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// 8.1-1 변동성 돌파
test('변동성 돌파: 목표가 K=0.5 / K=0.3', () => {
  eq(vbTarget(98000000, 100000000, 96000000, 0.5), 100000000);
  approx(vbTarget(98000000, 100000000, 96000000, 0.3), 99200000, 1e-6);
});

test('변동성 돌파: 돌파 전 hold, 돌파 시 buy, 같은 날 재돌파 hold, 다음날 09:00 sell', () => {
  const candles = [
    { t: T0, o: 97000000, h: 100000000, l: 96000000, c: 98000000 },
    { t: T0 + D, o: 98000000, h: 98500000, l: 97500000, c: 98000000 }
  ];
  const now = T0 + D + 3 * H;
  const params = { k: 0.5 };
  const r1 = evaluate('vb', { candles, price: 99999000, now, position: null, memo: {}, params });
  eq(r1.action, 'hold', '99,999,000');
  eq(r1.indicators.target, 100000000);
  const r2 = evaluate('vb', { candles, price: 100000000, now, position: null, memo: r1.memo, params });
  eq(r2.action, 'buy', '100,000,000');
  const r3 = evaluate('vb', { candles, price: 100500000, now: now + H, position: null, memo: r2.memo, params });
  eq(r3.action, 'hold', '같은 날 두 번째 돌파');
  const pos = { qty: 0.001, avgPrice: 100000000, enteredAt: now };
  const r4 = evaluate('vb', { candles, price: 101000000, now: T0 + 2 * D, position: pos, memo: r2.memo, params });
  eq(r4.action, 'sell', '다음날 09:00:00 KST');
  const r5 = evaluate('vb', { candles, price: 101000000, now: T0 + 2 * D - 1, position: pos, memo: r2.memo, params });
  eq(r5.action, 'hold', '08:59:59 KST에는 보유 유지');
});

// 8.1-2 SMA
test('SMA [1,2,3,4,5] 기간 3', () => {
  eq(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

// 8.1-3 골든/데드크로스
test('이동평균: 골든크로스 buy / 데드크로스 sell / 유지 hold', () => {
  const params = { short: 2, long: 3 };
  eq(evaluate('ma', { candles: mk([5, 4, 3, 4, 6]), params }).action, 'buy');
  const pos = { qty: 1, avgPrice: 4, enteredAt: T0 };
  eq(evaluate('ma', { candles: mk([3, 4, 5, 4, 2]), params, position: pos }).action, 'sell');
  eq(evaluate('ma', { candles: mk([1, 2, 3, 4, 5]), params }).action, 'hold');
  const r = evaluate('ma', { candles: mk([5, 4, 3, 4, 6]), params });
  eq(evaluate('ma', { candles: mk([5, 4, 3, 4, 6]), params, memo: r.memo }).action, 'hold', '같은 캔들 중복 처리 금지');
  eq(evaluate('ma', { candles: mk([5, 4, 3]), params }).reason, '데이터 부족');
});

// 8.1-4 RSI
test('RSI(Wilder, 3): 66.67 → 83.33, 전부 상승 100, 변화 없음 50', () => {
  const r = rsiWilder([10, 11, 12, 11, 13], 3);
  eq(round(r[3], 2), 66.67);
  eq(round(r[4], 2), 83.33);
  eq(rsiWilder([1, 2, 3, 4], 3)[3], 100);
  eq(rsiWilder([5, 5, 5, 5], 3)[3], 50);
});

test('RSI 교차: 28→31 buy, 72→69 sell, 25→27 hold', () => {
  eq(rsiCross(28, 31, 30, 70), 'buy');
  eq(rsiCross(72, 69, 30, 70), 'sell');
  eq(rsiCross(25, 27, 30, 70), null);
});

test('RSI 전략 evaluate: 과매도 탈출 시 buy', () => {
  // 하락 후 반등 → RSI가 30 아래에서 위로
  const closes = [100, 95, 90, 85, 80, 75, 70, 90];
  const r = rsiWilder(closes, 3);
  const res = evaluate('rsi', { candles: mk(closes), params: { period: 3, low: 30, high: 70 } });
  if (r[6] < 30 && r[7] >= 30) eq(res.action, 'buy');
  else fail(`테스트 데이터 RSI 확인 필요 ${r[6]} ${r[7]}`);
});

test('파라미터 검증', () => {
  eq(validateParams('ma', { short: 20, long: 5 }).ok, false);
  eq(validateParams('rsi', { period: 14, low: 70, high: 30 }).ok, false);
  eq(validateParams('vb', { k: 1.5 }).ok, false);
  eq(validateParams('vb', { k: 0.5 }).ok, true);
});

// 8.1-5 캔들 정렬·마감
test('캔들 정렬(최신순→과거순)과 마감 판정', () => {
  const raw = [
    { candle_date_time_utc: '2026-11-09T13:00:00', opening_price: 3, high_price: 3, low_price: 3, trade_price: 3 },
    { candle_date_time_utc: '2026-11-09T12:00:00', opening_price: 2, high_price: 2, low_price: 2, trade_price: 2 },
    { candle_date_time_utc: '2026-11-09T11:00:00', opening_price: 1, high_price: 1, low_price: 1, trade_price: 1 }
  ];
  const c = normalizeCandles(raw);
  eq(c.map((x) => x.c), [1, 2, 3]);
  const at1330 = Date.UTC(2026, 10, 9, 13, 30);
  const at1400 = Date.UTC(2026, 10, 9, 14, 0, 1);
  eq(closedOnly(c, 'minutes/60', at1330).length, 2, '13:30 미마감 제외');
  eq(closedOnly(c, 'minutes/60', at1400).length, 3, '14:00:01 포함');
  eq(isClosed(c[2], 'minutes/60', Date.UTC(2026, 10, 9, 14, 0, 0)), true);
  eq(nextCloseTime(at1330, 'minutes/60'), Date.UTC(2026, 10, 9, 14));
  eq(nextCloseTime(at1330, 'days'), Date.UTC(2026, 10, 10));
});

// 8.2 모의 체결·수수료
test('모의 매수 100,000원 @50,000,000 → 수수료 50, 잔고 899,950, 0.002 BTC', async () => {
  let price = 50000000;
  const b = new PaperBroker({ getPrice: () => price });
  const f = await b.marketBuy('KRW-BTC', 100000);
  eq(f.fee, 50);
  eq(f.qty, 0.002);
  const bal = await b.getBalance();
  eq(bal.krw, 899950);
  eq(bal.coins.BTC.avgPrice, 50000000);
  price = 52000000;
  const s = await b.marketSell('KRW-BTC', 0.002);
  approx(s.krw, 104000, 1e-6, '총액');
  approx(s.fee, 52, 1e-6, '수수료');
  approx((await b.getBalance()).krw, 1003898, 1e-6, '잔고');
  const pnl = realizedPnl({ net: s.krw - s.fee, cost: 100050, soldQty: 0.002, boughtQty: 0.002 });
  approx(pnl, 3898, 1e-6, '실현손익');
  eq(round(pnl / 100050 * 100, 2), 3.9);
});

test('simulateBuy/simulateSell 순수 계산', () => {
  const b = simulateBuy({ krw: 100000, price: 50000000 });
  eq([b.qty, b.fee, b.cost], [0.002, 50, 100050]);
  const s = simulateSell({ qty: 0.002, price: 52000000 });
  approx(s.net, 103948, 1e-6);
});

test('주문액 계산: 최소 미달 / 1회 최대 / 비중 50%', () => {
  const r1 = calcOrderKrw({ type: 'fixed', amount: 100000, availableKrw: 4000 });
  eq([r1.ok, r1.reason], [false, '최소 주문금액 미달']);
  eq(calcOrderKrw({ type: 'fixed', amount: 100000, availableKrw: 1000000, maxOrderKrw: 50000 }).krw, 50000);
  eq(calcOrderKrw({ type: 'ratio', ratio: 50, availableKrw: 899950 }).krw, 449975);
});

test('잔량 소액 판정, floor8, 호가 단위', () => {
  eq(canSell(0.00005, 50000000), false);
  eq(floor8(0.123456789), 0.12345678);
  eq(floor8(0.29), 0.29);
  eq(tickSize(98500000), 1000);
  eq(tickSize(55000), 10);
  eq(tickSize(5.5), 0.001);
  eq(roundToTick(100000123), 100000000);
  eq(roundToTick(123.456), 123.5);
});

test('Remaining-Req 헤더 파싱', () => {
  eq(parseRemainingReq('group=candles; min=599; sec=9'), { group: 'candles', min: 599, sec: 9 });
  eq(parseRemainingReq(null), null);
});

// 엔진 통합: 모의 브로커로 신호→주문, 최소금액, 먼지, 일일 횟수
function engineFixture({ closes = [5, 4, 3, 4, 6], krw = 1000000, safety = {}, invest = {} } = {}) {
  let now = T0 + closes.length * H + 10 * 1000;
  let price = 50000000;
  const candles = mk(closes);
  const account = { krw, coins: {}, initialKrw: krw, createdAt: T0 };
  const broker = new PaperBroker({ load: () => account, getPrice: () => price, now: () => now });
  const logs = [];
  const engine = new BotEngine({
    broker,
    mode: 'paper',
    getCandles: async () => candles,
    getPrice: () => price,
    now: () => now
  });
  engine.addEventListener('log', (e) => logs.push(e.detail));
  engine.configure({ market: 'KRW-BTC', strategyId: 'ma', params: { short: 2, long: 3 }, invest: { type: 'fixed', amount: 100000, ...invest }, safety });
  return {
    engine, broker, logs, candles,
    setPrice: (p) => { price = p; },
    advance: (ms) => { now += ms; }
  };
}

test('엔진: 시작 시점에 이미 교차한 캔들로는 매수하지 않음', async () => {
  const fx = engineFixture();
  await fx.engine.start();
  eq(fx.engine.state.position, null);
  eq(fx.engine.status, 'waiting');
});

test('엔진: 골든크로스 → 모의 매수 체결, 데드크로스 → 매도와 손익', async () => {
  const fx = engineFixture({ closes: [5, 4, 3, 3] });
  await fx.engine.start();
  fx.candles.push({ t: fx.candles[3].t + H, o: 6, h: 6, l: 6, c: 6, v: 1 });
  fx.advance(H);
  await fx.engine.heartbeat({ force: true });
  eq(fx.engine.status, 'holding');
  approx(fx.engine.state.position.qty, 0.002, 1e-12);
  // 하락으로 데드크로스
  fx.candles.push({ t: fx.candles[4].t + H, o: 2, h: 2, l: 2, c: 2, v: 1 });
  fx.candles.push({ t: fx.candles[5].t + H, o: 1, h: 1, l: 1, c: 1, v: 1 });
  fx.setPrice(52000000);
  fx.advance(2 * H);
  await fx.engine.heartbeat({ force: true });
  eq(fx.engine.state.position, null);
  approx(fx.engine.state.realizedPnl, 3898, 1e-6);
  eq(fx.engine.state.dailyCount.count, 2);
});

test('엔진: 가능 KRW 4,000원이면 주문 안 함 + "최소 주문금액 미달" 로그', async () => {
  const fx = engineFixture({ krw: 4000 });
  fx.engine.state.running = true;
  fx.engine.candles = fx.candles;
  await fx.engine.executeBuy('테스트', 50000000);
  eq(fx.engine.state.position, null);
  eq(fx.logs.some((l) => l.kind === 'warn' && l.msg.includes('최소 주문금액 미달')), true);
});

test('엔진: 1회 최대 50,000원이면 설정 100,000원이어도 50,000원 주문', async () => {
  const fx = engineFixture({ safety: { maxOrderKrw: 50000 } });
  fx.engine.state.running = true;
  await fx.engine.executeBuy('테스트', 50000000);
  eq(fx.logs.find((l) => l.kind === 'buy').krw, 50000);
});

test('엔진: 0.00005 BTC(2,500원) 매도 시도 → 매도 안 함 + 잔량 소액, 포지션 종료', async () => {
  const fx = engineFixture();
  fx.engine.state.running = true;
  fx.engine.state.position = { qty: 0.00005, avgPrice: 50000000, enteredAt: T0, cost: 2501.25 };
  await fx.engine.executeSell('테스트', 50000000);
  eq(fx.engine.state.position, null);
  eq(fx.logs.some((l) => l.msg.includes('잔량 소액')), true);
  eq(fx.logs.some((l) => l.kind === 'sell'), false);
});

test('엔진: 일일 주문 10회 도달 → 11번째 신호에서 봇 정지', async () => {
  const fx = engineFixture();
  fx.engine.state.running = true;
  fx.engine.rollDaily();
  fx.engine.state.dailyCount.count = 10;
  await fx.engine.executeBuy('11번째', 50000000);
  eq(fx.engine.running, false);
  eq(fx.engine.state.position, null);
  eq(fx.logs.some((l) => l.msg.includes('일일 최대 주문 횟수')), true);
});

test('엔진: 손절 -3% 켜면 실시간 가격으로 매도', async () => {
  const fx = engineFixture({ safety: { stopLoss: { on: true, pct: 3 } } });
  await fx.engine.start();
  await fx.engine.executeBuy('테스트', 50000000);
  fx.setPrice(48400000);
  fx.advance(2000);
  await fx.engine.evaluate('price');
  eq(fx.engine.state.position, null);
  eq(fx.logs.some((l) => l.kind === 'signal' && l.msg.startsWith('손절')), true);
});

// 백테스트
test('백테스트: 변동성 돌파 목표가 매수 → 다음 일봉 시가 매도', () => {
  const candles = [
    { t: T0, o: 100, h: 110, l: 90, c: 100 },
    { t: T0 + D, o: 100, h: 120, l: 95, c: 115 }, // target 110 → 매수
    { t: T0 + 2 * D, o: 121, h: 125, l: 118, c: 120 } // 시가 121 매도, target 121+15=136 미돌파
  ];
  const r = runBacktest(candles, 'vb', { k: 0.5 }, { feeRate: 0 });
  eq(r.tradeCount, 1);
  eq(r.markers.map((m) => [m.side, m.price]), [['buy', 110], ['sell', 121]]);
  approx(r.trades[0].exitPrice, 121, 1e-9);
  eq(r.winRate, 1);
  if (!(r.totalReturn > 0.09 && r.totalReturn < 0.1001)) fail(`수익률 ${r.totalReturn}`);
});

test('백테스트: MA 신호 다음 캔들 시가 체결, MDD·Buy&Hold 존재', () => {
  const closes = [5, 4, 3, 4, 6, 7, 8, 6, 3, 2, 2];
  const candles = closes.map((c, i) => ({ t: T0 + i * H, o: c, h: c, l: c, c }));
  const r = runBacktest(candles, 'ma', { short: 2, long: 3 }, { feeRate: 0 });
  eq(r.markers[0], { t: T0 + 5 * H, side: 'buy', price: 7 });
  eq(r.tradeCount >= 1, true);
  eq(typeof r.mdd, 'number');
  eq(typeof r.buyHoldReturn, 'number');
});

test('백테스트: RSI 실행', () => {
  const closes = [];
  for (let i = 0; i < 200; i++) closes.push(100 + 20 * Math.sin(i / 6) + i * 0.05);
  const candles = closes.map((c, i) => ({ t: T0 + i * H, o: c, h: c + 1, l: c - 1, c }));
  const r = runBacktest(candles, 'rsi', { period: 14, low: 30, high: 70 });
  eq(r.tradeCount > 0, true);
  eq(Number.isFinite(r.totalReturn), true);
});

// Review에서 추가: 돈 관련 경계 사례
test('엔진: 현재가가 없으면 매도를 보류하고 포지션을 지우지 않음', async () => {
  const fx = engineFixture();
  await fx.engine.start();
  await fx.engine.executeBuy('테스트', 50000000);
  const qty = fx.engine.state.position.qty;
  await fx.engine.executeSell('테스트', undefined);
  eq(fx.engine.state.position?.qty, qty);
  eq(fx.logs.some((l) => l.msg.includes('현재가가 없어')), true);
});

test('엔진: 일일 한도 10회 중 9회 사용 → 매수 안 함(청산 1회분 보존), 보유 중 매도는 허용', async () => {
  const fx = engineFixture();
  await fx.engine.start();
  fx.engine.state.dailyCount.count = 9;
  await fx.engine.executeBuy('10번째', 50000000);
  eq(fx.engine.state.position, null);
  eq(fx.engine.running, false);
  const fx2 = engineFixture();
  await fx2.engine.start();
  await fx2.engine.executeBuy('매수', 50000000);
  fx2.engine.state.dailyCount.count = 9;
  await fx2.engine.executeSell('청산', 50000000);
  eq(fx2.engine.state.position, null);
  eq(fx2.engine.state.dailyCount.count, 10);
  eq(fx2.engine.running, false);
});

test('엔진: 다른 마켓 포지션이 남아 있으면 시작 거부, 포지션에 마켓 기록', async () => {
  const fx = engineFixture();
  await fx.engine.start();
  await fx.engine.executeBuy('테스트', 50000000);
  eq(fx.engine.state.position.market, 'KRW-BTC');
  fx.engine.stop();
  fx.engine.configure({ market: 'KRW-ETH', strategyId: 'ma', params: { short: 2, long: 3 } });
  let err = null;
  try { await fx.engine.start(); } catch (e) { err = e; }
  eq(!!err && err.message.includes('KRW-BTC'), true);
});

test('LiveBroker: 체결 조회가 계속 실패하면 unconfirmed(포지션 누락·중복 매수 방지)', async () => {
  const { LiveBroker } = await import('../lib/brokers.js');
  const fetchImpl = async (url, opts) => {
    if (opts.method === 'POST') return new Response(JSON.stringify({ ok: true, data: { uuid: '11111111-1111-1111-1111-111111111111' } }), { status: 200 });
    throw new Error('offline');
  };
  const b = new LiveBroker({ getToken: () => 't', fetchImpl, sleep: async () => {}, pollMax: 3 });
  let err = null;
  try { await b.marketBuy('KRW-BTC', 10000, 50000000); } catch (e) { err = e; }
  eq(err?.code, 'unconfirmed');
  const b2 = new LiveBroker({ getToken: () => 't', fetchImpl: async () => { throw new Error('down'); }, sleep: async () => {} });
  err = null;
  try { await b2.marketBuy('KRW-BTC', 10000, 50000000); } catch (e) { err = e; }
  eq(err?.code, 'unconfirmed');
});

// 조정 매수(dip)
const DIP_CANDLES = [
  { t: T0, o: 99000000, h: 101000000, l: 97000000, c: 100000000 }, // 전일 종가 100,000,000
  { t: T0 + D, o: 100000000, h: 100500000, l: 95000000, c: 96000000 } // 당일 형성 캔들
];
const DIP_P = { dropPct: 10, risePct: 10, stopPct: 10 };

test('조정 매수: 기본 전략·일봉·가격 기반, 확정 기본값 하락 10 · 익절 5 · 손절 30', () => {
  eq(Object.keys(STRATEGIES)[0], 'dip');
  eq(STRATEGIES.dip.defaults, { dropPct: 10, risePct: 5, stopPct: 30 });
  eq(candleUnitOf('dip', {}), 'days');
  eq(isPriceBased('dip'), true);
  eq(isPriceBased('ma'), false);
  eq(STRATEGIES.dip.desc.includes('몇 주·몇 달'), true);
});

test('조정 매수: 매수가격선·익절선·손절선 계산(정확한 경계값)', () => {
  eq(dipBuyLine(100000000, 10), 90000000);
  eq(dipBuyLine(98000000, 10), 88200000);
  eq(dipBuyLine(0.3, 10), 0.27);
  eq(dipTakeProfit(90000000, 10), 99000000);
  eq(dipStopLine(90000000, 10), 81000000);
  approx(dipTakeProfit(0.27, 10), 0.297, 1e-12);
  approx(dipStopLine(0.27, 10), 0.243, 1e-12);
  // 부동소수 오차(0.29700000000000004)가 있어도 정확히 경계 가격이면 익절
  const small = { qty: 1000, avgPrice: 0.27, enteredAt: T0 + D + H };
  const r = evaluate('dip', { candles: DIP_CANDLES, price: 0.297, now: T0 + D + 2 * H, position: small, memo: {}, params: DIP_P });
  eq(r.action, 'sell');
});

test('조정 매수: −10% 경계 — 90,000,001 hold, 정확히 90,000,000 buy, 지표 표시', () => {
  const now = T0 + D + 3 * H;
  const r1 = evaluate('dip', { candles: DIP_CANDLES, price: 90000001, now, position: null, memo: {}, params: DIP_P });
  eq(r1.action, 'hold');
  eq(r1.indicators.prevClose, 100000000);
  eq(r1.indicators.buyLine, 90000000);
  const r2 = evaluate('dip', { candles: DIP_CANDLES, price: 90000000, now, position: null, memo: r1.memo, params: DIP_P });
  eq(r2.action, 'buy');
  eq(r2.reason, '전일 종가 대비 −10% 조정');
  eq(r2.memo.enteredDay, T0 + D);
});

test('조정 매수: 당일 일봉이 아직 없으면 매수하지 않음', () => {
  const r = evaluate('dip', { candles: DIP_CANDLES, price: 50000000, now: T0 + 2 * D + 1000, position: null, memo: {}, params: DIP_P });
  eq(r.action, 'hold');
  eq(r.reason, '당일 일봉 대기');
});

test('조정 매수: 익절·손절 경계(매수가 90,000,000 → 99,000,000 / 81,000,000)', () => {
  const now = T0 + D + 5 * H;
  const pos = { qty: 0.001, avgPrice: 90000000, enteredAt: T0 + D + 3 * H };
  const at = (price) => evaluate('dip', { candles: DIP_CANDLES, price, now, position: pos, memo: {}, params: DIP_P });
  eq(at(98999999).action, 'hold');
  const tp = at(99000000);
  eq(tp.action, 'sell');
  eq(tp.reason, '목표 수익 도달 +10%');
  eq(tp.indicators.takeProfit, 99000000);
  eq(tp.indicators.stopLine, 81000000);
  eq(at(81000001).action, 'hold');
  const sl = at(81000000);
  eq(sl.action, 'sell');
  eq(sl.reason, '손절 −10%');
});

test('조정 매수: 보유 기간 제한 없음(다음날에도 자동 청산 안 함)', () => {
  const pos = { qty: 0.001, avgPrice: 90000000, enteredAt: T0 + D + 3 * H };
  const r = evaluate('dip', { candles: DIP_CANDLES, price: 90000000, now: T0 + 5 * D, position: pos, memo: {}, params: DIP_P });
  eq(r.action, 'hold');
});

test('조정 매수: 같은 날 재진입 금지(손절 직후 재매수 없음), 다음날은 다시 진입', () => {
  const now = T0 + D + 3 * H;
  const r1 = evaluate('dip', { candles: DIP_CANDLES, price: 89000000, now, position: null, memo: {}, params: DIP_P });
  eq(r1.action, 'buy');
  const pos = { qty: 0.001, avgPrice: 89000000, enteredAt: now };
  const r2 = evaluate('dip', { candles: DIP_CANDLES, price: 80000000, now: now + H, position: pos, memo: r1.memo, params: DIP_P });
  eq(r2.action, 'sell');
  const r3 = evaluate('dip', { candles: DIP_CANDLES, price: 80000000, now: now + 2 * H, position: null, memo: r2.memo, params: DIP_P });
  eq(r3.action, 'hold');
  eq(r3.reason, '오늘 이미 진입함');
  const next = [...DIP_CANDLES, { t: T0 + 2 * D, o: 80000000, h: 80000000, l: 70000000, c: 71000000 }];
  const r4 = evaluate('dip', { candles: next, price: 71000000, now: T0 + 2 * D + H, position: null, memo: r3.memo, params: DIP_P });
  eq(r4.indicators.buyLine, 86400000);
  eq(r4.action, 'buy');
});

test('조정 매수 파라미터 검증', () => {
  eq(validateParams('dip', DIP_P).ok, true);
  eq(validateParams('dip', { ...DIP_P, dropPct: 0 }).ok, false);
  eq(validateParams('dip', { ...DIP_P, dropPct: 51 }).ok, false);
  eq(validateParams('dip', { ...DIP_P, risePct: 100 }).ok, true);
  eq(validateParams('dip', { ...DIP_P, risePct: 101 }).ok, false);
  eq(validateParams('dip', { ...DIP_P, stopPct: NaN }).ok, false);
});

test('엔진(dip): 가격 틱으로 매수 → 익절 매도, 같은 날 재매수 없음, 다음날 자동 청산 없음', async () => {
  const candles = DIP_CANDLES.map((c) => ({ ...c }));
  let now = T0 + D + 10 * 1000;
  let price = 95000000;
  const account = { krw: 1000000, coins: {}, initialKrw: 1000000, createdAt: T0 };
  const broker = new PaperBroker({ load: () => account, getPrice: () => price, now: () => now });
  const logs = [];
  const engine = new BotEngine({ broker, mode: 'paper', getCandles: async () => candles, getPrice: () => price, now: () => now });
  engine.addEventListener('log', (e) => logs.push(e.detail));
  engine.configure({ market: 'KRW-BTC', strategyId: 'dip', params: DIP_P, invest: { type: 'fixed', amount: 100000 } });
  eq(engine.unit, 'days');
  await engine.start();
  eq(engine.state.position, null);
  eq(engine.nextEvalAt, T0 + 2 * D + 5000);
  price = 90000000;
  now += 2000;
  await engine.evaluate('price');
  eq(engine.status, 'holding');
  eq(engine.state.position.avgPrice, 90000000);
  // 다음날로 넘어가도(vb와 달리) 청산하지 않음
  candles.push({ t: T0 + 2 * D, o: 91000000, h: 91000000, l: 91000000, c: 91000000 });
  now = T0 + 2 * D + 6000;
  price = 91000000;
  await engine.heartbeat();
  eq(engine.status, 'holding');
  price = 99000000;
  now += 2000;
  await engine.evaluate('price');
  eq(engine.state.position, null);
  eq(logs.some((l) => l.kind === 'sell' && l.msg.includes('목표 수익 도달 +10%')), true);
  // 익절 후 같은 날 매수가격선(전일 종가 96,000,000 × 0.9 = 86,400,000) 이하 → 이 날은 아직 진입 전이므로 매수
  price = 81000000;
  now += 2000;
  await engine.evaluate('price');
  eq(engine.status, 'holding');
  // 손절 후 같은 날 재매수 없음
  price = 72000000;
  now += 2000;
  await engine.evaluate('price');
  eq(engine.state.position, null);
  eq(logs.some((l) => l.kind === 'sell' && l.msg.includes('손절 −10%')), true);
  price = 70000000;
  now += 2000;
  await engine.evaluate('price');
  eq(engine.state.position, null);
  // 일일 주문 횟수는 KST 자정 기준: 11/11 KST에 익절·매수·손절 3회
  eq(engine.state.dailyCount.count, 3);
});

test('엔진(dip): 설정 탭 손절(-3%)이 켜져 있으면 먼저 작동해도 이상 없음', async () => {
  const candles = DIP_CANDLES.map((c) => ({ ...c }));
  let now = T0 + D + 10 * 1000;
  let price = 90000000;
  const account = { krw: 1000000, coins: {}, initialKrw: 1000000, createdAt: T0 };
  const broker = new PaperBroker({ load: () => account, getPrice: () => price, now: () => now });
  const logs = [];
  const engine = new BotEngine({ broker, mode: 'paper', getCandles: async () => candles, getPrice: () => price, now: () => now });
  engine.addEventListener('log', (e) => logs.push(e.detail));
  engine.configure({ market: 'KRW-BTC', strategyId: 'dip', params: DIP_P, safety: { stopLoss: { on: true, pct: 3 } } });
  await engine.start();
  eq(engine.status, 'holding');
  price = 87300000;
  now += 2000;
  await engine.evaluate('price');
  eq(engine.state.position, null);
  eq(logs.some((l) => l.kind === 'signal' && l.msg.startsWith('손절(')), true);
  price = 80000000;
  now += 2000;
  await engine.evaluate('price');
  eq(engine.state.position, null, '같은 날 재매수 없음');
});

test('백테스트(dip): 저가가 매수가격선 이하 → 매수가격선 체결, 고가가 익절선 이상 → 익절선 체결', () => {
  const candles = [
    { t: T0, o: 100, h: 101, l: 99, c: 100 },
    { t: T0 + D, o: 100, h: 100, l: 88, c: 92 }, // 매수가격선 90 → 90에 매수
    { t: T0 + 2 * D, o: 92, h: 100, l: 91, c: 98 }, // 익절선 99 → 99에 매도
    { t: T0 + 3 * D, o: 98, h: 99, l: 97, c: 98 }
  ];
  const r = runBacktest(candles, 'dip', DIP_P, { feeRate: 0 });
  eq(r.markers.map((m) => [m.side, m.price, m.t]), [['buy', 90, T0 + D], ['sell', 99, T0 + 2 * D]]);
  eq(r.tradeCount, 1);
  eq(r.winRate, 1);
  eq(r.assumptions.length > 0, true);
});

test('백테스트(dip): 손절선 체결, 같은 캔들 익절·손절 동시면 손절 우선', () => {
  const stop = [
    { t: T0, o: 100, h: 100, l: 100, c: 100 },
    { t: T0 + D, o: 100, h: 100, l: 90, c: 90 }, // 90 매수
    { t: T0 + 2 * D, o: 90, h: 92, l: 80, c: 82 } // 손절선 81 → 81 매도
  ];
  const r1 = runBacktest(stop, 'dip', DIP_P, { feeRate: 0 });
  eq(r1.markers.map((m) => [m.side, m.price]), [['buy', 90], ['sell', 81]]);
  eq(r1.winRate, 0);
  const both = [
    { t: T0, o: 100, h: 100, l: 100, c: 100 },
    { t: T0 + D, o: 100, h: 100, l: 90, c: 90 },
    { t: T0 + 2 * D, o: 90, h: 100, l: 80, c: 95 } // 99·81 모두 닿음 → 손절
  ];
  const r2 = runBacktest(both, 'dip', DIP_P, { feeRate: 0 });
  eq(r2.markers.map((m) => [m.side, m.price]), [['buy', 90], ['sell', 81]]);
});

test('백테스트(dip): 매도한 캔들에서는 재매수하지 않고, 매수한 캔들에서는 익절하지 않음', () => {
  const candles = [
    { t: T0, o: 100, h: 100, l: 100, c: 100 },
    { t: T0 + D, o: 100, h: 100, l: 90, c: 91 }, // 90 매수 (같은 캔들 고가 100 ≥ 99지만 익절 안 함)
    { t: T0 + 2 * D, o: 91, h: 91, l: 80, c: 81 }, // 81 손절, 매수가격선 81.9 이하지만 재매수 안 함
    { t: T0 + 3 * D, o: 81, h: 81, l: 72, c: 75 } // 매수가격선 72.9 → 72.9 매수
  ];
  const r = runBacktest(candles, 'dip', DIP_P, { feeRate: 0 });
  eq(r.markers.map((m) => [m.side, Math.round(m.price * 10) / 10]), [['buy', 90], ['sell', 81], ['buy', 72.9]]);
  eq(r.trades[r.trades.length - 1].open, true);
});

test('백테스트(dip): 시가가 이미 선 아래로 갭이면 선이 아닌 시가에 체결(낙관적 체결 방지)', () => {
  const candles = [
    { t: T0, o: 100, h: 100, l: 100, c: 100 },
    { t: T0 + D, o: 85, h: 86, l: 84, c: 86 }, // 매수가격선 90보다 시가 85가 낮음 → 85 매수
    { t: T0 + 2 * D, o: 70, h: 72, l: 69, c: 71 } // 손절선 76.5보다 시가 70이 낮음 → 70 매도
  ];
  const r = runBacktest(candles, 'dip', DIP_P, { feeRate: 0 });
  eq(r.markers.map((m) => [m.side, m.price]), [['buy', 85], ['sell', 70]]);
  const up = [
    { t: T0, o: 100, h: 100, l: 100, c: 100 },
    { t: T0 + D, o: 100, h: 100, l: 90, c: 92 }, // 90 매수
    { t: T0 + 2 * D, o: 105, h: 106, l: 104, c: 105 } // 익절선 99보다 시가 105가 높음 → 105 매도(실시간 봇도 첫 틱에 매도)
  ];
  const r2 = runBacktest(up, 'dip', DIP_P, { feeRate: 0 });
  eq(r2.markers.map((m) => [m.side, m.price]), [['buy', 90], ['sell', 105]]);
});

test('엔진(dip, 실거래 경로): 익절 매도 수량은 계좌 잔고가 더 많아도 봇이 산 수량까지만', async () => {
  const candles = DIP_CANDLES.map((c) => ({ ...c }));
  let now = T0 + D + 10 * 1000;
  let price = 90000000;
  const sells = [];
  // 사용자가 원래 1 BTC를 들고 있는 계좌를 흉내 낸 가짜 LiveBroker(네트워크·실주문 없음)
  const broker = {
    kind: 'live',
    async getChance() { return { bidFee: 0.0005 }; },
    async getBalance() { return { krw: 1000000, coins: { BTC: { qty: 1.001 } } }; },
    async marketBuy(market, krw, p) { return { qty: floor8(krw / p), price: p, krw, fee: krw * 0.0005 }; },
    async marketSell(market, qty, p) { sells.push(qty); return { qty, price: p, krw: qty * p, fee: qty * p * 0.0005 }; }
  };
  const engine = new BotEngine({ broker, mode: 'live', getCandles: async () => candles, getPrice: () => price, now: () => now });
  engine.configure({ market: 'KRW-BTC', strategyId: 'dip', params: DIP_P, invest: { type: 'fixed', amount: 90000 } });
  await engine.start();
  eq(engine.status, 'holding');
  const botQty = engine.state.position.qty;
  eq(botQty, 0.001);
  price = 99000000;
  now += 2000;
  await engine.evaluate('price');
  eq(engine.state.position, null);
  eq(sells, [botQty]);
});

// Node에서는 node:test로 등록
const isNode = typeof process !== 'undefined' && !!process.versions?.node;
if (isNode) {
  const { test: nodeTest } = await import('node:test');
  for (const c of cases) nodeTest(c.name, c.fn);
}

test('조정 매수: 확정 기본값(10/5/30) 경계 — 매수 90,000,000 · 익절 94,500,000 · 손절 63,000,000', () => {
  eq(dipBuyLine(100000000, 10), 90000000);
  eq(dipTakeProfit(90000000, 5), 94500000);
  eq(dipStopLine(90000000, 30), 63000000);
  eq(validateParams('dip', STRATEGIES.dip.defaults).ok, true);
});
