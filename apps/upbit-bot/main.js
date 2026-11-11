// 엔트리: 상태 초기화, 모듈 연결, 이벤트 바인딩
import { createStore, tokenStore } from './lib/store.js';
import { createPublicClient, createPriceFeed, normalizeMarkets } from './lib/upbit-public.js';
import { STRATEGIES, PARAM_SPECS, STRATEGY_UNITS, candleUnitOf, validateParams, evaluate } from './lib/strategies.js';
import { CANDLE_UNITS, closedOnly, nextCloseTime, formatKst } from './lib/candles.js';
import { sma, rsiWilder } from './lib/indicators.js';
import { runBacktest } from './lib/backtest.js';
import { FEE_RATE, MIN_ORDER_KRW } from './lib/market-rules.js';
import { PaperBroker, LiveBroker, coinOf } from './lib/brokers.js';
import { BotEngine, freshBotState } from './lib/bot.js';
import { createChart } from './ui/chart.js';
import * as V from './ui/views.js';
import { isServedLocally, isTopWindow, createServerMonitor, chipText, openLiveDialog } from './ui/live-gate.js';

export const APP_VERSION = '1.0.0';

const RISK_TEXT = [
  '이 앱은 개인 학습·실험용으로 만든 도구이며 투자 권유나 자문이 아닙니다. 가상자산은 가격 변동이 매우 크고 원금 전액을 잃을 수 있습니다.',
  '앱에 포함된 전략(변동성 돌파, 이동평균 교차, RSI)과 백테스트 결과는 과거 데이터에 기반한 것으로 미래 수익을 보장하지 않습니다.',
  '실거래 모드에서 발생하는 모든 주문과 그 결과(손실, 수수료, 프로그램 오류·네트워크 장애·거래소 장애로 인한 손해 포함)에 대한 책임은 전적으로 사용자에게 있습니다.',
  '이 프로그램은 각 사용자가 자기 PC에 직접 설치해 본인 계좌·본인 API 키로 쓰는 도구입니다. 모든 거래는 본인 판단이며 책임도 본인에게 있습니다. 배포자는 사용자의 API 키·자산에 접근하지 않으며, 투자 손실이나 키 관리 소홀로 생긴 손해에 책임지지 않습니다.',
  'API 키는 본인 PC의 server/.env에만 보관하고, 출금 권한을 절대 부여하지 마십시오. 유출이 의심되면 즉시 업비트에서 키를 삭제하십시오.',
  '이 앱은 업비트(두나무)와 관련이 없는 비공식 도구입니다.'
];

const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const MAX_LOGS = 500;
const MARKET_CACHE_MS = 24 * 3600 * 1000;
const PAPER_INITIAL = 1000000;
const FEED_TEXT = {
  connecting: ['○ 시세 연결 중', ''],
  live: ['● 실시간', 'ok'],
  polling: ['◐ 실시간 끊김 · 폴링 중', 'warn'],
  offline: ['⚠ 시세 연결 실패, 재시도 중', 'warn']
};
const STATUS_TEXT = { stopped: '정지', waiting: '실행 중 · 대기(미보유)', holding: '실행 중 · 보유 중', error: '오류' };

const $ = (id) => document.getElementById(id);
const store = createStore();

// ---------- 설정 ----------
const DEFAULT_SETTINGS = {
  market: 'KRW-BTC',
  strategyId: 'vb',
  params: {
    vb: { ...STRATEGIES.vb.defaults },
    ma: { ...STRATEGIES.ma.defaults },
    rsi: { ...STRATEGIES.rsi.defaults }
  },
  invest: { type: 'fixed', amount: 100000, ratio: 50 },
  safety: {
    maxOrderPaper: 0,
    maxOrderLive: 50000,
    dailyMaxOrders: 10,
    stopLoss: { on: false, pct: 3 },
    takeProfit: { on: false, pct: 5 },
    dailyLossLimit: { on: false, pct: 5 }
  },
  slippage: 0,
  serverBase: ''
};

function loadSettings() {
  const s = store.get('settings', {}) || {};
  const d = structuredClone(DEFAULT_SETTINGS);
  const out = { ...d, ...s };
  out.params = {
    vb: { ...d.params.vb, ...(s.params?.vb || {}) },
    ma: { ...d.params.ma, ...(s.params?.ma || {}) },
    rsi: { ...d.params.rsi, ...(s.params?.rsi || {}) }
  };
  out.invest = { ...d.invest, ...(s.invest || {}) };
  out.safety = { ...d.safety, ...(s.safety || {}) };
  if (!STRATEGIES[out.strategyId]) out.strategyId = 'vb';
  for (const id of ['ma', 'rsi']) {
    const u = out.params[id].unit;
    if (!CANDLE_UNITS[u] || (u === 'minutes/1' && !DEBUG)) out.params[id].unit = 'minutes/60';
  }
  return out;
}

const settings = loadSettings();
const saveSettings = () => store.set('settings', settings);

// ---------- 상태 ----------
const app = {
  mode: 'paper',
  markets: [],
  prices: {},
  ticker: null,
  chartUnit: candleUnitOf(settings.strategyId, settings.params[settings.strategyId]),
  chartCandles: [],
  chartNext: 0,
  strategyUnit: null,
  strategyCandles: [],
  strategyNext: 0,
  logs: { paper: store.get('logs:paper', []) || [], live: store.get('logs:live', []) || [] },
  logFilter: 'all',
  backtest: null,
  liveToken: tokenStore.get(),
  liveAuthFailed: false,
  liveBalance: null,
  lastAccountAt: 0,
  lastAriaAt: 0,
  ticking: false,
  errors: { params: [], invest: [], safety: [] }
};

