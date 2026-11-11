// BotEngine: 스케줄, 안전장치, 신호→주문, 이벤트 발행. 브로커 종류를 모른다
import { evaluate, validateParams, candleUnitOf, minCandlesFor, isPriceBased, STRATEGIES } from './strategies.js';
import { closedOnly, nextCloseTime, dayStartUtc, kstDateKey, formatKst, DAY_MS } from './candles.js';
import { calcOrderKrw, canSell, realizedPnl, floor8, FEE_RATE } from './market-rules.js';
import { coinOf } from './brokers.js';

export const DEFAULT_SAFETY = {
  maxOrderKrw: 0, // 0 = 제한 없음
  dailyMaxOrders: 10,
  stopLoss: { on: false, pct: 3 },
  takeProfit: { on: false, pct: 5 },
  dailyLossLimit: { on: false, pct: 5 }
};

export function freshBotState() {
  return {
    running: false,
    position: null,
    memo: {},
    lastCandleT: null,
    dailyCount: { date: '', count: 0 },
    dailyPnl: { date: '', pnl: 0 },
    realizedPnl: 0,
    lastBeat: null,
    error: null
  };
}

const CANDLE_DELAY_MS = 3000;
const VB_REFRESH_DELAY_MS = 5000;
const PRICE_THROTTLE_MS = 1000;
const GAP_MS = 90 * 1000;

function makeEvent(type, detail) {
  const e = new Event(type);
  e.detail = detail;
  return e;
}

export class BotEngine extends EventTarget {
  /**
   * @param {object} o
   * @param {object} o.broker PaperBroker | LiveBroker
   * @param {'paper'|'live'} o.mode
   * @param {(unit, market)=>Promise<Array>} o.getCandles 정규화된 캔들(과거→최신, 형성 캔들 포함)
   * @param {(market)=>number} o.getPrice 최신 체결가
   * @param {()=>number} [o.now]
   * @param {object} [o.state] 저장된 상태
   * @param {(state)=>void} [o.saveState]
   */
  constructor({ broker, mode = 'paper', getCandles, getPrice, now = () => Date.now(), state, saveState = () => {} }) {
    super();
    this.broker = broker;
    this.mode = mode;
    this.getCandles = getCandles;
    this.getPrice = getPrice;
    this.now = now;
    this.saveState = saveState;
    this.state = { ...freshBotState(), ...(state || {}) };
    this.config = null;
    this.feeRate = FEE_RATE;
    this.candles = [];
    this.nextEvalAt = null;
    this.lastPriceEval = 0;
    this.busy = false;
    this.orderErrors = 0;
    this.lastResult = null;
  }

  configure(cfg) {
    if (this.state.running) throw new Error('실행 중에는 설정을 바꿀 수 없습니다');
    this.config = {
      market: cfg.market,
      strategyId: cfg.strategyId,
      params: { ...STRATEGIES[cfg.strategyId].defaults, ...(cfg.params || {}) },
      invest: { type: 'fixed', amount: 100000, ratio: 50, ...(cfg.invest || {}) },
      safety: { ...DEFAULT_SAFETY, ...(cfg.safety || {}) }
    };
    this.unit = candleUnitOf(this.config.strategyId, this.config.params);
  }

  get running() {
    return this.state.running;
  }

  get status() {
    if (this.state.running) return this.state.position ? 'holding' : 'waiting';
    return this.state.error ? 'error' : 'stopped';
  }

  emit(type, detail) {
    this.dispatchEvent(makeEvent(type, detail));
  }

  log(kind, msg, extra = {}) {
    const entry = { at: this.now(), mode: this.mode, kind, market: this.config?.market || '', msg, ...extra };
    this.emit('log', entry);
    return entry;
  }

  persist() {
    this.saveState(structuredClone(this.state));
  }

  setStatus() {
    this.persist();
    this.emit('status', { status: this.status, state: this.state, nextEvalAt: this.nextEvalAt });
  }

  rollDaily() {
    const key = kstDateKey(this.now());
    if (this.state.dailyCount.date !== key) this.state.dailyCount = { date: key, count: 0 };
    if (this.state.dailyPnl.date !== key) this.state.dailyPnl = { date: key, pnl: 0 };
  }

