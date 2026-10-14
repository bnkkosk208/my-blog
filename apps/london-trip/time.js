/* london-trip — 시간 유틸 (순수 함수, DOM 접근 없음)
 * 모든 비교는 런던 현지 시각(Europe/London) 기준. 기기 시간대와 무관.
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

  var api = {
    TZ: TZ,
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
