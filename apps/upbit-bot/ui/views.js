// 렌더링 도우미. 외부 데이터·사용자 입력은 textContent로만 넣는다(innerHTML 사용 안 함)
import { roundToTick, tickSize, decimalsOf } from '../lib/market-rules.js';
import { formatKst } from '../lib/candles.js';

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const nf = (max, min = 0) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: max, minimumFractionDigits: min });
const nf0 = nf(0);

export function fmtKrw(n, withUnit = true) {
  if (n == null || !Number.isFinite(n)) return '-';
  const s = Math.abs(n) >= 100 ? nf0.format(Math.round(n)) : nf(2).format(n);
  return withUnit ? `${s}원` : s;
}

export function fmtSignedKrw(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  return `${n > 0 ? '+' : ''}${fmtKrw(n)}`;
}

// 호가 단위 기준 가격 표시
export function fmtPrice(p) {
  if (p == null || !Number.isFinite(p) || p <= 0) return '-';
  const d = decimalsOf(tickSize(p));
  return nf(d, d).format(roundToTick(p));
}

export function fmtPct(r, digits = 2) {
  if (r == null || !Number.isFinite(r)) return '-';
  const v = r * 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function fmtQty(q) {
  if (q == null || !Number.isFinite(q)) return '-';
  return nf(8).format(q);
}

// 거래대금 축약(억/조)
export function fmtBigKrw(n) {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e12) return `${nf(2).format(n / 1e12)}조`;
  if (n >= 1e8) return `${nf0.format(n / 1e8)}억`;
  return `${nf0.format(n / 1e4)}만`;
}

export function trendClass(v) {
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
}

export function setText(node, text, cls) {
  if (!node) return;
  node.textContent = text;
  if (cls !== undefined) {
    node.classList.remove('up', 'down', 'flat');
    if (cls) node.classList.add(cls);
  }
}

const KIND_LABEL = { buy: '매수', sell: '매도', signal: '신호', warn: '경고', error: '오류', info: '정보' };
const FILTERS = {
  all: () => true,
  trade: (l) => l.kind === 'buy' || l.kind === 'sell',
  signal: (l) => l.kind === 'signal',
  warn: (l) => l.kind === 'warn' || l.kind === 'error'
};

// 로그 표: 데스크톱은 표, 모바일은 CSS로 카드형
export function renderLogs(tbody, logs, filter = 'all', emptyNode) {
  clear(tbody);
  const list = logs.filter(FILTERS[filter] || FILTERS.all);
  if (emptyNode) emptyNode.hidden = list.length > 0;
  for (const l of list) {
    const tr = el('tr', { class: `log-${l.kind}` }, [
      el('td', { 'data-label': '시각', text: formatKst(l.at, 'full') }),
      el('td', { 'data-label': '모드', text: `${l.mode === 'live' ? '실거래' : '모의'}${l.dryRun ? '·DRY' : ''}` }),
      el('td', { 'data-label': '구분' }, el('span', { class: `kind kind-${l.kind}`, text: KIND_LABEL[l.kind] || l.kind })),
      el('td', { 'data-label': '마켓', text: l.market || '-' }),
      el('td', { 'data-label': '가격', class: 'num', text: l.price ? fmtPrice(l.price) : '-' }),
      el('td', { 'data-label': '수량', class: 'num', text: l.qty ? fmtQty(l.qty) : '-' }),
      el('td', { 'data-label': '금액', class: 'num', text: l.krw ? fmtKrw(l.krw) : '-' }),
      el('td', { 'data-label': '수수료', class: 'num', text: l.fee ? fmtKrw(l.fee) : '-' }),
      el('td', { 'data-label': '손익', class: `num ${l.pnl != null ? trendClass(l.pnl) : ''}`, text: l.pnl != null ? `${fmtSignedKrw(l.pnl)} (${fmtPct(l.pnlPct)})` : '-' }),
      el('td', { 'data-label': '내용', class: 'msg', text: l.msg || '' })
    ]);
    tbody.append(tr);
  }
}

