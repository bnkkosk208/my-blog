// 로컬 서버 장부(M3)·일일 한도(M4) 테스트. 업비트 응답은 가짜 fetch로 흉내 낸다(실제 네트워크 없음)
// 실행: node --test tests/server.test.js  (Node 전용, 브라우저 테스트 러너에는 포함하지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createApp, loadConfig } from '../server/server.js';

const TOKEN = 'test-token';

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// 가짜 업비트: 주문마다 체결 결과를 정할 수 있다
function fakeUpbit() {
  const orders = new Map();
  const st = { n: 0, price: 50000000, next: [], posts: 0 };
  const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body });
  st.fetch = async (url, opt = {}) => {
    const u = new URL(url);
    if (u.pathname === '/v1/ticker') return json(200, [{ market: u.searchParams.get('markets'), trade_price: st.price }]);
    if (u.pathname === '/v1/orders' && opt.method === 'POST') {
      st.posts += 1;
      const b = JSON.parse(opt.body);
      const plan = st.next.shift() || {};
      if (plan.reject) return json(400, { error: { name: plan.reject, message: '거부됨' } });
      if (plan.network) throw new Error('down');
      const uuid = `00000000-0000-0000-0000-${String(++st.n).padStart(12, '0')}`;
      const executed = plan.executed ?? (b.side === 'bid' ? Number(b.price) / st.price : Number(b.volume));
      orders.set(uuid, { uuid, side: b.side, state: plan.state || 'done', executed_volume: String(executed) });
      return json(201, { uuid, side: b.side, state: 'wait' });
    }
    if (u.pathname === '/v1/order') {
      const o = orders.get(u.searchParams.get('uuid'));
      return o ? json(200, o) : json(404, { error: { name: 'order_not_found' } });
    }
    return json(404, { error: { name: 'not_found' } });
  };
  return st;
}

