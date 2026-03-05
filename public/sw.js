const CACHE_NAME = 'static-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/css/main.css?v=1.0.0',
    '/images/placeholder.webp',
    '/images/favicon-32x32.png',
    'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter((cacheName) => cacheName !== CACHE_NAME)
                    .map((cacheName) => caches.delete(cacheName))
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).catch(err => {
                console.warn('[SW] Fetch failed:', event.request.url, err);
                // Return a fallback or just let it fail silently without uncaught promise
                return null;
            });
        })
    );
});
