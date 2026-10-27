import { useEffect, useRef, useState } from 'react'
import { escucharAvisos, movimientoReducido, sentir } from './feedback'

// Duración de abrir/cerrar paneles. Debe coincidir con --dur-panel en index.css.
export const DUR_PANEL = 320

// ---------------------------------------------------------------------------------------------
// Desplegable: muestra u oculta contenido creciendo/encogiéndose suave (nunca de golpe).
// El contenido se monta al abrir y se desmonta cuando termina de cerrarse.
export function Desplegable({ abierto, children, className = '', style }) {
  const [montado, setMontado] = useState(abierto)
  const [expandido, setExpandido] = useState(abierto)
  const [suelto, setSuelto] = useState(abierto) // abierto del todo: ya no recorta sombras

  useEffect(() => {
    if (abierto) {
      setMontado(true)
      let r2
      let t
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => {
          setExpandido(true)
          t = setTimeout(() => setSuelto(true), DUR_PANEL)
        })
      })
      return () => {
        cancelAnimationFrame(r1)
        cancelAnimationFrame(r2)
        clearTimeout(t)
      }
    }
    setSuelto(false)
    setExpandido(false)
    const t = setTimeout(() => setMontado(false), DUR_PANEL)
    return () => clearTimeout(t)
  }, [abierto])

  if (!montado) return null
  return (
    <div
      className={`desplegable${expandido ? ' abierto' : ''}${suelto ? ' suelto' : ''}`}
      aria-hidden={!abierto || undefined}
    >
      <div className={`desplegable-in ${className}`} style={style}>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Mensaje en línea (éxito o error). Entra suave; los errores además "tiemblan" un poco.
export function Mensaje({ tipo = 'ok', children }) {
  useEffect(() => {
    if (children && tipo === 'error') sentir('error')
  }, [children, tipo])
  if (!children) return null
  return (
    <p key={String(children)} className={`msj msj-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{tipo === 'error' ? '⚠️' : '✓'}</span>
      <span>{children}</span>
    </p>
  )
}

// ---------------------------------------------------------------------------------------------
// Avisos flotantes: píldoras que bajan desde arriba y se van solas. Se monta una vez en App.
const ICONOS = { ok: '✓', error: '⚠️', info: '•', cocina: '🍳', cobro: '💸', borrar: '🗑️', agotado: '🚫', listo: '🔔' }

export function Avisos() {
  const [lista, setLista] = useState([])

  useEffect(
    () =>
      escucharAvisos((a) => {
        setLista((l) => [...l.slice(-2), { ...a, saliendo: false }])
        setTimeout(() => setLista((l) => l.map((x) => (x.id === a.id ? { ...x, saliendo: true } : x))), 2400)
        setTimeout(() => setLista((l) => l.filter((x) => x.id !== a.id)), 2750)
      }),
    []
  )

  function cerrar(id) {
    setLista((l) => l.map((x) => (x.id === id ? { ...x, saliendo: true } : x)))
    setTimeout(() => setLista((l) => l.filter((x) => x.id !== id)), 350)
  }

  return (
    <div className="avisos" aria-live="polite">
      {lista.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`aviso aviso-${a.tipo}${a.saliendo ? ' saliendo' : ''}`}
          onClick={() => cerrar(a.id)}
        >
          <span className="aviso-icono" aria-hidden="true">
            {ICONOS[a.tipo] ?? '✓'}
          </span>
          {a.texto}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Esqueleto de carga: bloques pastel que "respiran" en vez de un texto "Cargando...".
export function Cargando({ filas = 3, alto = 56 }) {
  return (
    <div className="esqueleto" aria-label="Cargando" role="status">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esqueleto-bloque" style={{ height: alto, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Número que "cuenta" hasta su valor (de 0 al aparecer, y del valor anterior al cambiar).
export function NumeroAnimado({ valor, formato = (n) => String(Math.round(n)), duracion = 700 }) {
  const fin = Number(valor) || 0
  const [v, setV] = useState(movimientoReducido() ? fin : 0)
  const actual = useRef(movimientoReducido() ? fin : 0)

  useEffect(() => {
    const inicio = actual.current
    if (movimientoReducido() || inicio === fin) {
      actual.current = fin
      setV(fin)
      return
    }
    let raf
    const t0 = performance.now()
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / duracion)
      const x = inicio + (fin - inicio) * (1 - Math.pow(1 - p, 3))
      actual.current = x
      setV(p < 1 ? x : fin)
      if (p < 1) raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [fin, duracion])

  return <span className="numero">{formato(v)}</span>
}

// ---------------------------------------------------------------------------------------------
// Interruptor tipo iPhone (en vez de una casilla), con "clic" táctil y sonoro.
export function Interruptor({ checked, onChange, children, disabled, alerta = false }) {
  return (
    <label className={`interruptor${alerta ? ' interruptor-alerta' : ''}${disabled ? ' deshabilitado' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          sentir('toque', 'tic')
          onChange(e.target.checked)
        }}
      />
      <span className="interruptor-pista" aria-hidden="true">
        <span className="interruptor-bola" />
      </span>
      <span>{children}</span>
    </label>
  )
}

// ---------------------------------------------------------------------------------------------
// Selector segmentado con una "pastilla" que se desliza con rebote hasta la opción elegida.
export function Segmento({ opciones, valor, onChange, oscuro = false, etiqueta }) {
  const pos = Math.max(0, opciones.findIndex(([v]) => v === valor))
  return (
    <div
      className={`segmento${oscuro ? ' oscuro' : ''}`}
      style={{ '--n': opciones.length, '--pos': pos }}
      role="group"
      aria-label={etiqueta}
    >
      {opciones.map(([v, texto]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={v === valor}
          onClick={() => {
            if (v !== valor) sentir('toque', 'tic')
            onChange(v)
          }}
        >
          {texto}
        </button>
      ))}
    </div>
  )
}
