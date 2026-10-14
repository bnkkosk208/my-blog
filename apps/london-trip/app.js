/* london-trip — 진입점: 상태, 렌더링, 이벤트, 라우팅, 1분 타이머 */
(function () {
  'use strict';

  var D = window.TRIP_DATA;
  var Store = window.TripStore;
  var T = window.TripTime;
  var A = window.TripAlarm || null; // 알림(v2). 없으면 알림 UI만 생략
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
    autoScrolled: {},    // 날짜별 자동 스크롤 1회
    userScrolled: false,
    lastLiveKey: '',
  };
  var memoTimers = {};

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
  function scrollPageTo(node, offset) {
    // iframe 안에서 부모 페이지까지 스크롤하지 않도록 scrollIntoView 대신 window.scrollTo 사용
    var top = node.getBoundingClientRect().top + window.pageYOffset - (offset || 0);
    window.scrollTo(0, Math.max(0, top));
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
  function hasDetails(it) {
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

  function renderHeader(lt) {
    var clock = $('clockChip');
    var phase = $('phaseChip');
    if (!lt) {
      clock.textContent = '런던 시각 확인 불가';
      phase.hidden = true;
      return;
    }
    clock.textContent = '런던 ' + lt.hhmm + (lt.zone ? ' ' + lt.zone : '');
    phase.hidden = false;
    if (lt.trip.phase === 'during') phase.textContent = '오늘: Day ' + (lt.trip.dayIndex + 1);
    else if (lt.trip.phase === 'before') phase.textContent = 'D-' + lt.trip.dDay;
    else phase.textContent = '여행 종료';
  }

  // ---------- 날짜 탭 ----------
  function dayProgress(date) {
    var items = itemsOf(date);
    var done = items.filter(function (it) { return Store.isDone(it.id); }).length;
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
      ]);
      wrap.appendChild(b);
    });
    markTodayTab(londonInfo());
    centerDayTab();
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
    if (Store.isDone(it.id)) cls += ' is-done';
    var open = !!state.open[it.id];
    if (open) cls += ' is-open';
    var detailId = 'detail-' + it.id;
    var tt = timeText(it);

    var timeEl = el('div', { class: 'c-time' }, [tt.main, tt.dur ? el('span', { class: 'dur', text: tt.dur, title: tt.title || null }) : null]);
    var badges = el('div', { class: 'c-badges' });
    fillBadges(badges, it);
    var main = el('div', { class: 'c-main' }, [
      timeEl,
      el('p', { class: 'c-title', text: it.title }),
      badges,
      it.costText ? el('p', { class: 'c-cost', text: '비용(1인) ' + it.costText }) : null,
    ]);

    var cb = el('input', { type: 'checkbox', 'data-id': it.id });
    cb.checked = Store.isDone(it.id);
    var check = el('label', { class: 'check', title: '완료 체크' }, [cb, el('span', { class: 'sr-only', text: '완료: ' + it.title })]);
    var side = el('div', { class: 'c-side' }, [check, A ? makeBell(it) : null]);

    var details = hasDetails(it);
    var toggle = el('button', {
      type: 'button', class: 'btn btn-small btn-toggle', 'data-act': 'toggle', 'aria-expanded': open ? 'true' : 'false',
      'aria-controls': detailId,
    });
    toggle.textContent = details ? (open ? '접기 ▾' : '펼치기 ▸') : (open ? '메모 닫기' : '메모');

    var li = el('li', { class: cls, id: 'card-' + it.id, 'data-id': it.id }, [
      el('div', { class: 'c-top' }, [main, side]),
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

  function buildDetail(box, it) {
    clear(box);
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
    var done = items.filter(function (it) { return Store.isDone(it.id); }).length;
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
    var target = null;
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
      if (!target) target = c;
    });
    if (st.next) {
      var n = $('card-' + st.next.id);
      if (n) {
        var nb = n.querySelector('.live-badge');
        nb.textContent = '다음 · ' + st.next.inMin + '분 후';
        nb.classList.add('b-next');
        target = target || n;
      }
    }
    var key = state.day + '|' + st.current.join(',');
    if (key !== state.lastLiveKey) {
      if (names.length && !fromRender) announce('지금 진행 중: ' + names.join(', '));
      state.lastLiveKey = key;
    }
    if (target && state.view === 'schedule' && !state.autoScrolled[state.day] && !state.userScrolled) {
      state.autoScrolled[state.day] = true;
      var t = target;
      window.requestAnimationFrame(function () { scrollPageTo(t, stickyHeight()); });
    }
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
    if (view === 'schedule') { renderSchedule(); centerDayTab(); }
    else if (view === 'booking') renderBooking();
    else if (view === 'food') renderFood();
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
        el('span', { class: 'up-time', text: alarmWhen(e) }),
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
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
    var live = $('liveAlert');
    live.textContent = '';
    window.setTimeout(function () { live.textContent = '알림: ' + texts.join(', '); }, 50);
  }

  /** 항목으로 이동: 그 날 탭 → 카드 펼침 → 스크롤 */
  function gotoItem(id) {
    var it = A ? A.findItem(id) : null;
    if (!it || !dayInfo(it.date)) return;
    state.open[id] = true;
    state.userScrolled = true;
    if (state.view !== 'schedule') switchView('schedule');
    selectDay(it.date);
    var card = $('card-' + id);
    if (!card) return; // 숨긴 항목
    window.requestAnimationFrame(function () {
      scrollPageTo(card, stickyHeight());
      card.classList.remove('flash');
      void card.offsetWidth;
      card.classList.add('flash');
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
      var c = res.counts;
      window.alert('가져오기 완료\n완료 ' + c.done + ' · 메모 ' + c.memo + ' · 내 일정 ' + c.custom + ' · 숨김 ' + c.hidden + ' · 예약완료 ' + c.booked + ' · 알림 ' + (c.alarm || 0));
      switchView(state.view);
    };
    reader.onerror = function () { window.alert('파일을 읽지 못했습니다.'); };
    reader.readAsText(file);
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
        Store.setDone(id, t.checked);
        var card = $('card-' + id);
        if (card) card.classList.toggle('is-done', t.checked);
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
        else if (a === 'bell') {
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
      if (!window.confirm(info.label + '의 완료 체크를 모두 해제할까요?')) return;
      var ids = originalsOf(state.day).map(function (it) { return it.id; })
        .concat(Store.listCustom(state.day).map(function (c) { return c.id; }));
      Store.resetDone(ids);
      renderSchedule();
      announce(info.label + ' 완료 체크를 초기화했습니다.');
    });
    $('resetAllBtn').addEventListener('click', function () {
      if (!window.confirm('완료·메모·내 일정·숨김·예약 체크가 모두 삭제됩니다. 계속할까요?')) return;
      if (!window.confirm('정말 전체 초기화할까요? 되돌릴 수 없습니다. (원본 일정은 그대로 유지됩니다)')) return;
      Store.resetAll();
      state.open = {};
      state.showHidden = false;
      switchView('schedule');
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
      else if (d) { switchView('schedule'); selectDay(d); }
    });

    var markScroll = function () { state.userScrolled = true; };
    window.addEventListener('wheel', markScroll, { passive: true });
    window.addEventListener('touchmove', markScroll, { passive: true });
    window.addEventListener('keydown', function (e) {
      if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', ' ', 'End', 'Home'].indexOf(e.key) >= 0) markScroll();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { applyLive(false); alarmTick(); }
    });
    window.setInterval(function () { applyLive(false); alarmTick(); }, 60000);
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

    var lt = londonInfo();
    var hashDay = parseHash();
    var initial = hashDay ||
      (lt && lt.trip.phase === 'during' ? lt.date : null) ||
      Store.getLastDay() ||
      FIRST;
    state.day = initial;

    var view = hashDay ? 'schedule' : (Store.getLastView() || 'schedule');

    renderStatic();
    renderTripTotal();
    renderDayTabs();
    bind();
    switchView(view);
    var hashItem = parseHashItem();
    if (hashItem) gotoItem(hashItem);
    alarmTick();
  }

  start();
})();