const client = createPublicClient();
const chart = createChart($('chart'));
let engine = null;
let feed = null;
let monitor = null;

// ---------- 공통 UI ----------
function currentMarketInfo() {
  return app.markets.find((m) => m.market === settings.market) || { market: settings.market, korean: '', english: '' };
}

function confirmDialog(title, lines, { okLabel = '확인', danger = false, cancel = true } = {}) {
  const dlg = $('confirm-dialog');
  $('confirm-title').textContent = title;
  const body = $('confirm-body');
  V.clear(body);
  for (const line of lines) body.append(V.el('p', { text: line }));
  const ok = $('confirm-ok');
  const no = $('confirm-cancel');
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? 'danger' : 'primary'}`;
  no.hidden = !cancel;
  return new Promise((resolve) => {
    const done = (v) => {
      ok.onclick = no.onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    ok.onclick = () => done(true);
    no.onclick = () => done(false);
    dlg.onclose = () => done(false);
    dlg.showModal();
    (cancel ? no : ok).focus();
  });
}

function addLog(entry) {
  const list = app.logs[entry.mode] || app.logs[app.mode];
  list.unshift(entry);
  if (list.length > MAX_LOGS) list.length = MAX_LOGS;
  store.set(`logs:${entry.mode}`, list);
  if (entry.mode === 'live' && entry.kind === 'error' && entry.msg.includes('로컬 토큰')) {
    app.liveAuthFailed = true;
    renderServerChip();
  }
  if (entry.mode === app.mode) renderLogs();
  if (entry.kind === 'buy' || entry.kind === 'sell') updateChart();
}

function renderLogs() {
  V.renderLogs($('log-body'), app.logs[app.mode], app.logFilter, $('log-empty'));
}

// ---------- 테마 ----------
function currentTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr) return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initTheme() {
  $('theme-btn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.setRaw('theme', next);
    chart.redraw();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => chart.redraw());
}

// ---------- 탭 ----------
function initTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    updateChart();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next);
    });
  });
}

const activeTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.id;

// ---------- 마켓 ----------
async function loadMarkets() {
  const cached = store.get('markets');
  if (cached && Date.now() - cached.at < MARKET_CACHE_MS && cached.list?.length) {
    app.markets = cached.list;
  } else {
    try {
      app.markets = normalizeMarkets(await client.getMarkets());
      if (app.markets.length) store.set('markets', { at: Date.now(), list: app.markets });
    } catch (e) {
      app.markets = cached?.list || [];
      setTimeout(loadMarkets, 30000);
    }
  }
  renderMarketOptions($('market-search').value);
  renderMarketWarning();
}

function renderMarketOptions(query = '') {
  const sel = $('market-select');
  const q = query.trim().toLowerCase();
  let list = app.markets.length ? app.markets : [{ market: settings.market, korean: '', english: '' }];
  if (q) list = list.filter((m) => m.market.toLowerCase().includes(q) || m.korean.toLowerCase().includes(q) || m.english.toLowerCase().includes(q));
  if (!list.some((m) => m.market === settings.market)) list = [currentMarketInfo(), ...list];
  V.clear(sel);
  for (const m of list) {
    sel.append(V.el('option', { value: m.market, text: `${m.korean ? `${m.korean} ` : ''}${m.market}${m.warning ? ' [유의]' : ''}` }));
  }
  sel.value = settings.market;
}

function renderMarketWarning() {
  $('market-warning').hidden = !currentMarketInfo().warning;
}

function changeMarket(market) {
  if (engine.running || market === settings.market) return;
  const held = engine.state.position;
  if (held && (held.market || settings.market) !== market) {
    // 봇 1개 = 마켓 1개: 보유 포지션을 다른 마켓 기준으로 매도·평가하지 않도록 막는다
    $('market-select').value = settings.market;
    confirmDialog('마켓 변경', [`${held.market || settings.market} 보유 포지션이 있습니다. "보유분 시장가 매도"로 정리한 뒤 마켓을 바꾸세요.`], { cancel: false });
    return;
  }
  settings.market = market;
  saveSettings();
  app.ticker = null;
  app.backtest = null;
  V.renderBacktest($('backtest-result'), null);
  renderTicker();
  renderMarketWarning();
  feed.setMarket(market);
  app.chartCandles = [];
  chart.setData({ candles: [] });
  reloadData();
  refreshAccount(true);
}

// ---------- 시세 ----------
function onTicker(t) {
  if (t.market !== settings.market || !(t.price > 0)) return;
  const prev = app.prices[t.market];
  app.prices[t.market] = t.price;
  app.ticker = t;
  renderTicker(prev);
  chart.updateLastPrice(t.price);
  engine.onPrice();
  if (!engine.running) renderIndicators();
  if (Date.now() - app.lastAccountAt > 1000) refreshAccount();
}

function renderTicker(prev) {
  const t = app.ticker;
  const priceEl = $('price');
  if (!t) {
    V.setText(priceEl, '-', 'flat');
    V.setText($('change-rate'), '', 'flat');
    V.setText($('change-price'), '', 'flat');
    V.setText($('volume'), '거래대금 -');
    return;
  }
  const cls = V.trendClass(t.changeRate);
  V.setText(priceEl, `${V.fmtPrice(t.price)}원`, cls);
  V.setText($('change-rate'), `${t.changeRate > 0 ? '▲' : t.changeRate < 0 ? '▼' : ''} ${V.fmtPct(t.changeRate)}`, cls);
  const diff = Math.abs(t.changePrice);
  V.setText($('change-price'), diff > 0 ? `${t.changePrice > 0 ? '+' : '-'}${V.fmtPrice(diff)}` : '0', cls);
  V.setText($('volume'), `거래대금(24h) ${V.fmtBigKrw(t.accTradePrice24h)}`);
  if (prev && prev !== t.price) {
    const f = t.price > prev ? 'flash-up' : 'flash-down';
    priceEl.classList.add(f);
    setTimeout(() => priceEl.classList.remove(f), 150);
  }
  // 스크린리더 요약은 5초에 1회
  if (Date.now() - app.lastAriaAt > 5000) {
    app.lastAriaAt = Date.now();
    const info = currentMarketInfo();
    $('price-live').textContent = `${info.korean || settings.market} ${V.fmtPrice(t.price)}원, ${V.fmtPct(t.changeRate)}`;
  }
}

function onFeedStatus(s) {
  const [text, cls] = FEED_TEXT[s] || FEED_TEXT.connecting;
  const chip = $('feed-chip');
  chip.textContent = text;
  chip.className = `chip ${cls}`;
}

// ---------- 캔들 데이터 ----------
async function fetchCandles(unit, market) {
  const list = await client.getCandles(unit, market, 200);
  if (market === settings.market) {
    if (unit === app.strategyUnit) {
      app.strategyCandles = list;
      app.strategyNext = nextCloseTime(Date.now(), unit) + 3000;
    }
    if (unit === app.chartUnit) {
      app.chartCandles = list.map((c) => ({ ...c }));
      app.chartNext = nextCloseTime(Date.now(), unit) + 3000;
      updateChart();
    }
    renderIndicators();
  }
  return list;
}

function onDataError(e, what) {
  if (e && e.status === 418) {
    if (engine.running) engine.stop('업비트가 요청을 일시 차단했습니다', 'error');
    chart.setMessage('업비트가 요청을 일시 차단했습니다');
  } else {
    chart.setMessage('시세 연결 실패, 재시도 중');
  }
  const retry = Date.now() + 10000;
  if (what === 'chart') app.chartNext = retry;
  else app.strategyNext = retry;
}

async function loadStrategyCandles() {
  app.strategyUnit = candleUnitOf(settings.strategyId, settings.params[settings.strategyId]);
  try {
    await fetchCandles(app.strategyUnit, settings.market);
  } catch (e) {
    onDataError(e, 'strategy');
  }
}

async function loadChartCandles() {
  if (app.chartUnit === app.strategyUnit && app.strategyNext > Date.now() && app.strategyCandles.length) {
    app.chartCandles = app.strategyCandles.map((c) => ({ ...c }));
    app.chartNext = app.strategyNext;
    updateChart();
    return;
  }
  try {
    await fetchCandles(app.chartUnit, settings.market);
  } catch (e) {
    onDataError(e, 'chart');
  }
}

async function reloadData() {
  await loadStrategyCandles();
  await loadChartCandles();
}

// ---------- 차트 ----------
function renderChartUnits() {
  const box = $('chart-units');
  V.clear(box);
  const units = DEBUG ? ['minutes/1', ...STRATEGY_UNITS] : STRATEGY_UNITS;
  for (const u of units) {
    box.append(V.el('button', {
      type: 'button',
      'aria-pressed': String(u === app.chartUnit),
      dataset: { unit: u },
      text: CANDLE_UNITS[u].label,
      onclick: () => {
        if (app.chartUnit === u) return;
        app.chartUnit = u;
        renderChartUnits();
        app.chartCandles = [];
        chart.setData({ candles: [] });
        loadChartCandles();
      }
    }));
  }
}

function chartMarkers() {
  const bt = app.backtest;
  if (activeTab() === 'tab-backtest' && bt && bt.market === settings.market && bt.unit === app.chartUnit) return bt.markers;
  return app.logs[app.mode]
    .filter((l) => (l.kind === 'buy' || l.kind === 'sell') && l.market === settings.market)
    .map((l) => ({ t: l.at, side: l.kind, price: l.price }));
}

function updateChart() {
  const cs = app.chartCandles;
  const sid = settings.strategyId;
  const p = settings.params[sid];
  const closes = cs.map((c) => c.c);
  const maS = sid === 'ma' ? p.short : 5;
  const maL = sid === 'ma' ? p.long : 20;
  const ind = currentIndicators();
  const data = {
    candles: cs,
    unit: app.chartUnit,
    ma: { short: sma(closes, maS), long: sma(closes, maL) },
    target: sid === 'vb' && app.chartUnit === 'days' ? ind?.target || 0 : 0,
    markers: chartMarkers(),
    rsi: sid === 'rsi' ? { values: rsiWilder(closes, p.period), low: p.low, high: p.high } : null
  };
  $('chart-wrap').classList.toggle('with-rsi', !!data.rsi);
  $('legend-ma1').textContent = `MA${maS}`;
  $('legend-ma2').textContent = `MA${maL}`;
  const price = app.prices[settings.market];
  $('chart').setAttribute('aria-label', `${settings.market} ${CANDLE_UNITS[app.chartUnit].label}봉 차트${price ? `, 현재가 ${V.fmtPrice(price)}원` : ''}`);
  if (!cs.length) chart.setMessage('차트 데이터를 불러오는 중…');
  chart.setData(data);
}

// ---------- 전략·파라미터 폼 ----------
function parseNum(v) {
  const s = String(v).replace(/,/g, '').trim();
  if (s === '') return NaN;
  return Number(s);
}

function renderStrategy() {
  const sid = settings.strategyId;
  document.querySelectorAll('input[name="strategy"]').forEach((r) => { r.checked = r.value === sid; });
  $('strategy-desc').textContent = STRATEGIES[sid].desc;
  const box = $('params');
  V.clear(box);
  const p = settings.params[sid];
  for (const spec of PARAM_SPECS[sid]) {
    const id = `param-${spec.key}`;
    const input = V.el('input', { class: 'input', id, inputmode: 'decimal', value: String(p[spec.key]) });
    input.addEventListener('input', () => {
      p[spec.key] = parseNum(input.value);
      saveSettings();
      validateForm();
      renderIndicators();
      updateChart();
    });
    box.append(V.el('label', { class: 'field', for: id }, [
      V.el('span', { class: 'field-label', text: `${spec.label} (${spec.min}~${spec.max})` }),
      input
    ]));
  }
  if (sid === 'vb') {
    const cb = V.el('input', { type: 'checkbox', id: 'param-mafilter' });
    cb.checked = !!p.maFilter;
    cb.addEventListener('change', () => {
      p.maFilter = cb.checked;
      saveSettings();
      renderIndicators();
    });
    box.append(V.el('label', { class: 'check' }, [cb, '이동평균 필터(시가 > 5일 평균)']));
  } else {
    const sel = V.el('select', { class: 'input', id: 'param-unit' });
    const units = DEBUG ? ['minutes/1', ...STRATEGY_UNITS] : STRATEGY_UNITS;
    for (const u of units) sel.append(V.el('option', { value: u, text: `${CANDLE_UNITS[u].label}봉` }));
    sel.value = p.unit;
    sel.addEventListener('change', () => {
      p.unit = sel.value;
      saveSettings();
      onStrategyChanged();
    });
    box.append(V.el('label', { class: 'field', for: 'param-unit' }, [V.el('span', { class: 'field-label', text: '캔들 단위' }), sel]));
  }
  validateForm();
}

function onStrategyChanged() {
  app.backtest = null;
  V.renderBacktest($('backtest-result'), null);
  app.chartUnit = candleUnitOf(settings.strategyId, settings.params[settings.strategyId]);
  app.strategyCandles = [];
  app.chartCandles = [];
  chart.setData({ candles: [] });
  renderChartUnits();
  renderIndicators();
  reloadData();
}

function setErrors(el, errors) {
  el.textContent = errors.join(' · ');
}

function validateForm() {
  const sid = settings.strategyId;
  const v = validateParams(sid, settings.params[sid]);
  app.errors.params = v.errors;
  setErrors($('param-error'), v.errors);
  for (const spec of PARAM_SPECS[sid]) {
    const input = $(`param-${spec.key}`);
    if (input) input.setAttribute('aria-invalid', String(v.errors.some((e) => e.startsWith(spec.label))));
  }

  const inv = settings.invest;
  const ie = [];
  if (inv.type === 'fixed' && !(inv.amount >= MIN_ORDER_KRW)) ie.push(`고정 금액은 ${MIN_ORDER_KRW.toLocaleString('ko-KR')}원 이상`);
  if (inv.type === 'ratio' && !(inv.ratio > 0 && inv.ratio <= 100)) ie.push('비중은 1~100%');
  app.errors.invest = ie;
  setErrors($('invest-error'), ie);
  $('invest-amount').setAttribute('aria-invalid', String(inv.type === 'fixed' && ie.length > 0));
  $('invest-ratio').setAttribute('aria-invalid', String(inv.type === 'ratio' && ie.length > 0));

  const s = settings.safety;
  const se = [];
  if (!(s.maxOrderPaper >= 0)) se.push('모의 1회 최대 주문금액은 0 이상');
  if (!(s.maxOrderLive >= MIN_ORDER_KRW)) se.push(`실거래 1회 최대 주문금액은 ${MIN_ORDER_KRW}원 이상`);
  if (!(Number.isInteger(s.dailyMaxOrders) && s.dailyMaxOrders >= 1 && s.dailyMaxOrders <= 100)) se.push('일일 최대 주문 횟수는 1~100 정수');
  if (!(settings.slippage >= 0 && settings.slippage <= 0.5)) se.push('슬리피지는 0~0.5%');
  for (const [k, label] of [['stopLoss', '손절'], ['takeProfit', '익절'], ['dailyLossLimit', '일일 손실 한도']]) {
    if (s[k].on && !(s[k].pct > 0 && s[k].pct <= 50)) se.push(`${label} 기준은 0~50%`);
  }
  app.errors.safety = se;
  setErrors($('safety-error'), se);
  updateButtons();
  return formValid();
}

const formValid = () => !app.errors.params.length && !app.errors.invest.length && !app.errors.safety.length;

function initForms() {
  document.querySelectorAll('input[name="strategy"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (!r.checked || engine.running) return;
      settings.strategyId = r.value;
      saveSettings();
      renderStrategy();
      onStrategyChanged();
    });
  });

  const inv = settings.invest;
  document.querySelectorAll('input[name="invest-type"]').forEach((r) => {
    r.checked = r.value === inv.type;
    r.addEventListener('change', () => {
      if (r.checked) inv.type = r.value;
      saveSettings();
      validateForm();
    });
  });
  $('invest-amount').value = String(inv.amount);
  $('invest-ratio').value = String(inv.ratio);
  $('invest-amount').addEventListener('input', (e) => { inv.amount = parseNum(e.target.value); saveSettings(); validateForm(); });
  $('invest-ratio').addEventListener('input', (e) => { inv.ratio = parseNum(e.target.value); saveSettings(); validateForm(); });

  const s = settings.safety;
  const bindNum = (id, get, set) => {
    const input = $(id);
    input.value = String(get());
    input.addEventListener('input', () => { set(parseNum(input.value)); saveSettings(); validateForm(); });
  };
  bindNum('max-order-paper', () => s.maxOrderPaper, (v) => { s.maxOrderPaper = v; });
  bindNum('max-order-live', () => s.maxOrderLive, (v) => { s.maxOrderLive = v; });
  bindNum('daily-max', () => s.dailyMaxOrders, (v) => { s.dailyMaxOrders = v; });
  bindNum('slippage', () => settings.slippage, (v) => {
    settings.slippage = v;
    if (engine?.broker.kind === 'paper' && v >= 0 && v <= 0.5) engine.broker.slippage = v / 100;
  });
  for (const [k, pre] of [['stopLoss', 'sl'], ['takeProfit', 'tp'], ['dailyLossLimit', 'dl']]) {
    const cb = $(`${pre}-on`);
    cb.checked = !!s[k].on;
    cb.addEventListener('change', () => { s[k].on = cb.checked; saveSettings(); validateForm(); });
    bindNum(`${pre}-pct`, () => s[k].pct, (v) => { s[k].pct = v; });
  }

  $('market-search').addEventListener('input', (e) => renderMarketOptions(e.target.value));
  $('market-select').addEventListener('change', (e) => changeMarket(e.target.value));
}

// ---------- 지표 표시 ----------
function currentIndicators() {
  if (engine?.running && engine.lastResult) return engine.lastResult.indicators;
  return previewResult()?.indicators;
}

function previewResult() {
  const sid = settings.strategyId;
  const p = settings.params[sid];
  if (!validateParams(sid, p).ok || !app.strategyCandles.length) return null;
  const unit = candleUnitOf(sid, p);
  if (unit !== app.strategyUnit) return null;
  const now = Date.now();
  const candles = sid === 'vb' ? app.strategyCandles : closedOnly(app.strategyCandles, unit, now);
  return evaluate(sid, { candles, price: app.prices[settings.market], now, position: engine?.state.position || null, memo: {}, params: p });
}

function renderIndicators() {
  const sid = settings.strategyId;
  const r = engine?.running && engine.lastResult ? engine.lastResult : previewResult();
  const line = $('indicator-line');
  if (!r) {
    line.textContent = app.strategyCandles.length ? '-' : '캔들 불러오는 중…';
    return;
  }
  const i = r.indicators || {};
  const price = app.prices[settings.market];
  if (sid === 'vb') {
    if (!i.target) { line.textContent = r.reason; return; }
    const state = engine.state.position ? '보유 중' : price >= i.target ? '돌파' : '대기';
    line.textContent = `목표가 ${V.fmtPrice(i.target)}원 · 현재 ${state}${i.ma5 ? ` · 5일 평균 ${V.fmtPrice(i.ma5)}` : ''} · ${r.reason}`;
  } else if (sid === 'ma') {
    const p = settings.params.ma;
    line.textContent = i.smaShort != null
      ? `MA${p.short} ${V.fmtPrice(i.smaShort)} / MA${p.long} ${V.fmtPrice(i.smaLong)} · 현재 상태: ${r.reason}`
      : r.reason;
  } else {
    const p = settings.params.rsi;
    line.textContent = i.rsi != null
      ? `RSI ${i.rsi.toFixed(2)} (직전 ${i.prevRsi?.toFixed(2)}) · 과매도 ${p.low} / 과매수 ${p.high} · ${r.reason}`
      : r.reason;
  }
  if (sid === 'vb' && app.chartUnit === 'days') updateChart();
}

// ---------- 봇 상태·버튼 ----------
function renderStatus() {
  const st = engine.status;
  const text = st === 'error' ? `오류 · ${engine.state.error}` : STATUS_TEXT[st];
  const el = $('bot-status');
  el.textContent = text;
  el.className = st === 'error' ? 'down' : st === 'holding' ? 'up' : '';
  renderNextEval();
  updateButtons();
}

function renderNextEval() {
  const el = $('next-eval');
  if (!engine.running || !engine.nextEvalAt) { el.textContent = ''; return; }
  el.textContent = settings.strategyId === 'vb'
    ? `실시간 판정 · 일봉 갱신 ${formatKst(engine.nextEvalAt, 'datetime')}`
    : `다음 판정 ${formatKst(engine.nextEvalAt)}`;
}

function updateButtons() {
  if (!engine) return;
  const running = engine.running;
  $('bot-config').disabled = running;
  $('safety-config').disabled = running;
  $('market-search').disabled = running;
  $('market-select').disabled = running;
  $('start-btn').disabled = running || !formValid();
  $('stop-btn').disabled = !running;
  $('sell-all-btn').disabled = !engine.state.position;
  $('reset-paper-btn').disabled = running;
}

// ---------- 계좌 ----------
async function refreshAccount(fetchLive = false) {
  app.lastAccountAt = Date.now();
  const price = app.prices[settings.market] || 0;
  const coin = coinOf(settings.market);
  const st = engine.state;
  const pos = st.position;
  const a = { coin, realized: st.realizedPnl };
  if (app.mode === 'paper') {
    const b = await engine.broker.getBalance();
    const h = b.coins[coin];
    a.krw = b.krw;
    a.qty = h?.qty || 0;
    a.avgPrice = h?.avgPrice || 0;
    a.value = a.qty * price;
    let others = 0;
    for (const [c, x] of Object.entries(b.coins)) if (c !== coin) others += x.qty * x.avgPrice;
    a.total = price || !a.qty ? b.krw + a.value + others : null;
    a.totalReturn = a.total != null ? a.total / b.initialKrw - 1 : null;
    if (a.qty && price) {
      const cost = pos ? pos.cost : a.qty * a.avgPrice;
      a.unrealized = a.value - cost;
      a.unrealizedPct = a.unrealized / cost;
    }
    if (others > 0) a.note = '다른 마켓 보유분은 평균 매수가로 계산했습니다.';
  } else {
    if (fetchLive || !app.liveBalance) {
      try {
        app.liveBalance = await engine.broker.getBalance();
      } catch (e) {
        V.renderAccount($('account'), { coin, realized: st.realizedPnl, note: `잔고 조회 실패: ${e.message}` });
        return;
      }
    }
    const b = app.liveBalance;
    const h = b.coins[coin];
    a.krw = b.krw;
    a.qty = h?.qty || 0;
    a.avgPrice = h?.avgPrice || 0;
    a.value = a.qty * price;
    a.total = b.krw + b.krwLocked + a.value;
    if (pos && price) {
      a.unrealized = pos.qty * price - pos.cost;
      a.unrealizedPct = a.unrealized / pos.cost;
    }
    a.note = `서버 잔고 기준(총자산은 KRW + ${coin}만 합산). 봇 포지션: ${pos ? `${V.fmtQty(pos.qty)} ${coin}${pos.dryRun ? ' (DRY-RUN 가상)' : ''}` : '없음'} — 봇은 자신이 산 수량만 매도합니다.`;
  }
  V.renderAccount($('account'), a);
}

// ---------- 엔진 ----------
function makeBroker(mode) {
  if (mode === 'paper') {
    return new PaperBroker({
      load: () => store.get('paper'),
      save: (acc) => store.set('paper', acc),
      getPrice: (m) => app.prices[m],
      slippage: (settings.slippage || 0) / 100,
      initialKrw: PAPER_INITIAL
    });
  }
  return new LiveBroker({ baseUrl: serverBase() || '', getToken: () => app.liveToken, botId: 'upbitbot' });
}

function currentConfig() {
  const s = settings.safety;
  return {
    market: settings.market,
    strategyId: settings.strategyId,
    params: settings.params[settings.strategyId],
    invest: settings.invest,
    safety: {
      maxOrderKrw: app.mode === 'live' ? s.maxOrderLive : s.maxOrderPaper,
      dailyMaxOrders: s.dailyMaxOrders,
      stopLoss: s.stopLoss,
      takeProfit: s.takeProfit,
      dailyLossLimit: s.dailyLossLimit
    }
  };
}

function makeEngine(mode) {
  const e = new BotEngine({
    broker: makeBroker(mode),
    mode,
    getCandles: fetchCandles,
    getPrice: (m) => app.prices[m],
    state: store.get(`bot:${mode}`),
    saveState: (s) => store.set(`bot:${mode}`, s)
  });
  e.addEventListener('log', (ev) => addLog(ev.detail));
  e.addEventListener('status', () => {
    renderStatus();
    refreshAccount();
  });
  e.addEventListener('fill', () => {
    refreshAccount(true);
  });
  e.addEventListener('evaluate', () => renderIndicators());
  // 이전 실행 상태는 정지 상태로 복원하고, 사용자가 "재개"를 눌러야 다시 시작
  if (e.state.running) {
    e.state.running = false;
    e.persist();
    $('restore-banner').hidden = false;
  } else {
    $('restore-banner').hidden = true;
  }
  return e;
}

async function startBot() {
  if (!validateForm()) return;
  const sid = settings.strategyId;
  const p = settings.params[sid];
  const info = currentMarketInfo();
  const inv = settings.invest;
  const cfg = currentConfig();
  const paramText = PARAM_SPECS[sid].map((s) => `${s.label} ${p[s.key]}`).join(', ') + (sid === 'vb' ? '' : `, ${CANDLE_UNITS[p.unit].label}봉`);
  const lines = [
    `마켓: ${info.korean ? `${info.korean} ` : ''}${settings.market}`,
    `전략: ${STRATEGIES[sid].name} (${paramText})`,
    `투자: ${inv.type === 'fixed' ? V.fmtKrw(inv.amount) : `KRW 잔고의 ${inv.ratio}%`} · 1회 최대 ${cfg.safety.maxOrderKrw > 0 ? V.fmtKrw(cfg.safety.maxOrderKrw) : '제한 없음'} · 일 ${cfg.safety.dailyMaxOrders}회`,
    `모드: ${app.mode === 'live' ? `실거래${monitor.state.dryRun ? ' (서버 DRY-RUN)' : ' — 실제 주문'}` : '모의투자'}`
  ];
  if (info.warning) lines.unshift('⚠ 이 마켓은 투자 유의 종목입니다.');
  if (!app.prices[settings.market]) lines.push('아직 현재가를 받지 못했습니다. 가격이 들어오면 판정합니다.');
  if (app.mode === 'live') lines.push('실제 자산으로 주문이 나갈 수 있습니다. 시작할까요?');
  const ok = await confirmDialog(app.mode === 'live' ? '실거래 봇 시작' : '봇 시작', lines, { okLabel: '시작', danger: app.mode === 'live' });
  if (!ok) return;
  $('restore-banner').hidden = true;
  try {
    engine.configure(cfg);
    await engine.start();
  } catch (e) {
    engine.stop(`봇 시작 실패: ${e.message}`, 'error');
  }
  renderStatus();
}

async function sellAll() {
  const pos = engine.state.position;
  if (!pos) return;
  const posMarket = pos.market || settings.market;
  const ok = await confirmDialog('보유분 시장가 매도', [
    `${posMarket} ${V.fmtQty(pos.qty)} ${coinOf(posMarket)}를 시장가로 매도합니다.`,
    app.mode === 'live' ? '실거래 모드입니다. 실제 주문이 나갈 수 있습니다.' : '모의 계좌에서 매도합니다.'
  ], { okLabel: '매도', danger: true });
  if (!ok) return;
  if (!engine.running) engine.configure(currentConfig());
  await engine.sellPosition();
  renderStatus();
}

function initBotButtons() {
  $('start-btn').addEventListener('click', startBot);
  $('resume-btn').addEventListener('click', startBot);
  $('restore-dismiss').addEventListener('click', () => { $('restore-banner').hidden = true; });
  $('stop-btn').addEventListener('click', () => engine.stop('사용자 정지'));
  $('halt-btn').addEventListener('click', async () => {
    await engine.emergencyStop();
    renderStatus();
  });
  $('sell-all-btn').addEventListener('click', sellAll);
  $('refresh-balance-btn').addEventListener('click', () => refreshAccount(true));

  $('backtest-btn').addEventListener('click', runBt);

  document.querySelectorAll('#log-filters button').forEach((b) => {
    b.addEventListener('click', () => {
      app.logFilter = b.dataset.filter;
      document.querySelectorAll('#log-filters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderLogs();
    });
  });
  $('csv-btn').addEventListener('click', () => {
    const blob = new Blob([V.logsToCsv(app.logs[app.mode])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = V.el('a', { href: url, download: `upbit-bot-log-${app.mode}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('reset-paper-btn').addEventListener('click', async () => {
    if (engine.running) return;
    const ok = await confirmDialog('모의 계좌 초기화', ['모의 잔고를 1,000,000원으로, 모의 봇 포지션·실현손익을 초기화합니다. 로그는 남습니다.'], { okLabel: '초기화', danger: true });
    if (!ok) return;
    const broker = engine.broker.kind === 'paper' ? engine.broker : makeBroker('paper');
    broker.reset(PAPER_INITIAL);
    store.set('bot:paper', freshBotState());
    if (app.mode === 'paper') engine.resetPosition();
    addLog({ at: Date.now(), mode: 'paper', kind: 'info', market: settings.market, msg: '모의 계좌 초기화' });
    refreshAccount();
    renderStatus();
  });

  $('reset-settings-btn').addEventListener('click', async () => {
    if (engine.running) {
      await confirmDialog('설정 초기화', ['봇을 정지한 뒤에 초기화할 수 있습니다.'], { cancel: false });
      return;
    }
    const ok = await confirmDialog('설정 초기화', ['마켓·전략·파라미터·투자 금액·안전장치를 기본값으로 되돌리고 새로고침합니다. 모의 계좌와 로그는 유지됩니다.'], { okLabel: '초기화' });
    if (!ok) return;
    store.remove('settings');
    location.reload();
  });

  $('clear-data-btn').addEventListener('click', async () => {
    const ok = await confirmDialog('저장 데이터 전체 삭제', ['설정·모의 계좌·로그·봇 상태를 모두 지우고 새로고침합니다. (API 키는 원래 저장하지 않습니다)'], { okLabel: '삭제', danger: true });
    if (!ok) return;
    if (engine.running) engine.stop('데이터 삭제');
    store.clearAll();
    tokenStore.clear();
    location.reload();
  });
}

