// 설치형 앱(PWA)용 최소 서비스 워커 — 파일은 캐시하지 않고 항상 네트워크에서 받는다 (게임 갱신이 바로 반영되게)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { e.respondWith(fetch(e.request)); });
