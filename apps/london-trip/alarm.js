/* london-trip — 알림(v2, spec 13장)
 * - 대상 계산·예약·발사(시스템 알림/진동/소리), 토스트는 app.js 콜백
 * - 모든 시각은 epoch(UTC ms)로 비교 → 기기 시간대와 무관
 * - 캘린더 내보내기(.ics, VALARM) 생성
 * 테스트: TripTime.now = function () { return new Date('2026-10-18T15:00:10Z'); }; TripAlarm.check(); */
(function () {
  'use strict';

  var D = window.TRIP_DATA;
  var Store = window.TripStore;
  var T = window.TripTime;
  if (!D || !Store || !T) return;

  var MIN = 60000;
  var WINDOW = 15 * MIN;        // 알림 시각 후 15분까지만 울림
  var MAX_TIMEOUT = 24 * 60 * MIN;
  var LONDON = 'Europe/London';
  var SEOUL = 'Asia/Seoul';

  var handlers = { onFire: null, onOpen: null };
  var timer = null;
  var swReg = null;
  var audioCtx = null;

  var inIframe = (function () {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();

  // ---------- 항목 모델 ----------
  function fromOriginal(s) {
    return {
      id: s.id, orig: true, date: s.date, start: s.start, end: s.end, type: s.type, title: s.title,
      transport: s.transport, costText: s.costText, note: s.note, addresses: s.addresses || [], tz: s.tz,
    };
  }
  function fromCustom(c) {
    return {
      id: c.id, orig: false, date: c.date, start: c.start, end: c.end, type: c.type, title: c.title,
      transport: c.transport, costText: c.costText, note: null, addresses: [], tz: LONDON,
    };
  }
  /** 원본(엑셀 순서) + 사용자 일정 */
  function allItems() {
    var list = D.schedule.map(fromOriginal);
    Store.listCustom().forEach(function (c) { list.push(fromCustom(c)); });
    return list;
  }
  function findItem(id) {
    var list = allItems();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  /** 시작 시각의 시간대: r02(mixed)는 한국 출발, r66은 한국 시각 */
  function startTz(it) { return it.tz === 'mixed' || it.tz === SEOUL ? SEOUL : LONDON; }
  function endTz(it) { return it.tz === SEOUL ? SEOUL : LONDON; }
  function startAt(it) { return it.start ? T.toEpoch(it.date, it.start, startTz(it)) : null; }
  function endAt(it) { return it.end ? T.toEpoch(it.date, it.end, endTz(it)) : null; }
  function canAlarm(it) { return !!it && !!it.start && startAt(it) !== null; }
  function alarmAt(it) {
    var s = startAt(it);
    return s === null ? null : s - Store.alarmLead(it.id) * MIN;
  }
  function nowMs() { return T.now().getTime(); }

  /** 울릴 대상: 전역 켜짐 && 항목 켜짐 && 시작 있음 && 숨김 아님 && 완료 아님 */
  function targets() {
    if (!Store.getAlarm().enabled) return [];
    return allItems().filter(function (it) {
      return Store.isAlarmOn(it.id) && canAlarm(it) && !Store.isHidden(it.id) && !Store.isDone(it.id);
    });
  }

  function entry(it, now) {
    var at = alarmAt(it);
    var s = startAt(it);
    return { item: it, at: at, startAt: s, lead: Store.alarmLead(it.id), late: now - at, started: s <= now };
  }

  // ---------- 다가오는 알림 ----------
  /** {missed:[entry](알림 시각 후 15분 이내), next:[entry](지금 이후, 최대 n개)} */
  function upcoming(n) {
    var now = nowMs();
    var missed = [];
    var next = [];
    targets().forEach(function (it) {
      var e = entry(it, now);
      if (e.at > now) next.push(e);
      else if (now < e.at + WINDOW) missed.push(e);
    });
    var byAt = function (a, b) { return a.at - b.at; };
    missed.sort(byAt);
    next.sort(byAt);
    return { missed: missed, next: next.slice(0, n || 5) };
  }

  // ---------- 발사 ----------
  function check() {
    var now = nowMs();
    var fired = [];
    targets().forEach(function (it) {
      var e = entry(it, now);
      if (now < e.at) return;
      var key = String(e.at);
      if (Store.getFired(it.id) === key) return;
      if (now >= e.at + WINDOW) {
        Store.claimFired(it.id, key); // 오래된 알림은 기록만
        return;
      }
      if (Store.claimFired(it.id, key)) fired.push(e);
    });
    if (fired.length) fire(fired);
    reschedule();
    return fired;
  }

  function reschedule() {
    if (timer) { window.clearTimeout(timer); timer = null; }
    var now = nowMs();
    var soonest = null;
    targets().forEach(function (it) {
      var at = alarmAt(it);
      if (at > now && (soonest === null || at < soonest)) soonest = at;
    });
    if (soonest === null) return;
    var wait = soonest - now;
    if (wait > MAX_TIMEOUT) return; // 24시간 넘으면 1분 타이머에 맡김
    timer = window.setTimeout(check, wait + 200);
  }

  function fire(list) {
    var a = Store.getAlarm();
    if (handlers.onFire) {
      try { handlers.onFire(list); } catch (e) { console.error(e); }
    }
    list.forEach(showSystem);
    // Chrome은 사용자가 한 번도 탭하지 않은 페이지의 vibrate를 막고 콘솔 오류를 남기므로 미리 확인
    var activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (a.vibrate && navigator.vibrate && activated) {
      try { navigator.vibrate([200, 100, 200]); } catch (e) { /* noop */ }
    }
    if (a.sound) beep();
  }

  /** 토스트/알림 문구: '16:00 런던아이 탑승 · 30분 후 시작' */
  function describe(e, now) {
    now = now === undefined ? nowMs() : now;
    var it = e.item;
    var label = it.start + (startTz(it) === SEOUL ? '(한국)' : '');
    var tail;
    if (e.startAt <= now) tail = '시작됨';
    else if (now - e.at >= MIN) tail = '알림 시각 ' + Math.floor((now - e.at) / MIN) + '분 지남';
    else tail = Math.max(1, Math.round((e.startAt - now) / MIN)) + '분 후 시작';
    return { time: label, title: it.title, tail: tail, text: label + ' ' + it.title + ' · ' + tail };
  }

  // ---------- 시스템 알림 ----------
  function permission() {
    if (inIframe) return 'iframe';
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }
  function swAllowed() {
    if (!('serviceWorker' in navigator)) return false;
    var p = window.location.protocol;
    var h = window.location.hostname;
    return p === 'https:' || (p === 'http:' && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]'));
  }
  function registerSW() {
    if (inIframe || swReg || !swAllowed()) return Promise.resolve(swReg);
    return navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
      return reg;
    }).catch(function () { return null; });
  }
  /** 사용자 클릭 때만 호출 */
  function requestPermission() {
    if (permission() !== 'default') return Promise.resolve(permission());
    var done = function (p) {
      if (p === 'granted') return registerSW().then(function () { return p; });
      return p;
    };
    return new Promise(function (resolve) {
      var settled = false;
      var cb = function (p) { if (!settled) { settled = true; resolve(p); } };
      try {
        var r = Notification.requestPermission(cb); // 구형 Safari는 콜백 방식
        if (r && typeof r.then === 'function') r.then(cb, function () { cb(Notification.permission); });
      } catch (e) {
        cb(Notification.permission);
      }
    }).then(done);
  }
  function showSystem(e) {
    if (permission() !== 'granted') return;
    var d = describe(e);
    var tag = 'lt-' + e.item.id + '-' + e.at;
    var url = 'index.html#day=' + e.item.date + '&item=' + e.item.id;
    var opts = { body: d.time + ' · ' + d.tail, tag: tag, data: { id: e.item.id, date: e.item.date, url: url } };
    if (swReg && swReg.showNotification) {
      swReg.showNotification(e.item.title, opts).catch(function () { /* 토스트만 */ });
      return;
    }
    try {
      var n = new Notification(e.item.title, opts);
      n.onclick = function () {
        try { window.focus(); } catch (x) { /* noop */ }
        if (handlers.onOpen) handlers.onOpen(e.item.id);
        n.close();
      };
    } catch (x) { /* Android Chrome 등: 생성자 미지원 → 토스트만 */ }
  }

  // ---------- 소리 ----------
  /** 사용자 제스처(설정 클릭)에서 호출해 AudioContext를 준비 */
  function primeAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function beep() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    try {
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.3);
    } catch (e) { /* noop */ }
  }

  // ---------- 켜기 ----------
  /** 항목 하나 켜기/끄기. 반환 {ok, past}: past=이미 시작한 일정(울리지 않음) */
  function setItem(id, on, lead) {
    var it = findItem(id);
    if (on && !canAlarm(it)) return { ok: false };
    if (!Store.setAlarmItem(id, on, lead)) return { ok: false };
    var past = false;
    if (on) past = markIfPast(it);
    reschedule();
    return { ok: true, past: past };
  }
  /** 처음 켤 때 이미 시작한 일정은 울리지 않도록 기록만 */
  function markIfPast(it) {
    var now = nowMs();
    if (startAt(it) <= now) {
      Store.claimFired(it.id, String(alarmAt(it)));
      return true;
    }
    return false;
  }
  /** 조건에 맞는 항목 일괄 켜기. 반환 {count, past} */
  function enableWhere(pred) {
    var list = allItems().filter(function (it) { return canAlarm(it) && pred(it); });
    Store.setAlarmItems(list.map(function (it) { return it.id; }));
    var past = 0;
    list.forEach(function (it) { if (markIfPast(it)) past++; });
    reschedule();
    return { count: list.length, past: past };
  }

  // ---------- .ics ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function icsTime(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function icsText(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  }
  function utf8Len(cp) { return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }
  /** 75옥텟 접기(UTF-8 글자 중간에서 자르지 않음) */
  function fold(line) {
    var out = [];
    var cur = '';
    var len = 0;
    var limit = 75;
    Array.from(line).forEach(function (ch) {
      var l = utf8Len(ch.codePointAt(0));
      if (len + l > limit) {
        out.push(cur);
        cur = ' ';
        len = 1;
        limit = 75;
      }
      cur += ch;
      len += l;
    });
    out.push(cur);
    return out.join('\r\n');
  }
  /**
   * items: 내보낼 항목 모델(시작 없는 항목은 제외됨)
   * 각 항목의 알림이 켜져 있고 완료가 아니면 VALARM 포함. 메모는 넣지 않는다.
   */
  function buildICS(items) {
    var stamp = icsTime(nowMs());
    var L = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//london-trip//KO', 'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsText('런던 여행'),
    ];
    var n = 0;
    items.forEach(function (it) {
      if (!canAlarm(it)) return;
      var s = startAt(it);
      var e = endAt(it);
      if (e === null || e <= s) e = s + 15 * MIN;
      var desc = [];
      if (it.transport) desc.push('이동수단: ' + it.transport);
      if (it.costText) desc.push('예상 비용(1인): ' + it.costText);
      if (it.note) desc.push('비고: ' + it.note);
      L.push('BEGIN:VEVENT');
      L.push('UID:' + it.id + '@london-trip');
      L.push('DTSTAMP:' + stamp);
      L.push('DTSTART:' + icsTime(s));
      L.push('DTEND:' + icsTime(e));
      L.push('SUMMARY:' + icsText((it.type === '이동' ? '→ ' : '') + it.title));
      if (it.addresses && it.addresses.length) L.push('LOCATION:' + icsText(it.addresses[0]));
      if (desc.length) L.push('DESCRIPTION:' + icsText(desc.join('\n')));
      if (Store.isAlarmOn(it.id) && !Store.isDone(it.id)) {
        L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT' + Store.alarmLead(it.id) + 'M', 'DESCRIPTION:' + icsText(it.title), 'END:VALARM');
      }
      L.push('END:VEVENT');
      n++;
    });
    L.push('END:VCALENDAR');
    return { count: n, text: L.map(fold).join('\r\n') + '\r\n' };
  }
  /**
   * 범위별 내보낼 항목. scope: 'alarms' | 'day' | 'all'
   * 제외: 시작 없는 행, 숨긴 원본, (includeCustom=false면) 사용자 일정
   */
  function exportItems(scope, date, includeCustom) {
    return allItems().filter(function (it) {
      if (!canAlarm(it)) return false;
      if (it.orig && Store.isHidden(it.id)) return false;
      if (!it.orig && !includeCustom) return false;
      if (scope === 'alarms') return Store.isAlarmOn(it.id);
      if (scope === 'day') return it.date === date;
      return true;
    }).sort(function (a, b) { return startAt(a) - startAt(b); });
  }

  // ---------- 시작 ----------
  function init(h) {
    handlers.onFire = h && h.onFire || null;
    handlers.onOpen = h && h.onOpen || null;
    if (!inIframe && swAllowed()) {
      navigator.serviceWorker.addEventListener('message', function (ev) {
        var d = ev.data;
        if (d && d.type === 'lt-open' && typeof d.id === 'string' && handlers.onOpen) handlers.onOpen(d.id);
      });
      if (permission() === 'granted') registerSW();
    }
  }

  window.TripAlarm = {
    LEADS: Store.LEADS,
    inIframe: inIframe,
    init: init,
    allItems: allItems,
    findItem: findItem,
    canAlarm: canAlarm,
    startTz: startTz,
    startAt: startAt,
    alarmAt: alarmAt,
    targets: targets,
    upcoming: upcoming,
    check: check,
    reschedule: reschedule,
    describe: describe,
    permission: permission,
    requestPermission: requestPermission,
    primeAudio: primeAudio,
    canVibrate: function () { return typeof navigator.vibrate === 'function'; },
    setItem: setItem,
    enableWhere: enableWhere,
    exportItems: exportItems,
    buildICS: buildICS,
  };
})();
