import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icono from './iconos'
import { supabase } from './supabase'
import { Desplegable, Interruptor, Mensaje } from './ui'
import { avisar, sentir } from './feedback'
import { ESTADOS_PLAN, estiloTono, fechaPlan } from './plan'

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`

// Cobro a los restaurantes (solo superadmin). Viene APAGADO: mientras esté apagado, ningún local ve nada.
export default function CobroSuper() {
  const [abierto, setAbierto] = useState(false)
  const [datos, setDatos] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [error, setError] = useState('')
  const [falta, setFalta] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [verFoto, setVerFoto] = useState(null)
  const [manual, setManual] = useState(null) // { id, nombre, meses, monto }

  async function cargar() {
    const { data, error: err } = await supabase.rpc('cobro_panel')
    if (err) {
      if (/cobro_panel|function/i.test(err.message)) setFalta(true)
      else setError(err.message)
      return
    }
    setDatos(data)
    setCfg((c) => c ?? { ...data.config })
    // Fotos de comprobantes revisados hace más de 60 días: se borran del depósito y se olvida su ruta.
    const viejas = data.fotos_viejas ?? []
    if (viejas.length) {
      const { error: e2 } = await supabase.storage.from('comprobantes').remove(viejas.map((v) => v.foto))
      if (!e2) await supabase.rpc('olvidar_fotos_plan', { p_ids: viejas.map((v) => v.id) })
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  async function correr(clave, fn, ok) {
    setError('')
    setOcupado(clave)
    try {
      const { data, error: err } = await fn()
      if (err) throw new Error(err.message)
      sentir('ok')
      if (ok) avisar(typeof ok === 'function' ? ok(data) : ok)
      await cargar()
      return data
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado('')
    }
  }

  const guardarCfg = (activo = cfg.activo) =>
    correr(
      'cfg',
      () =>
        supabase.rpc('guardar_config_cobro', {
          p_activo: activo,
          p_precio: Number(cfg.precio) || 0,
          p_dias_prueba: Number(cfg.dias_prueba) || 0,
          p_dias_gracia: Number(cfg.dias_gracia) || 0,
          p_datos: cfg.datos_pago ?? '',
        }),
      activo ? 'Cobro guardado' : 'Cobro apagado'
    )

  async function resolver(p, aprobar) {
    const r = await correr(
      p.id,
      () => supabase.rpc('resolver_pago_plan', { p_id: p.id, p_aprobar: aprobar, p_motivo: null, p_meses: 1 }),
      (d) => (aprobar ? `Aprobado: ${p.nombre} queda pagado hasta el ${fechaPlan(d?.hasta)}` : 'Pago rechazado')
    )
    if (r?.foto) supabase.storage.from('comprobantes').remove([r.foto]).catch(() => {})
  }

  async function mirarFoto(p) {
    const { data, error: err } = await supabase.storage.from('comprobantes').createSignedUrl(p.foto, 300)
    if (err) return setError(err.message)
    setVerFoto(data.signedUrl)
  }

  const activo = !!datos?.config?.activo
  const pendientes = datos?.pendientes ?? []

  return (
    <section className="tarjeta" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        style={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
      >
        <Icono n="dinero" tam={20} />
        <b style={{ flex: 1, minWidth: 0 }}>Cobro a restaurantes</b>
        {pendientes.length > 0 && <span style={estiloTono('aviso')}>{pendientes.length} por revisar</span>}
        <span style={estiloTono(activo ? 'ok' : 'info')}>{falta ? 'Falta paso35' : activo ? 'Encendido' : 'Apagado'}</span>
        <span style={{ display: 'inline-flex', transform: `rotate(${abierto ? -90 : 90}deg)`, transition: 'transform .2s' }}><Icono n="siguiente" tam={18} /></span>
      </button>

      <Desplegable abierto={abierto} style={{ minWidth: 0 }}>
        {falta ? (
          <small className="suave">Ejecuta paso35_cobro_restaurantes.sql en Supabase para usar esta sección.</small>
        ) : !datos || !cfg ? (
          <small className="suave">Cargando…</small>
        ) : (
          <div style={{ display: 'grid', gap: 14, paddingTop: 4, minWidth: 0 }}>
            <Mensaje tipo="error">{error}</Mensaje>

            {/* Configuración */}
            <div style={{ display: 'grid', gap: 10 }}>
              <Interruptor checked={activo} disabled={ocupado === 'cfg'} alerta onChange={(v) => { setCfg((c) => ({ ...c, activo: v })); guardarCfg(v) }}>
                Cobrar a los restaurantes
              </Interruptor>
              <small className="suave">
                {activo
                  ? 'Los locales «normales» ven «Mi plan» y los avisos de vencimiento. Los «piloto» no ven nada.'
                  : 'Apagado: ningún local ve nada del cobro. Al encenderlo, los locales que nunca han pagado reciben su prueba gratis desde ese día.'}
              </small>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                <label className="etiqueta">Precio mes
                  <input className="campo" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }} inputMode="numeric" value={cfg.precio ?? ''} onChange={(e) => setCfg({ ...cfg, precio: e.target.value.replace(/\D/g, '') })} />
                </label>
                <label className="etiqueta">Días prueba
                  <input className="campo" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }} inputMode="numeric" value={cfg.dias_prueba ?? ''} onChange={(e) => setCfg({ ...cfg, dias_prueba: e.target.value.replace(/\D/g, '') })} />
                </label>
                <label className="etiqueta">Días gracia
                  <input className="campo" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }} inputMode="numeric" value={cfg.dias_gracia ?? ''} onChange={(e) => setCfg({ ...cfg, dias_gracia: e.target.value.replace(/\D/g, '') })} />
                </label>
              </div>
              <label className="etiqueta">Datos para transferir (los ve el administrador de cada local)
                <textarea className="campo" style={{ width: '100%', boxSizing: 'border-box' }} rows={4} maxLength={600} value={cfg.datos_pago ?? ''} onChange={(e) => setCfg({ ...cfg, datos_pago: e.target.value })} placeholder={'Banco Estado · Cuenta RUT\n12.345.678-9 · Tu nombre\ncorreo@ejemplo.cl'} />
              </label>
              <button className="btn btn-sec btn-chico" style={{ justifySelf: 'start' }} disabled={ocupado === 'cfg'} onClick={() => guardarCfg()}>
                Guardar precio y datos
              </button>
            </div>

            {/* Pagos por revisar */}
            <div style={{ display: 'grid', gap: 8 }}>
              <b>Pagos por revisar</b>
              {pendientes.length === 0 && <small className="suave">No hay pagos esperando revisión.</small>}
              {pendientes.map((p) => (
                <div key={p.id} className="tarjeta" style={{ display: 'grid', gap: 8, boxShadow: 'none' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <b style={{ flex: 1 }}>{p.nombre}</b>
                    <b>{pesos(p.monto)}</b>
                  </div>
                  <small className="suave">Operación <b>{p.operacion}</b> · informado el {fechaPlan(p.creado_en)}. Búscala en tu cartola antes de aprobar.</small>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {p.foto && (
                      <button className="btn btn-sec btn-chico" onClick={() => mirarFoto(p)}><Icono n="recibo" tam={16} className="it" /> Ver comprobante</button>
                    )}
                    <button className="btn btn-principal btn-chico" disabled={ocupado === p.id} onClick={() => resolver(p, true)}>Aprobar (1 mes)</button>
                    <button className="btn btn-sec btn-chico" disabled={ocupado === p.id} onClick={() => resolver(p, false)}>Rechazar</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Restaurantes */}
            <div style={{ display: 'grid', gap: 2 }}>
              <b style={{ marginBottom: 6 }}>Restaurantes</b>
              {datos.restaurantes.map((r) => {
                const est = ESTADOS_PLAN[r.estado] ?? ESTADOS_PLAN.libre
                const piloto = r.tipo === 'piloto'
                return (
                  <div key={r.id} style={{ display: 'grid', gap: 6, padding: '10px 0', borderTop: '1px solid var(--linea)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <b style={{ flex: 1, minWidth: 0 }}>{r.nombre}</b>
                      <span style={estiloTono(piloto ? 'ok' : est.tono)}>{piloto ? 'Piloto · gratis' : est.texto}</span>
                    </div>
                    {!piloto && (
                      <small className="suave">
                        {r.pagado_hasta ? `Pagado hasta ${fechaPlan(r.pagado_hasta)}` : 'Nunca ha pagado'}
                        {r.prueba_hasta ? ` · prueba hasta ${fechaPlan(r.prueba_hasta)}` : ''}
                      </small>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sec btn-chico" disabled={ocupado === r.id} onClick={() => correr(r.id, () => supabase.rpc('cambiar_plan', { p_rid: r.id, p_tipo: piloto ? 'normal' : 'piloto' }), piloto ? `${r.nombre} ahora paga normal` : `${r.nombre} queda como piloto (gratis)`)}>
                        {piloto ? 'Pasar a normal' : 'Marcar piloto'}
                      </button>
                      {!piloto && (
                        <>
                          <button className="btn btn-sec btn-chico" disabled={ocupado === r.id} onClick={() => correr(r.id, () => supabase.rpc('cambiar_plan', { p_rid: r.id, p_dias_prueba: 7 }), '7 días más de prueba')}>+7 días prueba</button>
                          <button className="btn btn-sec btn-chico" onClick={() => setManual({ id: r.id, nombre: r.nombre, meses: '1', monto: String(Math.round(datos.config.precio)), nota: '' })}>Registrar pago</button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {(datos.recientes ?? []).length > 0 && (
              <div style={{ display: 'grid', gap: 2 }}>
                <b style={{ marginBottom: 6 }}>Últimos pagos revisados</b>
                {datos.recientes.map((p) => (
                  <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--linea)', fontSize: 14 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{p.nombre} · {pesos(p.monto)} <small className="suave">{fechaPlan(p.resuelto_en)}</small></span>
                    <span style={estiloTono(p.estado === 'aprobado' ? 'ok' : 'error')}>{p.estado === 'aprobado' ? (p.manual ? 'A mano' : 'Aprobado') : 'Rechazado'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Desplegable>

      {manual && createPortal(
        <div className="hoja-velo funde" onClick={() => setManual(null)}>
          <div className="hoja sube" role="dialog" aria-modal="true" aria-label="Registrar pago" onClick={(e) => e.stopPropagation()}>
            <div className="hoja-cuerpo" style={{ display: 'grid', gap: 12, paddingBottom: 'calc(20px + var(--seguro-abajo, 0px))' }}>
              <b style={{ fontSize: 18 }}>Registrar pago de {manual.nombre}</b>
              <small className="suave">Para un pago que te llegó sin que lo informaran (efectivo, transferencia directa…).</small>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                <label className="etiqueta">Meses
                  <input className="campo" inputMode="numeric" value={manual.meses} onChange={(e) => setManual({ ...manual, meses: e.target.value.replace(/\D/g, '') })} />
                </label>
                <label className="etiqueta">Monto
                  <input className="campo" inputMode="numeric" value={manual.monto} onChange={(e) => setManual({ ...manual, monto: e.target.value.replace(/\D/g, '') })} />
                </label>
              </div>
              <label className="etiqueta">Nota (opcional)
                <input className="campo" maxLength={40} value={manual.nota} onChange={(e) => setManual({ ...manual, nota: e.target.value })} placeholder="Ej: efectivo" />
              </label>
              <button
                className="btn btn-principal"
                disabled={ocupado === 'manual'}
                onClick={async () => {
                  const m = manual
                  const r = await correr('manual', () => supabase.rpc('registrar_pago_plan', { p_rid: m.id, p_meses: Number(m.meses) || 1, p_monto: Number(m.monto) || 0, p_nota: m.nota }), (d) => `${m.nombre} queda pagado hasta el ${fechaPlan(d?.hasta)}`)
                  if (r) setManual(null)
                }}
              >
                Registrar
              </button>
              <button className="btn btn-sec" onClick={() => setManual(null)}>Cancelar</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {verFoto && createPortal(
        <div className="hoja-velo funde" style={{ zIndex: 95, display: 'grid', placeItems: 'center', padding: 16 }} onClick={() => setVerFoto(null)}>
          <img src={verFoto} alt="Comprobante" style={{ maxWidth: '100%', maxHeight: '86vh', borderRadius: 12, background: '#fff' }} />
        </div>,
        document.body
      )}
    </section>
  )
}
