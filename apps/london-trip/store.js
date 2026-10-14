/* london-trip — localStorage 래퍼
 * - 모든 접근 try/catch, 실패 시 메모리 상태로만 동작
 * - 읽을 때 스키마 검증(잘못된 항목만 버리고 나머지 유지)
 * - 키 접두사 'london-trip:' (블로그 theme, 2048 키와 충돌 없음) */
(function () {
  'use strict';

  var PREFIX = 'london-trip:';
  var K = {
    done: PREFIX + 'v1:done',
    memo: PREFIX + 'v1:memo',
    custom: PREFIX + 'v1:custom',
    hidden: PREFIX + 'v1:hidden',
    booked: PREFIX + 'v1:booked',
    lastDay: PREFIX + 'lastDay',
    lastView: PREFIX + 'lastView',
  };
  var MEMO_MAX = 2000;
  var TITLE_MAX = 200;
  var TEXT_MAX = 200;
  var VIEWS = ['schedule', 'booking', 'food', 'musical', 'golf'];

  var TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  var USER_ID_RE = /^u_[a-z0-9]{1,24}$/;
  var ROW_ID_RE = /^r\d{2}$/;

  var ls = null;
  var persistent = false;
  try {
    ls = window.localStorage;
    var probe = PREFIX + '__probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    persistent = true;
  } catch (e) {
    ls = null;
    persistent = false;
  }

  var validRows = {};   // { r02: true, ... }
  var validDates = {};  // { '2026-10-16': true, ... }
  var state = { done: {}, memo: {}, custom: [], hidden: {}, booked: {}, lastDay: null, lastView: null };
  var writeFailed = false;
  var listeners = [];

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function rawGet(key) {
    if (!ls) return null;
    try { return ls.getItem(key); } catch (e) { return null; }
  }
  function rawSet(key, value) {
    if (!ls) return false;
    try {
      if (value === null) ls.removeItem(key); else ls.setItem(key, value);
      return true;
    } catch (e) {
      if (!writeFailed) { writeFailed = true; notify('writeFailed'); }
      return false;
    }
  }
  function readJSON(key) {
    var s = rawGet(key);
    if (s === null) return undefined;
    try { return JSON.parse(s); } catch (e) { return undefined; }
  }
  function writeJSON(key, value) { rawSet(key, JSON.stringify(value)); }

  function notify(what) {
    listeners.forEach(function (fn) { try { fn(what); } catch (e) { /* noop */ } });
  }

  // ---------- 검증 ----------
  function validItemId(id) {
    return typeof id === 'string' && ((ROW_ID_RE.test(id) && validRows[id] === true) || USER_ID_RE.test(id));
  }
  function cleanFlagMap(v, rowsOnly) {
    var out = {};
    if (!isObj(v)) return out;
    Object.keys(v).forEach(function (k) {
      if (v[k] !== true) return;
      if (rowsOnly ? (validRows[k] === true) : validItemId(k)) out[k] = true;
    });
    return out;
  }
  function cleanMemo(v) {
    var out = {};
    if (!isObj(v)) return out;
    Object.keys(v).forEach(function (k) {
      if (!validItemId(k) || typeof v[k] !== 'string' || v[k] === '') return;
      out[k] = v[k].slice(0, MEMO_MAX);
    });
    return out;
  }
  function str(v, max) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') return undefined;
    var t = v.trim();
    return t === '' ? null : t.slice(0, max);
  }
  function cleanCustomItem(it) {
    if (!isObj(it)) return null;
    if (typeof it.id !== 'string' || !USER_ID_RE.test(it.id)) return null;
    if (typeof it.date !== 'string' || validDates[it.date] !== true) return null;
    if (typeof it.start !== 'string' || !TIME_RE.test(it.start)) return null;
    var end = it.end === null || it.end === undefined || it.end === '' ? null : it.end;
    if (end !== null && (typeof end !== 'string' || !TIME_RE.test(end))) return null;
    if (end !== null && end < it.start) return null;
    if (it.type !== '활동' && it.type !== '이동') return null;
    var title = str(it.title, TITLE_MAX);
    if (!title) return null;
    var transport = str(it.transport, TEXT_MAX);
    var costText = str(it.costText, TEXT_MAX);
    if (transport === undefined || costText === undefined) return null;
    var createdAt = typeof it.createdAt === 'number' && isFinite(it.createdAt) ? it.createdAt : 0;
    var updatedAt = typeof it.updatedAt === 'number' && isFinite(it.updatedAt) ? it.updatedAt : createdAt;
    return {
      id: it.id, date: it.date, start: it.start, end: end, type: it.type, title: title,
      transport: transport, costText: costText, createdAt: createdAt, updatedAt: updatedAt,
    };
  }
  function cleanCustom(v) {
    var out = [];
    var seen = {};
    if (!Array.isArray(v)) return out;
    v.forEach(function (it) {
      var c = cleanCustomItem(it);
      if (c && !seen[c.id]) { seen[c.id] = true; out.push(c); }
    });
    return out;
  }

  function load() {
    state.done = cleanFlagMap(readJSON(K.done), false);
    state.memo = cleanMemo(readJSON(K.memo));
    state.custom = cleanCustom(readJSON(K.custom));
    state.hidden = cleanFlagMap(readJSON(K.hidden), true);
    state.booked = cleanFlagMap(readJSON(K.booked), true);
    var ld = rawGet(K.lastDay);
    state.lastDay = ld && validDates[ld] === true ? ld : null;
    var lv = rawGet(K.lastView);
    state.lastView = lv && VIEWS.indexOf(lv) >= 0 ? lv : null;
  }

  function persistMap(name) {
    var m = state[name];
    if (Object.keys(m).length === 0) rawSet(K[name], null); else writeJSON(K[name], m);
  }
  function persistCustom() {
    if (state.custom.length === 0) rawSet(K.custom, null); else writeJSON(K.custom, state.custom);
  }

  function newId() {
    var id;
    do {
      id = 'u_' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    } while (state.custom.some(function (c) { return c.id === id; }));
    return id;
  }

  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  var api = {
    MEMO_MAX: MEMO_MAX,
    /** 원본 행 id·날짜 목록으로 초기화(검증 기준) */
    init: function (rowIds, dates) {
      validRows = {};
      validDates = {};
      rowIds.forEach(function (id) { validRows[id] = true; });
      dates.forEach(function (d) { validDates[d] = true; });
      load();
    },
    isPersistent: function () { return persistent && !writeFailed; },
    onChange: function (fn) { listeners.push(fn); },

    // 완료
    isDone: function (id) { return state.done[id] === true; },
    setDone: function (id, on) {
      if (!validItemId(id)) return;
      if (on) state.done[id] = true; else delete state.done[id];
      persistMap('done');
    },

    // 메모
    getMemo: function (id) { return own(state.memo, id) ? state.memo[id] : ''; },
    setMemo: function (id, text) {
      if (!validItemId(id)) return;
      text = typeof text === 'string' ? text.slice(0, MEMO_MAX) : '';
      if (text.trim() === '') delete state.memo[id]; else state.memo[id] = text;
      persistMap('memo');
    },

    // 숨기기(S1) — 원본 행만
    isHidden: function (id) { return state.hidden[id] === true; },
    setHidden: function (id, on) {
      if (validRows[id] !== true) return;
      if (on) state.hidden[id] = true; else delete state.hidden[id];
      persistMap('hidden');
    },

    // 예약 완료 — 원본 행만
    isBooked: function (id) { return state.booked[id] === true; },
    setBooked: function (id, on) {
      if (validRows[id] !== true) return;
      if (on) state.booked[id] = true; else delete state.booked[id];
      persistMap('booked');
    },

    // 사용자 일정
    listCustom: function (date) {
      return state.custom.filter(function (c) { return !date || c.date === date; }).map(copy);
    },
    getCustom: function (id) {
      var c = state.custom.filter(function (x) { return x.id === id; })[0];
      return c ? copy(c) : null;
    },
    /** 저장 성공 시 저장된 항목, 실패 시 null */
    addCustom: function (fields) {
      var now = Date.now();
      var item = cleanCustomItem({
        id: newId(), date: fields.date, start: fields.start, end: fields.end, type: fields.type,
        title: fields.title, transport: fields.transport, costText: fields.costText,
        createdAt: now, updatedAt: now,
      });
      if (!item) return null;
      state.custom.push(item);
      persistCustom();
      return copy(item);
    },
    updateCustom: function (id, fields) {
      var idx = -1;
      state.custom.forEach(function (c, i) { if (c.id === id) idx = i; });
      if (idx < 0) return null;
      var prev = state.custom[idx];
      var item = cleanCustomItem({
        id: id, date: prev.date, start: fields.start, end: fields.end, type: fields.type,
        title: fields.title, transport: fields.transport, costText: fields.costText,
        createdAt: prev.createdAt, updatedAt: Date.now(),
      });
      if (!item) return null;
      state.custom[idx] = item;
      persistCustom();
      return copy(item);
    },
    removeCustom: function (id) {
      state.custom = state.custom.filter(function (c) { return c.id !== id; });
      delete state.done[id];
      delete state.memo[id];
      persistCustom();
      persistMap('done');
      persistMap('memo');
    },

    // 마지막 위치
    getLastDay: function () { return state.lastDay; },
    setLastDay: function (d) {
      if (validDates[d] !== true) return;
      state.lastDay = d;
      rawSet(K.lastDay, d);
    },
    getLastView: function () { return state.lastView; },
    setLastView: function (v) {
      if (VIEWS.indexOf(v) < 0) return;
      state.lastView = v;
      rawSet(K.lastView, v);
    },

    // 초기화
    /** 주어진 id들의 완료 체크만 삭제 */
    resetDone: function (ids) {
      ids.forEach(function (id) { delete state.done[id]; });
      persistMap('done');
    },
    /** 'london-trip:' 접두사 키를 모두 삭제 */
    resetAll: function () {
      if (ls) {
        try {
          var keys = [];
          for (var i = 0; i < ls.length; i++) {
            var k = ls.key(i);
            if (k && k.indexOf(PREFIX) === 0) keys.push(k);
          }
          keys.forEach(function (k) { ls.removeItem(k); });
        } catch (e) { /* noop */ }
      }
      state = { done: {}, memo: {}, custom: [], hidden: {}, booked: {}, lastDay: null, lastView: null };
    },

    // 내보내기/가져오기(S2)
    exportData: function () {
      return {
        app: 'london-trip',
        version: 1,
        exportedAt: new Date().toISOString(),
        done: copy(state.done),
        memo: copy(state.memo),
        custom: copy(state.custom),
        hidden: copy(state.hidden),
        booked: copy(state.booked),
      };
    },
    /** 검증 후 병합. 반환: {ok, counts} 또는 {ok:false, error} */
    importData: function (obj) {
      if (!isObj(obj) || obj.app !== 'london-trip') return { ok: false, error: '이 앱에서 내보낸 파일이 아닙니다.' };
      var done = cleanFlagMap(obj.done, false);
      var memo = cleanMemo(obj.memo);
      var custom = cleanCustom(obj.custom);
      var hidden = cleanFlagMap(obj.hidden, true);
      var booked = cleanFlagMap(obj.booked, true);
      Object.keys(done).forEach(function (k) { state.done[k] = true; });
      Object.keys(memo).forEach(function (k) { state.memo[k] = memo[k]; });
      Object.keys(hidden).forEach(function (k) { state.hidden[k] = true; });
      Object.keys(booked).forEach(function (k) { state.booked[k] = true; });
      custom.forEach(function (c) {
        var idx = -1;
        state.custom.forEach(function (x, i) { if (x.id === c.id) idx = i; });
        if (idx < 0) state.custom.push(c);
        else if (c.updatedAt >= state.custom[idx].updatedAt) state.custom[idx] = c;
      });
      ['done', 'memo', 'hidden', 'booked'].forEach(persistMap);
      persistCustom();
      return {
        ok: true,
        counts: {
          done: Object.keys(done).length, memo: Object.keys(memo).length, custom: custom.length,
          hidden: Object.keys(hidden).length, booked: Object.keys(booked).length,
        },
      };
    },
  };

  window.TripStore = api;
})();