// ---------- 백테스트 ----------
async function runBt() {
  const sid = settings.strategyId;
  const p = settings.params[sid];
  const err = $('backtest-error');
  const v = validateParams(sid, p);
  if (!v.ok) { err.textContent = v.errors.join(' · '); return; }
  if (!(settings.slippage >= 0 && settings.slippage <= 0.5)) { err.textContent = '슬리피지 설정을 확인하세요'; return; }
  err.textContent = '';
  const btn = $('backtest-btn');
  btn.disabled = true;
  btn.textContent = '불러오는 중…';
  try {
    const unit = candleUnitOf(sid, p);
    const all = await client.getCandles(unit, settings.market, 200);
    const closed = closedOnly(all, unit, Date.now());
    const r = runBacktest(closed, sid, p, { initialKrw: PAPER_INITIAL, feeRate: FEE_RATE, slippage: settings.slippage / 100 });
    app.backtest = { ...r, market: settings.market, unit };
    V.renderBacktest($('backtest-result'), r, `${CANDLE_UNITS[unit].label}봉`);
    if (app.chartUnit !== unit) {
      app.chartUnit = unit;
      renderChartUnits();
      await loadChartCandles();
    }
    updateChart();
  } catch (e) {
    err.textContent = e.status === 418 ? '업비트가 요청을 일시 차단했습니다' : `캔들을 불러오지 못했습니다(${e.message}). 시세 연결 실패, 잠시 후 다시 시도하세요.`;
  } finally {
    btn.disabled = false;
    btn.textContent = '백테스트 실행';
  }
}

