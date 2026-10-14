/* london-trip — 알림 표시 전용 최소 서비스 워커 (spec 13.6, A4)
 * - 앱(alarm.js)이 registration.showNotification()으로 알림을 띄울 수 있게 등록만 한다.
 * - 알림 클릭 시 열린 앱 창을 포커스하거나 새로 연다.
 * - fetch 가로채기·캐시·push 없음. 스코프: apps/london-trip/ */
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', function (event) {
  var data = event.notification.data || {};
  event.notification.close();
  var scope = self.registration.scope;
  var target = new URL(typeof data.url === 'string' ? data.url : 'index.html', scope).href;
  if (target.indexOf(scope) !== 0) target = scope; // 스코프 밖 주소는 열지 않음

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        // 블로그 iframe(nested) 안의 앱은 메시지를 받지 않으므로 최상위 창만 사용
        if (c.url.indexOf(scope) === 0 && c.frameType !== 'nested' && 'focus' in c) {
          c.postMessage({ type: 'lt-open', id: data.id, date: data.date });
          return c.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});
