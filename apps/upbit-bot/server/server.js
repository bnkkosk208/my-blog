// 실거래용 로컬 서버: 정적 파일 서빙 + /api/* 업비트 프록시. 127.0.0.1에만 바인딩
// 실행: cd apps/upbit-bot/server && cp .env.example .env && node server.js
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv, setEnvValue } from './env.js';
import { buildQuery, makeJwt, decodeJwtUnsigned } from './upbit-auth.js';
import { createLedger, toUnits, fromUnits } from './ledger.js';

export const VERSION = '1.0.0';
// 공식 문서 확인 필요(spec 11장 5번): 미체결 조회 경로, 주문 엔드포인트
const UPBIT_API = 'https://api.upbit.com';
const OPEN_ORDERS_PATH = '/v1/orders/open';
// 키 목록·만료일 조회 — 공식 문서 확인 필요
const API_KEYS_PATH = '/v1/api_keys';
const KEY_EXPIRE_WARN_DAYS = 14;
const MIN_ORDER_KRW = 5000;
const MAX_BODY = 4 * 1024;
const UPSTREAM_TIMEOUT_MS = 10000;
const TOKEN_MAX_FAIL = 5;
const TOKEN_LOCK_MS = 60 * 1000;

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVER_DIR, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const isPlaceholder = (v) => !v || v.startsWith('여기에');
// 'https://example.github.io' 처럼 경로 없는 https 출처만 허용
const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

export function parsePagesOrigin(v) {
  const o = String(v || '').trim().replace(/\/$/, '').toLowerCase();
  return ORIGIN_RE.test(o) ? o : '';
}

