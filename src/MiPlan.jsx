import { useEffect, useRef, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { Mensaje } from './ui'
import { avisar, sentir } from './feedback'
import { subirComprobante } from './imagenes'
import { ESTADOS_PLAN, estiloTono, fechaPlan, planBloqueado, usePlan } from './plan'

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`

// Para meseras y cocina: si el plan del local quedó en solo lectura, se muestra un aviso en vez de la operación.
export function BloqueoPlan({ restaurante, children }) {
  const plan = usePlan(restaurante?.id)
  if (!planBloqueado(plan)) return children
  return (
    <div className="vacio aparece">
      <span className="vacio-icono"><Icono n="candado" tam={34} ancho={1.5} /></span>
      <b>El sistema de {restaurante.nombre} está pausado</b>
      <span>El plan mensual venció. Avísale al administrador del local: apenas pague, vuelve a funcionar.</span>
    </div>
  )
}

// «Mi plan»: lo ve el administrador del local cuando el cobro está encendido (y el local no es piloto).
// Muestra cuánto le queda, los datos para transferir y un formulario para informar el pago.
export default function MiPlan({ restaurante, plan }) {
  const [pagos, setPagos] = useState(null)
  const [operacion, setOperacion] = useState('')
  const [monto, setMonto] = useState('')
  const [foto, setFoto] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const archivo = useRef(null)

  async function cargarPagos() {
    const { data } = await supabase
      .from('pagos_plan')
      .select('id, monto, operacion, estado, motivo, meses, cubre_hasta, manual, creado_en')
      .eq('restaurante_id', restaurante.id)
      .order('creado_en', { ascending: false })
      .limit(12)
    setPagos(data ?? [])
  }

  useEffect(() => {
    cargarPagos()
  }, [restaurante.id])

  useEffect(() => {
    if (plan?.precio && !monto) setMonto(String(Math.round(plan.precio)))
  }, [plan?.precio])

  if (!plan) return null
  const est = ESTADOS_PLAN[plan.estado] ?? ESTADOS_PLAN.libre
  const d = plan.dias
  const pendiente = (pagos ?? []).find((p) => p.estado === 'pendiente')

  async function copiar() {
    try {
      await navigator.clipboard.writeText(plan.datos_pago ?? '')
      sentir('ok')
      avisar('Datos copiados')
    } catch {
      setError('No se pudo copiar. Puedes escribirlos a mano.')
    }
  }

  async function enviar(e) {
    e.preventDefault()
    setError('')
    const op = operacion.trim()
    const m = Number(String(monto).replace(/\D/g, ''))
    if (op.length < 3) return setError('Escribe el número de operación que aparece en tu comprobante.')
    if (!m) return setError('Escribe el monto que transferiste.')
    setEnviando(true)
    try {
      const ruta = foto ? await subirComprobante(restaurante.id, foto) : null
      const { error: err } = await supabase.rpc('informar_pago_plan', {
        p_restaurante: restaurante.id,
        p_operacion: op,
        p_monto: m,
        p_foto: ruta,
      })
      if (err) {
        if (ruta) supabase.storage.from('comprobantes').remove([ruta]).catch(() => {})
        throw new Error(err.message)
      }
      sentir('ok')
      avisar('Pago informado. Te avisaremos cuando esté revisado.')
      setOperacion('')
      setFoto(null)
      if (archivo.current) archivo.current.value = ''
      await cargarPagos()
      window.dispatchEvent(new Event('plan-cambio'))
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0 }}>Mi plan</h2>
        <small className="suave">Plan mensual del sistema: mesas, cocina, caja, carta QR y reportes.</small>
      </div>

      <section className="tarjeta" style={{ display: 'grid', gap: 8 }}>
        <span style={{ ...estiloTono(est.tono), justifySelf: 'start' }}>{est.texto}</span>
        <b style={{ fontSize: 26, lineHeight: 1.15 }}>
          {plan.estado === 'moroso'
            ? 'Solo para consultar'
            : d == null
              ? '—'
              : d < 0
                ? `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}`
                : d === 0
                  ? 'Vence hoy'
                  : `Quedan ${d} ${d === 1 ? 'día' : 'días'}`}
        </b>
        <small className="suave">
          {plan.estado === 'prueba' && `Tu prueba gratis termina el ${fechaPlan(plan.vence)}.`}
          {['al_dia', 'por_vencer'].includes(plan.estado) && `Pagado hasta el ${fechaPlan(plan.vence)}.`}
          {plan.estado === 'atrasado' && `Venció el ${fechaPlan(plan.vence)}. Desde el ${fechaPlan(plan.bloqueo)} el sistema queda solo para consultar.`}
          {plan.estado === 'moroso' && 'Tus datos están guardados. Ves el historial y los reportes, pero no puedes tomar pedidos hasta pagar.'}
        </small>
      </section>

      <section className="tarjeta" style={{ display: 'grid', gap: 10 }}>
        <small className="suave">Plan Restaurante</small>
        <b style={{ fontSize: 26 }}>
          {pesos(plan.precio)} <small className="suave" style={{ fontSize: 14 }}>/ mes</small>
        </b>
        {plan.datos_pago ? (
          <>
            <small className="suave">Transfiere a:</small>
            <p style={{ margin: 0, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{plan.datos_pago}</p>
            <button type="button" className="btn btn-sec btn-chico" style={{ justifySelf: 'start' }} onClick={copiar}>
              <Icono n="copiar" tam={16} className="it" /> Copiar datos
            </button>
          </>
        ) : (
          <small className="suave">Pronto verás aquí los datos para transferir.</small>
        )}
      </section>

      <section className="tarjeta" style={{ display: 'grid', gap: 12 }}>
        <b>Informar mi pago</b>
        {pendiente ? (
          <p className="msj" style={{ margin: 0, background: 'var(--durazno)', color: 'var(--aviso-tinta)' }}>
            Recibimos tu pago de {pesos(pendiente.monto)} (operación {pendiente.operacion}). Lo estamos revisando; normalmente queda listo el mismo día.
          </p>
        ) : (
          <form onSubmit={enviar} style={{ display: 'grid', gap: 12 }}>
            <label className="etiqueta">
              Número de operación
              <input className="campo" inputMode="text" autoComplete="off" maxLength={40} value={operacion} onChange={(e) => setOperacion(e.target.value)} placeholder="Aparece en tu comprobante" />
            </label>
            <label className="etiqueta">
              Monto transferido
              <input className="campo" inputMode="numeric" maxLength={10} value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="etiqueta">
              <span>Foto del comprobante <small className="suave" style={{ fontWeight: 500 }}>(opcional)</small></span>
              <input ref={archivo} type="file" accept="image/*" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
              <small className="suave" style={{ fontWeight: 500 }}>Solo la vemos nosotros y se borra sola a los 60 días.</small>
            </label>
            <Mensaje tipo="error">{error}</Mensaje>
            <button className="btn btn-principal" disabled={enviando}>
              {enviando ? <span className="puntos">Enviando</span> : 'Informar pago'}
            </button>
          </form>
        )}
      </section>

      {pagos?.length > 0 && (
        <section className="tarjeta" style={{ display: 'grid', gap: 2 }}>
          <b style={{ marginBottom: 6 }}>Mis pagos</b>
          {pagos.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--linea)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{pesos(p.monto)} <small className="suave">· {fechaPlan(p.creado_en)}</small></div>
                <small className="suave">
                  {p.estado === 'aprobado' && `Cubre hasta el ${fechaPlan(p.cubre_hasta)}`}
                  {p.estado === 'pendiente' && `Operación ${p.operacion}`}
                  {p.estado === 'rechazado' && (p.motivo || 'No encontramos esta transferencia.')}
                </small>
              </div>
              <span style={estiloTono(p.estado === 'aprobado' ? 'ok' : p.estado === 'pendiente' ? 'aviso' : 'error')}>
                {p.estado === 'aprobado' ? 'Aprobado' : p.estado === 'pendiente' ? 'En revisión' : 'Rechazado'}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
