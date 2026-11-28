// 앱 화면은 오프라인에서도 열리도록 캐시, API 요청은 항상 네트워크 사용
const CACHE = 'review-v2';
const ASSETS = ['/', '/style.css', '/app.js', '/config.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/herb')) return;
  // 네트워크 우선, 실패 시 캐시 (질문/문구 수정이 바로 반영되도록)
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});

// 직원용 한약 진행 푸시 알림
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: '한약 진행', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '한약 진행', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/herb' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/herb';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => new URL(x.url).pathname.startsWith('/herb'));
    return c ? c.focus() : self.clients.openWindow(url);
  }));
});