  scheduleNext() {
    const now = this.now();
    // dip/vb: 가격 틱마다 판정하고, 일봉 목록은 다음 일봉 시작(KST 09:00) 직후 갱신
    this.nextEvalAt = isPriceBased(this.config.strategyId)
      ? dayStartUtc(now) + DAY_MS + VB_REFRESH_DELAY_MS
      : nextCloseTime(now, this.unit) + CANDLE_DELAY_MS;
  }

  async refreshCandles() {
    const all = await this.getCandles(this.unit, this.config.market);
    this.candles = isPriceBased(this.config.strategyId) ? all : closedOnly(all, this.unit, this.now());
    if (this.candles.length) this.state.lastCandleT = this.candles[this.candles.length - 1].t;
    return this.candles;
  }

  async start() {
    if (!this.config) throw new Error('설정이 없습니다');
    if (this.state.running) return;
    const v = validateParams(this.config.strategyId, this.config.params);
    if (!v.ok) throw new Error(v.errors.join(', '));
    const held = this.state.position;
    if (held && held.market && held.market !== this.config.market) {
      throw new Error(`${held.market} 보유 포지션이 남아 있습니다. 해당 마켓으로 돌아가 매도한 뒤 다른 마켓으로 시작하세요`);
    }
    this.state.error = null;
    try {
      const chance = await this.broker.getChance(this.config.market);
      if (chance.bidFee > 0) this.feeRate = chance.bidFee;
    } catch (e) {
      this.log('warn', `수수료 정보 조회 실패, 기본값 ${FEE_RATE * 100}% 사용: ${e.message}`);
    }
    await this.refreshCandles();
    if (this.candles.length < minCandlesFor(this.config.strategyId, this.config.params)) {
      this.log('warn', '데이터 부족 — 캔들이 충분히 쌓이면 판정합니다');
    }
    // ma/rsi: 시작 시점의 마지막 마감 캔들은 판정 완료로 처리(이미 교차한 상태로 매수하지 않음)
    if (!isPriceBased(this.config.strategyId) && this.candles.length) {
      this.state.memo = { ...this.state.memo, lastT: this.candles[this.candles.length - 1].t };
    }
    this.rollDaily();
    this.state.running = true;
    this.state.lastBeat = this.now();
    this.orderErrors = 0;
    this.scheduleNext();
    const p = this.config.params;
    this.log('info', `봇 시작 · ${STRATEGIES[this.config.strategyId].name} · ${JSON.stringify(p)}`);
    this.setStatus();
    await this.evaluate('start');
  }

  stop(reason = '봇 정지', kind = 'info') {
    if (!this.state.running && kind !== 'error') return;
    this.state.running = false;
    if (kind === 'error') this.state.error = reason;
    this.log(kind, reason);
    this.setStatus();
  }

  // 1초마다 호출. 캔들 마감 판정은 매번 현재 시각으로 다시 계산한다
  async heartbeat({ force = false } = {}) {
    if (!this.state.running) return;
    const now = this.now();
    const lastBeat = this.state.lastBeat;
    if (lastBeat && now - lastBeat > GAP_MS) {
      this.log('warn', `중단 구간 ${formatKst(lastBeat, 'hm')}~${formatKst(now, 'hm')} (놓친 신호는 소급 체결하지 않음)`);
      force = true;
    }
    this.state.lastBeat = now;
    this.rollDaily();
    if (force || (this.nextEvalAt && now >= this.nextEvalAt)) {
      try {
        await this.refreshCandles();
      } catch (e) {
        this.handleDataError(e);
        return;
      }
      this.scheduleNext();
      await this.evaluate('candle');
      // 다음날 자동 청산 타이머는 vb 전용(dip은 보유 기간 제한 없음 — 익절·손절선으로만 청산)
    } else if (this.config.strategyId === 'vb' && this.state.position && now >= dayStartUtc(this.state.position.enteredAt ?? 0) + DAY_MS) {
      await this.evaluate('timer');
    }
  }

  handleDataError(e) {
    if (e && e.status === 418) {
      this.stop('업비트가 요청을 일시 차단했습니다. 잠시 후 다시 시작하세요', 'error');
      return;
    }
    this.log('warn', `캔들 조회 실패, 10초 후 재시도: ${e?.message || e}`);
    this.nextEvalAt = this.now() + 10000;
  }

