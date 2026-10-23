import { useEffect, useState } from 'react'

// Campo de texto que se edita en el lugar y se guarda al salir de él (o con Enter).
// onGuardar(texto) puede devolver false si el valor no es válido: el campo vuelve al valor anterior.
export default function Campo({ valor, onGuardar, style, ...resto }) {
  const [v, setV] = useState(String(valor ?? ''))

  useEffect(() => {
    setV(String(valor ?? ''))
  }, [valor])

  async function confirmar() {
    if (v === String(valor ?? '')) return
    const ok = await onGuardar(v)
    if (ok === false) setV(String(valor ?? ''))
  }

  return (
    <input
      {...resto}
      value={v}
      style={style}
      onChange={(e) => setV(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur()
      }}
    />
  )
}
