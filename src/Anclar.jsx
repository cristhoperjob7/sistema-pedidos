import { useEffect, useRef } from 'react'
import { DUR_PANEL } from './ui'

// Se coloca dentro de una sección que aparece. Al mostrarse, la pantalla baja sola (suave)
// hasta esa sección (el elemento padre). Espera a que el panel termine de abrirse para
// calcular bien la posición. No ocupa espacio ni se ve.
export default function Anclar({ block = 'nearest' }) {
  const ref = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.parentElement?.scrollIntoView({ behavior: 'smooth', block })
    }, DUR_PANEL * 0.6)
    return () => clearTimeout(t)
  }, [block])

  return <span ref={ref} style={{ display: 'none' }} />
}