  // 가격 수신마다 호출(최대 초당 1회 평가)
  onPrice() {
    if (!this.state.running) return;
    const now = this.now();
    if (now - this.lastPriceEval < PRICE_THROTTLE_MS) return;
    this.lastPriceEval = now;
    this.evaluate('price').catch((e) => this.log('error', `평가 오류: ${e.message}`));
  }

  checkRisk(price) {
    const pos = this.state.position;
    if (!pos || !(price > 0)) return null;
    if (pos.market && pos.market !== this.config.market) return null;
    const s = this.config.safety;
    const change = price / pos.avgPrice - 1;
    if (s.stopLoss?.on && change <= -s.stopLoss.pct / 100) return `손절(${(change * 100).toFixed(2)}%)`;
    if (s.takeProfit?.on && change >= s.takeProfit.pct / 100) return `익절(${(change * 100).toFixed(2)}%)`;
    return null;
  }

  async evaluate(trigger) {
    if (!this.state.running || this.busy) return null;
    this.busy = true;
    try {
      const price = this.getPrice(this.config.market);
      const risk = this.checkRisk(price);
      if (risk) {
        this.log('signal', risk, { price });
        await this.executeSell(risk, price);
        return null;
      }
      // ma/rsi는 캔들 마감 시에만 전략 판정, 가격 틱에서는 안전장치만(dip/vb는 가격 틱마다 판정)
      if (!isPriceBased(this.config.strategyId) && (trigger === 'price' || trigger === 'timer')) return null;
      const result = evaluate(this.config.strategyId, {
        candles: this.candles,
        price,
        now: this.now(),
        position: this.state.position,
        memo: this.state.memo,
        params: this.config.params
      });
      this.state.memo = result.memo;
      this.lastResult = result;
      this.emit('evaluate', result);
      if (result.action === 'buy') {
        this.log('signal', `매수 신호: ${result.reason}`, { price });
        await this.executeBuy(result.reason, price);
      } else if (result.action === 'sell') {
        this.log('signal', `매도 신호: ${result.reason}`, { price });
        await this.executeSell(result.reason, price);
      } else {
        this.persist();
      }
      return result;
    } finally {
      this.busy = false;
    }
  }

  // 매수는 청산(매도) 1회분을 남겨 두고 허용한다(reserve=1). 매도는 한도 때문에 막지 않는다
  checkDailyLimit(reserve = 0) {
    this.rollDaily();
    const max = this.config.safety.dailyMaxOrders;
    if (max > 0 && this.state.dailyCount.count + reserve >= max) {
      this.stop(`일일 최대 주문 횟수(${max}회) 도달 — 봇 자동 정지`, 'warn');
      return false;
    }
    return true;
  }

  onOrderError(e) {
    this.orderErrors += 1;
    this.log('error', `주문 실패: ${e.message}`);
    if (e.code === 'unconfirmed') {
      this.stop('체결 확인 실패로 봇을 일시정지했습니다', 'error');
    } else if (this.orderErrors >= 3) {
      this.stop('주문 실패가 3회 이어져 봇을 정지했습니다', 'error');
    } else {
      this.setStatus();
    }
  }

  async executeBuy(reason, price) {
    if (this.state.position) return;
    if (!this.checkDailyLimit(1)) return;
    let bal;
    try {
      bal = await this.broker.getBalance();
    } catch (e) {
      this.onOrderError(e);
      return;
    }
    // 일일 손실 한도 기준: 그날 첫 매수 시점의 KRW 잔고
    if (!this.state.dailyPnl.base) this.state.dailyPnl.base = bal.krw;
    const { invest, safety } = this.config;
    const order = calcOrderKrw({
      type: invest.type,
      amount: invest.amount,
      ratio: invest.ratio,
      availableKrw: bal.krw,
      maxOrderKrw: safety.maxOrderKrw,
      feeRate: this.feeRate
    });
    if (!order.ok) {
      this.log('warn', `${order.reason} — 주문하지 않음 (가능 금액 ${order.krw.toLocaleString('ko-KR')}원)`);
      this.persist();
      return;
    }
    let fill;
    try {
      fill = await this.broker.marketBuy(this.config.market, order.krw, price);
    } catch (e) {
      this.onOrderError(e);
      return;
    }
    this.orderErrors = 0;
    this.state.dailyCount.count += 1;
    this.state.position = {
      market: this.config.market,
      qty: fill.qty,
      avgPrice: fill.price,
      enteredAt: this.now(),
      cost: fill.krw + fill.fee,
      dryRun: !!fill.dryRun
    };
    this.log('buy', `${fill.dryRun ? '[DRY-RUN] ' : ''}매수 체결 (${reason})`, {
      price: fill.price, qty: fill.qty, krw: fill.krw, fee: fill.fee, dryRun: !!fill.dryRun
    });
    this.emit('fill', fill);
    this.setStatus();
  }