export function loadConfig(env) {
  const port = Number(env.PORT) || 8787;
  return {
    port,
    dryRun: String(env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
    accessKey: env.UPBIT_ACCESS_KEY || '',
    secretKey: env.UPBIT_SECRET_KEY || '',
    keyConfigured: !isPlaceholder(env.UPBIT_ACCESS_KEY) && !isPlaceholder(env.UPBIT_SECRET_KEY),
    maxOrderKrw: Number(env.MAX_ORDER_KRW) || 50000,
    dailyMaxOrders: Number(env.DAILY_MAX_ORDERS) || 10,
    allowedMarkets: String(env.ALLOWED_MARKETS || 'KRW-BTC').split(',').map((s) => s.trim()).filter(Boolean),
    localToken: env.LOCAL_TOKEN || crypto.randomBytes(24).toString('base64url'),
    pagesOrigin: parsePagesOrigin(env.ALLOWED_PAGES_ORIGIN),
    get allowPagesOrigin() {
      return !!this.pagesOrigin;
    }
  };
}

function kstDateKey(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function digest(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

const NUM_RE = /^\d+(\.\d+)?$/;
const MARKET_RE = /^[A-Z]{2,5}-[A-Z0-9]{1,15}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const VOLUME_RE = /^\d+(\.\d{1,8})?$/;
// DRY-RUN 장부는 서버가 추정한 수량이라 브라우저 추정과 가격 차이만큼 어긋날 수 있다
const DRY_TOLERANCE = 1.02;
const IDENT_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

export function createApp(config, {
  fetchImpl = globalThis.fetch,
  log = console.log,
  ledgerFile = path.join(SERVER_DIR, 'data', 'positions.json'),
  pollMs = 1000,
  pollMax = 15,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms))
} = {}) {
  const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const sameOrigins = new Set([...hosts].map((h) => `http://${h}`));
  const tokenDigest = digest(config.localToken);
  const auth = { fails: 0, lockedUntil: 0 };
  const daily = { date: kstDateKey(), count: 0 };
  const identifiers = new Set();
  const ledger = createLedger(ledgerFile, { log });

  function send(res, status, body, headers = {}) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    });
    res.end(data);
  }

  const fail = (res, status, code, message, headers) => send(res, status, { ok: false, status, code, message }, headers);

  function corsHeaders(origin) {
    if (config.pagesOrigin && origin === config.pagesOrigin) {
      return {
        'Access-Control-Allow-Origin': config.pagesOrigin,
        Vary: 'Origin',
        'Access-Control-Allow-Headers': 'Content-Type, X-Local-Token',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        'Access-Control-Allow-Private-Network': 'true'
      };
    }
    return {};
  }

  function checkToken(req) {
    const now = Date.now();
    if (now < auth.lockedUntil) return 'locked';
    const given = req.headers['x-local-token'];
    if (typeof given === 'string' && given && crypto.timingSafeEqual(digest(given), tokenDigest)) {
      auth.fails = 0;
      return 'ok';
    }
    auth.fails += 1;
    if (auth.fails >= TOKEN_MAX_FAIL) {
      auth.fails = 0;
      auth.lockedUntil = now + TOKEN_LOCK_MS;
    }
    return 'bad';
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let chunks = [];
      req.on('data', (c) => {
        if (!chunks) return; // 한도 초과 후에는 버리면서 끝까지 읽는다
        size += c.length;
        if (size > MAX_BODY) {
          chunks = null;
          reject(Object.assign(new Error('too_large'), { status: 413 }));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (chunks) resolve(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', reject);
    });
  }

  async function upbit(method, pathname, params, extra = {}) {
    const qs = buildQuery(params);
    const jwt = makeJwt({ accessKey: config.accessKey, secretKey: config.secretKey, qs });
    const hasQuery = (method === 'GET' || method === 'DELETE') && qs;
    const url = `${UPBIT_API}${pathname}${hasQuery ? `?${qs}` : ''}`;
    if (extra.dry) {
      const { header, payload } = decodeJwtUnsigned(jwt);
      // 응답에 키 값이 나가지 않도록 가린다
      payload.access_key = '(숨김)';
      return {
        status: 200,
        body: { ok: true, dryRun: true, request: { method, url, body: method === 'POST' ? params : null, queryHash: payload.query_hash || null, jwtHeaderPayload: { header, payload } } }
      };
    }
    let r;
    try {
      r = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'POST' ? JSON.stringify(params) : undefined,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });
    } catch (e) {
      return { status: 502, body: { ok: false, status: 502, code: 'upstream_unreachable', message: '업비트 서버에 연결할 수 없습니다' } };
    }
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    const remaining = r.headers.get('remaining-req');
    const headers = remaining ? { 'Remaining-Req': remaining } : {};
    if (!r.ok) {
      return {
        status: r.status,
        headers,
        body: { ok: false, status: r.status, code: data?.error?.name || `upbit_${r.status}`, message: data?.error?.message || '업비트 요청 실패' }
      };
    }
    return { status: 200, headers, body: { ok: true, data } };
  }

  function validateOrder(b) {
    if (!b || typeof b !== 'object') return '바디가 올바르지 않습니다';
    if (!MARKET_RE.test(String(b.market)) || !config.allowedMarkets.includes(b.market)) return ['market_not_allowed', '허용되지 않은 마켓입니다'];
    if (typeof b.identifier !== 'string' || !IDENT_RE.test(b.identifier)) return 'identifier 형식 오류';
    if (identifiers.has(b.identifier)) return ['duplicate_identifier', '이미 처리한 identifier입니다'];
    if (b.side === 'bid') {
      if (b.ord_type !== 'price' || b.volume != null) return '시장가 매수는 ord_type=price, price만 허용합니다';
      if (!NUM_RE.test(String(b.price))) return 'price 형식 오류';
      const p = Number(b.price);
      if (p < MIN_ORDER_KRW) return ['under_min_total_bid', `최소 주문금액 ${MIN_ORDER_KRW}원 미만입니다`];
      if (p > config.maxOrderKrw) return ['over_max_order', `1회 최대 주문금액 ${config.maxOrderKrw}원 초과입니다`];
    } else if (b.side === 'ask') {
      if (b.ord_type !== 'market' || b.price != null) return '시장가 매도는 ord_type=market, volume만 허용합니다';
      if (!VOLUME_RE.test(String(b.volume)) || !(Number(b.volume) > 0)) return 'volume 형식 오류(소수 8자리까지)';
    } else {
      return 'side는 bid 또는 ask여야 합니다';
    }
    // 일일 한도는 매수에만 적용한다. 매도(청산)는 막지 않는다
    if (b.side === 'bid') {
      if (daily.date !== kstDateKey()) {
        daily.date = kstDateKey();
        daily.count = 0;
      }
      if (daily.count >= config.dailyMaxOrders) return ['daily_limit', `서버 일일 최대 매수 횟수(${config.dailyMaxOrders}) 초과 — 매도(청산)는 계속 가능합니다`];
    }
    return null;
  }

  const isFinal = (o) => o && (o.state === 'done' || o.state === 'cancel');

  // 체결 확정: 매수는 체결 수량만큼 장부 증가, 매도는 미리 뺀 수량 중 미체결분을 되돌린다
  function settle(uuid, order) {
    const info = ledger.takePending(uuid);
    if (!info) return;
    const executed = toUnits(order.executed_volume);
    if (info.side === 'bid') {
      ledger.add('live', info.market, executed);
      log(`장부: ${info.market} 매수 체결 +${fromUnits(executed)}`);
    } else {
      const refund = Math.max(0, info.units - executed);
      if (refund > 0) ledger.add('live', info.market, refund);
      log(`장부: ${info.market} 매도 체결 ${fromUnits(executed)}${refund > 0 ? `, 미체결 ${fromUnits(refund)} 복구` : ''}`);
    }
  }

  // 브라우저와 별개로 서버도 체결을 확인한다(브라우저 탭이 닫혀도 장부가 맞도록)
  async function confirmOrder(uuid) {
    for (let i = 0; i < pollMax; i++) {
      await sleep(pollMs);
      if (!ledger.hasPending(uuid)) return;
      const r = await upbit('GET', '/v1/order', { uuid });
      if (r.status === 200 && isFinal(r.body.data)) {
        settle(uuid, r.body.data);
        return;
      }
    }
    log('경고: 주문 체결을 확인하지 못했습니다 — 매수는 장부에 넣지 않고, 매도는 뺀 수량을 그대로 둡니다');
  }

  async function dryEstimateUnits(market, krw) {
    try {
      const r = await fetchImpl(`${UPBIT_API}/v1/ticker?markets=${encodeURIComponent(market)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      const list = await r.json();
      const price = Number(list?.[0]?.trade_price);
      if (r.ok && price > 0) return Math.floor((krw / price) * 1e8);
    } catch (e) {
      // 시세를 못 받으면 추정 불가
    }
    return -1;
  }

  async function placeOrder(body, res, cors) {
    const book = config.dryRun ? 'dry' : 'live';
    const market = body.market;
    let units = 0;
    if (body.side === 'ask') {
      units = toUnits(body.volume);
      const have = ledger.get(book, market);
      const unknownDry = book === 'dry' && have < 0;
      const limit = book === 'dry' ? Math.floor(have * DRY_TOLERANCE) : have;
      if (!unknownDry && units > limit) {
        return fail(res, 400, 'over_position',
          `봇이 산 수량(${fromUnits(Math.max(0, have))})보다 많이 매도할 수 없습니다. 원래 보유하던 코인은 업비트에서 직접 매도하세요`, cors);
      }
      // 동시 요청 대비: 업비트로 보내기 전에 먼저 뺀다
      if (unknownDry) ledger.sub(book, market, Infinity);
      else ledger.sub(book, market, units);
    } else {
      daily.count += 1; // 실패하면 아래에서 되돌린다
    }
    identifiers.add(body.identifier);
    // 업비트로 보낼 파라미터를 고정 순서로 다시 만든다(브라우저 값을 그대로 쓰지 않음)
    const params = body.side === 'bid'
      ? { market, side: 'bid', ord_type: 'price', price: String(body.price), identifier: body.identifier }
      : { market, side: 'ask', ord_type: 'market', volume: String(body.volume), identifier: body.identifier };
    const out = await upbit('POST', '/v1/orders', params, { dry: config.dryRun });
    const ok = out.status === 200 && out.body.ok;
    if (!ok) {
      // 업비트가 거부한 주문은 횟수·장부에 반영하지 않는다. 연결 실패는 나갔는지 모르므로 보수적으로 유지
      const rejected = out.body?.code !== 'upstream_unreachable';
      if (rejected) {
        if (body.side === 'bid') daily.count = Math.max(0, daily.count - 1);
        else ledger.add(book, market, units);
      } else {
        log('경고: 주문 전송 결과를 알 수 없습니다 — 매수 횟수와 매도 장부 차감을 유지합니다');
      }
    } else if (config.dryRun) {
      if (body.side === 'bid') {
        const est = await dryEstimateUnits(market, Number(body.price));
        // 시세를 못 받아 추정할 수 없으면 '알 수 없음'으로 표시하고 다음 DRY-RUN 매도는 통과시킨다
        if (est > 0 && ledger.get('dry', market) >= 0) ledger.add('dry', market, est);
        else ledger.setUnknown('dry', market);
      }
      const left = ledger.get('dry', market);
      out.body.ledger = { book: 'dry', market, qty: left < 0 ? '알 수 없음' : fromUnits(left) };
    } else {
      const uuid = out.body.data?.uuid;
      if (uuid) {
        ledger.addPending(uuid, { market, side: body.side, units, at: Date.now() });
        confirmOrder(uuid).catch(() => {});
      } else if (body.side === 'bid') {
        log('경고: 주문 번호(uuid)가 없어 매수 체결을 장부에 넣지 못했습니다');
      }
    }
    return send(res, out.status, out.body, { ...cors, ...(out.headers || {}) });
  }

  async function handleApi(req, res, url, cors) {
    const tok = checkToken(req);
    if (tok === 'locked') return fail(res, 429, 'locked', '토큰 인증 실패가 반복되어 1분간 잠겼습니다', cors);
    if (tok !== 'ok') return fail(res, 401, 'local_token', '로컬 토큰이 올바르지 않습니다', cors);

    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/session') return send(res, 200, { ok: true, dryRun: config.dryRun }, cors);
    if (!config.keyConfigured) return fail(res, 503, 'key_not_configured', '.env에 API 키가 설정되지 않았습니다', cors);

    const q = url.searchParams;
    let out;
    if (route === 'GET /api/accounts') {
      out = await upbit('GET', '/v1/accounts', {});
    } else if (route === 'GET /api/chance') {
      const market = q.get('market');
      if (!MARKET_RE.test(market || '')) return fail(res, 400, 'validation_error', 'market 형식 오류', cors);
      out = await upbit('GET', '/v1/orders/chance', { market });
    } else if (route === 'GET /api/order' || route === 'DELETE /api/order') {
      const uuid = q.get('uuid');
      if (!UUID_RE.test(uuid || '')) return fail(res, 400, 'validation_error', 'uuid 형식 오류', cors);
      out = await upbit(req.method, '/v1/order', { uuid }, { dry: req.method === 'DELETE' && config.dryRun });
      if (req.method === 'GET' && out.status === 200 && isFinal(out.body.data)) settle(uuid, out.body.data);
    } else if (route === 'GET /api/orders/open') {
      const market = q.get('market');
      if (!MARKET_RE.test(market || '')) return fail(res, 400, 'validation_error', 'market 형식 오류', cors);
      out = await upbit('GET', OPEN_ORDERS_PATH, { market });
    } else if (route === 'GET /api/positions') {
      return send(res, 200, { ok: true, dryRun: config.dryRun, ...ledger.snapshot() }, cors);
    } else if (route === 'POST /api/orders') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        return fail(res, 415, 'validation_error', 'Content-Type: application/json만 허용합니다', cors);
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        if (e.status === 413) return fail(res, 413, 'validation_error', '요청 바디가 너무 큽니다', cors);
        return fail(res, 400, 'validation_error', 'JSON 형식 오류', cors);
      }
      const err = validateOrder(body);
      if (err) {
        const [code, message] = Array.isArray(err) ? err : ['validation_error', err];
        return fail(res, 400, code, message, cors);
      }
      return placeOrder(body, res, cors);
    } else {
      return fail(res, 404, 'not_found', '없는 API입니다', cors);
    }
    return send(res, out.status, out.body, { ...cors, ...(out.headers || {}) });
  }

  function serveStatic(req, res, rawUrl, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method_not_allowed', '허용되지 않은 메서드');
    // 경로 탈출 시도는 정규화 전에 차단
    if (/(^|[\\/])\.\.([\\/]|$)|%2e%2e|%2f|%5c|\0/i.test(rawUrl)) return fail(res, 403, 'forbidden', '접근할 수 없는 경로');
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch (e) {
      return fail(res, 400, 'bad_path', '잘못된 경로');
    }
    let file = path.resolve(APP_ROOT, `.${rel}`);
    if (!file.startsWith(APP_ROOT + path.sep) && file !== APP_ROOT) return fail(res, 403, 'forbidden', '접근할 수 없는 경로');
    // server/ 폴더(.env 포함)와 숨김 파일은 서빙하지 않는다
    if (file === SERVER_DIR || file.startsWith(SERVER_DIR + path.sep)) return fail(res, 404, 'not_found', '없음');
    if (path.relative(APP_ROOT, file).split(path.sep).some((seg) => seg.startsWith('.'))) return fail(res, 404, 'not_found', '없음');
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    } catch (e) {
      return fail(res, 404, 'not_found', '없음');
    }
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return fail(res, 404, 'not_found', '없음');
    fs.readFile(file, (err, data) => {
      if (err) return fail(res, 404, 'not_found', '없음');
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || '/';
    res.on('finish', () => log(`${req.method} ${rawUrl.split('?')[0]} ${res.statusCode}`));
    try {
      // DNS 리바인딩 방지
      if (!hosts.has(String(req.headers.host || '').toLowerCase())) return fail(res, 403, 'bad_host', '허용되지 않은 Host');
      const origin = req.headers.origin;
      const cors = origin ? corsHeaders(origin) : {};
      if (origin && !sameOrigins.has(origin) && !cors['Access-Control-Allow-Origin']) {
        return fail(res, 403, 'bad_origin', '허용되지 않은 출처');
      }
      if (req.method === 'OPTIONS') {
        if (!cors['Access-Control-Allow-Origin']) return fail(res, 403, 'bad_origin', '허용되지 않은 출처');
        res.writeHead(204, cors);
        return res.end();
      }
      const url = new URL(rawUrl, `http://${req.headers.host}`);
      if (url.pathname === '/health' && req.method === 'GET') {
        return send(res, 200, {
          ok: true,
          version: VERSION,
          dryRun: config.dryRun,
          keyConfigured: config.keyConfigured,
          maxOrderKrw: config.maxOrderKrw,
          dailyMaxOrders: config.dailyMaxOrders,
          allowedMarkets: config.allowedMarkets,
          allowPagesOrigin: config.allowPagesOrigin,
          keyExpireAt: config.keyExpireAt || null
        }, cors);
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, cors);
      return serveStatic(req, res, rawUrl, url);
    } catch (e) {
      // 오류 메시지에 키가 섞이지 않도록 일반 문구만 응답
      log(`오류: ${e && e.name}`);
      if (!res.headersSent) fail(res, 500, 'internal', '서버 내부 오류');
    }
  });
  return server;
}

