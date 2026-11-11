// 업비트 공개 시세 REST(요청 큐 + 토큰 버킷) + 웹소켓 래퍼
// Node에서 import해도 에러가 나지 않도록 브라우저 전역은 함수 안에서만 사용한다
import { normalizeCandles } from './candles.js';

// 공식 문서 확인 필요(spec 11장 1~3번): 주소, 요청 한도, 웹소켓 프레임 형식
export const UPBIT_REST = 'https://api.upbit.com/v1';
export const UPBIT_WS = 'wss://api.upbit.com/websocket/v1';
export const RATE_PER_SEC = 5; // 알려진 시세 한도(초당 10회)의 절반
export const WS_PING_MS = 30000;
export const POLL_MS = 2000;
export const WS_BACKOFF_MAX_MS = 10000;

export class UpbitError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'UpbitError';
    this.status = status;
    this.code = code;
  }
}

// 'group=candles; min=599; sec=9' → { group:'candles', min:599, sec:9 }
export function parseRemainingReq(header) {
  if (!header) return null;
  const out = {};
  for (const part of String(header).split(';')) {
    const [k, v] = part.split('=').map((s) => (s || '').trim());
    if (!k) continue;
    out[k] = k === 'group' ? v : Number(v);
  }
  return out;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createPublicClient({ fetchImpl, base = UPBIT_REST, ratePerSec = RATE_PER_SEC, sleep = defaultSleep, now = () => Date.now() } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  let tokens = ratePerSec;
  let lastRefill = now();
  let pauseUntil = 0;
  let chain = Promise.resolve();

  async function acquire() {
    for (;;) {
      const t = now();
      if (t < pauseUntil) {
        await sleep(pauseUntil - t);
        continue;
      }
      tokens = Math.min(ratePerSec, tokens + ((t - lastRefill) / 1000) * ratePerSec);
      lastRefill = t;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - tokens) / ratePerSec) * 1000));
    }
  }

  async function doRequest(path, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v != null) qs.set(k, v);
    const url = `${base}${path}${qs.toString() ? `?${qs}` : ''}`;
    for (let attempt = 0; ; attempt++) {
      await acquire();
      let res;
      try {
        res = await doFetch(url, { headers: { Accept: 'application/json' } });
      } catch (e) {
        throw new UpbitError('시세 서버에 연결할 수 없습니다', 0, 'network');
      }
      const rr = parseRemainingReq(res.headers?.get?.('Remaining-Req'));
      if (rr && rr.sec <= 1) pauseUntil = Math.max(pauseUntil, now() + 1000);
      if (res.status === 429 && attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 418) throw new UpbitError('업비트가 요청을 일시 차단했습니다', 418, 'blocked');
      if (!res.ok) {
        let msg = `요청 실패(${res.status})`;
        try {
          const body = await res.json();
          if (body?.error?.message) msg = body.error.message;
        } catch (e) {
          // 본문 없음
        }
        throw new UpbitError(msg, res.status);
      }
      return res.json();
    }
  }

  function request(path, params) {
    const p = chain.then(() => doRequest(path, params));
    chain = p.catch(() => {});
    return p;
  }

  return {
    request,
    getMarkets: () => request('/market/all', { isDetails: 'true' }),
    getTickers: (markets) => request('/ticker', { markets: markets.join(',') }),
    async getCandles(unit, market, count = 200, to) {
      const raw = await request(`/candles/${unit}`, { market, count, to });
      return normalizeCandles(raw);
    }
  };
}

export function normalizeTicker(x) {
  return {
    market: x.code || x.market,
    price: Number(x.trade_price),
    changeRate: Number(x.signed_change_rate),
    changePrice: Number(x.signed_change_price),
    change: x.change,
    accTradePrice24h: Number(x.acc_trade_price_24h),
    ts: x.trade_timestamp || x.timestamp || Date.now()
  };
}

// 업비트 market/all 응답 → KRW 마켓 목록
export function normalizeMarkets(list) {
  return (list || [])
    .filter((m) => typeof m.market === 'string' && m.market.startsWith('KRW-'))
    .map((m) => ({
      market: m.market,
      korean: m.korean_name || '',
      english: m.english_name || '',
      warning: m.market_warning === 'CAUTION' || m.market_event?.warning === true
    }));
}

/**
 * 실시간 가격: 웹소켓 1개. 끊기면 지수 백오프로 재연결하고 그동안 REST 폴링으로 대체
 * status: 'connecting' | 'live' | 'polling' | 'offline'
 * onStatus(status, info) — info.reason: 마지막 실패 이유(사람이 읽는 문장)
 */