// ---------- 모드·로컬 서버 ----------
function serverBase() {
  const typed = (settings.serverBase || '').trim().replace(/\/$/, '');
  if (typed) return typed;
  return isServedLocally() ? '' : null;
}

function liveEligibility() {
  if (!isTopWindow()) return { ok: false, reason: '블로그에 삽입된 화면에서는 실거래를 쓸 수 없습니다. PC에서 로컬 서버를 실행하고 http://127.0.0.1:8787/ 을 새 창으로 여세요.' };
  const s = monitor.state;
  const local = isServedLocally() && !settings.serverBase;
  if (!local && !(s.reachable && s.allowPagesOrigin)) {
    return { ok: false, reason: '실거래는 PC에서 로컬 서버(apps/upbit-bot/server)를 실행한 뒤, 서버가 알려 주는 http://127.0.0.1:8787/ 주소에서 이 앱을 열어야 사용할 수 있습니다. API 키는 PC의 server/.env에만 둡니다.' };
  }
  if (!s.reachable) return { ok: false, reason: '로컬 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.' };
  if (!s.keyConfigured) return { ok: false, reason: '서버에 API 키가 설정되지 않았습니다. server/.env에 키를 넣고 서버를 다시 시작하세요.' };
  return { ok: true };
}

function renderServerChip() {
  const s = monitor.state;
  const { text, cls } = chipText(s, app.liveAuthFailed);
  const chip = $('server-chip');
  chip.textContent = text;
  chip.className = `chip ${cls}`;
  const elig = liveEligibility();
  $('mode-live').setAttribute('aria-disabled', String(!elig.ok && app.mode !== 'live'));
  renderLiveBanner();
  $('server-detail').textContent = s.reachable
    ? `서버 v${s.version} · ${s.dryRun ? 'DRY-RUN(주문 미전송)' : '실주문'} · 키 ${s.keyConfigured ? '설정됨' : '없음'}${s.keyExpireAt ? `(만료 ${String(s.keyExpireAt).slice(0, 10)})` : ''} · 서버 1회 최대 ${V.fmtKrw(s.maxOrderKrw)} · 하루 ${s.dailyMaxOrders}회 · 허용 마켓 ${(s.allowedMarkets || []).join(', ')}`
    : s.disabled ? '현재 주소에서는 로컬 서버를 확인하지 않습니다.' : '로컬 서버 응답 없음';
}