function restrictFile(file) {
  try {
    fs.chmodSync(file, 0o600); // Windows에서는 효과가 제한적
  } catch (e) {
    // 무시
  }
}

// 첫 실행: .env가 없으면 .env.example을 복사하고 안내 후 종료
export function ensureEnvFile(envFile, exampleFile) {
  if (fs.existsSync(envFile)) {
    restrictFile(envFile);
    return true;
  }
  fs.copyFileSync(exampleFile, envFile);
  restrictFile(envFile);
  return false;
}

// 키 만료일 확인 (조회 전용). 키 값은 출력하지 않는다
export async function checkKeyExpiry(config, fetchImpl = globalThis.fetch, now = Date.now()) {
  try {
    const jwt = makeJwt({ accessKey: config.accessKey, secretKey: config.secretKey });
    const r = await fetchImpl(`${UPBIT_API}${API_KEYS_PATH}`, {
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { level: 'warn', message: `키 확인 실패: ${data?.error?.name || r.status} (권한·허용 IP를 확인하세요)` };
    const mine = (Array.isArray(data) ? data : []).find((k) => k.access_key === config.accessKey);
    if (!mine || !mine.expire_at) return { level: 'warn', message: '키 만료일을 확인하지 못했습니다' };
    const exp = Date.parse(mine.expire_at);
    config.keyExpireAt = mine.expire_at;
    const days = Math.floor((exp - now) / 86400000);
    if (days < 0) return { level: 'error', message: `API 키가 만료되었습니다(${mine.expire_at}). 업비트에서 새로 발급하세요` };
    if (days <= KEY_EXPIRE_WARN_DAYS) return { level: 'warn', message: `API 키가 ${days}일 후 만료됩니다(${mine.expire_at})` };
    return { level: 'ok', message: `API 키 만료일: ${mine.expire_at}` };
  } catch (e) {
    return { level: 'warn', message: '키 확인 실패: 업비트 서버에 연결할 수 없습니다' };
  }
}

export function start() {
  const envFile = path.join(SERVER_DIR, '.env');
  if (!ensureEnvFile(envFile, path.join(SERVER_DIR, '.env.example'))) {
    console.log('처음 실행이라 설정 파일(.env)을 만들었습니다.');
    console.log(`  ${envFile}`);
    console.log('메모장 등으로 .env를 열어 UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY에 본인 키를 넣고 다시 실행하세요.');
    console.log('키를 넣지 않아도 다시 실행하면 모의투자 화면은 쓸 수 있습니다.');
    console.log('API 키 권한은 "자산조회"와 "주문하기"만 체크하세요. 출금 권한은 절대 체크하지 마세요.');
    process.exitCode = 0;
    return null;
  }
  const env = loadEnv(envFile);
  let newToken = false;
  if (!env.LOCAL_TOKEN) {
    env.LOCAL_TOKEN = crypto.randomBytes(24).toString('base64url');
    try {
      setEnvValue(envFile, 'LOCAL_TOKEN', env.LOCAL_TOKEN);
      restrictFile(envFile);
      newToken = true;
    } catch (e) {
      console.log('경고: .env에 토큰을 저장하지 못했습니다. 이번 실행에만 쓰는 토큰을 만듭니다.');
      newToken = true;
    }
  }
  const config = loadConfig(env);
  const server = createApp(config);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.log(`포트 ${config.port}이(가) 이미 사용 중입니다. 서버가 이미 켜져 있는지 확인하거나 .env의 PORT를 바꾸세요.`);
    else console.log(`서버 시작 실패: ${e.code || e.name}`);
    process.exitCode = 1;
  });
  server.listen(config.port, '127.0.0.1', async () => {
    console.log(`업비트 자동매매 봇 로컬 서버 v${VERSION}`);
    console.log(`브라우저에서 http://127.0.0.1:${config.port}/ 을 여세요`);
    if (newToken) {
      console.log(`로컬 토큰(처음 한 번만 표시, .env의 LOCAL_TOKEN에 저장됨): ${config.localToken}`);
    } else {
      console.log('로컬 토큰: .env 파일의 LOCAL_TOKEN 값을 실거래 진입 화면에 입력하세요');
    }
    console.log(`DRY_RUN: ${config.dryRun ? 'true (업비트로 주문을 보내지 않음)' : 'false (실제 주문!)'}`);
    console.log(`API 키 설정: ${config.keyConfigured ? '예' : '아니오'} · 허용 마켓: ${config.allowedMarkets.join(', ')} · 1회 최대 ${config.maxOrderKrw}원 · 하루 ${config.dailyMaxOrders}회`);
    if (config.pagesOrigin) console.log(`추가 허용 출처: ${config.pagesOrigin}`);
    console.log('이 프로그램은 본인 계좌·본인 판단·본인 책임으로 사용하는 도구이며 수익을 보장하지 않습니다.');
    if (!config.dryRun && config.keyConfigured) {
      const r = await checkKeyExpiry(config);
      console.log(`${r.level === 'ok' ? '' : '경고: '}${r.message}`);
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start();
}