async function boot({ dryRun = false, dailyMax = 10, ledgerFile, upbit = fakeUpbit() } = {}) {
  const port = await freePort();
  const config = loadConfig({
    PORT: String(port), DRY_RUN: String(dryRun), UPBIT_ACCESS_KEY: 'FAKE-A', UPBIT_SECRET_KEY: 'FAKE-S',
    LOCAL_TOKEN: TOKEN, MAX_ORDER_KRW: '50000', DAILY_MAX_ORDERS: String(dailyMax), ALLOWED_MARKETS: 'KRW-BTC'
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upbit-bot-test-'));
  const file = ledgerFile || path.join(dir, 'data', 'positions.json');
  const server = createApp(config, { fetchImpl: upbit.fetch, log: () => {}, ledgerFile: file, pollMs: 1, pollMax: 5 });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${port}`;
  let seq = 0;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'X-Local-Token': TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  };
  const buy = (price = 10000) => call('POST', '/api/orders', { market: 'KRW-BTC', side: 'bid', ord_type: 'price', price: String(price), identifier: `t-${++seq}` });
  const sell = (volume) => call('POST', '/api/orders', { market: 'KRW-BTC', side: 'ask', ord_type: 'market', volume: String(volume), identifier: `t-${++seq}` });
  const positions = async () => (await call('GET', '/api/positions')).body;
  const settle = () => new Promise((r) => setTimeout(r, 40));
  // keep=true면 장부 파일이 든 임시 폴더를 남긴다(재시작 테스트용)
  const close = async (keep = false) => {
    await settle(); // 백그라운드 체결 확인이 끝난 뒤 정리
    await new Promise((r) => server.close(r));
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  };
  return { upbit, buy, sell, positions, settle, close, file, dir };
}

test('M3: 매수 체결 수량만큼 장부 증가, 장부보다 많은 매도 거부, 이내 매도 허용', async () => {
  const s = await boot();
  try {
    assert.equal((await s.sell('0.0001')).body.code, 'over_position', '장부 0이면 매도 거부(기존 보유분 보호)');
    assert.equal((await s.buy(10000)).status, 200);
    await s.settle();
    assert.equal((await s.positions()).live['KRW-BTC'], '0.0002');
    const over = await s.sell('0.00020001');
    assert.equal(over.status, 400);
    assert.equal(over.body.code, 'over_position');
    assert.match(over.body.message, /봇이 산 수량/);
    assert.equal((await s.sell('0.0002')).status, 200);
    await s.settle();
    assert.equal((await s.positions()).live['KRW-BTC'], undefined);
    assert.equal(s.upbit.posts, 2, '거부된 매도는 업비트로 보내지 않음');
  } finally {
    await s.close();
  }
});

test('M3: 업비트가 매도를 거부하면 장부 복구, 부분 체결이면 미체결분 복구', async () => {
  const s = await boot();
  try {
    await s.buy(10000);
    await s.settle();
    s.upbit.next.push({ reject: 'insufficient_funds_ask' });
    assert.equal((await s.sell('0.0002')).status, 400);
    assert.equal((await s.positions()).live['KRW-BTC'], '0.0002');
    s.upbit.next.push({ state: 'cancel', executed: 0.00005 });
    assert.equal((await s.sell('0.0002')).status, 200);
    await s.settle();
    assert.equal((await s.positions()).live['KRW-BTC'], '0.00015');
  } finally {
    await s.close();
  }
});

test('M3: 8자리 정수 단위로 계산(0.1 + 0.2 = 0.3), 9자리 이상 수량은 거부', async () => {
  const s = await boot();
  try {
    s.upbit.next.push({ executed: 0.1 }, { executed: 0.2 });
    await s.buy(10000);
    await s.buy(10000);
    await s.settle();
    assert.equal((await s.positions()).live['KRW-BTC'], '0.3');
    assert.equal((await s.sell('0.000000001')).body.code, 'validation_error');
    assert.equal((await s.sell('0.3')).status, 200);
  } finally {
    await s.close();
  }
});

test('M3: 체결 확인 불가(연결 실패)면 매수는 장부 미반영, 매도는 차감 유지', async () => {
  const s = await boot();
  try {
    s.upbit.next.push({ network: true });
    assert.equal((await s.buy(10000)).status, 502);
    await s.settle();
    assert.equal((await s.positions()).live['KRW-BTC'], undefined);
    await s.buy(10000);
    await s.settle();
    s.upbit.next.push({ network: true });
    assert.equal((await s.sell('0.0001')).status, 502);
    assert.equal((await s.positions()).live['KRW-BTC'], '0.0001');
  } finally {
    await s.close();
  }
});

test('M4: 일일 한도는 매수에만 — 한도 도달 후에도 매도 허용, 거부된 매수는 세지 않음', async () => {
  const s = await boot({ dailyMax: 2 });
  try {
    s.upbit.next.push({ reject: 'insufficient_funds_bid' });
    assert.equal((await s.buy(10000)).status, 400, '업비트 거부');
    assert.equal((await s.buy(10000)).status, 200);
    assert.equal((await s.buy(10000)).status, 200);
    const third = await s.buy(10000);
    assert.equal(third.body.code, 'daily_limit');
    await s.settle();
    assert.equal((await s.sell('0.0002')).status, 200);
    assert.equal((await s.sell('0.0002')).status, 200);
  } finally {
    await s.close();
  }
});

test('DRY-RUN: 별도 장부(dry)만 쓰고 실장부는 그대로, 추정 수량 초과 매도 거부', async () => {
  const s = await boot({ dryRun: true });
  try {
    const b = await s.buy(10000);
    assert.equal(b.body.dryRun, true);
    assert.equal(b.body.ledger.qty, '0.0002');
    const p = await s.positions();
    assert.equal(p.dry['KRW-BTC'], '0.0002');
    assert.deepEqual(p.live, {});
    assert.equal((await s.sell('0.0003')).body.code, 'over_position');
    assert.equal((await s.sell('0.0002')).status, 200);
    assert.equal(s.upbit.posts, 0, 'DRY-RUN은 업비트로 주문을 보내지 않음');
  } finally {
    await s.close();
  }
});

test('장부 파일: 재시작 후 유지, 권한 0600, 파일 삭제 시 초기화', async () => {
  const s = await boot();
  await s.buy(10000);
  await s.settle();
  await s.close(true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(s.file).mode & 0o777, 0o600);
  const s2 = await boot({ ledgerFile: s.file });
  try {
    assert.equal((await s2.positions()).live['KRW-BTC'], '0.0002');
  } finally {
    await s2.close();
  }
  fs.rmSync(s.file);
  const s3 = await boot({ ledgerFile: s.file });
  try {
    assert.deepEqual((await s3.positions()).live, {});
  } finally {
    await s3.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
