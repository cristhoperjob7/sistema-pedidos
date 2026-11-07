import { useSyncExternalStore } from 'react'
import Icono from './iconos'
import { sentir } from './feedback'

// Modo oscuro por defecto. Se recuerda en cada dispositivo (si el navegador deja guardarlo).
const CLAVE = 'tema'
const oyentes = new Set()

function leer() {
  try {
    return localStorage.getItem(CLAVE) === 'claro' ? 'claro' : 'oscuro'
  } catch {
    return 'oscuro'
  }
}

let actual = leer()

function aplicar() {
  document.documentElement.dataset.tema = actual
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    const f = getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim()
    meta.setAttribute('content', f || (actual === 'claro' ? '#f3f6fb' : '#0d131f'))
  }
}
aplicar()

export function elegirTema(t) {
  if (t === actual) return
  actual = t
  try {
    localStorage.setItem(CLAVE, t)
  } catch {
    /* sin almacenamiento: el cambio vale solo mientras la página está abierta */
  }
  aplicar()
  oyentes.forEach((f) => f())
}

export function useTema() {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f)
      return () => oyentes.delete(f)
    },
    () => actual,
  )
}

// Botón redondo para el encabezado: muestra el modo al que se cambiaría.
export function BotonTema() {
  const tema = useTema()
  const claro = tema === 'claro'
  return (
    <button
      className="btn btn-chico btn-icono-tema"
      aria-label={claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      title={claro ? 'Modo oscuro' : 'Modo claro'}
      onClick={() => {
        sentir('toque')
        elegirTema(claro ? 'oscuro' : 'claro')
      }}
    >
      <Icono n={claro ? 'luna' : 'sol'} tam={18} />
    </button>
  )
}

// Selector con las dos opciones a la vista (para el panel lateral).
export function SelectorTema() {
  const tema = useTema()
  return (
    <div className="selector-tema" role="group" aria-label="Modo de color">
      {[
        ['claro', 'Claro', 'sol'],
        ['oscuro', 'Oscuro', 'luna'],
      ].map(([id, texto, ic]) => (
        <button
          key={id}
          aria-pressed={tema === id}
          onClick={() => {
            if (tema !== id) sentir('toque')
            elegirTema(id)
          }}
        >
          <Icono n={ic} tam={15} />
          {texto}
        </button>
      ))}
    </div>
  )
}
