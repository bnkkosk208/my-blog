// 실시간 시세(웹소켓 + 폴링 대체) 끊김 대응 테스트. 가짜 웹소켓·가짜 시세 클라이언트 사용(실제 네트워크 없음)
// 실행: node --test tests/feed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPriceFeed, OFFLINE_AFTER_FAILS } from '../lib/upbit-public.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 열자마자 닫히는(=업비트 실시간 연결 실패) 가짜 웹소켓
class ClosingWS {
  constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 1006 }); }, 1); }
  send() {}
  close() {}
}

// 정상 연결되지만 아무 메시지도 보내지 않는(=조용히 끊긴) 가짜 웹소켓
class SilentWS {
  static count = 0;
  constructor() { SilentWS.count += 1; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 1); }
  send() {}
  close() { this.readyState = 3; }
}

const tickerRow = { market: 'KRW-BTC', trade_price: 100, signed_change_rate: 0, signed_change_price: 0, change: 'EVEN', acc_trade_price_24h: 0 };

test('폴링이 한두 번 실패해도 바로 "연결 실패"로 바꾸지 않고, 연속 실패 때만 이유와 함께 알린다', async () => {
  let calls = 0;
  const failUntil = OFFLINE_AFTER_FAILS - 1; // 처음 2번 실패 → 3번째 성공
  const client = { getTickers: async () => { calls += 1; if (calls <= failUntil) { const e = new Error('x'); e.code = 'network'; throw e; } return [tickerRow]; } };
  const statuses = [];
  const prices = [];
  const feed = createPriceFeed({ client, WebSocketImpl: ClosingWS, onStatus: (s, i) => statuses.push([s, i.reason]), onTicker: (t) => prices.push(t.price), pollMs: 15 });
  feed.setMarket('KRW-BTC');
  await wait(120);
  feed.close();
  assert.ok(!statuses.some(([s]) => s === 'offline'), `offline이 뜨면 안 됨: ${JSON.stringify(statuses)}`);
  assert.ok(statuses.some(([s]) => s === 'polling'));
  assert.ok(prices.includes(100));
});

test('폴링이 연속으로 실패하면 "연결 실패"와 원인을 알려 준다', async () => {
  const client = { getTickers: async () => { const e = new Error('x'); e.status = 429; throw e; } };
  const statuses = [];
  const feed = createPriceFeed({ client, WebSocketImpl: ClosingWS, onStatus: (s, i) => statuses.push([s, i.reason]), onTicker: () => {}, pollMs: 10 });
  feed.setMarket('KRW-BTC');
  await wait(120);
  feed.close();
  const off = statuses.find(([s]) => s === 'offline');
  assert.ok(off, JSON.stringify(statuses));
  assert.match(off[1], /429/);
});

test('웹소켓이 조용히 끊기면(응답 없음) 감시 타이머가 다시 연결한다', async () => {
  SilentWS.count = 0;
  const client = { getTickers: async () => [tickerRow] };
  const feed = createPriceFeed({ client, WebSocketImpl: SilentWS, onTicker: () => {}, pingMs: 10, watchdogMs: 30, pollMs: 1000 });
  feed.setMarket('KRW-BTC');
  await wait(150);
  feed.close();
  assert.ok(SilentWS.count >= 2, `재연결 횟수 ${SilentWS.count}`);
});

test('reconnectNow는 기다리던 재연결을 건너뛰고 바로 다시 붙는다', async () => {
  let made = 0;
  class CountingClosing extends ClosingWS { constructor() { super(); made += 1; } }
  const client = { getTickers: async () => [tickerRow] };
  const feed = createPriceFeed({ client, WebSocketImpl: CountingClosing, onTicker: () => {}, pollMs: 1000 });
  feed.setMarket('KRW-BTC');
  await wait(20); // 첫 연결 실패 → 1초 뒤 재연결 예약 상태
  const before = made;
  feed.reconnectNow();
  await wait(5);
  feed.close();
  assert.equal(made, before + 1);
});