// 실거래 띠: 서버가 DRY-RUN이면 주문이 업비트로 나가지 않으므로 문구와 색을 구분한다
function renderLiveBanner() {
  const banner = $('live-banner');
  const dry = app.mode === 'live' && monitor.state.reachable && monitor.state.dryRun;
  banner.textContent = dry ? '실거래 모드 · 시험 모드(DRY-RUN) — 업비트로 주문이 나가지 않음' : '실거래 모드 · 실제 주문';
  banner.classList.toggle('dry', Boolean(dry));
}

function setMode(mode) {
  app.mode = mode;
  engine = makeEngine(mode);
  app.liveBalance = null;
  const live = mode === 'live';
  document.body.classList.toggle('is-live', live);
  $('live-banner').hidden = !live;
  $('mode-paper').setAttribute('aria-checked', String(!live));
  $('mode-live').setAttribute('aria-checked', String(live));
  $('mode-chip').textContent = live ? '실거래 모드' : '모의투자 중';
  $('mode-chip').className = `chip ${live ? 'live' : ''}`;
  $('account-mode').textContent = live ? '(실거래 · 서버 잔고)' : '(모의)';
  $('refresh-balance-btn').hidden = !live;
  renderServerChip();
  renderLogs();
  renderStatus();
  refreshAccount(true);
  renderIndicators();
  updateChart();
}