export function logsToCsv(logs) {
  const head = ['시각(KST)', '모드', '구분', '마켓', '가격', '수량', '금액', '수수료', '손익', '내용'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    // 스프레드시트 수식 주입 방지
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = logs.map((l) => [formatKst(l.at, 'full'), l.mode, KIND_LABEL[l.kind] || l.kind, l.market, l.price ?? '', l.qty ?? '', l.krw ?? '', l.fee ?? '', l.pnl ?? '', l.msg]);
  return '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

// 내 계좌 요약
export function renderAccount(container, a) {
  clear(container);
  const row = (label, value, cls) => el('div', { class: 'stat' }, [
    el('dt', { text: label }),
    el('dd', { class: cls || '', text: value })
  ]);
  const items = [
    row('총자산', a.total != null ? `${fmtKrw(a.total)}${a.totalReturn != null ? ` (${fmtPct(a.totalReturn)})` : ''}` : '-', a.totalReturn != null ? trendClass(a.totalReturn) : ''),
    row('KRW 잔고', fmtKrw(a.krw)),
    row('보유 수량', a.qty ? `${fmtQty(a.qty)} ${a.coin}` : `0 ${a.coin || ''}`),
    row('평균 매수가', a.avgPrice ? fmtPrice(a.avgPrice) : '-'),
    row('평가금액', a.value ? fmtKrw(a.value) : '-'),
    row('평가손익', a.unrealized != null ? `${fmtSignedKrw(a.unrealized)} (${fmtPct(a.unrealizedPct)})` : '-', a.unrealized != null ? trendClass(a.unrealized) : ''),
    row('누적 실현손익', fmtSignedKrw(a.realized || 0), trendClass(a.realized || 0))
  ];
  container.append(el('dl', { class: 'stats' }, items));
  if (a.note) container.append(el('p', { class: 'muted small', text: a.note }));
}

// 백테스트 결과
export function renderBacktest(container, r, unitLabel) {
  clear(container);
  if (!r) return;
  const stat = (label, value, cls) => el('div', { class: 'stat' }, [el('dt', { text: label }), el('dd', { class: cls || '', text: value })]);
  container.append(
    el('p', { class: 'muted small', text: `${formatKst(r.from, 'datetime')} ~ ${formatKst(r.to, 'datetime')} · ${unitLabel} 캔들 ${r.equity.length}개 · 초기 ${fmtKrw(r.initialKrw)} · 매번 가용 KRW 전액 투자 가정` }),
    el('dl', { class: 'stats' }, [
      stat('총 수익률', fmtPct(r.totalReturn), trendClass(r.totalReturn)),
      stat('단순 보유', fmtPct(r.buyHoldReturn), trendClass(r.buyHoldReturn)),
      stat('거래 횟수', `${r.tradeCount}회`),
      stat('승률', r.winRate == null ? '-' : `${(r.winRate * 100).toFixed(0)}%`),
      stat('최대 낙폭(MDD)', r.mdd ? `-${(r.mdd * 100).toFixed(2)}%` : '0%'),
      stat('최종 자산', fmtKrw(r.finalEquity))
    ])
  );
  if (!r.trades.length) {
    container.append(el('p', { class: 'muted', text: '이 기간에는 거래가 없었습니다.' }));
    return;
  }
  const tbody = el('tbody');
  for (const t of r.trades) {
    tbody.append(el('tr', {}, [
      el('td', { 'data-label': '매수', text: `${formatKst(t.entryT, 'datetime')} · ${fmtPrice(t.entryPrice)}` }),
      el('td', { 'data-label': '매도', text: t.open ? `보유 중 · 종가 ${fmtPrice(t.exitPrice)}` : `${formatKst(t.exitT, 'datetime')} · ${fmtPrice(t.exitPrice)}` }),
      el('td', { 'data-label': '손익', class: `num ${trendClass(t.pnl)}`, text: `${fmtSignedKrw(t.pnl)} (${fmtPct(t.pnlPct)})` })
    ]));
  }
  container.append(el('div', { class: 'table-wrap' }, el('table', { class: 'table cards' }, [
    el('thead', {}, el('tr', {}, [el('th', { text: '매수' }), el('th', { text: '매도' }), el('th', { text: '손익' })])),
    tbody
  ])));
}