  async executeSell(reason, price, { manual = false } = {}) {
    const pos = this.state.position;
    if (!pos) return;
    const market = pos.market || this.config.market;
    if (!(price > 0)) {
      // 현재가가 없으면 '잔량 소액'으로 오판해 포지션을 지우지 않도록 보류한다
      this.log('warn', `현재가가 없어 매도를 보류합니다(${reason})`);
      this.persist();
      return;
    }
    let qty = pos.qty;
    if (this.broker.kind === 'live' && !pos.dryRun) {
      // 봇이 산 수량과 실제 잔고 중 작은 값만 매도
      try {
        const bal = await this.broker.getBalance();
        qty = floor8(Math.min(qty, bal.coins[coinOf(market)]?.qty || 0));
      } catch (e) {
        this.onOrderError(e);
        return;
      }
    }
    if (!canSell(qty, price)) {
      this.log('warn', '잔량 소액(먼지) — 최소 주문금액 미만이라 매도하지 않고 포지션 종료로 처리', { price, qty });
      this.state.position = null;
      this.setStatus();
      return;
    }
    let fill;
    try {
      fill = await this.broker.marketSell(market, qty, price);
    } catch (e) {
      this.onOrderError(e);
      return;
    }
    this.orderErrors = 0;
    this.state.dailyCount.count += 1;
    const net = fill.krw - fill.fee;
    const pnl = realizedPnl({ net, cost: pos.cost, soldQty: fill.qty, boughtQty: pos.qty });
    this.state.realizedPnl += pnl;
    this.rollDaily();
    this.state.dailyPnl.pnl += pnl;
    const left = floor8(pos.qty - fill.qty);
    this.state.position = left > 0 && canSell(left, price)
      ? { ...pos, qty: left, cost: pos.cost * (left / pos.qty) }
      : null;
    this.log('sell', `${fill.dryRun ? '[DRY-RUN] ' : ''}매도 체결 (${reason})`, {
      price: fill.price, qty: fill.qty, krw: fill.krw, fee: fill.fee, pnl, pnlPct: pnl / (pos.cost * fill.qty / pos.qty), dryRun: !!fill.dryRun
    });
    this.emit('fill', fill);
    const lim = this.config.safety.dailyLossLimit;
    if (this.state.running && lim?.on && pos.cost > 0) {
      const base = this.state.dailyPnl.base || pos.cost;
      if (this.state.dailyPnl.pnl <= -base * lim.pct / 100) {
        this.stop(`일일 손실 한도(−${lim.pct}%) 도달 — 봇 자동 정지`, 'warn');
        return;
      }
    }
    if (this.state.running && !this.state.position) {
      const max = this.config.safety.dailyMaxOrders;
      if (max > 0 && this.state.dailyCount.count + 1 >= max) {
        this.stop(`일일 최대 주문 횟수(${max}회) 도달 — 봇 자동 정지`, 'warn');
        return;
      }
    }
    this.setStatus();
  }

  // 긴급 정지: 봇 정지 + (실거래) 미체결 주문 취소. 보유분은 자동 매도하지 않는다
  async emergencyStop() {
    this.state.running = false;
    this.log('warn', '모두 정지 — 봇을 멈췄습니다');
    if (this.broker.kind === 'live' && this.config) {
      try {
        const n = await this.broker.cancelAll(this.config.market);
        this.log('info', `미체결 주문 ${n}건 취소 요청`);
      } catch (e) {
        this.log('error', `미체결 주문 취소 실패: ${e.message}`);
      }
    }
    this.setStatus();
  }

  // "보유분 시장가 매도" 버튼(봇 정지 상태에서도 가능)
  async sellPosition() {
    if (!this.state.position || this.busy) return;
    this.busy = true;
    try {
      const market = this.state.position.market || this.config.market;
      await this.executeSell('수동 매도', this.getPrice(market), { manual: true });
    } finally {
      this.busy = false;
    }
  }

  resetPosition() {
    this.state = { ...freshBotState() };
    this.setStatus();
  }
}