async function requestMode(mode) {
  if (mode === app.mode) return;
  if (engine.running) {
    await confirmDialog('모드 전환', ['봇을 정지한 뒤에 모드를 바꿀 수 있습니다.'], { cancel: false });
    return;
  }
  if (mode === 'paper') {
    setMode('paper');
    return;
  }
  await monitor.check();
  const elig = liveEligibility();
  if (!elig.ok) {
    await confirmDialog('실거래 모드 안내', [elig.reason], { cancel: false });
    return;
  }
  const token = await openLiveDialog($('live-dialog'), { base: serverBase() || '', savedToken: app.liveToken });
  if (!token) return;
  app.liveToken = token;
  tokenStore.set(token);
  app.liveAuthFailed = false;
  setMode('live');
}

function initModeSwitch() {
  const buttons = [$('mode-paper'), $('mode-live')];
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => requestMode(b.dataset.mode));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      buttons[1 - i].focus();
    });
  });

  monitor = createServerMonitor({
    getBase: serverBase,
    onChange: renderServerChip,
    onLost: () => {
      if (app.mode === 'live' && engine.running) engine.stop('로컬 서버 응답이 3회 연속 실패해 실거래 봇을 정지했습니다', 'error');
    }
  });
  const baseInput = $('server-base');
  baseInput.value = settings.serverBase || '';
  baseInput.addEventListener('change', () => {
    settings.serverBase = baseInput.value.trim();
    saveSettings();
    monitor.stop();
    monitor.start();
  });
  $('server-check-btn').addEventListener('click', () => monitor.check());
  $('token-clear-btn').addEventListener('click', () => {
    tokenStore.clear();
    app.liveToken = '';
    if (app.mode === 'live' && !engine.running) setMode('paper');
  });
  monitor.start();
}

