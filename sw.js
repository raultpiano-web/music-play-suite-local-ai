/**
 * sw.js — Service Worker Offline-First v4.1
 * Music Play! Suite · E.M.M. Tordesillas
 * 
 * Responsabilidades:
 *   - Caché de recursos estáticos (HTML, CSS, JS)
 *   - Funcionamiento offline tras la primera visita
 *   - Los pesos del modelo WebLLM se gestionan internamente por Cache API
 */

const CACHE_VERSION = 'mps-v4.1';
const STATIC_CACHE = [
  '/',
  '/quiz_v4.html',
  '/feedback_v4.html',
  '/engine.js',
  '/storage.js',
  'https://cdn.tailwindcss.com'
];

// Instalación: Cachear recursos estáticos
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker v4.1...');
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW] Cacheando recursos estáticos...');
      return cache.addAll(STATIC_CACHE);
    })
  );
  self.skipWaiting();
});

// Activación: Limpiar cachés antiguas
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando Service Worker v4.1...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_VERSION && cacheName.startsWith('mps-')) {
            console.log('[SW] Eliminando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Estrategia Cache-First para recursos estáticos
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Ignorar requests de WebLLM (gestiona su propia caché)
  if (request.url.includes('huggingface.co') || request.url.includes('mlc-ai')) {
    return;
  }
  
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        console.log('[SW] Sirviendo desde caché:', request.url);
        return cached;
      }
      
      console.log('[SW] Descargando desde red:', request.url);
      return fetch(request).then((response) => {
        // Cachear dinámicamente solo recursos GET exitosos
        if (request.method === 'GET' && response.status === 200) {
          const clonedResponse = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(request, clonedResponse);
          });
        }
        return response;
      }).catch(() => {
        // Offline y sin caché: devolver página de error personalizada
        return new Response('Offline: Recurso no disponible en caché', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=UTF-8' })
        });
      });
    })
  );
});
