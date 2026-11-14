import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Estado del plan (cobro mensual) de un restaurante. Si falta paso35.sql o el cobro está apagado,
// devuelve null o { estado: 'libre' } y la app se comporta exactamente como antes.
export function usePlan(rid) {
  const [plan, setPlan] = useState(null)

  const cargar = useCallback(async () => {
    if (!rid) return
    const { data, error } = await supabase.rpc('estado_plan', { p_restaurante: rid })
    if (!error && data) setPlan(data)
  }, [rid])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 15 * 60 * 1000)
    const alVolver = () => document.visibilityState === 'visible' && cargar()
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('plan-cambio', cargar)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('plan-cambio', cargar)
    }
  }, [cargar])

  return plan
}

// El plan se muestra solo si el cobro está encendido y el local no es piloto.
export const planVisible = (p) => !!p && p.cobro_activo && !['libre', 'piloto'].includes(p.estado)
export const planBloqueado = (p) => planVisible(p) && p.estado === 'moroso'

export const ESTADOS_PLAN = {
  libre: { texto: 'Sin cobro', tono: 'info' },
  piloto: { texto: 'Piloto · gratis', tono: 'ok' },
  prueba: { texto: 'Prueba gratis', tono: 'info' },
  al_dia: { texto: 'Al día', tono: 'ok' },
  por_vencer: { texto: 'Por vencer', tono: 'aviso' },
  atrasado: { texto: 'Pago atrasado', tono: 'error' },
  moroso: { texto: 'Solo lectura', tono: 'error' },
}

const TONOS = {
  ok: { background: 'var(--menta)', color: 'var(--menta-tinta)' },
  info: { background: 'color-mix(in srgb, var(--marca) 18%, transparent)', color: 'var(--tinta)' },
  aviso: { background: 'var(--durazno)', color: 'var(--aviso-tinta)' },
  error: { background: 'var(--rosa)', color: 'var(--rosa-tinta)' },
}
export const estiloTono = (tono) => ({
  ...TONOS[tono ?? 'info'],
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 800,
  padding: '3px 10px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
})

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
// '2026-11-18' → '18 nov 2026'
export function fechaPlan(iso) {
  if (!iso) return '—'
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${d} ${MESES[m - 1]} ${a}`
}

// Frase corta para el aviso de arriba del panel (null = no mostrar aviso).
export function avisoPlan(p) {
  if (!planVisible(p)) return null
  const d = p.dias
  const cuando = d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`
  if (p.estado === 'prueba' && d <= 5) return { tono: 'aviso', texto: `Tu prueba gratis termina ${cuando}.` }
  if (p.estado === 'por_vencer') return { tono: 'aviso', texto: `Tu mensualidad vence ${cuando} (${fechaPlan(p.vence)}).` }
  if (p.estado === 'atrasado') return { tono: 'error', texto: `Tu mensualidad venció. El ${fechaPlan(p.bloqueo)} el sistema queda solo para consultar.` }
  if (p.estado === 'moroso') return { tono: 'error', texto: 'Tu plan está vencido: el sistema quedó solo para consultar. Paga para volver a usarlo.' }
  return null
}
