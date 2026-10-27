import { useEffect, useState } from 'react'

// Ayudas para "agotado hoy": un plato agotado vale solo por el día (en la zona horaria del
// restaurante) y vuelve solo al día siguiente.

// Fecha de hoy como "2026-10-26", igual a como llega la columna agotado_dia desde la base.
export function hoyEn(zona) {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: zona || 'America/Santiago' })
  } catch {
    return new Date().toLocaleDateString('en-CA')
  }
}

export function estaAgotado(producto, hoy) {
  return !!producto?.agotado_dia && producto.agotado_dia === hoy
}

// "Hoy" que se actualiza solo si la app queda abierta pasada la medianoche.
export function useHoy(zona) {
  const [hoy, setHoy] = useState(() => hoyEn(zona))
  useEffect(() => {
    setHoy(hoyEn(zona))
    const t = setInterval(() => setHoy(hoyEn(zona)), 60000)
    return () => clearInterval(t)
  }, [zona])
  return hoy
}

// Productos que ESTE equipo acaba de marcar: así no se avisa a sí mismo de lo que él mismo hizo.
const propios = new Map()

export function marcarPropio(id) {
  clearTimeout(propios.get(id))
  propios.set(
    id,
    setTimeout(() => propios.delete(id), 8000)
  )
}

export function esPropio(id) {
  return propios.has(id)
}
