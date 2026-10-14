/* london-trip — 시간 유틸 (순수 함수, DOM 접근 없음)
 * 모든 비교는 런던 현지 시각(Europe/London) 기준. 기기 시간대와 무관.
 * toEpoch/format은 알림·.ics용(시간대 지정 가능).
 * 테스트: 개발자 도구에서 TripTime.now = function () { return new Date('2026-10-18T15:10:00Z'); } */
(function () {
  'use strict';

  var TZ = 'Europe/London';
  var partsFmt = null;
  var zoneFmt = null;
  try {
    partsFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    // 일부 구형 엔진은 timeZone을 무시하므로 실제 적용 여부 확인
    if (partsFmt.resolvedOptions().timeZone !== TZ) partsFmt = null;
  } catch (e) {
    partsFmt = null;
  }
  try {
    zoneFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'short' });
  } catch (e) {
    zoneFmt = null;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** 'HH:MM' → 분(0~1439). 형식이 틀리면 null */
  function toMin(hhmm) {
    if (typeof hhmm !== 'string') return null;
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }

  /** 분 → 'HH:MM' */
  function fromMin(min) {
    return pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60);
  }

  function isTime(s) { return toMin(s) !== null; }

  function isISODate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  /** ISO 날짜 사이 일수(b - a) */
  function daysBetween(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    var ta = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]);
    var tb = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((tb - ta) / 86400000);
  }

  /** 런던 현재 날짜·분. Intl timeZone 미지원 시 null */
  function london() {
    if (!partsFmt) return null;
    var d = api.now();
    var p = {};
    partsFmt.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var hour = +p.hour % 24;
    var minute = +p.minute;
    var zone = '';
    if (zoneFmt && zoneFmt.formatToParts) {
      zoneFmt.formatToParts(d).forEach(function (x) { if (x.type === 'timeZoneName') zone = x.value; });
    }
    return {
      date: p.year + '-' + p.month + '-' + p.day,
      minutes: hour * 60 + minute,
      hhmm: pad(hour) + ':' + pad(minute),
      zone: zone,
    };
  }

  /** 여행 기간 대비 상태: {phase:'before'|'during'|'after', dDay, dayIndex} */
  function tripPhase(todayISO, firstISO, lastISO) {
    if (todayISO < firstISO) return { phase: 'before', dDay: daysBetween(todayISO, firstISO) };
    if (todayISO > lastISO) return { phase: 'after' };
    return { phase: 'during', dayIndex: daysBetween(firstISO, todayISO) };
  }

  /**
   * 진행 중/다음 항목 판정.
   * items: [{id, start:'HH:MM'|null, end:'HH:MM'|null}] (하이라이트 대상만 넘길 것)
   * 반환: { current: [id...], next: {id, inMin} | null } — next는 현재 이후 가장 먼저 시작하는 항목
   */
  function status(items, nowMin) {
    var current = [];
    var next = null;
    items.forEach(function (it) {
      var s = toMin(it.start);
      if (s === null) return;
      var e = toMin(it.end);
      if (e === null) e = s; // 종료 없는 사용자 항목: 시작 시점만
      if (s <= nowMin && nowMin < e) current.push(it.id);
      else if (s > nowMin && (!next || s - nowMin < next.inMin)) next = { id: it.id, inMin: s - nowMin };
    });
    return { current: current, next: next };
  }

  // ---------- 시간대 → UTC epoch (알림·.ics용) ----------
  // Intl 미지원 시 고정 오프셋(분): 2026년 영국 서머타임 종료가 10/25라 여행 기간 전체가 BST(UTC+1), 서울 UTC+9
  var FIXED_OFFSET = { 'Europe/London': 60, 'Asia/Seoul': 540 };
  var tzFmts = {};
  function tzFmt(tz) {
    if (tzFmts[tz] !== undefined) return tzFmts[tz];
    var f = null;
    try {
      f = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      });
      if (f.resolvedOptions().timeZone !== tz) f = null;
    } catch (e) {
      f = null;
    }
    tzFmts[tz] = f;
    return f;
  }
  /** epoch ms → 그 시간대의 {y,mo,d,h,mi,s} */
  function wallParts(ms, tz) {
    var f = tzFmt(tz);
    if (!f) {
      var off = FIXED_OFFSET[tz] || 0;
      var d = new Date(ms + off * 60000);
      return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
    }
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }
  /** 해당 시각(ms)에서 tz의 UTC 오프셋(ms) */
  function offsetAt(ms, tz) {
    var w = wallParts(ms, tz);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
  }
  /**
   * 'YYYY-MM-DD' + 'HH:MM'(tz 현지 시각) → UTC epoch ms. 형식이 틀리면 null.
   * 기기 시간대와 무관하다.
   */
  function toEpoch(dateISO, hhmm, tz) {
    if (!isISODate(dateISO)) return null;
    var min = toMin(hhmm);
    if (min === null) return null;
    tz = tz || TZ;
    var p = dateISO.split('-');
    var guess = Date.UTC(+p[0], +p[1] - 1, +p[2], Math.floor(min / 60), min % 60);
    var off1 = offsetAt(guess, tz);
    var t = guess - off1;
    var off2 = offsetAt(t, tz);
    if (off2 !== off1) t = guess - off2; // 서머타임 경계 보정
    return t;
  }
  /** epoch ms → tz 현지 {date:'YYYY-MM-DD', hhmm:'HH:MM', md:'10/18'} */
  function format(ms, tz) {
    var w = wallParts(ms, tz || TZ);
    return {
      date: w.y + '-' + pad(w.mo) + '-' + pad(w.d),
      hhmm: pad(w.h) + ':' + pad(w.mi),
      md: w.mo + '/' + w.d,
    };
  }

  var api = {
    TZ: TZ,
    toEpoch: toEpoch,
    format: format,
    supported: !!partsFmt,
    /** 현재 시각. 테스트를 위해 덮어쓸 수 있다. */
    now: function () { return new Date(); },
    toMin: toMin,
    fromMin: fromMin,
    isTime: isTime,
    isISODate: isISODate,
    daysBetween: daysBetween,
    london: london,
    tripPhase: tripPhase,
    status: status,
  };
  window.TripTime = api;
})();
