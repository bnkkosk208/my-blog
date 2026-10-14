/* london-trip — 진입점: 상태, 렌더링, 이벤트, 라우팅, 1분 타이머 */
(function () {
  'use strict';

  var D = window.TRIP_DATA;
  var Store = window.TripStore;
  var T = window.TripTime;
  var A = window.TripAlarm || null; // 알림(v2). 없으면 알림 UI만 생략
  var PLACES = window.TripPlaces || {}; // 장소 사진(v4). 없으면 사진만 생략
  var W = window.TripWeather || null;   // 날씨 예보(v7). 없거나 실패해도 나머지 기능은 그대로
  if (!D || !Store || !T) {
    console.error('[london-trip] 필수 스크립트를 불러오지 못했습니다.');
    return;
  }

  var DAYS = D.meta.days;
  var FIRST = DAYS[0].date;
  var LAST = DAYS[DAYS.length - 1].date;
  var MAP_URL = 'https://www.google.com/maps/search/?api=1&query=';

  // ---------- 개발용 자가검증 ----------
  (function selfCheck() {
    var errs = [];
    if (D.schedule.length !== 65) errs.push('schedule.length=' + D.schedule.length + ' (기대 65)');
    var ids = {};
    var dates = {};
    DAYS.forEach(function (d) { dates[d.date] = true; });
    D.schedule.forEach(function (s) {
      if (ids[s.id]) errs.push('중복 id ' + s.id);
      ids[s.id] = true;
      if (!dates[s.date]) errs.push(s.id + ' 날짜 ' + s.date + '가 meta.days에 없음');
    });
    Object.keys(PLACES).forEach(function (rid) {
      if (!ids[rid]) errs.push('places.js 행 ' + rid + '가 schedule에 없음');
    });
    if (errs.length) console.error('[london-trip] 데이터 자가검증 실패:', errs);
  })();

  Store.init(D.schedule.map(function (s) { return s.id; }), DAYS.map(function (d) { return d.date; }));

  // ---------- 상태 ----------
  var state = {
    view: 'schedule',
    day: FIRST,
    open: {},            // 펼친 카드 id
    showHidden: false,
    foodFilter: 'all',
    lastLiveKey: '',
    lastInteract: 0,     // 마지막 사용자 조작 시각(ms, TripTime.now 기준) — 자동 이동 보류용 (spec 14.3)
    lastTargetKey: '',   // 마지막으로 자동 이동한 대상 'day|itemId'
  };
  var HOLD_MIN = 3;                 // 조작 후 자동 이동 보류(분) — spec 14.9 B1
  var AUTO = !!T.supported;         // Intl 미지원 시 자동 이동 전체 끔 (spec 14.1)
  var memoTimers = {};

  // ---------- 표시 설정 (spec 15.1 C1 · 15.x C6) — 'london-trip:' 접두사라 전체 초기화 시 함께 삭제 ----------
  var PREF_KST = 'london-trip:showKst';
  var PREF_IMG = 'london-trip:showImg';
  function readPref(key, def) {
    try {
      var v = window.localStorage.getItem(key);
      return v === '1' ? true : v === '0' ? false : def;
    } catch (e) { return def; }
  }
  function writePref(key, on) {
    try { window.localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* 저장 불가: 이 탭에서만 유지 */ }
  }
  var prefs = { kst: readPref(PREF_KST, true), img: readPref(PREF_IMG, true) };

  // ---------- DOM 헬퍼 ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'hidden') n.hidden = true;
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function extLink(url, label) {
    return el('a', { href: url, target: '_blank', rel: 'noopener', text: label });
  }
  /** 원문 텍스트에서 links.label과 일치하는 부분만 <a>로 감싸고 나머지는 텍스트 노드로 */
  function appendLinked(parent, text, links) {
    var i = 0;
    while (i < text.length) {
      var best = -1;
      var bestLink = null;
      (links || []).forEach(function (l) {
        var p = text.indexOf(l.label, i);
        if (p >= 0 && (best < 0 || p < best)) { best = p; bestLink = l; }
      });
      if (best < 0) { parent.appendChild(document.createTextNode(text.slice(i))); break; }
      if (best > i) parent.appendChild(document.createTextNode(text.slice(i, best)));
      parent.appendChild(extLink(bestLink.url, bestLink.label));
      i = best + bestLink.label.length;
    }
    return parent;
  }
  function money(n) { return '£' + n.toFixed(2); }
  function range(a, b) { return Math.abs(a - b) < 0.001 ? money(a) : money(a) + ' ~ ' + money(b); }
  function announce(msg) {
    var live = $('live');
    live.textContent = '';
    window.setTimeout(function () { live.textContent = msg; }, 50);
  }
  function dayInfo(date) {
    for (var i = 0; i < DAYS.length; i++) if (DAYS[i].date === date) return DAYS[i];
    return null;
  }
  function shortLabel(d) { // '10/16(금)' -> '10/16', '(금)'
    return { md: d.label.replace(/\(.*$/, ''), dow: '(' + d.dow + ')' };
  }
  function scrollToY(y, behavior) {
    if (behavior === 'smooth') {
      try { window.scrollTo({ top: y, left: 0, behavior: 'smooth' }); return; } catch (e) { /* 구형 브라우저 */ }
    }
    window.scrollTo(0, y);
  }
  function scrollPageTo(node, offset, behavior) {
    // iframe 안에서 부모 페이지까지 스크롤하지 않도록 scrollIntoView 대신 window.scrollTo 사용
    var top = node.getBoundingClientRect().top + window.pageYOffset - (offset || 0);
    scrollToY(Math.max(0, top), behavior);
  }
  function autoBehavior() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'auto';
    } catch (e) { /* 무시 */ }
    return 'smooth';
  }
  function stickyHeight() { return document.querySelector('.sticky').offsetHeight + 8; }

  // ---------- 항목 모델 ----------
  var restaurantByName = {};
  D.restaurants.forEach(function (r) { if (!restaurantByName[r.name]) restaurantByName[r.name] = r.id; });

  function fromOriginal(s, idx) {
    return {
      id: s.id, orig: true, order: idx, date: s.date, start: s.start, end: s.end, durationMin: s.durationMin,
      type: s.type, title: s.title, transport: s.transport, reservation: s.reservation, note: s.note,
      links: s.links, addresses: s.addresses, restaurants: s.restaurants, cafes: s.cafes,
      costText: s.costText, tz: s.tz,
    };
  }
  function fromCustom(c) {
    var s = T.toMin(c.start);
    var e = T.toMin(c.end);
    return {
      id: c.id, orig: false, order: c.createdAt, date: c.date, start: c.start, end: c.end,
      durationMin: s !== null && e !== null ? e - s : null, type: c.type, title: c.title,
      transport: c.transport, reservation: false, note: null, links: [], addresses: [],
      restaurants: [], cafes: [], costText: c.costText, tz: 'Europe/London',
    };
  }
  function originalsOf(date) {
    var out = [];
    D.schedule.forEach(function (s, i) { if (s.date === date) out.push(fromOriginal(s, i)); });
    return out;
  }
  /** 화면에 표시할 항목(숨긴 원본 제외) — 시간순, 같으면 원본 먼저 */
  function itemsOf(date) {
    var list = originalsOf(date).filter(function (it) { return !Store.isHidden(it.id); });
    Store.listCustom(date).forEach(function (c) { list.push(fromCustom(c)); });
    list.sort(function (a, b) {
      var sa = a.start === null ? -1 : T.toMin(a.start);
      var sb = b.start === null ? -1 : T.toMin(b.start);
      if (sa !== sb) return sa - sb;
      if (a.orig !== b.orig) return a.orig ? -1 : 1;
      return a.order - b.order;
    });
    return list;
  }
  // ---------- 완료 판정 (spec 17): 수동 done || 시간 경과 자동 완료 ----------
  function doneEff(it) { return A ? A.isDoneEff(it) : Store.isDone(it.id); }
  function autoDoneOf(it) { return A ? A.isAutoDone(it) : false; }
  function isPastItem(it) { return A ? A.isPast(it) : false; }
  function doneLabel(it, auto) { return (auto ? '완료(시간 경과 자동): ' : '완료: ') + it.title; }

  /** 원본 행의 장소 사진 정보 (custom 일정은 없음) */
  function placeOf(it) {
    return it.orig && Object.prototype.hasOwnProperty.call(PLACES, it.id) ? PLACES[it.id] : null;
  }
  function hasDetails(it) {
    // 사진은 접힌 카드에 상시 표시되므로 펼칠 내용 판단에서 제외 (spec 16.1)
    return !!(it.note || it.restaurants.length || it.cafes.length || it.addresses.length);
  }
  function highlightable(it) {
    return it.tz === 'Europe/London' && it.start !== null;
  }

  // ---------- 헤더 / 시간 ----------
  function londonInfo() {
    var lt = T.london();
    if (!lt) return null;
    lt.trip = T.tripPhase(lt.date, FIRST, LAST);
    return lt;
  }

  // ---------- 한국 시간 (spec 15.1) ----------
  var SEOUL = 'Asia/Seoul';
  function wallMs(f) { // T.format 결과(벽시계)를 비교용 ms로
    var d = f.date.split('-');
    var t = f.hhmm.split(':');
    return Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1]);
  }
  /** 두 시간대 벽시계 차 → '+8h' (하드코딩 없이 계산하므로 10/25 GMT 전환 후 +9h) */
  function offsetLabel(fromF, toF) {
    var h = (wallMs(toF) - wallMs(fromF)) / 3600000;
    return (h >= 0 ? '+' : '') + (h % 1 ? h.toFixed(1) : String(h)) + 'h';
  }
  function daySuffix(n) { return n ? ' ' + (n > 0 ? '+' : '') + n + '일' : ''; }
  /**
   * 카드 보조 줄. 반환 {flag, text} 또는 null(표시 생략)
   * - 런던 행: 🇰🇷 01:50–04:30 +1일 (시작·종료가 모두 있을 때만)
   * - tz 'mixed'(r02): 시작=한국(부산 출발), 종료=런던(히드로 도착)
   * - tz 'Asia/Seoul'(r66): 원래 시각이 한국 → 런던 시각으로 역변환
   */
  function kstLine(it) {
    if (it.tz === 'mixed') {
      if (!it.start) return null;
      var txt = '한국 ' + it.start + ' 출발';
      var arr = it.end ? T.toEpoch(it.date, it.end, T.TZ) : null;
      if (arr !== null) {
        var fa = T.format(arr, SEOUL);
        txt += ' · 도착 시 한국 ' + fa.hhmm + daySuffix(T.daysBetween(it.date, fa.date));
      }
      return { flag: '', text: txt };
    }
    if (it.tz === SEOUL) {
      var t = it.start || it.end;
      var ms = t ? T.toEpoch(it.date, t, SEOUL) : null;
      if (ms === null) return null;
      var fl = T.format(ms, T.TZ);
      return { flag: '', text: '런던 ' + fl.hhmm + daySuffix(T.daysBetween(it.date, fl.date)) };
    }
    if (!it.start || !it.end) return null;
    var s = T.toEpoch(it.date, it.start, T.TZ);
    var e = T.toEpoch(it.date, it.end, T.TZ);
    if (s === null || e === null) return null;
    var fs = T.format(s, SEOUL);
    var fe = T.format(e, SEOUL);
    var ds = T.daysBetween(it.date, fs.date);
    var de = T.daysBetween(it.date, fe.date);
    // 시작·종료의 날짜 차가 같으면 끝에 한 번, 다르면 시작에도 붙인다
    var startTxt = fs.hhmm + (ds !== de && ds ? '(' + daySuffix(ds).trim() + ')' : '');
    return { flag: '🇰🇷', text: startTxt + '–' + fe.hhmm + daySuffix(de) };
  }
  function kstEl(it) {
    if (!prefs.kst) return null;
    var k = kstLine(it);
    if (!k) return null;
    return el('div', { class: 'c-kst' }, [
      k.flag ? el('span', { class: 'kst-flag', 'aria-hidden': 'true', text: k.flag + ' ' }) : null,
      k.flag ? el('span', { class: 'sr-only', text: '한국 시각 ' }) : null,
      k.text,
    ]);
  }

  function renderHeader(lt) {
    var clock = $('clockChip');
    var phase = $('phaseChip');
    if (!lt) {
      clock.textContent = '런던 시각 확인 불가';
      phase.hidden = true;
      return;
    }
    // 런던 15:59 BST · 한국 23:59 (+8h) — 좁은 화면에서는 한국 시각이 둘째 줄로 (spec 15.1)
    var ms = T.now().getTime();
    var k = T.format(ms, SEOUL);
    var lParts = clock.querySelector('.clk-l');
    if (!lParts) {
      clear(clock);
      clock.appendChild(el('span', { class: 'clk-l' }));
      clock.appendChild(el('span', { class: 'clk-k' }));
      lParts = clock.querySelector('.clk-l');
    }
    lParts.textContent = '런던 ' + lt.hhmm + (lt.zone ? ' ' + lt.zone : '');
    clock.querySelector('.clk-k').textContent = ' · 한국 ' + k.hhmm + ' (' + offsetLabel(T.format(ms, T.TZ), k) + ')';
    phase.hidden = false;
    if (lt.trip.phase === 'during') phase.textContent = '오늘: Day ' + (lt.trip.dayIndex + 1);
    else if (lt.trip.phase === 'before') phase.textContent = 'D-' + lt.trip.dDay;
    else phase.textContent = '여행 종료';
  }

  // ---------- 날짜 탭 ----------
  function dayProgress(date) {
    var items = itemsOf(date);
    var done = items.filter(doneEff).length;
    return done + '/' + items.length;
  }

  function renderDayTabs() {
    var wrap = $('dayTabs');
    clear(wrap);
    DAYS.forEach(function (d) {
      var sel = d.date === state.day;
      var lbl = shortLabel(d);
      var b = el('button', {
        type: 'button', role: 'tab', class: 'day-tab', id: 'day-' + d.date, 'data-date': d.date,
        'aria-selected': sel ? 'true' : 'false', 'aria-controls': 'panel-schedule', tabindex: sel ? '0' : '-1',
      }, [
        el('span', { class: 'd-no', text: 'Day ' + d.dayNo }),
        el('span', { text: lbl.md + ' ' + lbl.dow }),
        el('span', { class: 'd-prog', text: dayProgress(d.date), 'aria-label': '완료 ' + dayProgress(d.date) }),
        el('span', { class: 'd-wx', hidden: true }),
      ]);
      wrap.appendChild(b);
    });
    markTodayTab(londonInfo());
    renderTabWeather();
    centerDayTab();
  }

  // ---------- 날씨 (spec 18) — 응답 값은 모두 textContent로만 렌더 ----------
  function deg(v) { return String(Math.round(v) || 0) + '°'; }
  function wxOf(date) {
    if (!W) return null;
    try { return W.get(date); } catch (e) { return null; }
  }
  /** 날짜 탭 한 줄: '🌧 14°/9°' (탭 폭이 넘치면 최저 생략) */
  function renderTabWeather() {
    var wrap = $('dayTabs');
    var visible = !wrap.hidden && wrap.offsetParent !== null;
    DAYS.forEach(function (d) {
      var t = $('day-' + d.date);
      var box = t && t.querySelector('.d-wx');
      if (!box) return;
      var w = wxOf(d.date);
      clear(box);
      t.classList.toggle('has-wx', !!w);
      box.classList.toggle('wx-past', !!(w && w.past));
      if (!w) { box.hidden = true; return; }
      box.hidden = false;
      box.appendChild(el('span', { 'aria-hidden': 'true', text: w.emoji + ' ' + deg(w.max) }));
      var minEl = el('span', { class: 'wx-min', 'aria-hidden': 'true', text: '/' + deg(w.min) });
      box.appendChild(minEl);
      box.appendChild(el('span', {
        class: 'sr-only',
        text: (w.past ? '지난 예보 ' : '') + w.text + ', 최고 ' + Math.round(w.max) + '도 최저 ' + Math.round(w.min) + '도',
      }));
      if (visible && box.scrollWidth > box.clientWidth + 1) minEl.hidden = true;
    });
  }
  function fmtUpdated(ms) {
    var l = T.format(ms, T.TZ);
    var k = T.format(ms, SEOUL);
    var today = londonInfo();
    var md = function (f) { var p = f.date.split('-'); return +p[1] + '/' + +p[2] + ' '; };
    var showDate = !today || today.date !== l.date;
    return '업데이트 런던 ' + (showDate ? md(l) : '') + l.hhmm + ' · 한국 ' + (k.date !== l.date || showDate ? md(k) : '') + k.hhmm;
  }
  /** 일자 요약 카드 하단 날씨 블록. 표시할 값이 없으면 null(영역 숨김) */
  function weatherBlock(date) {
    var w = wxOf(date);
    if (!w) return null;
    var parts = [w.text, '최고 ' + deg(w.max) + ' / 최저 ' + deg(w.min)];
    if (w.pop !== null) parts.push('강수 ' + Math.round(w.pop) + '%');
    var box = el('div', { class: 's-wx' + (w.past ? ' wx-past' : ''), role: 'group', 'aria-label': '날씨 예보' });
    box.appendChild(el('p', { class: 's-wx-main' }, [
      el('span', { 'aria-hidden': 'true', text: w.emoji + ' ' }),
      parts.join(' · ') + (w.past ? ' (지난 예보)' : ''),
    ]));
    if (!w.past && w.pop !== null && w.pop >= 50) box.appendChild(el('p', { class: 's-wx-umb', text: '☂ 우산 챙기세요' }));
    var at = W.fetchedAt();
    box.appendChild(el('p', { class: 's-wx-foot' }, [at ? fmtUpdated(at) + ' · ' : '', el('a', {
      href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener noreferrer', text: 'Weather data by Open-Meteo.com',
    })]));
    return box;
  }
  function onWeatherUpdate() {
    // 비동기 응답으로 탭(56→68px)·요약 높이가 바뀌어도 보던 카드가 밀리지 않게 위치 고정 (Review v7)
    var sticky = document.querySelector('.sticky');
    var anchor = null;
    var before = 0;
    if (state.view === 'schedule' && window.pageYOffset > 0 && sticky) {
      var line = sticky.getBoundingClientRect().bottom;
      var cards = document.querySelectorAll('#panel-schedule .card, #panel-schedule .settings');
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].getBoundingClientRect().bottom > line) { anchor = cards[i]; break; }
      }
      if (anchor) before = anchor.getBoundingClientRect().top - line;
    }
    renderTabWeather();
    if (state.view === 'schedule' && dayInfo(state.day)) renderSummary();
    if (anchor && anchor.isConnected) {
      var delta = anchor.getBoundingClientRect().top - sticky.getBoundingClientRect().bottom - before;
      if (Math.abs(delta) >= 1) window.scrollTo(0, window.pageYOffset + delta);
    }
  }
  function updateDayProgress() {
    DAYS.forEach(function (d) {
      var t = $('day-' + d.date);
      if (!t) return;
      var p = t.querySelector('.d-prog');
      var v = dayProgress(d.date);
      p.textContent = v;
      p.setAttribute('aria-label', '완료 ' + v);
    });
  }
  function markTodayTab(lt) {
    DAYS.forEach(function (d) {
      var t = $('day-' + d.date);
      if (t) t.classList.toggle('is-today', !!lt && lt.date === d.date);
    });
  }
  function centerDayTab() {
    var wrap = $('dayTabs');
    var t = $('day-' + state.day);
    if (!t) return;
    var target = t.offsetLeft - wrap.offsetLeft - (wrap.clientWidth - t.offsetWidth) / 2;
    wrap.scrollLeft = Math.max(0, target);
  }

  function selectDay(date, focus) {
    if (!dayInfo(date)) return;
    state.day = date;
    Store.setLastDay(date);
    DAYS.forEach(function (d) {
      var t = $('day-' + d.date);
      if (!t) return;
      var sel = d.date === date;
      t.setAttribute('aria-selected', sel ? 'true' : 'false');
      t.tabIndex = sel ? 0 : -1;
      if (sel && focus) t.focus();
    });
    centerDayTab();
    state.showHidden = false;
    renderSchedule();
    updateNowBtnSoon();
  }

  // ---------- 일정(타임라인) ----------
  function timeText(it) {
    if (it.start === null) {
      return { main: '– ' + (it.end || '') + ' 도착' + (it.tz === 'Asia/Seoul' ? ' (한국 시각)' : ''), dur: '' };
    }
    if (it.tz === 'mixed') {
      return { main: it.start + ' (한국) – ' + it.end + ' (런던)', dur: it.durationMin !== null ? ' (' + it.durationMin + '분 · 시차 미반영)' : '', title: '엑셀 원문 소요값입니다. 한국–런던 시차(8시간)는 반영되지 않았습니다.' };
    }
    var main = it.end ? it.start + '–' + it.end : it.start;
    return { main: main, dur: it.durationMin !== null ? ' (' + it.durationMin + '분)' : '' };
  }

  function fillBadges(box, it) {
    clear(box);
    if (it.type === '이동') box.appendChild(el('span', { class: 'badge b-move', text: '→ 이동' }));
    else if (it.type === '이동/활동') box.appendChild(el('span', { class: 'badge b-mix', text: '→ 이동/활동' }));
    else box.appendChild(el('span', { class: 'badge b-act', text: '● 활동' }));
    if (it.transport) box.appendChild(el('span', { class: 'badge b-transport', text: it.transport }));
    if (it.reservation) {
      if (Store.isBooked(it.id)) box.appendChild(el('span', { class: 'badge b-booked', text: '예약완료 ✓' }));
      else box.appendChild(el('span', { class: 'badge b-reserve', text: '예약필요' }));
    }
    if (!it.orig) box.appendChild(el('span', { class: 'badge b-mine', text: '내 일정' }));
    if (Store.getMemo(it.id)) box.appendChild(el('span', { class: 'badge b-memo', text: '메모' }));
    if (A && it.start && Store.isAlarmOn(it.id)) {
      box.appendChild(el('span', { class: 'badge b-alarm', text: '🔔 ' + Store.alarmLead(it.id) + '분 전' }));
    }
    box.appendChild(el('span', { class: 'badge live-badge' }));
  }

  function placeList(places) {
    var ul = el('ul', { class: 'places' });
    places.forEach(function (p) {
      var li = el('li', null, [el('span', { class: 'p-name', text: p.name })]);
      if (p.popular) li.appendChild(el('span', { class: 'badge b-pop', text: '인기' }));
      if (p.waiting) li.appendChild(el('span', { class: 'badge b-wait', text: '웨이팅' }));
      if (p.desc) li.appendChild(el('span', { class: 'p-desc', text: p.desc }));
      var rid = restaurantByName[p.name];
      if (rid) {
        li.appendChild(el('a', { href: '#', class: 'goto-food', 'data-rid': rid, text: '예약방법 보기' }));
      }
      ul.appendChild(li);
    });
    return ul;
  }

  function makeCard(it) {
    var cls = 'card ' + (it.type === '이동' ? 't-move' : it.type === '이동/활동' ? 't-mix' : 't-act');
    if (!it.orig) cls += ' custom';
    var auto = autoDoneOf(it);
    if (auto || Store.isDone(it.id)) cls += ' is-done';
    if (auto) cls += ' is-auto-done';
    var open = !!state.open[it.id];
    if (open) cls += ' is-open';
    var detailId = 'detail-' + it.id;
    var tt = timeText(it);

    var timeEl = el('div', { class: 'c-time' }, [tt.main, tt.dur ? el('span', { class: 'dur', text: tt.dur, title: tt.title || null }) : null]);
    var badges = el('div', { class: 'c-badges' });
    fillBadges(badges, it);
    var main = el('div', { class: 'c-main' }, [
      timeEl,
      kstEl(it),
      el('p', { class: 'c-title', text: it.title }),
      badges,
      it.costText ? el('p', { class: 'c-cost', text: '비용(1인) ' + it.costText }) : null,
    ]);

    var cb = el('input', { type: 'checkbox', 'data-id': it.id, 'aria-label': doneLabel(it, auto) });
    cb.checked = auto || Store.isDone(it.id);
    var check = el('label', { class: 'check', title: '완료 체크' }, [cb, el('span', { class: 'sr-only', text: doneLabel(it, auto) })]);
    // 자동 완료 배지: 색 외 구분용 텍스트, 의미는 체크박스 aria-label이 전달 (spec 17.3)
    var autoTag = el('span', { class: 'auto-tag', text: '자동', 'aria-hidden': 'true', title: '시간이 지나 자동 완료됨' });
    autoTag.hidden = !auto;
    var side = el('div', { class: 'c-side' }, [check, autoTag, A ? makeBell(it) : null]);

    var details = hasDetails(it);
    var toggle = el('button', {
      type: 'button', class: 'btn btn-small btn-toggle', 'data-act': 'toggle', 'aria-expanded': open ? 'true' : 'false',
      'aria-controls': detailId,
    });
    toggle.textContent = details ? (open ? '접기 ▾' : '펼치기 ▸') : (open ? '메모 닫기' : '메모');

    // 장소 사진: 접힘과 무관하게 헤더 아래 상시 표시, 설정 끔이면 미렌더 (spec 16.1)
    var pl = prefs.img ? placeOf(it) : null;
    var li = el('li', { class: cls, id: 'card-' + it.id, 'data-id': it.id }, [
      el('div', { class: 'c-top' }, [main, side]),
      pl ? placeBlock(pl) : null,
      el('div', { class: 'c-actions' }, [toggle]),
    ]);
    li._item = it;
    li._hasDetails = details;
    var detail = el('div', { class: 'c-detail', id: detailId });
    detail.hidden = !open;
    if (open) buildDetail(detail, it);
    li.appendChild(detail);
    return li;
  }

  // ---------- 알림: 카드 벨 / 시점 ----------
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function bellIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M12 3.5a5.5 5.5 0 0 0-5.5 5.5v4.2L4.8 16.5h14.4l-1.7-3.3V9A5.5 5.5 0 0 0 12 3.5zM9.8 19a2.2 2.2 0 0 0 4.4 0z');
    svg.appendChild(path);
    return svg;
  }
  function makeBell(it) {
    var can = !!it.start;
    var on = can && Store.isAlarmOn(it.id);
    return el('button', {
      type: 'button', class: 'bell', 'data-act': 'bell', 'aria-pressed': on ? 'true' : 'false',
      'aria-label': '알림 켜기: ' + it.title,
      title: can ? (on ? '알림 ' + Store.alarmLead(it.id) + '분 전 (누르면 끄기)' : '알림 켜기') : '시작 시간이 없어 알림 불가',
      disabled: !can,
    }, [bellIcon()]);
  }
  /** 벨·배지·시점 select를 현재 설정으로 갱신(카드 DOM 유지) */
  function updateAlarmUI(li) {
    var it = li._item;
    var bell = li.querySelector('.bell');
    if (bell) bell.parentNode.replaceChild(makeBell(it), bell);
    fillBadges(li.querySelector('.c-badges'), it);
    var sel = li.querySelector('select.alarm-lead');
    if (sel) {
      sel.value = String(Store.alarmLead(it.id));
      var hint = sel.parentNode.querySelector('.alarm-hint');
      if (hint) hint.textContent = Store.isAlarmOn(it.id) ? '' : '(바꾸면 알림이 켜집니다)';
    }
    applyLive(true);
  }
  function leadSelect(value, attrs) {
    var sel = el('select', attrs);
    (A ? A.LEADS : []).forEach(function (m) {
      var o = el('option', { value: String(m), text: m + '분 전' });
      if (m === value) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  // ---------- 장소 사진 (spec 15.4 · 15.x: 앱에 포함된 파일만, 외부 요청 없음) ----------
  function searchLink(pl) {
    return el('a', {
      class: 'img-search', href: 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(pl.en + ' London'),
      target: '_blank', rel: 'noopener noreferrer', text: '이미지 검색 ↗',
    });
  }
  /** 캡션: 사진: {저작자} · {라이선스} · 출처 ↗ */
  function fillCredit(p, pl) {
    clear(p);
    p.appendChild(document.createTextNode('사진: ' + pl.artist + ' · '));
    p.appendChild(el('a', { href: pl.licenseUrl, target: '_blank', rel: 'noopener noreferrer license', text: pl.license }));
    p.appendChild(document.createTextNode(' · '));
    p.appendChild(el('a', { href: pl.source, target: '_blank', rel: 'noopener noreferrer', text: '출처 ↗', title: 'Wikimedia Commons 파일 페이지' }));
    return p;
  }
  function placeBlock(pl) {
    var wrap = el('div', { class: 'place-media' });
    var img = el('img', {
      src: pl.img, alt: pl.ko + ' 사진', width: String(pl.w), height: String(pl.h), loading: 'lazy', decoding: 'async',
    });
    if (pl.pos) img.style.objectPosition = pl.pos;
    var btn = el('button', { type: 'button', class: 'place-img', 'data-act': 'zoom', 'aria-label': pl.ko + ' 사진 크게 보기' }, [
      img,
      el('span', { class: 'zoom-hint', 'aria-hidden': 'true', text: '⤢ 크게 보기' }),
    ]);
    var fig = el('figure', { class: 'place-fig' }, [btn, el('figcaption', null, [fillCredit(el('p', { class: 'img-credit' }), pl)])]);
    img.addEventListener('error', function () { // 파일 누락 등: 사진 영역을 숨기고 검색 링크만
      fig.hidden = true;
      wrap.appendChild(el('p', { class: 'small muted img-off' }, ['사진을 불러오지 못했습니다 · ', searchLink(pl)]));
    });
    wrap.appendChild(fig);
    return wrap;
  }

  var imgDlg = $('imgDialog');
  var imgOpener = null;
  function openImg(pl, opener) {
    if (!imgDlg) return;
    imgOpener = opener || null;
    $('imgDialogTitle').textContent = pl.ko;
    var im = $('imgDialogImg');
    im.src = pl.img;
    im.alt = pl.ko + ' 사진';
    im.width = pl.w;
    im.height = pl.h;
    im.hidden = false;
    fillCredit($('imgDialogCredit'), pl);
    if (typeof imgDlg.showModal === 'function') imgDlg.showModal();
    else imgDlg.setAttribute('open', '');
    $('imgDialogClose').focus();
  }
  function closeImg() {
    if (!imgDlg) return;
    if (typeof imgDlg.close === 'function' && imgDlg.open) imgDlg.close();
    else if (imgDlg.hasAttribute('open')) { imgDlg.removeAttribute('open'); onImgClosed(); }
  }
  function onImgClosed() {
    var o = imgOpener;
    imgOpener = null;
    if (o && document.body.contains(o)) {
      try { o.focus({ preventScroll: true }); } catch (e) { o.focus(); }
    }
  }

  function buildDetail(box, it) {
    clear(box); // 사진은 카드 본문에 상시 표시 → 펼친 영역에는 중복 표시하지 않음 (spec 16.1)
    if (A && it.start) {
      var lid = 'lead-' + it.id;
      box.appendChild(el('div', { class: 'alarm-row' }, [
        el('label', { for: lid, text: '알림 시점' }),
        leadSelect(Store.alarmLead(it.id), { id: lid, class: 'alarm-lead', 'data-id': it.id }),
        el('span', { class: 'muted small alarm-hint', text: Store.isAlarmOn(it.id) ? '' : '(바꾸면 알림이 켜집니다)' }),
      ]));
    }
    if (it.note) {
      box.appendChild(el('h4', { text: '비고' }));
      box.appendChild(appendLinked(el('p', { class: 'c-note' }), it.note, it.links));
    }
    if (it.addresses.length) {
      var ml = el('div', { class: 'map-links' });
      it.addresses.forEach(function (a) {
        var label = it.addresses.length > 1 ? '지도에서 보기: ' + a.split(',')[0] : '지도에서 보기';
        ml.appendChild(extLink(MAP_URL + encodeURIComponent(a), label + ' ↗'));
      });
      box.appendChild(ml);
    }
    if (it.restaurants.length) {
      box.appendChild(el('h4', { text: '주변 식당 추천' }));
      box.appendChild(placeList(it.restaurants));
    }
    if (it.cafes.length) {
      box.appendChild(el('h4', { text: '주변 카페 추천' }));
      box.appendChild(placeList(it.cafes));
    }
    var memoId = 'memo-' + it.id;
    box.appendChild(el('label', { class: 'memo-label', for: memoId, text: '내 메모' }));
    var ta = el('textarea', { class: 'memo', id: memoId, 'data-id': it.id, maxlength: String(Store.MEMO_MAX), rows: '3', placeholder: '메모를 입력하면 자동 저장됩니다' });
    ta.value = Store.getMemo(it.id);
    box.appendChild(ta);
    box.appendChild(el('p', { class: 'memo-status', 'aria-live': 'polite' }));
    var acts = el('div', { class: 'c-actions' });
    if (it.orig) {
      acts.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', 'data-act': 'hide', text: '이 항목 숨기기' }));
    } else {
      acts.appendChild(el('button', { type: 'button', class: 'btn btn-small', 'data-act': 'edit', text: '수정' }));
      acts.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-danger', 'data-act': 'delete', text: '삭제' }));
    }
    box.appendChild(acts);
  }

  function toggleCard(li, force) {
    var it = li._item;
    var open = force !== undefined ? force : !state.open[it.id];
    if (open) state.open[it.id] = true; else delete state.open[it.id];
    li.classList.toggle('is-open', open);
    var detail = li.querySelector('.c-detail');
    var btn = li.querySelector('[data-act="toggle"]');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = li._hasDetails ? (open ? '접기 ▾' : '펼치기 ▸') : (open ? '메모 닫기' : '메모');
    if (open) buildDetail(detail, it);
    detail.hidden = !open;
  }

  function renderSummary() {
    var date = state.day;
    var info = dayInfo(date);
    var all = originalsOf(date);
    var items = itemsOf(date);
    var visibleOrig = items.filter(function (it) { return it.orig; });
    var mine = items.length - visibleOrig.length;
    var cnt = function (t) { return visibleOrig.filter(function (it) { return it.type === t; }).length; };
    var done = items.filter(doneEff).length;
    var resv = all.filter(function (it) { return it.reservation; });
    var booked = resv.filter(function (it) { return Store.isBooked(it.id); }).length;

    var src = D.schedule.filter(function (s) { return s.date === date; });
    var first = src[0];
    var last = src[src.length - 1];
    var span = first.start ? first.start + '–' + (last.end || '') : '– ' + (last.end || '');

    // 비용
    var tMin = 0, tMax = 0, tCount = 0, flight = false;
    var fMin = 0, fMax = 0, fCount = 0, unknownFee = false, actCount = 0;
    src.forEach(function (s) {
      if (s.costCategory === 'transport') {
        if (s.costMin === null) { if (s.costText && s.costText.indexOf('항공권') >= 0) flight = true; return; }
        tMin += s.costMin; tMax += s.costMax; tCount++;
      } else if (s.type === '활동') {
        actCount++;
        if (s.costCategory === 'fee' || s.costCategory === 'free') { fMin += s.costMin; fMax += s.costMax; fCount++; }
        else if (s.costCategory === 'unknown' && s.costText) unknownFee = true;
      }
    });
    var transportText;
    if (tCount) transportText = range(tMin, tMax) + (flight ? ' (+항공권 별도)' : '');
    else if (flight) transportText = '항공권 별도';
    else transportText = money(0) + ' (이동 행 없음)';
    var feeText;
    if (!actCount) feeText = '–';
    else if (unknownFee && fMax === 0) feeText = '계산 불가 (상품별 상이) · 식사·쇼핑 별도';
    else feeText = range(fMin, fMax) + (unknownFee ? ' + 상품별 상이 항목' : '') + ' · 식사·쇼핑 별도';

    var typeParts = ['활동 ' + cnt('활동'), '이동 ' + cnt('이동')];
    if (cnt('이동/활동')) typeParts.push('이동/활동 ' + cnt('이동/활동'));
    if (mine) typeParts.push('내 일정 ' + mine);
    var statParts = ['완료 ' + done + '/' + items.length];
    if (resv.length) statParts.push('예약필요 ' + resv.length + ' (예약완료 ' + booked + ')');

    var box = $('daySummary');
    clear(box);
    box.appendChild(el('p', { class: 's-head', text: 'Day ' + info.dayNo + ' · ' + info.label + ' · ' + span }));
    box.appendChild(el('p', { text: typeParts.join(' · ') }));
    box.appendChild(el('p', { text: statParts.join(' · ') }));
    box.appendChild(el('p', { text: '예상 교통비 ' + transportText }));
    box.appendChild(el('p', { text: '예상 입장·이용료 ' + feeText }));
    var wx = weatherBlock(date);
    if (wx) box.appendChild(wx);
  }

  function renderTripTotal() {
    var tMin = 0, tMax = 0, fMin = 0, fMax = 0;
    D.schedule.forEach(function (s) {
      if (s.costMin === null) return;
      if (s.costCategory === 'transport') { tMin += s.costMin; tMax += s.costMax; }
      else if (s.type === '활동' && (s.costCategory === 'fee' || s.costCategory === 'free')) { fMin += s.costMin; fMax += s.costMax; }
    });
    $('tripTotal').textContent = '여행 전체(1인) 예상: 교통 ' + range(tMin, tMax) + ' · 입장·이용료 ' + range(fMin, fMax) + ' (식사·쇼핑·항공·투어 별도)';
  }

  function renderHidden() {
    var date = state.day;
    var hidden = originalsOf(date).filter(function (it) { return Store.isHidden(it.id); });
    var wrap = $('hiddenRows');
    var btn = $('hiddenToggle');
    var list = $('hiddenList');
    wrap.hidden = hidden.length === 0;
    if (!hidden.length) { state.showHidden = false; return; }
    btn.textContent = state.showHidden ? '숨긴 항목 접기' : '숨긴 항목 ' + hidden.length + '개 보기';
    btn.setAttribute('aria-expanded', state.showHidden ? 'true' : 'false');
    list.hidden = !state.showHidden;
    clear(list);
    hidden.forEach(function (it) {
      list.appendChild(el('li', null, [
        el('span', { text: (it.start || '–') + ' · ' + it.title }),
        el('button', { type: 'button', class: 'btn btn-small', 'data-unhide': it.id, text: '다시 표시' }),
      ]));
    });
  }

  function renderSchedule() {
    var tl = $('timeline');
    clear(tl);
    itemsOf(state.day).forEach(function (it) { tl.appendChild(makeCard(it)); });
    renderSummary();
    renderHidden();
    updateDayProgress();
    state.lastLiveKey = '';
    applyLive(true);
    $('timeline').classList.toggle('alarms-off', !!A && !Store.getAlarm().enabled);
    alarmRefresh();
  }

  // ---------- 완료 표시 갱신 (spec 17.3) — 카드 클래스·체크·배지·요약만, DOM 재생성 없음(스크롤 유지) ----------
  function updateDoneUI(li) {
    var it = li && li._item;
    if (!it) return;
    var auto = autoDoneOf(it);
    var done = auto || Store.isDone(it.id);
    li.classList.toggle('is-done', done);
    li.classList.toggle('is-auto-done', auto);
    var cb = li.querySelector('.check input[data-id]');
    if (cb) {
      cb.checked = done;
      cb.setAttribute('aria-label', doneLabel(it, auto));
      var sr = cb.parentNode.querySelector('.sr-only');
      if (sr) sr.textContent = doneLabel(it, auto);
    }
    var tag = li.querySelector('.auto-tag');
    if (tag) tag.hidden = !auto;
  }
  function refreshDone() {
    Array.prototype.forEach.call($('timeline').querySelectorAll('.card'), updateDoneUI);
    if (dayInfo(state.day)) renderSummary();
    updateDayProgress();
  }

  // ---------- 진행 중 / 다음 ----------
  function applyLive(fromRender) {
    var lt = londonInfo();
    renderHeader(lt);
    markTodayTab(lt);
    var cards = $('timeline').querySelectorAll('.card');
    Array.prototype.forEach.call(cards, function (c) {
      c.classList.remove('is-now');
      c.removeAttribute('aria-current');
      var lb = c.querySelector('.live-badge');
      if (lb) { lb.textContent = ''; lb.className = 'badge live-badge'; }
    });
    if (!lt || lt.trip.phase !== 'during' || lt.date !== state.day) return;

    var items = itemsOf(state.day).filter(highlightable);
    var st = T.status(items, lt.minutes);
    var names = [];
    st.current.forEach(function (id) {
      var c = $('card-' + id);
      if (!c) return;
      c.classList.add('is-now');
      c.setAttribute('aria-current', 'true');
      var lb = c.querySelector('.live-badge');
      lb.textContent = '지금';
      lb.classList.add('b-now');
      names.push(c._item.title);
    });
    if (st.next) {
      var n = $('card-' + st.next.id);
      if (n) {
        var nb = n.querySelector('.live-badge');
        nb.textContent = '다음 · ' + st.next.inMin + '분 후';
        nb.classList.add('b-next');
      }
    }
    var key = state.day + '|' + st.current.join(',');
    if (key !== state.lastLiveKey) {
      if (names.length && !fromRender) announce('지금 진행 중: ' + names.join(', '));
      state.lastLiveKey = key;
    }
  }

  // ---------- 현재 위치 자동 이동 (spec 14) ----------
  /** 현재 위치: {day, itemId|null, phase} — Intl 미지원이면 null */
  function currentTarget() {
    if (!AUTO) return null;
    var lt = londonInfo();
    if (!lt) return null;
    var phase = lt.trip.phase;
    if (phase === 'after') return { day: LAST, itemId: null, phase: phase };
    if (phase === 'before') {
      var first = itemsOf(FIRST);
      var pick = null;
      first.forEach(function (it) { if (it.id === 'r02') pick = it; });
      if (!pick) pick = first.filter(highlightable)[0] || null;
      return { day: FIRST, itemId: pick ? pick.id : null, phase: phase };
    }
    var items = itemsOf(lt.date).filter(highlightable);
    var st = T.status(items, lt.minutes);
    var id = st.current[0] || (st.next ? st.next.id : null) || (items.length ? items[items.length - 1].id : null);
    return { day: lt.date, itemId: id, phase: phase };
  }

  function markInteract() {
    state.lastInteract = T.now().getTime();
    updateNowBtnSoon();
  }
  function isHeld() {
    if (!state.lastInteract) return false;
    return T.now().getTime() - state.lastInteract < HOLD_MIN * 60000;
  }
  var NON_TEXT_INPUT = /^(checkbox|radio|button|submit|reset|file|range|color|image)$/i;
  /** 절대 이동 금지 조건: 입력 중, 바텀시트 열림, 텍스트 선택 중 (spec 14.3) */
  function isBlocked() {
    var a = document.activeElement;
    // 닫힌 dialog 안에 포커스가 남은 경우(포커스 복원 실패)는 입력 중으로 보지 않는다(Review v3)
    if (a && a !== document.body && !(a.closest && a.closest('dialog:not([open])'))) {
      var tag = a.tagName;
      if (a.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT' && !NON_TEXT_INPUT.test(a.type || '')) return true;
    }
    if (dialog && (dialog.open || dialog.hasAttribute('open'))) return true;
    if (imgDlg && (imgDlg.open || imgDlg.hasAttribute('open'))) return true; // 사진 크게 보기 (spec 15.4)
    // 알림 패널(<details>)은 열어 둔 채 둘 수 있으므로 "열림"만으로는 차단하지 않는다(Review v3).
    // 패널 안 select·입력 포커스는 위 입력 검사로, 패널 클릭·변경은 markInteract 보류로 처리된다.
    try {
      var sel = window.getSelection ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && String(sel).trim()) return true;
    } catch (e) { /* 무시 */ }
    return false;
  }
  /** 대상 카드가 화면(고정 탭 아래)에 보이는가 */
  function atPosition(tgt) {
    if (state.view !== 'schedule' || state.day !== tgt.day) return false;
    if (!tgt.itemId) return true;
    var c = $('card-' + tgt.itemId);
    if (!c) return true;
    var r = c.getBoundingClientRect();
    var top = document.querySelector('.sticky').getBoundingClientRect().bottom;
    return r.bottom > top + 24 && r.top < window.innerHeight - 48;
  }
  function removeHash() {
    if (!window.location.hash || !window.history || !window.history.replaceState) return;
    try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); } catch (e) { /* 무시 */ }
  }
  function flashCard(card) {
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  }
  function moveTo(tgt, manual) {
    if (state.day !== tgt.day) selectDay(tgt.day);
    removeHash();
    var behavior = autoBehavior();
    window.requestAnimationFrame(function () {
      var card = tgt.itemId ? $('card-' + tgt.itemId) : null;
      if (card) scrollPageTo(card, stickyHeight(), behavior);
      else scrollToY(0, behavior);
      if (manual) {
        if (card) {
          flashCard(card);
          var b = card.querySelector('[data-act="toggle"]');
          if (b) b.focus({ preventScroll: true });
        } else {
          var dt = $('day-' + tgt.day);
          if (dt) dt.focus({ preventScroll: true });
        }
      }
      updateNowBtnSoon();
    });
  }
  /**
   * 현재 위치로 이동. reason: 'load' | 'return'(탭·앱 복귀) | 'timer' | 'button'
   * 반환: 실제로 이동했으면 true
   */
  function syncToNow(reason) {
    var tgt = currentTarget();
    if (!tgt) { updateNowBtn(); return false; }
    var manual = reason === 'button';
    if (!manual && isBlocked()) { updateNowBtn(); return false; }
    if (reason === 'timer' && isHeld()) { updateNowBtn(); return false; }
    if (state.view !== 'schedule') {
      // 다른 뷰: 버튼 또는 여행 중 앱 복귀일 때만 일정 뷰로 전환 (spec 14.5)
      if (!(manual || (reason === 'return' && tgt.phase === 'during'))) { updateNowBtn(); return false; }
      switchView('schedule');
    }
    var key = tgt.day + '|' + (tgt.itemId || '');
    if (!manual && reason !== 'load' && key === state.lastTargetKey && atPosition(tgt)) { updateNowBtn(); return false; }
    state.lastTargetKey = key;
    if (manual) state.lastInteract = 0;
    moveTo(tgt, manual);
    return true;
  }

  var nowRaf = 0;
  function updateNowBtn() {
    var row = $('nowRow');
    if (!row) return;
    var tgt = currentTarget();
    var show = !!tgt && tgt.phase !== 'after' && !atPosition(tgt);
    if (row.hidden === show) row.hidden = !show;
  }
  function updateNowBtnSoon() {
    if (nowRaf) return;
    nowRaf = window.requestAnimationFrame(function () { nowRaf = 0; updateNowBtn(); });
  }
  /** 1분 타이머·복귀 공통: 헤더·하이라이트 갱신 → 알림 확인 → 현재 위치 판단 */
  function tick(reason) {
    applyLive(false);
    refreshDone();
    renderTabWeather(); // 날짜가 바뀌면 지난 날짜 흐림 처리 (요청 없음)
    alarmTick();
    syncToNow(reason);
  }

  // ---------- 예약 체크 ----------
  function renderBooking() {
    var rows = D.schedule.filter(function (s) { return s.reservation; });
    var list = $('bookingList');
    clear(list);
    var n = 0;
    rows.forEach(function (s) {
      var booked = Store.isBooked(s.id);
      if (booked) n++;
      var cb = el('input', { type: 'checkbox', 'data-book': s.id });
      cb.checked = booked;
      var body = el('div', { class: 'bk-main' }, [
        el('div', { class: 'bk-meta', text: s.dateLabel + ' · ' + (s.start || '–') + '–' + (s.end || '') }),
        el('h3', { text: s.title }),
      ]);
      if (s.note) body.appendChild(appendLinked(el('p', { class: 'c-note small' }), s.note, s.links));
      if (s.costText) body.appendChild(el('p', { class: 'small muted', text: '비용(1인) ' + s.costText }));
      list.appendChild(el('li', { class: 'info-card' + (booked ? ' is-booked' : '') }, [
        el('div', { class: 'bk-top' }, [
          body,
          el('label', { class: 'check', title: '예약 완료' }, [cb, el('span', { class: 'sr-only', text: '예약 완료: ' + s.title })]),
        ]),
        el('span', { class: 'badge ' + (booked ? 'b-booked' : 'b-reserve'), text: booked ? '예약완료 ✓' : '예약필요' }),
      ]));
    });
    $('bookingProgress').textContent = n + '/' + rows.length;

    var bookable = D.restaurants.filter(function (r) { return r.reservation.indexOf('예약 필수') === 0 || r.reservation.indexOf('예약 권장') === 0; }).length;
    var info = $('bookingFoodInfo');
    clear(info);
    info.appendChild(el('p', { class: 'small', style: 'margin:0', text: '식당예약방법 시트에서 ‘예약 필수/권장’ 식당은 ' + bookable + '곳입니다. (전체 ' + D.restaurants.length + '곳)' }));
    info.appendChild(el('button', { type: 'button', class: 'btn btn-small', id: 'gotoFoodBtn', text: '식당 탭에서 보기' }));
  }

  // ---------- 식당 ----------
  function reservationClass(r) {
    if (r.indexOf('예약 필수') === 0) return 'b-must';
    if (r.indexOf('예약 권장') === 0) return 'b-rec';
    return 'b-no';
  }
  function dl(pairs) {
    var d = el('dl');
    pairs.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || p[1] === '') return;
      d.appendChild(el('dt', { text: p[0] }));
      d.appendChild(typeof p[1] === 'string' ? el('dd', { text: p[1] }) : el('dd', null, p[1]));
    });
    return d;
  }
  function siteNode(text, links) { return appendLinked(el('span'), text, links); }

  function renderFood() {
    var f = state.foodFilter;
    Array.prototype.forEach.call(document.querySelectorAll('#foodFilters .filter'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-filter') === f ? 'true' : 'false');
    });
    var wrap = $('foodList');
    clear(wrap);
    var groups = [];
    var byDate = {};
    D.restaurants.forEach(function (r) {
      var walk = r.reservation.indexOf('예약 불가') === 0;
      if (f === 'bookable' && walk) return;
      if (f === 'walkin' && !walk) return;
      if (!byDate[r.dateLabel]) { byDate[r.dateLabel] = []; groups.push(r.dateLabel); }
      byDate[r.dateLabel].push(r);
    });
    groups.forEach(function (g) {
      wrap.appendChild(el('h3', { class: 'group-title', text: g }));
      var ul = el('ul', { class: 'card-list' });
      byDate[g].forEach(function (r) {
        ul.appendChild(el('li', { class: 'info-card', id: 'food-' + r.id }, [
          el('h3', null, [r.name, el('span', { class: 'badge ' + reservationClass(r.reservation), text: r.reservation })]),
          dl([
            ['시간대', r.meal],
            ['요리/특징', r.cuisine],
            ['예약 방법', r.method],
            ['웹사이트', siteNode(r.siteText, r.links)],
            ['비고', r.note],
          ]),
        ]));
      });
      wrap.appendChild(ul);
    });
    if (!groups.length) wrap.appendChild(el('p', { class: 'muted', text: '해당하는 식당이 없습니다.' }));
  }

  function gotoRestaurant(rid) {
    state.foodFilter = 'all';
    switchView('food');
    var card = $('food-' + rid);
    if (!card) return;
    scrollPageTo(card, stickyHeight());
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
    card.setAttribute('tabindex', '-1');
    card.focus({ preventScroll: true });
  }

  // ---------- 뮤지컬 / 골프 ----------
  function renderMusical() {
    var list = $('musicalList');
    clear(list);
    D.musicals.forEach(function (m) {
      list.appendChild(el('li', { class: 'info-card', id: 'mus-' + m.id }, [
        el('h3', null, [m.title, m.inSchedule ? el('span', { class: 'badge b-sched', text: '일정 후보' }) : null]),
        dl([
          ['장르/특징', m.genre],
          ['공연장', m.theatre],
          ['위치', m.area],
          ['러닝타임', m.runtime],
          ['공식 예매처', m.booking],
          ['웹사이트', siteNode(m.siteText, m.links)],
          ['비고', m.note],
        ]),
      ]));
    });
    var tips = $('musicalTips');
    clear(tips);
    D.musicalTips.forEach(function (t) { tips.appendChild(el('li', { text: t })); });
  }

  function renderGolf() {
    var list = $('golfList');
    clear(list);
    D.golf.forEach(function (g) {
      list.appendChild(el('li', { class: 'info-card', id: 'golf-' + g.id }, [
        el('h3', null, [g.name, g.inSchedule ? el('span', { class: 'badge b-sched', text: '일정 확정' }) : null]),
        dl([
          ['지역', g.region],
          ['코스 특징', g.feature],
          ['그린피(1인)', g.greenFee],
          ['예약 필요', g.reservation],
          ['예약 방법', g.method],
          ['웹사이트', siteNode(g.siteText, g.links)],
          ['이동수단', g.access],
          ['소요(편도)', g.travelTime],
          ['비고', g.note],
        ]),
      ]));
    });
    var notes = $('golfNotes');
    clear(notes);
    D.golfNotes.forEach(function (t) { notes.appendChild(el('li', { text: t })); });
  }

  function renderStatic() {
    var fn = $('foodNotes');
    clear(fn);
    D.restaurantNotes.forEach(function (t) { fn.appendChild(el('li', { text: t })); });
    renderMusical();
    renderGolf();
  }

  // ---------- 뷰 전환 ----------
  var VIEWS = ['schedule', 'booking', 'food', 'musical', 'golf'];
  function switchView(view, focus) {
    if (VIEWS.indexOf(view) < 0) view = 'schedule';
    state.view = view;
    Store.setLastView(view);
    VIEWS.forEach(function (v) {
      var tab = $('tab-' + v);
      var sel = v === view;
      tab.setAttribute('aria-selected', sel ? 'true' : 'false');
      tab.tabIndex = sel ? 0 : -1;
      if (sel && focus) tab.focus();
      $('panel-' + v).hidden = !sel;
    });
    $('dayTabs').hidden = view !== 'schedule';
    if (view === 'schedule') { renderSchedule(); renderTabWeather(); centerDayTab(); maybeSwipeHint(); }
    else if (view === 'booking') renderBooking();
    else if (view === 'food') renderFood();
    updateNowBtnSoon();
  }

  // ---------- 바텀시트(내 일정) ----------
  var editingId = null;
  var dialog = $('itemDialog');

  function openDialog(item) {
    editingId = item ? item.id : null;
    var info = dayInfo(item ? item.date : state.day);
    $('dialogTitle').textContent = item ? '내 일정 수정' : '내 일정 추가';
    $('dialogDate').textContent = 'Day ' + info.dayNo + ' · ' + info.label + ' (런던 시각)';
    $('fStart').value = item ? item.start : '';
    $('fEnd').value = item && item.end ? item.end : '';
    $('fTitle').value = item ? item.title : '';
    $('fTransport').value = item && item.transport ? item.transport : '';
    $('fCost').value = item && item.costText ? item.costText : '';
    $('fMemo').value = item ? Store.getMemo(item.id) : '';
    Array.prototype.forEach.call(dialog.querySelectorAll('input[name="type"]'), function (r) {
      r.checked = r.value === (item ? item.type : '활동');
    });
    $('formError').textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    $('fStart').focus();
  }
  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function submitDialog(e) {
    e.preventDefault();
    var start = $('fStart').value;
    var end = $('fEnd').value;
    var title = $('fTitle').value.trim();
    var typeEl = dialog.querySelector('input[name="type"]:checked');
    var err = $('formError');
    if (!title) { err.textContent = '내용을 입력하세요.'; $('fTitle').focus(); return; }
    if (!T.isTime(start)) { err.textContent = '시작 시간을 입력하세요.'; $('fStart').focus(); return; }
    if (end && !T.isTime(end)) { err.textContent = '종료 시간 형식이 올바르지 않습니다.'; $('fEnd').focus(); return; }
    if (end && T.toMin(end) < T.toMin(start)) {
      err.textContent = '종료 시간이 시작 시간보다 빠릅니다. 자정을 넘기는 일정은 저장할 수 없습니다.';
      $('fEnd').focus();
      return;
    }
    var fields = {
      date: state.day, start: start, end: end || null, type: typeEl ? typeEl.value : '활동',
      title: title, transport: $('fTransport').value, costText: $('fCost').value,
    };
    var saved = editingId ? Store.updateCustom(editingId, fields) : Store.addCustom(fields);
    if (!saved) { err.textContent = '저장하지 못했습니다. 입력값을 확인하세요.'; return; }
    Store.setMemo(saved.id, $('fMemo').value);
    closeDialog();
    renderSchedule();
    announce(editingId ? '일정을 수정했습니다.' : '내 일정을 추가했습니다.');
    var card = $('card-' + saved.id);
    if (card) {
      scrollPageTo(card, stickyHeight());
      var b = card.querySelector('[data-act="toggle"]');
      if (b) b.focus({ preventScroll: true });
    }
    editingId = null;
  }

  // ---------- 알림 패널 / 토스트 (spec 13.2) ----------
  function alarmWhen(e) {
    var tz = A.startTz(e.item);
    var f = T.format(e.at, tz);
    return f.md + ' ' + f.hhmm + (tz === 'Asia/Seoul' ? '(한국)' : '');
  }
  /** 다가오는 알림 목록용 한국 시각 보조 표기 ' (한국 23:30)' — 이미 한국 시각인 항목은 생략 (spec 15.1) */
  function kstHint(e) {
    if (A.startTz(e.item) === SEOUL) return '';
    return ' (한국 ' + T.format(e.at, SEOUL).hhmm + ')';
  }
  /** 설정·데이터 변경 후: 다시 예약하고 패널 갱신 */
  function alarmRefresh() {
    if (!A) return;
    A.reschedule();
    renderAlarmPanel();
  }
  /** 1분 타이머·탭 복귀: 울릴 알림 확인 */
  function alarmTick() {
    if (!A) return;
    A.check();
    renderAlarmPanel();
  }

  function renderAlarmPanel() {
    if (!A) return;
    var cfg = Store.getAlarm();
    var up = A.upcoming(5);
    var sum = $('alarmSummary');
    var onCount = Object.keys(cfg.items).length;
    if (!cfg.enabled) sum.textContent = '🔕 알림 꺼짐';
    else if (up.next.length) {
      var n = up.next[0];
      sum.textContent = '🔔 다음 알림 ' + alarmWhen(n) + ' · ' + n.item.title + ' (' + n.lead + '분 전)';
    } else sum.textContent = onCount ? '🔔 예정된 알림 없음' : '🔕 알림 꺼짐 (켠 항목 없음)';

    $('alarmEnabled').checked = cfg.enabled;
    $('alarmLead').value = String(cfg.lead);
    $('alarmSound').checked = cfg.sound;
    $('alarmVibrate').checked = cfg.vibrate;
    $('alarmVibrateRow').hidden = !A.canVibrate();

    var perm = $('alarmPerm');
    var p = A.permission();
    if (perm.getAttribute('data-perm') !== p) {
      perm.setAttribute('data-perm', p);
      clear(perm);
      var lbl = el('span', { text: '시스템 알림: ' });
      if (p === 'granted') perm.appendChild(el('p', null, [lbl, el('strong', { text: '허용됨' })]));
      else if (p === 'denied') perm.appendChild(el('p', null, [lbl, el('strong', { text: '거부됨' }), ' (브라우저 설정에서 변경) · 앱 안 알림(토스트)만 표시됩니다.']));
      else if (p === 'unsupported') perm.appendChild(el('p', null, [lbl, el('strong', { text: '미지원' }), ' · 앱 안 알림(토스트)만 표시됩니다.']));
      else if (p === 'iframe') {
        perm.appendChild(el('p', null, [lbl, el('strong', { text: 'iframe 안' }), ' · 앱 안 알림만 표시됩니다. 시스템 알림은 ',
          el('a', { href: './index.html', target: '_blank', rel: 'noopener', text: '새 창에서 열기 ↗' }), ' 후 사용하세요.']));
      } else {
        perm.appendChild(el('p', null, [lbl, '아직 허용하지 않음']));
        perm.appendChild(el('button', { type: 'button', class: 'btn btn-small', id: 'alarmPermBtn', text: '시스템 알림 허용' }));
      }
    }

    var ul = $('alarmUpcoming');
    clear(ul);
    var rows = up.missed.map(function (e) { return { e: e, missed: true }; })
      .concat(up.next.map(function (e) { return { e: e, missed: false }; }));
    if (!cfg.enabled) ul.appendChild(el('li', { class: 'muted small', text: '알림 사용이 꺼져 있습니다.' }));
    else if (!rows.length) ul.appendChild(el('li', { class: 'muted small', text: '다가오는 알림이 없습니다. 카드의 벨이나 위 버튼으로 켜세요.' }));
    rows.forEach(function (r) {
      var e = r.e;
      ul.appendChild(el('li', null, [el('button', { type: 'button', class: 'up-item', 'data-goto': e.item.id }, [
        r.missed ? el('span', { class: 'badge b-missed', text: '놓침' }) : null,
        el('span', { class: 'up-time', text: alarmWhen(e) + kstHint(e) }),
        el('span', { class: 'up-title', text: e.item.title }),
        el('span', { class: 'up-lead', text: e.lead + '분 전' }),
      ])]));
    });
  }

  function showToast(list) {
    var wrap = $('toastWrap');
    var now = T.now().getTime();
    var texts = list.map(function (e) { return A.describe(e, now).text; });
    var lines = el('ul', { class: 'toast-lines' });
    texts.slice(0, 3).forEach(function (t) { lines.appendChild(el('li', { text: t })); });
    if (texts.length > 3) lines.appendChild(el('li', { class: 'toast-more', text: '외 ' + (texts.length - 3) + '개' }));
    var firstId = list[0].item.id;
    var toast = el('div', { class: 'toast' }, [
      el('span', { class: 'toast-icon', 'aria-hidden': 'true', text: '🔔' }),
      lines,
      el('div', { class: 'toast-actions' }, [
        el('button', { type: 'button', class: 'btn btn-small btn-primary', 'data-toast': 'view', 'data-id': firstId, text: '보기' }),
        el('button', { type: 'button', class: 'btn btn-small', 'data-toast': 'close', text: '닫기' }),
      ]),
    ]);
    wrap.appendChild(toast);
    var toasts = wrap.querySelectorAll('.toast');
    for (var i = 0; i < toasts.length - 3; i++) wrap.removeChild(toasts[i]);
    var live = $('liveAlert');
    live.textContent = '';
    window.setTimeout(function () { live.textContent = '알림: ' + texts.join(', '); }, 50);
  }

  /** 항목으로 이동: 그 날 탭 → 카드 펼침 → 스크롤 */
  function gotoItem(id) {
    var it = A ? A.findItem(id) : null;
    if (!it || !dayInfo(it.date)) return;
    state.open[id] = true;
    markInteract(); // 알림·해시로 이동한 위치는 사용자 조작으로 간주(보류) — spec 14.6
    if (state.view !== 'schedule') switchView('schedule');
    selectDay(it.date);
    var card = $('card-' + id);
    if (!card) return; // 숨긴 항목
    window.requestAnimationFrame(function () {
      scrollPageTo(card, stickyHeight());
      flashCard(card);
      var b = card.querySelector('[data-act="toggle"]');
      if (b) b.focus({ preventScroll: true });
    });
  }

  function bulkEnable(kind) {
    if (!A) return;
    var res;
    if (kind === 'off') {
      if (!window.confirm('모든 항목의 알림을 끌까요?')) return;
      Store.clearAlarmItems();
      renderSchedule();
      announce('모든 알림을 껐습니다.');
      return;
    }
    if (kind === 'reserve') {
      var resv = {};
      D.schedule.forEach(function (s) { if (s.reservation) resv[s.id] = true; });
      res = A.enableWhere(function (it) { return resv[it.id] === true; });
    } else if (kind === 'move') {
      res = A.enableWhere(function (it) { return it.type === '이동' || it.type === '이동/활동'; });
    } else if (kind === 'day') {
      var day = state.day;
      res = A.enableWhere(function (it) { return it.date === day; });
    } else return;
    renderSchedule();
    announce('알림 ' + res.count + '개를 켰습니다.' + (res.past ? ' (이미 지난 일정 ' + res.past + '개는 울리지 않습니다)' : ''));
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportICS() {
    var r = document.querySelector('input[name="icsScope"]:checked');
    var scope = r ? r.value : 'alarms';
    var items = A.exportItems(scope, state.day, $('icsCustom').checked);
    var ics = A.buildICS(items);
    if (!ics.count) { window.alert('내보낼 일정이 없습니다.'); return; }
    var name = scope === 'alarms' ? 'london-trip-alarms.ics' : scope === 'day' ? 'london-trip-' + state.day + '.ics' : 'london-trip-all.ics';
    downloadBlob(new Blob([ics.text], { type: 'text/calendar;charset=utf-8' }), name);
    announce('캘린더 파일(' + ics.count + '개 일정)을 내보냈습니다.');
  }

  function bindAlarm() {
    if (!A) { $('alarmPanel').hidden = true; return; }
    var leadSel = $('alarmLead');
    A.LEADS.forEach(function (m) { leadSel.appendChild(el('option', { value: String(m), text: m + '분 전' })); });

    $('alarmEnabled').addEventListener('change', function (e) {
      Store.setAlarmGlobal({ enabled: e.target.checked });
      renderSchedule();
      alarmTick();
      announce(e.target.checked ? '알림을 사용합니다.' : '알림을 껐습니다. 항목 설정은 유지됩니다.');
    });
    leadSel.addEventListener('change', function (e) {
      Store.setAlarmGlobal({ lead: +e.target.value });
      renderAlarmPanel();
    });
    $('alarmSound').addEventListener('change', function (e) {
      if (e.target.checked) A.primeAudio();
      Store.setAlarmGlobal({ sound: e.target.checked });
    });
    $('alarmVibrate').addEventListener('change', function (e) {
      Store.setAlarmGlobal({ vibrate: e.target.checked });
    });
    $('alarmPanel').addEventListener('click', function (e) {
      var t = e.target;
      if (Store.getAlarm().sound) A.primeAudio();
      if (t.closest('#alarmPermBtn')) {
        A.requestPermission().then(function (p) {
          renderAlarmPanel();
          announce(p === 'granted' ? '시스템 알림을 허용했습니다.' : '시스템 알림이 허용되지 않았습니다. 앱 안 알림만 표시됩니다.');
        });
        return;
      }
      var b = t.closest('[data-bulk]');
      if (b) { bulkEnable(b.getAttribute('data-bulk')); return; }
      var g = t.closest('[data-goto]');
      if (g) { gotoItem(g.getAttribute('data-goto')); return; }
      if (t.closest('#icsBtn')) exportICS();
    });
    $('toastWrap').addEventListener('click', function (e) {
      var b = e.target.closest('[data-toast]');
      if (!b) return;
      var toast = b.closest('.toast');
      if (b.getAttribute('data-toast') === 'view') gotoItem(b.getAttribute('data-id'));
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    });

    A.init({
      onFire: function (list) { showToast(list); renderAlarmPanel(); },
      onOpen: function (id) { gotoItem(id); },
    });
  }

  // ---------- 내보내기 / 가져오기 ----------
  function exportData() {
    var data = Store.exportData();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var lt = londonInfo();
    var stamp = (lt ? lt.date : new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    downloadBlob(blob, 'london-trip-backup-' + stamp + '.json');
    announce('백업 파일을 내보냈습니다.');
  }
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result)); } catch (e) { obj = null; }
      var res = obj ? Store.importData(obj) : { ok: false, error: 'JSON 파일을 읽을 수 없습니다.' };
      if (!res.ok) { window.alert('가져오기 실패: ' + res.error); return; }
      syncPrefInputs();
      var c = res.counts;
      window.alert('가져오기 완료\n완료 ' + c.done + ' · 메모 ' + c.memo + ' · 내 일정 ' + c.custom + ' · 숨김 ' + c.hidden + ' · 예약완료 ' + c.booked + ' · 알림 ' + (c.alarm || 0) + ' · 자동완료 해제 ' + (c.undone || 0));
      switchView(state.view);
    };
    reader.onerror = function () { window.alert('파일을 읽지 못했습니다.'); };
    reader.readAsText(file);
  }

  // ---------- 표시 설정 스위치 / 사진 크게 보기 ----------
  function syncPrefInputs() {
    $('showKst').checked = prefs.kst;
    $('showImg').checked = prefs.img;
    $('autoDone').checked = Store.getAutoDone();
    $('weatherOn').checked = !!W && W.isOn();
    $('weatherOn').disabled = !W;
  }
  function bindPrefs() {
    syncPrefInputs();
    $('showKst').addEventListener('change', function (e) {
      prefs.kst = e.target.checked;
      writePref(PREF_KST, prefs.kst);
      renderSchedule();
      announce(prefs.kst ? '카드에 한국 시각을 표시합니다.' : '카드의 한국 시각 표시를 껐습니다.');
    });
    $('showImg').addEventListener('change', function (e) {
      prefs.img = e.target.checked;
      writePref(PREF_IMG, prefs.img);
      renderSchedule();
      announce(prefs.img ? '장소 사진을 표시합니다.' : '장소 사진 표시를 껐습니다.');
    });
    $('autoDone').addEventListener('change', function (e) {
      Store.setAutoDone(e.target.checked);
      refreshDone();
      alarmRefresh();
      announce(e.target.checked ? '시간이 지난 일정을 자동으로 완료 표시합니다.' : '자동 완료를 껐습니다. 직접 체크한 항목만 완료로 표시합니다.');
    });
    $('weatherOn').addEventListener('change', function (e) {
      if (!W) return;
      W.setOn(e.target.checked); // 켜면 TTL 검사 후 필요할 때만 요청, 끄면 요청 없음
      onWeatherUpdate();
      announce(e.target.checked ? '날씨 예보를 표시합니다.' : '날씨 예보 표시를 껐습니다.');
    });
  }
  function bindImgDialog() {
    if (!imgDlg) return;
    $('imgDialogClose').addEventListener('click', closeImg);
    imgDlg.addEventListener('close', onImgClosed);
    imgDlg.addEventListener('click', function (e) { if (e.target === imgDlg) closeImg(); }); // 배경 탭
    imgDlg.addEventListener('keydown', function (e) { // showModal 미지원 브라우저용 Esc
      if (e.key === 'Escape' && typeof imgDlg.showModal !== 'function') { e.preventDefault(); closeImg(); }
    });
  }

  // ---------- 일자 좌우 스와이프 (spec 16.2) ----------
  var SWIPE_LOCK = 10;          // 방향 판정 시작 이동량(px)
  var SWIPE_DIST = 60;          // 거리만으로 확정
  var SWIPE_MIN = 30;           // 속도 조건과 함께 확정
  var SWIPE_VEL = 0.5;          // px/ms
  var SWIPE_EDGE = 20;          // 화면 가장자리 시작 무시(iOS 뒤로가기)
  var SWIPE_MS = 180;           // 슬라이드 아웃/인 시간
  var SWIPE_IGNORE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog, #alarmPanel, .settings, #dayTabs';
  var PREF_SWIPE_HINT = 'london-trip:swipeHint';
  var sw = null;                // 진행 중 제스처
  var swPointers = 0;           // 화면에 닿아 있는 터치 포인터 수
  var swAnimating = false;
  var swSuppressClick = 0;      // 스와이프 직후 click 1회 억제 기한(ms, performance 기준 아님 → Date.now)

  function swipeTargets() { return [$('daySummary'), $('timeline')]; }
  function setSwipeX(x, ms) {
    swipeTargets().forEach(function (n) {
      if (!n) return;
      n.style.transition = ms ? 'transform ' + ms + 'ms ease-out, opacity ' + ms + 'ms ease-out' : 'none';
      n.style.transform = x ? 'translateX(' + x + 'px)' : '';
    });
  }
  function setSwipeOpacity(o) {
    swipeTargets().forEach(function (n) { if (n) n.style.opacity = o === 1 ? '' : String(o); });
  }
  function swipeReset(animate) {
    var reduce = autoBehavior() === 'auto';
    setSwipeX(0, animate && !reduce ? SWIPE_MS : 0);
    setSwipeOpacity(1);
    window.setTimeout(function () {
      if (sw || swAnimating) return;
      $('panel-schedule').classList.remove('is-swiping');
      setSwipeX(0, 0);
    }, animate && !reduce ? SWIPE_MS + 20 : 0);
  }
  function hasTextSelection() {
    try {
      var s = window.getSelection ? window.getSelection() : null;
      return !!(s && !s.isCollapsed && String(s).trim());
    } catch (e) { return false; }
  }
  function dayIndexOf(date) {
    for (var i = 0; i < DAYS.length; i++) if (DAYS[i].date === date) return i;
    return -1;
  }
  /** 날짜 변경 후 새 날짜 맨 위로 — 이미 그 위치보다 아래로 내려가 있을 때만 (spec 16.2 · D6) */
  function scrollToDayTop() {
    var panel = $('panel-schedule');
    var top = panel.getBoundingClientRect().top + window.pageYOffset - stickyHeight();
    if (window.pageYOffset > top + 1) scrollToY(Math.max(0, top), 'auto');
  }
  function commitSwipe(dir) {
    var idx = dayIndexOf(state.day) + dir;
    var info = DAYS[idx];
    var w = Math.max(160, $('panel-schedule').clientWidth);
    var finish = function () {
      selectDay(info.date);
      scrollToDayTop();
      announce('Day ' + info.dayNo + ' · ' + info.label);
    };
    if (autoBehavior() === 'auto') { // reduced-motion: 즉시 전환
      swAnimating = false;
      swipeReset(false);
      finish();
      return;
    }
    swAnimating = true;
    setSwipeX(-dir * w, SWIPE_MS);
    setSwipeOpacity(0);
    window.setTimeout(function () {
      finish();
      setSwipeX(dir * w * 0.5, 0);           // 반대편에서
      void $('timeline').offsetWidth;
      setSwipeX(0, SWIPE_MS);                // 슬라이드 인
      setSwipeOpacity(1);
      window.setTimeout(function () {
        swAnimating = false;
        swipeReset(false);
      }, SWIPE_MS + 20);
    }, SWIPE_MS);
  }

  function onSwipeDown(e) {
    if (e.pointerType !== 'touch') return; // 데스크톱 마우스 드래그 미지원 (D3)
    if (e.isPrimary) swPointers = 0; // 첫 손가락 = 화면에 다른 터치 없음 → 유실된 up/cancel로 카운터가 굳는 것 방지 (Review v5)
    swPointers++;
    if (sw) { // 두 번째 손가락: 이번 제스처 취소
      if (sw.lock === 'h') swipeReset(true);
      sw = null;
      return;
    }
    if (swPointers > 1 || swAnimating || state.view !== 'schedule') return;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    if (e.clientX < SWIPE_EDGE || e.clientX > vw - SWIPE_EDGE) return;
    var t = e.target;
    if (t && t.closest && t.closest(SWIPE_IGNORE)) return;
    if (t && t.isContentEditable) return;
    if (hasTextSelection()) return;
    sw = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, lock: null, samples: [{ x: e.clientX, t: e.timeStamp }] };
  }
  function onSwipeMove(e) {
    if (!sw || e.pointerId !== sw.id) return;
    var dx = e.clientX - sw.x0;
    var dy = e.clientY - sw.y0;
    sw.dx = dx;
    sw.samples.push({ x: e.clientX, t: e.timeStamp });
    if (sw.samples.length > 8) sw.samples.shift();
    if (!sw.lock) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_LOCK) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        sw.lock = 'h';
        markInteract(); // 14장 자동 이동 3분 보류
        $('panel-schedule').classList.add('is-swiping');
      } else {
        sw = null; // 세로 스크롤: 이번 제스처는 무시
        return;
      }
    }
    if (autoBehavior() === 'auto') return; // reduced-motion: 따라오기 없음
    var idx = dayIndexOf(state.day);
    var edge = (dx > 0 && idx <= 0) || (dx < 0 && idx >= DAYS.length - 1);
    setSwipeX(dx * (edge ? 0.15 : 0.4), 0);
  }
  function swipeVelocity(s, e) {
    var last = { x: e.clientX, t: e.timeStamp };
    var from = s.samples[0];
    for (var i = s.samples.length - 1; i >= 0; i--) {
      from = s.samples[i];
      if (last.t - s.samples[i].t >= 100) break;
    }
    var dt = last.t - from.t;
    return dt > 0 ? Math.abs(last.x - from.x) / dt : 0;
  }
  function onSwipeUp(e) {
    if (e.pointerType === 'touch') swPointers = Math.max(0, swPointers - 1);
    if (!sw || e.pointerId !== sw.id) return;
    var g = sw;
    sw = null;
    if (g.lock !== 'h') return; // 10px 미만: 일반 탭(카드 펼치기 클릭 유지)
    swSuppressClick = Date.now() + 400;
    var dx = e.clientX - g.x0;
    var adx = Math.abs(dx);
    var ok = adx >= SWIPE_DIST || (adx >= SWIPE_MIN && swipeVelocity(g, e) >= SWIPE_VEL);
    var dir = dx < 0 ? 1 : -1; // 왼쪽으로 밀면 다음 날
    var idx = dayIndexOf(state.day) + dir;
    if (!ok || idx < 0 || idx >= DAYS.length) { swipeReset(true); return; } // 미확정·경계: 원위치 (순환 없음, D2)
    commitSwipe(dir);
  }
  function onSwipeCancel(e) {
    if (e.pointerType === 'touch') swPointers = Math.max(0, swPointers - 1);
    if (!sw || e.pointerId !== sw.id) return;
    var wasH = sw.lock === 'h';
    sw = null;
    if (wasH) swipeReset(true);
  }
  function bindSwipe() {
    var panel = $('panel-schedule');
    var opt = { passive: true };
    panel.addEventListener('pointerdown', onSwipeDown, opt);
    panel.addEventListener('pointermove', onSwipeMove, opt);
    // 포인터가 패널 밖에서 떨어져도 정리되도록 window에서 받는다
    window.addEventListener('pointerup', onSwipeUp, opt);
    window.addEventListener('pointercancel', onSwipeCancel, opt);
    window.addEventListener('click', function (e) {
      if (!swSuppressClick) return;
      var live = Date.now() < swSuppressClick;
      swSuppressClick = 0;
      if (live) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }
  /** 첫 일정 뷰 진입 시 1회 안내 — 터치 기기만 (spec 16.2 · D5) */
  function maybeSwipeHint() {
    var coarse = false;
    try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { /* 무시 */ }
    if (!coarse) return;
    try {
      if (window.localStorage.getItem(PREF_SWIPE_HINT) === '1') return;
      window.localStorage.setItem(PREF_SWIPE_HINT, '1');
    } catch (e) { return; } // 저장 불가 환경에서는 매번 뜨지 않도록 표시하지 않음
    var wrap = $('toastWrap');
    var hint = el('div', { class: 'toast toast-hint', role: 'status' }, [el('span', { text: '← 좌우로 밀어 날짜 이동 →' })]);
    hint.addEventListener('click', function () { if (hint.parentNode) hint.parentNode.removeChild(hint); });
    wrap.appendChild(hint);
    window.setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 4000);
  }

  // ---------- 이벤트 ----------
  function tabKeys(e, selector, onPick) {
    var keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (keys.indexOf(e.key) < 0) return;
    var tabs = Array.prototype.slice.call(e.currentTarget.querySelectorAll(selector));
    var idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;
    e.preventDefault();
    var next = idx;
    if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    markInteract();
    onPick(tabs[next]);
  }

  function bind() {
    $('viewTabs').addEventListener('click', function (e) {
      var t = e.target.closest('[role="tab"]');
      if (t) switchView(t.getAttribute('data-view'));
    });
    $('viewTabs').addEventListener('keydown', function (e) {
      tabKeys(e, '[role="tab"]', function (t) { switchView(t.getAttribute('data-view'), true); });
    });
    $('dayTabs').addEventListener('click', function (e) {
      var t = e.target.closest('.day-tab');
      if (t) selectDay(t.getAttribute('data-date'));
    });
    $('dayTabs').addEventListener('keydown', function (e) {
      tabKeys(e, '.day-tab', function (t) { selectDay(t.getAttribute('data-date'), true); });
    });

    var tl = $('timeline');
    tl.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('input[type="checkbox"][data-id]')) {
        var id = t.getAttribute('data-id');
        var card = $('card-' + id);
        if (t.checked) {
          // 다시 체크 → 해제 기록 삭제 + 수동 완료 (spec 17.2)
          Store.setUndone(id, false);
          Store.setDone(id, true);
        } else {
          Store.setDone(id, false);
          // 시간이 지난 항목을 해제 → 다시 자동 체크되지 않도록 기록
          if (card && isPastItem(card._item)) Store.setUndone(id, true);
        }
        if (card) updateDoneUI(card);
        renderSummary();
        updateDayProgress();
        alarmRefresh();
      } else if (A && t.matches('select.alarm-lead')) {
        var aid = t.getAttribute('data-id');
        var lead = +t.value;
        var r = A.setItem(aid, true, lead);
        if (!r.ok) return;
        var li = $('card-' + aid);
        if (li) updateAlarmUI(li);
        alarmRefresh();
        announce(r.past ? '이미 지난 일정입니다. 알림이 울리지 않습니다.' : '알림을 ' + lead + '분 전으로 설정했습니다.');
      }
    });
    tl.addEventListener('click', function (e) {
      var t = e.target;
      var li = t.closest('.card');
      if (!li) return;
      var goto = t.closest('.goto-food');
      if (goto) { e.preventDefault(); gotoRestaurant(goto.getAttribute('data-rid')); return; }
      var act = t.closest('[data-act]');
      if (act) {
        var a = act.getAttribute('data-act');
        var it = li._item;
        if (a === 'toggle') toggleCard(li);
        else if (a === 'zoom') {
          var zp = placeOf(it);
          if (zp) openImg(zp, act);
        } else if (a === 'bell') {
          if (!A || !it.start) return;
          if (Store.getAlarm().sound) A.primeAudio();
          var on = !Store.isAlarmOn(it.id);
          var res = A.setItem(it.id, on);
          if (!res.ok) return;
          updateAlarmUI(li);
          var nb = li.querySelector('.bell');
          if (nb) nb.focus();
          alarmRefresh();
          if (!on) announce('‘' + it.title + '’ 알림을 껐습니다.');
          else if (res.past) announce('이미 지난 일정입니다. ‘' + it.title + '’ 알림은 울리지 않습니다.');
          else announce('‘' + it.title + '’ 알림을 켰습니다 (' + Store.alarmLead(it.id) + '분 전).' + (Store.getAlarm().enabled ? '' : ' 전역 알림 사용이 꺼져 있습니다.'));
        } else if (a === 'hide') {
          Store.setHidden(it.id, true);
          delete state.open[it.id];
          renderSchedule();
          announce('‘' + it.title + '’ 항목을 숨겼습니다. 아래 ‘숨긴 항목 보기’에서 다시 표시할 수 있습니다.');
        } else if (a === 'edit') {
          openDialog(Store.getCustom(it.id));
        } else if (a === 'delete') {
          if (window.confirm('‘' + it.title + '’ 일정을 삭제할까요?')) {
            Store.removeCustom(it.id);
            delete state.open[it.id];
            renderSchedule();
            announce('일정을 삭제했습니다.');
          }
        }
        return;
      }
      if (t.closest('a, button, input, textarea, label, select')) return;
      if (t.closest('.c-main')) toggleCard(li);
    });
    tl.addEventListener('input', function (e) {
      var t = e.target;
      if (!t.matches('textarea.memo')) return;
      var id = t.getAttribute('data-id');
      var status = t.parentNode.querySelector('.memo-status');
      status.textContent = '입력 중…';
      window.clearTimeout(memoTimers[id]);
      memoTimers[id] = window.setTimeout(function () {
        var had = !!Store.getMemo(id);
        Store.setMemo(id, t.value);
        status.textContent = Store.isPersistent() ? '저장됨' : '저장됨(이 탭에서만 유지)';
        var has = !!Store.getMemo(id);
        if (had !== has) {
          var card = $('card-' + id);
          if (card) fillBadges(card.querySelector('.c-badges'), card._item);
          applyLive(true);
        }
      }, 500);
    });

    $('hiddenToggle').addEventListener('click', function () {
      state.showHidden = !state.showHidden;
      renderHidden();
    });
    $('hiddenList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-unhide]');
      if (!b) return;
      Store.setHidden(b.getAttribute('data-unhide'), false);
      renderSchedule();
      announce('항목을 다시 표시했습니다.');
    });

    $('addBtn').addEventListener('click', function () { openDialog(null); });
    $('itemForm').addEventListener('submit', submitDialog);
    $('cancelBtn').addEventListener('click', function () { closeDialog(); editingId = null; });
    dialog.addEventListener('close', function () { editingId = null; });

    $('resetDayBtn').addEventListener('click', function () {
      var info = dayInfo(state.day);
      var autoNote = A && Store.getAutoDone() ? '\n(시간이 지난 일정은 자동 완료로 다시 표시됩니다)' : '';
      if (!window.confirm(info.label + '의 완료 체크를 모두 해제할까요?' + autoNote)) return;
      var ids = originalsOf(state.day).map(function (it) { return it.id; })
        .concat(Store.listCustom(state.day).map(function (c) { return c.id; }));
      Store.resetDone(ids);
      renderSchedule();
      announce(info.label + ' 완료 체크를 초기화했습니다.');
    });
    $('resetAllBtn').addEventListener('click', function () {
      if (!window.confirm('완료·메모·내 일정·숨김·예약 체크가 모두 삭제됩니다. 계속할까요?')) return;
      if (!window.confirm('정말 전체 초기화할까요? 되돌릴 수 없습니다. (원본 일정은 그대로 유지됩니다)')) return;
      Store.resetAll(); // 'london-trip:' 키 전체 삭제 → 표시 설정도 기본값(켬)으로 (날씨 캐시·토글 포함)
      prefs.kst = true;
      prefs.img = true;
      if (W) W.reset();
      syncPrefInputs();
      state.open = {};
      state.showHidden = false;
      switchView('schedule');
      if (W) W.refresh();
      announce('전체 초기화했습니다.');
    });
    $('exportBtn').addEventListener('click', exportData);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      e.target.value = '';
    });

    $('bookingList').addEventListener('change', function (e) {
      var t = e.target;
      if (!t.matches('input[data-book]')) return;
      Store.setBooked(t.getAttribute('data-book'), t.checked);
      renderBooking();
      var cb = $('bookingList').querySelector('input[data-book="' + t.getAttribute('data-book') + '"]');
      if (cb) cb.focus();
    });
    $('panel-booking').addEventListener('click', function (e) {
      if (e.target.closest('#gotoFoodBtn')) {
        state.foodFilter = 'bookable';
        switchView('food');
        scrollPageTo($('panel-food'), stickyHeight());
      }
    });
    $('foodFilters').addEventListener('click', function (e) {
      var b = e.target.closest('.filter');
      if (!b) return;
      state.foodFilter = b.getAttribute('data-filter');
      renderFood();
    });

    window.addEventListener('hashchange', function () {
      var d = parseHash();
      var item = parseHashItem();
      if (item) gotoItem(item);
      else if (d) { markInteract(); switchView('schedule'); selectDay(d); }
    });

    // 사용자 조작 감지 → 자동 이동 보류 (spec 14.3). 자동 스크롤의 scroll 이벤트는 세지 않는다.
    window.addEventListener('wheel', markInteract, { passive: true });
    window.addEventListener('touchmove', markInteract, { passive: true });
    window.addEventListener('keydown', function (e) {
      if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', ' ', 'End', 'Home'].indexOf(e.key) >= 0) markInteract();
    });
    var INTERACTIVE = 'button, a, input, select, textarea, label, summary, .card, [role="tab"]';
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || t.closest('#nowRow')) return;
      if (t.closest(INTERACTIVE)) markInteract();
    }, true);
    document.addEventListener('input', markInteract, true);
    document.addEventListener('change', markInteract, true);

    $('nowBtn').addEventListener('click', function () {
      state.lastInteract = 0;
      syncToNow('button');
    });
    window.addEventListener('scroll', updateNowBtnSoon, { passive: true });
    window.addEventListener('resize', updateNowBtnSoon);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        tick('return');
        if (W) W.refresh(); // 복귀 시에만 TTL 재검사 (1분 tick에서는 요청하지 않음)
      }
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) tick('return'); // bfcache 복귀
    });
    window.setInterval(function () { tick('timer'); }, 60000);
    bindPrefs();
    bindImgDialog();
    bindSwipe();
    bindAlarm();

    Store.onChange(function (what) { if (what === 'writeFailed') $('storageWarn').hidden = false; });
  }

  // '#day=2026-10-18' 또는 알림 클릭용 '#day=2026-10-18&item=r30'
  var HASH_RE = /^#day=(\d{4}-\d{2}-\d{2})(?:&item=([a-z0-9_]{1,30}))?$/;
  function parseHash() {
    var m = HASH_RE.exec(window.location.hash || '');
    return m && dayInfo(m[1]) ? m[1] : null;
  }
  function parseHashItem() {
    var m = HASH_RE.exec(window.location.hash || '');
    return m && m[2] && dayInfo(m[1]) ? m[2] : null;
  }

  // ---------- 시작 ----------
  function start() {
    try {
      if (window.self !== window.top) $('openNew').hidden = false;
    } catch (e) {
      $('openNew').hidden = false;
    }
    if (!Store.isPersistent()) $('storageWarn').hidden = false;

    // 초기 선택 (spec 14가 2.1 ②③을 대체): 해시 > 현재 위치 > (자동 이동 불가 시) lastDay > Day 1
    var hashDay = parseHash();
    var hashItem = parseHashItem();
    var tgt = currentTarget();
    state.day = hashDay || (tgt ? tgt.day : null) || Store.getLastDay() || FIRST;
    // lastView 복원은 여행 중에는 무시, 여행 전·후(및 자동 이동 불가)에는 유지 (spec 14.5)
    var view = hashDay || (tgt && tgt.phase === 'during') ? 'schedule' : (Store.getLastView() || 'schedule');

    renderStatic();
    renderTripTotal();
    renderDayTabs();
    bind();
    switchView(view);
    if (hashItem) { markInteract(); gotoItem(hashItem); }
    else if (hashDay) markInteract();
    else syncToNow('load');
    alarmTick();
    if (W) {
      W.onUpdate(onWeatherUpdate);
      W.refresh(); // 캐시는 이미 즉시 렌더됨. TTL 경과 & 온라인일 때만 백그라운드 요청
    }
  }

  // 개발·검증용: TripTime.now 고정 후 TripApp.tick('timer') 등으로 타이머 동작을 바로 확인
  window.TripApp = {
    tick: tick,
    syncToNow: syncToNow,
    currentTarget: currentTarget,
    HOLD_MIN: HOLD_MIN,
  };

  start();
})();
