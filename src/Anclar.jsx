import { useEffect, useRef } from 'react'

// Se coloca dentro de una sección que aparece de golpe. Al mostrarse, la pantalla
// baja sola hasta esa sección (el elemento padre). No ocupa espacio ni se ve.
export default function Anclar({ block = 'nearest' }) {
  const ref = useRef(null)

  useEffect(() => {
    ref.current?.parentElement?.scrollIntoView({ behavior: 'smooth', block })
  }, [block])

  return <span ref={ref} style={{ display: 'none' }} />
}
