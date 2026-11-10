// 브로커: PaperBroker(모의)와 LiveBroker(로컬 서버 경유)가 같은 인터페이스를 가진다
import { FEE_RATE, MIN_ORDER_KRW, simulateBuy, simulateSell, money, floor8 } from './market-rules.js';

export class BrokerError extends Error {
  constructor(message, code = 'broker_error', extra = {}) {
    super(message);
    this.name = 'BrokerError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export function coinOf(market) {
  return String(market).split('-')[1];
}

let seq = 0;
function fillId(prefix) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function freshPaperAccount(initialKrw = 1000000, now = Date.now()) {
  return { krw: initialKrw, coins: {}, initialKrw, createdAt: now };
}

export class PaperBroker {
  /**
   * @param {{load:()=>object|null, save:(acc)=>void, getPrice:(market)=>number, feeRate?, slippage?, initialKrw?, now?}} opts
   */
  constructor({ load = () => null, save = () => {}, getPrice, feeRate = FEE_RATE, slippage = 0, initialKrw = 1000000, now = () => Date.now() }) {
    this.kind = 'paper';
    this.load = load;
    this.save = save;
    this.getPrice = getPrice;
    this.feeRate = feeRate;
    this.slippage = slippage;
    this.initialKrw = initialKrw;
    this.now = now;
    this.account = load() || freshPaperAccount(initialKrw, now());
  }

  persist() {
    this.save(this.account);
  }

  reset(initialKrw = this.initialKrw) {
    this.account = freshPaperAccount(initialKrw, this.now());
    this.persist();
  }

  async getBalance() {
    const a = this.account;
    return { krw: a.krw, krwLocked: 0, coins: structuredClone(a.coins), initialKrw: a.initialKrw };
  }

  async getChance() {
    return { bidFee: this.feeRate, askFee: this.feeRate, minTotal: MIN_ORDER_KRW };
  }

  async cancelAll() {}

  currentPrice(market) {
    const price = this.getPrice(market);
    if (!(price > 0)) throw new BrokerError('현재가가 없어 주문할 수 없습니다', 'no_price');
    return price;
  }

  async marketBuy(market, krwAmount) {
    if (!(krwAmount >= MIN_ORDER_KRW)) throw new BrokerError('최소 주문금액 미달', 'under_min_total');
    const price = this.currentPrice(market);
    const f = simulateBuy({ krw: krwAmount, price, feeRate: this.feeRate, slippage: this.slippage });
    const a = this.account;
    if (f.cost > a.krw + 1e-6) throw new BrokerError('KRW 잔고 부족', 'insufficient_funds_bid');
    a.krw = money(a.krw - f.cost);
    const cur = coinOf(market);
    const prev = a.coins[cur] || { qty: 0, avgPrice: 0 };
    const qty = floor8(prev.qty + f.qty);
    a.coins[cur] = { qty, avgPrice: qty > 0 ? (prev.qty * prev.avgPrice + f.qty * f.price) / qty : 0 };
    this.persist();
    return { id: fillId('paper'), side: 'buy', market, price: f.price, qty: f.qty, krw: f.krw, fee: f.fee, at: this.now() };
  }

  async marketSell(market, qty) {
    const price = this.currentPrice(market);
    const a = this.account;
    const cur = coinOf(market);
    const have = a.coins[cur]?.qty || 0;
    const v = floor8(Math.min(qty, have));
    if (!(v > 0)) throw new BrokerError('매도할 수량이 없습니다', 'insufficient_funds_ask');
    const f = simulateSell({ qty: v, price, feeRate: this.feeRate, slippage: this.slippage });
    a.krw = money(a.krw + f.net);
    const left = floor8(have - v);
    if (left > 0) a.coins[cur] = { ...a.coins[cur], qty: left };
    else delete a.coins[cur];
    this.persist();
    return { id: fillId('paper'), side: 'sell', market, price: f.price, qty: v, krw: f.krw, fee: f.fee, at: this.now() };
  }
}

// 업비트/로컬 서버 오류 코드 → 사람이 읽을 문장
const ERROR_TEXT = {
  insufficient_funds_bid: 'KRW 잔고 부족',
  insufficient_funds_ask: '매도 가능 수량 부족',
  under_min_total_bid: '최소 주문금액 미달(매수)',
  under_min_total_ask: '최소 주문금액 미달(매도)',
  invalid_query_payload: '요청 서명(query_hash) 오류',
  jwt_verification: 'API 키 인증 실패(JWT 검증 오류)',
  expired_access_key: 'API 키가 만료되었습니다',
  nonce_used: '중복 요청(nonce 재사용)',
  no_authorization_i_p: '허용되지 않은 IP입니다. 업비트에 PC 공인 IP를 등록하세요',
  out_of_scope: 'API 키 권한이 부족합니다',
  validation_error: '요청 값 오류',
  local_token: '로컬 토큰 인증 실패',
  locked: '토큰 인증 실패가 반복되어 잠시 잠겼습니다',
  key_not_configured: '서버에 API 키가 설정되지 않았습니다',
  market_not_allowed: '서버 허용 마켓이 아닙니다',
  over_max_order: '서버 1회 최대 주문금액 초과',
  daily_limit: '서버 일일 최대 주문 횟수 초과',
  duplicate_identifier: '중복 주문 요청',
  upstream_unreachable: '업비트 서버에 연결할 수 없습니다',
  network: '로컬 서버에 연결할 수 없습니다'
};

export function describeError(code, fallback) {
  return ERROR_TEXT[code] || fallback || code || '알 수 없는 오류';
}

export class LiveBroker {
  /**
   * @param {{baseUrl?:string, getToken:()=>string, fetchImpl?, sleep?, now?, pollMs?, pollMax?}} opts
   */
  constructor({ baseUrl = '', getToken, fetchImpl, sleep, now = () => Date.now(), pollMs = 1000, pollMax = 10, botId = 'bot' }) {
    this.kind = 'live';
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
    this.fetchImpl = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = now;
    this.pollMs = pollMs;
    this.pollMax = pollMax;
    this.botId = botId;
    this.inFlight = false;
  }

