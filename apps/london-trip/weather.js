/* london-trip — 날짜별 날씨 예보 (spec 18, v7)
 * - 외부 요청은 Open-Meteo 1곳만(고정 좌표·고정 파라미터, 개인정보 없음). 키·서버 없음.
 * - 응답(2026-10-14 실측): daily.time[] 'YYYY-MM-DD', daily.weather_code[] (WMO),
 *   daily.temperature_2m_max/min[] (°C), daily.precipitation_probability_max[] (%) — 16개, 끝쪽은 null 가능.
 * - 캐시: localStorage 'london-trip:weather' (TTL 3시간). 지난 날짜 값은 다음 응답에 없어도 캐시에 남겨 흐리게 표시.
 * - 토글: 'london-trip:weatherOn' '1'|'0' (기본 켬). 끄면 요청하지 않는다.
 * - 실패는 삼키고 console.warn 1회. 다른 기능을 막지 않는다. */
(function () {
  'use strict';

  var LAT = 51.51;
  var LON = -0.13;
  var KEY = 'london-trip:weather';
  var KEY_ON = 'london-trip:weatherOn';
  var TTL = 3 * 60 * 60 * 1000;
  var TIMEOUT = 8000;
  var URL_ = 'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=Europe/London&forecast_days=16';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MAX_DAYS = 40; // 캐시 크기 상한

  /** WMO 코드 → {e: 이모지, t: 한국어 설명} (spec 18.4) */
  var CODES = [
    { m: [0], e: '☀️', t: '맑음' },
    { m: [1, 2], e: '🌤', t: '구름 조금' },
    { m: [3], e: '☁️', t: '흐림' },
    { m: [45, 48], e: '🌫', t: '안개' },
    { m: [51, 52, 53, 54, 55, 56, 57], e: '🌦', t: '이슬비' },
    { m: [61, 62, 63, 64, 65, 66, 67], e: '🌧', t: '비' },
    { m: [71, 72, 73, 74, 75, 76, 77], e: '❄️', t: '눈' },
    { m: [80, 81, 82], e: '🌧', t: '소나기' },
    { m: [85, 86], e: '🌨', t: '눈 소나기' },
    { m: [95, 96, 97, 98, 99], e: '⛈', t: '뇌우' },
  ];
  var UNKNOWN = { e: '❔', t: '정보 없음' };
  function describe(code) {
    for (var i = 0; i < CODES.length; i++) if (CODES[i].m.indexOf(code) >= 0) return CODES[i];
    return UNKNOWN;
  }

  var ls = null;
  try { ls = window.localStorage; } catch (e) { ls = null; }
  function rawGet(k) { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } }
  function rawSet(k, v) { try { if (ls) ls.setItem(k, v); } catch (e) { /* 저장 불가: 메모리만 */ } }

  var warned = false;
  function warnOnce(msg, err) {
    if (warned) return;
    warned = true;
    try { console.warn('[london-trip] 날씨 예보를 불러오지 못했습니다: ' + msg, err || ''); } catch (e) { /* noop */ }
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /** 캐시/응답 공통 정규화: {time[],code[],max[],min[],pop[]} 또는 null */
  function cleanDaily(d) {
    if (!d || !Array.isArray(d.time)) return null;
    var keys = ['code', 'max', 'min', 'pop'];
    var out = { time: [], code: [], max: [], min: [], pop: [] };
    for (var i = 0; i < d.time.length && out.time.length < MAX_DAYS; i++) {
      if (typeof d.time[i] !== 'string' || !DATE_RE.test(d.time[i])) continue;
      out.time.push(d.time[i]);
      keys.forEach(function (k) { out[k].push(Array.isArray(d[k]) ? num(d[k][i]) : null); });
    }
    return out.time.length ? out : null;
  }

  function loadCache() {
    var raw = rawGet(KEY);
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object' || !num(o.fetchedAt) || o.lat !== LAT || o.lon !== LON) return null;
      var daily = cleanDaily(o.daily);
      return daily ? { fetchedAt: o.fetchedAt, lat: LAT, lon: LON, daily: daily } : null;
    } catch (e) { return null; }
  }

  /** 새 응답 + 기존 캐시 병합: 새 응답에 없는 이전 날짜(지난 날)는 기존 값을 유지 */
  function merge(oldDaily, fresh) {
    var map = {};
    function put(d) {
      if (!d) return;
      d.time.forEach(function (t, i) { map[t] = { code: d.code[i], max: d.max[i], min: d.min[i], pop: d.pop[i] }; });
    }
    if (oldDaily) {
      var firstNew = fresh.time[0];
      oldDaily.time.forEach(function (t, i) {
        if (t < firstNew) map[t] = { code: oldDaily.code[i], max: oldDaily.max[i], min: oldDaily.min[i], pop: oldDaily.pop[i] };
      });
    }
    put(fresh);
    var dates = Object.keys(map).sort().slice(-MAX_DAYS);
    var out = { time: [], code: [], max: [], min: [], pop: [] };
    dates.forEach(function (t) {
      out.time.push(t); out.code.push(map[t].code); out.max.push(map[t].max); out.min.push(map[t].min); out.pop.push(map[t].pop);
    });
    return out;
  }

  /** 응답 JSON → daily (실측 필드명 그대로) */
  function fromResponse(j) {
    if (!j || typeof j !== 'object' || !j.daily || typeof j.daily !== 'object') return null;
    var d = j.daily;
    return cleanDaily({
      time: d.time,
      code: d.weather_code,
      max: d.temperature_2m_max,
      min: d.temperature_2m_min,
      pop: d.precipitation_probability_max,
    });
  }

  var cache = loadCache();
  var inflight = null;
  var listeners = [];

  function isOn() {
    var v = rawGet(KEY_ON);
    return v === '0' ? false : true;
  }
  var on = isOn();

  function notify() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* 렌더 오류가 다른 리스너를 막지 않게 */ } });
  }

  function londonToday() {
    var T = window.TripTime;
    try {
      var lt = T && T.london ? T.london() : null;
      return lt ? lt.date : null;
    } catch (e) { return null; }
  }

  function online() {
    try { return navigator.onLine !== false; } catch (e) { return true; }
  }

  /**
   * TTL 경과 + 온라인 + 켜짐일 때만 1회 요청. force=true는 TTL 무시(토글 켬 직후 캐시 없음 등에는 쓰지 않음).
   * 항상 Promise 반환(실패해도 reject하지 않음).
   */
  function refresh(force) {
    if (!on) return Promise.resolve(false);
    if (inflight) return inflight;
    if (!force && cache && Date.now() - cache.fetchedAt < TTL && Date.now() >= cache.fetchedAt) return Promise.resolve(false);
    if (!online()) return Promise.resolve(false);
    if (typeof window.fetch !== 'function') { warnOnce('fetch 미지원'); return Promise.resolve(false); }

    var ctrl = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
    var p;
    try {
      p = window.fetch(URL_, { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    } catch (e) {
      window.clearTimeout(timer);
      warnOnce('요청 실패', e);
      return Promise.resolve(false);
    }
    inflight = p.then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (j) {
      var fresh = fromResponse(j);
      if (!fresh) throw new Error('응답 형식이 예상과 다름');
      cache = { fetchedAt: Date.now(), lat: LAT, lon: LON, daily: merge(cache ? cache.daily : null, fresh) };
      rawSet(KEY, JSON.stringify(cache));
      return true;
    }).catch(function (e) {
      warnOnce(e && e.name === 'AbortError' ? '시간 초과(' + TIMEOUT / 1000 + '초)' : (e && e.message) || '오류', e);
      return false;
    }).then(function (ok) {
      window.clearTimeout(timer);
      inflight = null;
      if (ok && on) notify();
      return ok;
    });
    return inflight;
  }

  var api = {
    URL: URL_,
    TTL: TTL,
    describe: describe,
    /** 켜짐 여부 */
    isOn: function () { return on; },
    /** 토글 저장. 켜면 TTL 검사 후 요청 */
    setOn: function (v) {
      on = !!v;
      rawSet(KEY_ON, on ? '1' : '0');
      if (on) refresh(false);
    },
    /**
     * 해당 날짜 예보. 꺼짐·캐시 없음·응답에 없음·최고/최저 값 없음이면 null.
     * 반환 {date, code, max, min, pop(null 가능), emoji, text, past}
     */
    get: function (dateStr) {
      if (!on || !cache) return null;
      var i = cache.daily.time.indexOf(dateStr);
      if (i < 0) return null;
      var max = cache.daily.max[i];
      var min = cache.daily.min[i];
      var code = cache.daily.code[i];
      if (max === null || min === null || code === null) return null;
      var today = londonToday();
      var past = !!today && dateStr < today;
      var d = describe(code);
      return {
        date: dateStr, code: code, max: max, min: min, pop: cache.daily.pop[i],
        emoji: d.e, text: d.t, past: past,
      };
    },
    /** 마지막 성공 시각(ms) 또는 null */
    fetchedAt: function () { return on && cache ? cache.fetchedAt : null; },
    refresh: refresh,
    /** 갱신 성공 시 호출할 콜백 등록 */
    onUpdate: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    /** 전체 초기화 후: 메모리 캐시도 비우고 기본값(켬)으로 */
    reset: function () { cache = null; on = isOn(); },
  };
  window.TripWeather = api;
})();
