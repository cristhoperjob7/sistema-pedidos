// Sin zoom: la pantalla se queda en su lugar (pellizcar, doble toque, zoom al escribir).
// Se importa una sola vez desde App.jsx y vale para todo el sistema.

const VISTA = 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover'

function fijarVista() {
  let meta = document.querySelector('meta[name="viewport"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'viewport'
    document.head.appendChild(meta)
  }
  if (meta.content !== VISTA) meta.content = VISTA
}

if (typeof window !== 'undefined' && !window.__sinZoom) {
  window.__sinZoom = true
  fijarVista()
  const opc = { passive: false }
  // iPhone: el pellizco llega como "gesture" aunque el viewport diga que no.
  for (const nombre of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(nombre, (e) => e.preventDefault(), opc)
  }
  // Dos dedos sobre la pantalla: no se hace zoom (con un dedo todo se mueve normal).
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, opc)
  // Computador: Ctrl + rueda o pellizco del panel táctil.
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault() }, opc)
}
