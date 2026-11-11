// Service worker mínimo: hace la app instalable y muestra una pantalla amable si no hay internet.
// No guarda datos de Supabase ni respuestas de la API (los pedidos siempre deben ser en vivo).
const VERSION = 'v1'
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#241529;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div><h1 style="font-size:22px;margin:0 0 8px">Sin conexión</h1><p style="opacity:.8;margin:0 0 18px">Revisa tu internet. Los pedidos necesitan conexión para sincronizarse.</p>
<button onclick="location.reload()" style="border:0;border-radius:12px;padding:12px 20px;font-size:16px;font-weight:700">Reintentar</button></div>`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const r = e.request
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
  }
})
