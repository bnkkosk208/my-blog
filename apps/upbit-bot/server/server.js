// 실거래용 로컬 서버: 정적 파일 서빙 + /api/* 업비트 프록시. 127.0.0.1에만 바인딩
// 실행: cd apps/upbit-bot/server && cp .env.example .env && node server.js
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from './env.js';
import { buildQuery, makeJwt, decodeJwtUnsigned } from './upbit-auth.js';

export const VERSION = '1.0.0';
// 공식 문서 확인 필요(spec 11장 5번): 미체결 조회 경로, 주문 엔드포인트
const UPBIT_API = 'https://api.upbit.com';
const OPEN_ORDERS_PATH = '/v1/orders/open';
const PAGES_ORIGIN = 'https://bnkkosk208.github.io';
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

export function loadConfig(env) {
  const port = Number(env.PORT) || 8787;
  return {
    port,
    dryRun: String(env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
    accessKey: env.UPBIT_ACCESS_KEY || '',
    secretKey: env.UPBIT_SECRET_KEY || '',
    keyConfigured: !isPlaceholder(env.UPBIT_ACCESS_KEY) && !isPlaceholder(env.UPBIT_SECRET_KEY),
    maxOrderKrw: Number(env.MAX_ORDER_KRW) || 50000,
    dailyMaxOrders: Number(env.DAILY_MAX_ORDERS) || 20,
    allowedMarkets: String(env.ALLOWED_MARKETS || 'KRW-BTC,KRW-ETH').split(',').map((s) => s.trim()).filter(Boolean),
    localToken: env.LOCAL_TOKEN || crypto.randomBytes(24).toString('base64url'),
    allowPagesOrigin: String(env.ALLOW_PAGES_ORIGIN || 'false').toLowerCase() === 'true'
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
const IDENT_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

export function createApp(config, { fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const sameOrigins = new Set([...hosts].map((h) => `http://${h}`));
  const tokenDigest = digest(config.localToken);
  const auth = { fails: 0, lockedUntil: 0 };
  const daily = { date: kstDateKey(), count: 0 };
  const identifiers = new Set();

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
    if (config.allowPagesOrigin && origin === PAGES_ORIGIN) {
      return {
        'Access-Control-Allow-Origin': PAGES_ORIGIN,
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
      if (!NUM_RE.test(String(b.volume)) || !(Number(b.volume) > 0)) return 'volume 형식 오류';
    } else {
      return 'side는 bid 또는 ask여야 합니다';
    }
    if (daily.date !== kstDateKey()) {
      daily.date = kstDateKey();
      daily.count = 0;
    }
    if (daily.count >= config.dailyMaxOrders) return ['daily_limit', `서버 일일 최대 주문 횟수(${config.dailyMaxOrders}) 초과`];
    return null;
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
    } else if (route === 'GET /api/orders/open') {
      const market = q.get('market');
      if (!MARKET_RE.test(market || '')) return fail(res, 400, 'validation_error', 'market 형식 오류', cors);
      out = await upbit('GET', OPEN_ORDERS_PATH, { market });
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
      // 업비트로 보낼 파라미터를 고정 순서로 다시 만든다(브라우저 값을 그대로 쓰지 않음)
      const params = body.side === 'bid'
        ? { market: body.market, side: 'bid', ord_type: 'price', price: String(body.price), identifier: body.identifier }
        : { market: body.market, side: 'ask', ord_type: 'market', volume: String(body.volume), identifier: body.identifier };
      identifiers.add(body.identifier);
      daily.count += 1;
      out = await upbit('POST', '/v1/orders', params, { dry: config.dryRun });
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
          allowPagesOrigin: config.allowPagesOrigin
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

export function start() {
  const env = loadEnv(path.join(SERVER_DIR, '.env'));
  const config = loadConfig(env);
  const server = createApp(config);
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`업비트 자동매매 봇 로컬 서버 v${VERSION}`);
    console.log(`http://127.0.0.1:${config.port}/ 에서 앱을 여세요`);
    console.log(`로컬 토큰: ${config.localToken}`);
    console.log(`DRY_RUN: ${config.dryRun ? 'true (업비트로 주문을 보내지 않음)' : 'false (실제 주문!)'}`);
    console.log(`API 키 설정: ${config.keyConfigured ? '예' : '아니오'} · 허용 마켓: ${config.allowedMarkets.join(', ')} · 1회 최대 ${config.maxOrderKrw}원`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start();
}