export const WS_WATCHDOG_MS = 75000; // 이 시간 동안 아무 메시지(PING 응답 포함)도 없으면 끊긴 것으로 본다
export const OFFLINE_AFTER_FAILS = 3; // 폴링이 연속 이만큼 실패해야 '연결 실패'로 표시
export function createPriceFeed({ client, onTicker, onStatus = () => {}, WebSocketImpl, url = UPBIT_WS, pingMs = WS_PING_MS, pollMs = POLL_MS, watchdogMs = WS_WATCHDOG_MS, now = () => Date.now() }) {
  const WS = WebSocketImpl || globalThis.WebSocket;
  let market = null;
  let ws = null;
  let backoff = 1000;
  let reconnectTimer = null;
  let pollTimer = null;
  let pingTimer = null;
  let closed = false;
  let status = '';
  let pollFails = 0;
  let lastMsgAt = 0;
  let reason = '';

  const setStatus = (s) => {
    if (s !== status) {
      status = s;
      onStatus(s, { reason });
    }
  };
  const wsOpen = () => ws && ws.readyState === 1;

  function subscribe() {
    if (!wsOpen() || !market) return;
    const ticket = `upbit-bot-${Math.random().toString(36).slice(2)}`;
    ws.send(JSON.stringify([{ ticket }, { type: 'ticker', codes: [market] }, { format: 'DEFAULT' }]));
  }

  function describe(e) {
    if (!e) return '알 수 없는 오류';
    if (e.status === 429) return '요청이 너무 많아 업비트가 잠시 제한함(429)';
    if (e.status === 418) return '업비트가 요청을 일시 차단함(418)';
    if (e.code === 'network') return '네트워크 오류 또는 브라우저 차단(인터넷 연결·광고 차단 확장 확인)';
    return e.message || String(e);
  }

  async function pollOnce() {
    if (!market) return;
    try {
      const list = await client.getTickers([market]);
      pollFails = 0;
      if (list && list[0]) onTicker(normalizeTicker(list[0]));
      if (!wsOpen()) setStatus('polling');
    } catch (e) {
      pollFails += 1;
      reason = describe(e);
      // 한두 번 실패는 흔하므로 연속으로 실패할 때만 '연결 실패'로 보여 준다
      if (!wsOpen() && pollFails >= OFFLINE_AFTER_FAILS) setStatus('offline');
    }
  }

  function startPolling() {
    if (pollTimer || closed) return;
    pollOnce();
    pollTimer = setInterval(pollOnce, pollMs);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function decode(data) {
    if (typeof data === 'string') return data;
    try {
      return new TextDecoder().decode(data);
    } catch (e) {
      return '';
    }
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 2, WS_BACKOFF_MAX_MS);
  }

  function cleanupSocket() {
    clearInterval(pingTimer);
    pingTimer = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch (e) { /* 무시 */ }
    }
    ws = null;
  }

  function onDrop(why, { immediate = false } = {}) {
    if (why) reason = why;
    cleanupSocket();
    startPolling();
    if (immediate) connect();
    else scheduleReconnect();
  }

  function connect() {
    if (closed) return;
    if (!WS) {
      startPolling();
      return;
    }
    if (status !== 'polling' && status !== 'offline') setStatus('connecting');
    try {
      ws = new WS(url);
    } catch (e) {
      onDrop('실시간 연결을 만들 수 없음');
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      backoff = 1000;
      lastMsgAt = now();
      stopPolling();
      subscribe();
      setStatus('live');
      // 무응답 끊김 방지: PING을 보내고, 응답·시세가 오래 없으면 다시 연결한다(공식 문서 확인 필요: idle timeout)
      pingTimer = setInterval(() => {
        if (now() - lastMsgAt > watchdogMs) {
          // 잘 되던 연결이 조용히 끊긴 경우라 기다리지 않고 바로 다시 붙는다
          onDrop('실시간 응답 없음(자동 재연결)', { immediate: true });
          return;
        }
        try { ws.send('PING'); } catch (e) { /* 무시 */ }
      }, pingMs);
    };
    ws.onmessage = (ev) => {
      lastMsgAt = now();
      const text = decode(ev.data);
      if (!text || text[0] !== '{') return;
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (msg.type === 'ticker' && (msg.code || msg.cd) === market) {
        setStatus('live');
        onTicker(normalizeTicker(msg));
      }
    };
    ws.onerror = () => onDrop('실시간 연결 오류');
    ws.onclose = (ev) => onDrop(`실시간 연결 끊김${ev && ev.code ? `(코드 ${ev.code})` : ''}`);
  }

  return {
    get status() { return status; },
    get reason() { return reason; },
    setMarket(m) {
      market = m;
      if (wsOpen()) subscribe();
      if (pollTimer) pollOnce();
      if (!ws && !reconnectTimer && !pollTimer) connect();
    },
    // 화면 복귀·인터넷 재연결·사용자 클릭 때 즉시 다시 붙는다
    reconnectNow() {
      if (closed) return;
      if (wsOpen() && now() - lastMsgAt < watchdogMs) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      backoff = 1000;
      pollFails = 0;
      cleanupSocket();
      if (pollTimer) pollOnce();
      connect();
    },
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      stopPolling();
      cleanupSocket();
    }
  };
}