// ---------- 주기 작업 ----------
async function tick() {
  if (app.ticking) return;
  app.ticking = true;
  try {
    const now = Date.now();
    if (engine.running) await engine.heartbeat();
    else if (now >= app.strategyNext) await loadStrategyCandles();
    if (now >= app.chartNext) await loadChartCandles();
    renderNextEval();
  } catch (e) {
    // 다음 주기에 다시 시도
  } finally {
    app.ticking = false;
  }
}

function initLifecycle() {
  window.addEventListener('beforeunload', (e) => {
    if (engine.running) {
      e.preventDefault();
      e.returnValue = '봇이 실행 중입니다. 닫으면 멈춥니다.';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    feed.reconnectNow();
    if (engine.running) engine.heartbeat({ force: true });
    else app.strategyNext = 0;
    app.chartNext = 0;
  });
}

// ---------- 시작 ----------
function init() {
  document.querySelectorAll('[data-risk-text], #risk-full').forEach((box) => {
    V.clear(box);
    RISK_TEXT.forEach((t) => box.append(V.el('p', { text: t })));
  });
  $('risk-more').addEventListener('click', () => $('risk-dialog').showModal());
  $('risk-close').addEventListener('click', () => $('risk-dialog').close());
  $('storage-chip').hidden = store.available;
  $('app-version').textContent = `v${APP_VERSION}`;

  initTheme();
  initTabs();
  initForms();
  engine = makeEngine('paper');
  initModeSwitch();
  initBotButtons();
  renderStrategy();
  renderChartUnits();
  renderMarketOptions();
  renderLogs();
  renderStatus();
  refreshAccount();

  feed = createPriceFeed({ client, onTicker, onStatus: onFeedStatus });
  feed.setMarket(settings.market);
  loadMarkets();
  reloadData();
  initLifecycle();
  setInterval(tick, 1000);
}

init();
