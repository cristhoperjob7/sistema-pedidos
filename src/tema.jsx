// ReSystem tiene un solo diseño (claro). Este archivo solo fija el tema y el color de la barra del navegador.
document.documentElement.dataset.tema = 'claro'
const meta = document.querySelector('meta[name="theme-color"]')
if (meta) meta.setAttribute('content', '#fafaf9')
try {
  localStorage.removeItem('tema')
} catch {
  /* sin almacenamiento: no pasa nada */
}

export const useTema = () => 'claro'
export function BotonTema() {
  return null
}
export function SelectorTema() {
  return null
}
