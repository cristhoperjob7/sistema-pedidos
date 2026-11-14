// ReSystem usa modo oscuro dentro del sistema. La carta QR que ven los clientes queda clara (se lee mejor de día).
const esCarta = () => /^\/c\//.test(location.pathname || '') || /^#\/carta\//.test(location.hash || '')
function aplicar() {
  const t = esCarta() ? 'claro' : 'oscuro'
  document.documentElement.dataset.tema = t
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t === 'claro' ? '#fafaf9' : '#0a0a0a')
}
aplicar()
window.addEventListener('hashchange', aplicar)
try {
  localStorage.removeItem('tema')
} catch {
  /* sin almacenamiento: no pasa nada */
}

export const useTema = () => document.documentElement.dataset.tema
export function BotonTema() {
  return null
}
export function SelectorTema() {
  return null
}
