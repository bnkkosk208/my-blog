// spec 8장 계산 케이스. Node: `node --test apps/upbit-bot/tests/` / 브라우저: tests/index.html
import { sma, rsiWilder, round } from '../lib/indicators.js';
import { evaluate, validateParams, rsiCross, vbTarget } from '../lib/strategies.js';
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

// Node에서는 node:test로 등록
const isNode = typeof process !== 'undefined' && !!process.versions?.node;
if (isNode) {
  const { test: nodeTest } = await import('node:test');
  for (const c of cases) nodeTest(c.name, c.fn);
}
