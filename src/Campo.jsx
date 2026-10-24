import { useEffect, useState } from 'react'
import { sentir } from './feedback'

// Campo de texto que se edita en el lugar y se guarda al salir de él (o con Enter).
// onGuardar(texto) puede devolver false si el valor no es válido: el campo vuelve al valor anterior.
// Al guardar, el borde se pone menta un instante y aparece un ✓; si no se pudo, tiembla.
export default function Campo({ valor, onGuardar, style, className = 'campo', ...resto }) {
  const [v, setV] = useState(String(valor ?? ''))
  const [estado, setEstado] = useState(null) // { tipo: 'guardado' | 'invalido', n } para repetir la animación

  useEffect(() => {
    setV(String(valor ?? ''))
  }, [valor])

  async function confirmar() {
    if (v === String(valor ?? '')) return
    const ok = await onGuardar(v)
    if (ok === false) {
      setV(String(valor ?? ''))
      setEstado((e) => ({ tipo: 'invalido', n: (e?.n ?? 0) + 1 }))
    } else {
      sentir('toque', 'tic')
      setEstado((e) => ({ tipo: 'guardado', n: (e?.n ?? 0) + 1 }))
    }
  }

  const { flex, minWidth, width, ...estiloInput } = style ?? {}

  return (
    <span className="campo-envoltura" style={{ flex, minWidth, width }}>
      <input
        {...resto}
        key={estado?.n ?? 0}
        className={`${className}${estado ? ` ${estado.tipo}` : ''}`}
        value={v}
        style={{ ...estiloInput, width: '100%' }}
        onChange={(e) => setV(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
        }}
      />
      {estado?.tipo === 'guardado' && (
        <span key={estado.n} className="campo-check" aria-hidden="true">
          ✓
        </span>
      )}
    </span>
  )
}
