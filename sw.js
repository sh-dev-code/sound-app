// 電波がなくてもアプリを使えるようにする仕組み（サービスワーカー）
//
// - 一度開いたら、アプリ本体と音声ファイルをスマホの中に保存しておく
// - アプリ本体（HTML・JS・CSS・一覧データ）は、つながるときは毎回新しいものを取りに行く。
//   こうすると、修正を公開したら次に開いたときから新しい版になる。つながらないときは保存したものを使う
// - 音声ファイルと画像は変わらないので、保存したものをそのまま使う

const CACHE = 'hooked-noise-v1';
// つながりが悪いときは、この秒数で見切りをつけて保存したものを使う
const NETWORK_TIMEOUT_MS = 3000;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'sounds.json',
  'css/style.css',
  'js/main.js',
  'js/images.js',
  'js/library.js',
  'js/noise.js',
  'js/player.js',
  'js/playlist-editor.js',
  'js/playlists.js',
  'js/ratings.js',
  'js/settings-view.js',
  'js/slideshow.js',
  'js/storage.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_FILES);
    // 音声ファイルの一覧は sounds.json から作る（音を足しても、このファイルを書き換えなくてよい）
    const library = await (await cache.match('sounds.json')).json();
    const files = library.sounds.filter((s) => s.type === 'file').map((s) => `sounds/${s.file}`);
    await Promise.all(files.map((f) => cache.add(f).catch(() => {})));
    await self.skipWaiting();
  })());
});

// 古い版で保存したものを片付ける
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const unchanging = /\/(sounds|icons)\//.test(url.pathname);
  event.respondWith(unchanging ? cacheFirst(request) : networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}
