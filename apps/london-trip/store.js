/* london-trip — localStorage 래퍼
 * - 모든 접근 try/catch, 실패 시 메모리 상태로만 동작
 * - 읽을 때 스키마 검증(잘못된 항목만 버리고 나머지 유지)
 * - 키 접두사 'london-trip:' (블로그 theme, 2048 키와 충돌 없음) */
(function () {
  'use strict';

  var PREFIX = 'london-trip:';
  var K = {
    done: PREFIX + 'v1:done',
    undone: PREFIX + 'v1:undone',       // 자동 완료를 사용자가 해제한 항목 (spec 17.2)
    autoDone: PREFIX + 'autoDone',      // '1' | '0' (spec 17.4, 기본 켬)
    memo: PREFIX + 'v1:memo',
    custom: PREFIX + 'v1:custom',
    hidden: PREFIX + 'v1:hidden',
    booked: PREFIX + 'v1:booked',
    lastDay: PREFIX + 'lastDay',
    lastView: PREFIX + 'lastView',
    alarm: PREFIX + 'v1:alarm',
    alarmFired: PREFIX + 'v1:alarmFired',
  };
  var LEADS = [5, 10, 15, 30, 60, 90, 120];
  function defaultAlarm() { return { enabled: true, lead: 30, sound: false, vibrate: true, items: {} }; }
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
  var state = emptyState();
  var writeFailed = false;
  var listeners = [];

  function emptyState() {
    return { done: {}, undone: {}, autoDone: true, memo: {}, custom: [], hidden: {}, booked: {}, lastDay: null, lastView: null, alarm: defaultAlarm(), alarmFired: {} };
  }
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

  // ---------- 알림 검증 ----------
  function validLead(v) { return typeof v === 'number' && LEADS.indexOf(v) >= 0; }
  /** 사용자 id는 현재 저장된 사용자 일정에 있어야 함 */
  function alarmIdOk(id) {
    if (!validItemId(id)) return false;
    if (USER_ID_RE.test(id)) return state.custom.some(function (c) { return c.id === id; });
    return true;
  }
  function cleanAlarmItems(v, globalLead) {
    var out = {};
    if (!isObj(v)) return out;
    Object.keys(v).forEach(function (k) {
      if (!alarmIdOk(k)) return;
      var it = v[k];
      var lead = isObj(it) && validLead(it.lead) ? it.lead : globalLead;
      out[k] = { lead: lead };
    });
    return out;
  }
  function cleanAlarm(v) {
    var a = defaultAlarm();
    if (!isObj(v)) return a;
    if (typeof v.enabled === 'boolean') a.enabled = v.enabled;
    if (validLead(v.lead)) a.lead = v.lead;
    if (typeof v.sound === 'boolean') a.sound = v.sound;
    if (typeof v.vibrate === 'boolean') a.vibrate = v.vibrate;
    a.items = cleanAlarmItems(v.items, a.lead);
    return a;
  }
  function cleanFired(v) {
    var out = {};
    if (!isObj(v)) return out;
    Object.keys(v).forEach(function (k) {
      if (alarmIdOk(k) && typeof v[k] === 'string' && /^\d{1,15}$/.test(v[k])) out[k] = v[k];
    });
    return out;
  }
  function persistAlarm() { writeJSON(K.alarm, state.alarm); }
  function persistFired() {
    if (Object.keys(state.alarmFired).length === 0) rawSet(K.alarmFired, null); else writeJSON(K.alarmFired, state.alarmFired);
  }

  function load() {
    state.done = cleanFlagMap(readJSON(K.done), false);
    state.undone = cleanFlagMap(readJSON(K.undone), false);
    var ad = rawGet(K.autoDone);
    state.autoDone = ad === '0' ? false : true;
    state.memo = cleanMemo(readJSON(K.memo));
    state.custom = cleanCustom(readJSON(K.custom));
    state.hidden = cleanFlagMap(readJSON(K.hidden), true);
    state.booked = cleanFlagMap(readJSON(K.booked), true);
    var ld = rawGet(K.lastDay);
    state.lastDay = ld && validDates[ld] === true ? ld : null;
    var lv = rawGet(K.lastView);
    state.lastView = lv && VIEWS.indexOf(lv) >= 0 ? lv : null;
    // 사용자 일정 검증 이후에 읽는다(없는 사용자 id 제거)
    state.alarm = cleanAlarm(readJSON(K.alarm));
    state.alarmFired = cleanFired(readJSON(K.alarmFired));
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
    // 자동 완료 해제 기록 (spec 17.2)
    isUndone: function (id) { return state.undone[id] === true; },
    setUndone: function (id, on) {
      if (!validItemId(id)) return;
      if (on) state.undone[id] = true; else delete state.undone[id];
      persistMap('undone');
    },
    // 시간 지난 일정 자동 완료 토글 (spec 17.4)
    getAutoDone: function () { return state.autoDone; },
    setAutoDone: function (on) {
      state.autoDone = !!on;
      rawSet(K.autoDone, state.autoDone ? '1' : '0');
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
      delete state.undone[id];
      delete state.memo[id];
      var hadAlarm = own(state.alarm.items, id);
      delete state.alarm.items[id];
      delete state.alarmFired[id];
      persistCustom();
      persistMap('done');
      persistMap('undone');
      persistMap('memo');
      if (hadAlarm) persistAlarm();
      persistFired();
    },

    // 알림 (13.3)
    LEADS: LEADS.slice(),
    /** 전역 설정 + 항목 복사본 */
    getAlarm: function () { return copy(state.alarm); },
    /** 전역 설정 변경: {enabled, lead, sound, vibrate} 중 일부 */
    setAlarmGlobal: function (f) {
      if (!isObj(f)) return;
      if (typeof f.enabled === 'boolean') state.alarm.enabled = f.enabled;
      if (validLead(f.lead)) state.alarm.lead = f.lead;
      if (typeof f.sound === 'boolean') state.alarm.sound = f.sound;
      if (typeof f.vibrate === 'boolean') state.alarm.vibrate = f.vibrate;
      persistAlarm();
    },
    isAlarmOn: function (id) { return own(state.alarm.items, id); },
    /** 항목 알림 시점(분). 꺼져 있으면 전역 기본값 */
    alarmLead: function (id) {
      return own(state.alarm.items, id) ? state.alarm.items[id].lead : state.alarm.lead;
    },
    /** 항목 켜기/끄기. lead 생략 시 기존값 또는 전역 기본값 */
    setAlarmItem: function (id, on, lead) {
      if (!alarmIdOk(id)) return false;
      if (on) {
        var l = validLead(lead) ? lead : (own(state.alarm.items, id) ? state.alarm.items[id].lead : state.alarm.lead);
        state.alarm.items[id] = { lead: l };
      } else {
        delete state.alarm.items[id];
      }
      persistAlarm();
      return true;
    },
    /** 여러 항목 켜기. 새로 켠 id 배열 반환 */
    setAlarmItems: function (ids) {
      var added = [];
      ids.forEach(function (id) {
        if (!alarmIdOk(id)) return;
        if (!own(state.alarm.items, id)) added.push(id);
        state.alarm.items[id] = { lead: own(state.alarm.items, id) ? state.alarm.items[id].lead : state.alarm.lead };
      });
      persistAlarm();
      return added;
    },
    clearAlarmItems: function () {
      state.alarm.items = {};
      persistAlarm();
    },
    /** 저장소에서 다시 읽은 발사 기록(여러 탭 대비) */
    getFired: function (id) {
      if (ls && !writeFailed) state.alarmFired = cleanFired(readJSON(K.alarmFired)); // 없거나 손상이면 {}
      return own(state.alarmFired, id) ? state.alarmFired[id] : null;
    },
    /**
     * 발사 기록. 저장소를 다시 읽어 이미 같은 키가 있으면 false(다른 탭이 이미 울림).
     * 기록에 성공하면 true.
     */
    claimFired: function (id, key) {
      if (!alarmIdOk(id) || !/^\d{1,15}$/.test(String(key))) return false;
      if (this.getFired(id) === String(key)) return false;
      state.alarmFired[id] = String(key);
      persistFired();
      return true;
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
    /** 주어진 id들의 완료 체크와 자동 완료 해제 기록을 모두 삭제 (spec 17.x E5: 지난 일정은 다시 자동 완료) */
    resetDone: function (ids) {
      ids.forEach(function (id) { delete state.done[id]; delete state.undone[id]; });
      persistMap('done');
      persistMap('undone');
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
      state = emptyState();
    },

    // 내보내기/가져오기(S2)
    exportData: function () {
      return {
        app: 'london-trip',
        version: 1,
        exportedAt: new Date().toISOString(),
        done: copy(state.done),
        undone: copy(state.undone),
        autoDone: state.autoDone,
        memo: copy(state.memo),
        custom: copy(state.custom),
        hidden: copy(state.hidden),
        booked: copy(state.booked),
        alarm: copy(state.alarm),
      };
    },
    /** 검증 후 병합. 반환: {ok, counts} 또는 {ok:false, error} */
    importData: function (obj) {
      if (!isObj(obj) || obj.app !== 'london-trip') return { ok: false, error: '이 앱에서 내보낸 파일이 아닙니다.' };
      var done = cleanFlagMap(obj.done, false);
      var undone = cleanFlagMap(obj.undone, false); // 없으면 빈 값
      var memo = cleanMemo(obj.memo);
      var custom = cleanCustom(obj.custom);
      var hidden = cleanFlagMap(obj.hidden, true);
      var booked = cleanFlagMap(obj.booked, true);
      Object.keys(done).forEach(function (k) { state.done[k] = true; });
      Object.keys(undone).forEach(function (k) { if (state.done[k] !== true) state.undone[k] = true; });
      if (typeof obj.autoDone === 'boolean') this.setAutoDone(obj.autoDone);
      Object.keys(memo).forEach(function (k) { state.memo[k] = memo[k]; });
      Object.keys(hidden).forEach(function (k) { state.hidden[k] = true; });
      Object.keys(booked).forEach(function (k) { state.booked[k] = true; });
      custom.forEach(function (c) {
        var idx = -1;
        state.custom.forEach(function (x, i) { if (x.id === c.id) idx = i; });
        if (idx < 0) state.custom.push(c);
        else if (c.updatedAt >= state.custom[idx].updatedAt) state.custom[idx] = c;
      });
      ['done', 'undone', 'memo', 'hidden', 'booked'].forEach(persistMap);
      persistCustom();
      // 알림: 항목만 병합(전역 설정은 덮어쓰지 않음). 사용자 일정 병합 후 검증
      var alarmItems = isObj(obj.alarm) ? cleanAlarmItems(obj.alarm.items, state.alarm.lead) : {};
      Object.keys(alarmItems).forEach(function (k) { state.alarm.items[k] = alarmItems[k]; });
      if (Object.keys(alarmItems).length) persistAlarm();
      return {
        ok: true,
        counts: {
          done: Object.keys(done).length, undone: Object.keys(undone).length, memo: Object.keys(memo).length, custom: custom.length,
          hidden: Object.keys(hidden).length, booked: Object.keys(booked).length,
          alarm: Object.keys(alarmItems).length,
        },
      };
    },
  };

  window.TripStore = api;
})();