  async api(method, path, body) {
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Local-Token': this.getToken() || '' },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new BrokerError(describeError('network'), 'network');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || (data && data.ok === false)) {
      const code = data?.code || `http_${res.status}`;
      throw new BrokerError(describeError(code, data?.message), code, { status: res.status });
    }
    return data;
  }

  async getBalance() {
    const data = await this.api('GET', '/api/accounts');
    const list = Array.isArray(data) ? data : data.data || [];
    const out = { krw: 0, krwLocked: 0, coins: {} };
    for (const a of list) {
      if (a.currency === 'KRW') {
        out.krw = Number(a.balance);
        out.krwLocked = Number(a.locked);
      } else {
        out.coins[a.currency] = { qty: Number(a.balance), locked: Number(a.locked), avgPrice: Number(a.avg_buy_price) };
      }
    }
    return out;
  }

  async getChance(market) {
    const d = await this.api('GET', `/api/chance?market=${encodeURIComponent(market)}`);
    const c = d.data || d;
    return {
      bidFee: Number(c.bid_fee),
      askFee: Number(c.ask_fee),
      minTotal: Number(c.market?.bid?.min_total) || MIN_ORDER_KRW
    };
  }

  async cancelAll(market) {
    const d = await this.api('GET', `/api/orders/open?market=${encodeURIComponent(market)}`);
    const list = Array.isArray(d) ? d : d.data || [];
    for (const o of list) {
      await this.api('DELETE', `/api/order?uuid=${encodeURIComponent(o.uuid)}`);
    }
    return list.length;
  }

  identifier() {
    return `${this.botId}-${this.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async place(body, estimate) {
    if (this.inFlight) throw new BrokerError('이전 주문이 처리 중입니다', 'in_flight');
    this.inFlight = true;
    try {
      const d = await this.api('POST', '/api/orders', { ...body, identifier: this.identifier() });
      if (d.dryRun) {
        // DRY-RUN: 업비트로 보내지 않았다. 현재가 기준 추정 체결로 흐름만 이어간다
        return { id: 'dry-run', ...estimate, dryRun: true, request: d.request, at: this.now() };
      }
      const order = d.data || d;
      return await this.waitFilled(order.uuid, body.market);
    } finally {
      this.inFlight = false;
    }
  }

  async waitFilled(uuid, market) {
    for (let i = 0; i < this.pollMax; i++) {
      await this.sleep(this.pollMs);
      const d = await this.api('GET', `/api/order?uuid=${encodeURIComponent(uuid)}`);
      const o = d.data || d;
      const executed = Number(o.executed_volume || 0);
      // 시장가 매수는 체결 후 state가 cancel로 끝날 수 있음 — 공식 문서 확인 필요
      if (o.state === 'done' || (o.state === 'cancel' && executed > 0)) {
        const trades = o.trades || [];
        const funds = trades.reduce((s, t) => s + Number(t.funds || 0), 0);
        const vol = trades.reduce((s, t) => s + Number(t.volume || 0), 0) || executed;
        return {
          id: uuid,
          side: o.side === 'bid' ? 'buy' : 'sell',
          market,
          price: vol > 0 ? funds / vol : Number(o.price || 0),
          qty: vol,
          krw: funds,
          fee: Number(o.paid_fee || 0),
          at: this.now()
        };
      }
      if (o.state === 'cancel') throw new BrokerError('주문이 체결 없이 취소되었습니다', 'cancelled');
    }
    throw new BrokerError('체결 확인 시간 초과 — 업비트에서 주문 상태를 직접 확인하세요', 'unconfirmed', { uuid });
  }

  async marketBuy(market, krwAmount, price = 0) {
    const krw = Math.floor(krwAmount);
    const estimate = { side: 'buy', market, price, qty: price > 0 ? floor8(krw / price) : 0, krw, fee: krw * FEE_RATE };
    return this.place({ market, side: 'bid', ord_type: 'price', price: String(krw) }, estimate);
  }

  async marketSell(market, qty, price = 0) {
    const v = floor8(qty);
    const estimate = { side: 'sell', market, price, qty: v, krw: v * price, fee: v * price * FEE_RATE };
    return this.place({ market, side: 'ask', ord_type: 'market', volume: String(v) }, estimate);
  }
}
