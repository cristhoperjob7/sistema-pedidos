import { useEffect, useRef, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { Mensaje } from './ui'
import { avisar, sentir } from './feedback'
import { subirComprobante } from './imagenes'
import { estiloTono, fechaPlan, planBloqueado, planPro, usePlan } from './plan'
import { Corona } from './marca'
import './plan.css'

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

// Los datos para transferir los escribe el superadmin, una línea por dato: «Titular: Juan Pérez».
function leerDatos(texto) {
  return String(texto ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':')
      return i > 0 ? { etiqueta: l.slice(0, i).trim(), valor: l.slice(i + 1).trim() } : { etiqueta: '', valor: l }
    })
}

const DIAS_PERIODO = 30

// «Mi plan»: lo ve el administrador del local cuando el cobro está encendido (y el local no es piloto).
// Muestra su plan, los datos para transferir y 3 pasos simples para avisar que pagó (el monto ya viene fijo).
export default function MiPlan({ restaurante, plan }) {
  const [pagos, setPagos] = useState(null)
  const [operacion, setOperacion] = useState('')
  const [foto, setFoto] = useState(null)
  const [vista, setVista] = useState('')
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

  // Vista previa de la foto elegida.
  useEffect(() => {
    if (!foto) return setVista('')
    const url = URL.createObjectURL(foto)
    setVista(url)
    return () => URL.revokeObjectURL(url)
  }, [foto])

  if (!plan) return null
  const pro = planPro(plan)
  const malo = ['atrasado', 'moroso'].includes(plan.estado)
  const d = plan.dias ?? 0
  const usados = Math.max(0, Math.min(DIAS_PERIODO, DIAS_PERIODO - d))
  const datos = leerDatos(plan.datos_pago)
  const pendiente = (pagos ?? []).find((p) => p.estado === 'pendiente')
  const precio = Number(plan.precio) || 0

  async function copiar(texto, que) {
    try {
      await navigator.clipboard.writeText(texto)
      sentir('ok')
      avisar(`${que} copiado`)
    } catch {
      setError('No se pudo copiar. Puedes escribirlo a mano.')
    }
  }

  async function enviar(e) {
    e.preventDefault()
    setError('')
    const op = operacion.trim()
    if (op.length < 3) return setError('Escribe el número de operación que aparece en tu comprobante.')
    setEnviando(true)
    try {
      const ruta = foto ? await subirComprobante(restaurante.id, foto) : null
      const { error: err } = await supabase.rpc('informar_pago_plan', {
        p_restaurante: restaurante.id,
        p_operacion: op,
        p_monto: precio,
        p_foto: ruta,
      })
      if (err) {
        if (ruta) supabase.storage.from('comprobantes').remove([ruta]).catch(() => {})
        throw new Error(err.message)
      }
      sentir('ok')
      avisar('¡Listo! Te avisamos apenas revisemos tu pago.')
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

  const titulo = plan.estado === 'prueba' ? 'Prueba gratis' : 'ReSystem Pro'
  const linea =
    plan.estado === 'moroso'
      ? 'Tu plan venció: el sistema quedó solo para consultar.'
      : plan.estado === 'atrasado'
        ? `Venció el ${fechaPlan(plan.vence)}. Paga antes del ${fechaPlan(plan.bloqueo)} para no perder el acceso.`
        : plan.estado === 'prueba'
          ? `Tu prueba termina el ${fechaPlan(plan.vence)}`
          : `Renueva el ${fechaPlan(plan.vence)}`

  return (
    <div className="mp">
      <div>
        <h2 style={{ margin: 0 }}>Mi plan</h2>
        <small className="suave">Mesas, cocina, caja, carta QR y reportes, sin límite de usuarios.</small>
      </div>

      {/* Tarjeta del plan */}
      <section className={`mp-tarjeta${malo ? ' malo' : ''}`}>
        <div className="mp-fila">
          <span className="mp-plan">
            {pro || plan.estado === 'prueba' ? <Corona tam={20} /> : null}
            <span className={pro ? 'oro-texto' : undefined}>{titulo}</span>
          </span>
          <small className="suave">{linea}</small>
        </div>
        <div>
          <div className="mp-etq">Tu mensualidad</div>
          <div className="mp-monto">{pesos(precio)}</div>
        </div>
        {plan.estado !== 'moroso' && (
          <>
            <div className="mp-barra" aria-hidden="true">
              <i style={{ width: `${(usados / DIAS_PERIODO) * 100}%` }} />
            </div>
            <small className="suave">
              {d >= 0 ? `Quedan ${d} ${d === 1 ? 'día' : 'días'}` : `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}`}
            </small>
          </>
        )}
      </section>

      {pendiente ? (
        <section className="tarjeta mp-revision">
          <span className="mp-reloj" aria-hidden="true">
            <Icono n="reloj" tam={22} />
          </span>
          <div>
            <b>Estamos revisando tu pago</b>
            <p className="suave" style={{ margin: '4px 0 0' }}>
              Recibimos tu aviso de {pesos(pendiente.monto)} (operación {pendiente.operacion}). Normalmente queda listo el mismo día.
            </p>
          </div>
        </section>
      ) : (
        <form className="tarjeta mp-pasos" onSubmit={enviar}>
          {/* Paso 1 */}
          <div className="mp-paso">
            <span className="mp-num">1</span>
            <div className="mp-paso-in">
              <b>Transfiere {pesos(precio)}</b>
              <small className="suave">Desde la app de tu banco. Toca un dato para copiarlo.</small>
              {datos.length === 0 ? (
                <small className="suave">Pronto verás aquí los datos para transferir.</small>
              ) : (
                <>
                  <div className="mp-datos">
                    {datos.map((x, i) => (
                      <button type="button" key={i} className="mp-dato" onClick={() => copiar(x.valor, x.etiqueta || 'Dato')}>
                        {x.etiqueta && <small>{x.etiqueta}</small>}
                        <b>{x.valor}</b>
                        <span className="mp-copiar" aria-hidden="true">
                          <Icono n="copiar" tam={15} />
                        </span>
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-sec btn-chico" style={{ justifySelf: 'start' }} onClick={() => copiar(datos.map((x) => (x.etiqueta ? `${x.etiqueta}: ${x.valor}` : x.valor)).join('\n') + `\nMonto: ${pesos(precio)}`, 'Datos')}>
                    <Icono n="copiar" tam={15} className="it" /> Copiar todos los datos
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Paso 2 */}
          <div className="mp-paso">
            <span className="mp-num">2</span>
            <div className="mp-paso-in">
              <b>
                Sube el comprobante <small className="suave" style={{ fontWeight: 500 }}>(opcional)</small>
              </b>
              <input ref={archivo} id="mp-foto" type="file" accept="image/*" className="mp-oculto" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
              {foto ? (
                <div className="mp-elegida">
                  {vista && <img src={vista} alt="Comprobante elegido" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b className="mp-nombre">{foto.name}</b>
                    <small className="suave">Listo para enviar</small>
                  </div>
                  <button
                    type="button"
                    className="btn btn-chico btn-sec"
                    onClick={() => {
                      setFoto(null)
                      if (archivo.current) archivo.current.value = ''
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <label htmlFor="mp-foto" className="mp-subir">
                  <span className="mp-subir-ic">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                  </span>
                  <span>
                    <b>Toca para subir una foto o captura</b>
                    <small className="suave">Solo la vemos nosotros · se borra sola a los 60 días</small>
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Paso 3 */}
          <div className="mp-paso">
            <span className="mp-num">3</span>
            <div className="mp-paso-in">
              <label htmlFor="mp-op">
                <b>Escribe el número de operación</b>
              </label>
              <input id="mp-op" className="campo" autoComplete="off" maxLength={40} value={operacion} onChange={(e) => setOperacion(e.target.value)} placeholder="Aparece en tu comprobante · ej: 004412398" />
              <Mensaje tipo="error">{error}</Mensaje>
              <button className="mp-pagar" disabled={enviando}>
                {enviando ? <span className="puntos">Enviando</span> : <>Ya pagué · {pesos(precio)}</>}
              </button>
            </div>
          </div>
        </form>
      )}

      {pagos?.length > 0 && (
        <section className="tarjeta" style={{ display: 'grid', gap: 2 }}>
          <b style={{ marginBottom: 6 }}>Mis pagos</b>
          {pagos.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--linea)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {pesos(p.monto)} <small className="suave">· {fechaPlan(p.creado_en)}</small>
                </div>
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
