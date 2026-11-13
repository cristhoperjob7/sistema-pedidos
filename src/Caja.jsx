import { useCallback, useEffect, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { formatear, leerPrecio, soloPrecio } from './moneda'
import { Cargando, Desplegable, Mensaje, Confirmar } from './ui'
import { avisar, sentir } from './feedback'
import { PinCaja } from './Turno'
import { abrirPDFCaja } from './pdfCaja'

const hoyEn = (zona) => new Date().toLocaleDateString('en-CA', { timeZone: zona || 'America/Santiago' })
const esEfectivo = (nombre) => /(efectivo|cash)/i.test(nombre ?? '')
const fechaLarga = (dia) =>
  new Date(dia + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
const mayus = (x) => x.charAt(0).toUpperCase() + x.slice(1)

// Cierre de caja: lo vendido en el día por método de pago, el efectivo que debería haber y la diferencia.
export default function Caja({ restaurante }) {
  const $ = (v) => formatear(v, restaurante)
  const hoy = hoyEn(restaurante.zona_horaria)
  const [dia, setDia] = useState(hoy)
  const [res, setRes] = useState(null)
  const [historial, setHistorial] = useState([])
  const [error, setError] = useState('')
  const [contado, setContado] = useState('')
  const [nota, setNota] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [reabrir, setReabrir] = useState(false)
  const [turnos, setTurnos] = useState([])
  const [cerrarTurno, setCerrarTurno] = useState(null)
  const [contadoTurno, setContadoTurno] = useState('')
  const [errTurno, setErrTurno] = useState('')

  const cargar = useCallback(async () => {
    const [r, h] = await Promise.all([
      supabase.rpc('resumen_caja', { p_restaurante: restaurante.id, p_dia: dia }),
      supabase.from('cierres_caja').select('id, dia, ventas_total, diferencia, efectivo_contado').eq('restaurante_id', restaurante.id).order('dia', { ascending: false }).limit(15),
    ])
    if (r.error) {
      setError(r.error.message)
      return
    }
    setError('')
    setRes(r.data)
    setHistorial(h.data ?? [])
    const [t, m] = await Promise.all([
      supabase.from('turnos_caja').select('*').eq('restaurante_id', restaurante.id).order('abierto_en', { ascending: false }).limit(60),
      supabase.from('miembros').select('usuario_id, nombre').eq('restaurante_id', restaurante.id),
    ])
    const nombres = Object.fromEntries((m.data ?? []).map((x) => [x.usuario_id, x.nombre]))
    const zona = restaurante.zona_horaria || 'America/Santiago'
    const dDe = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: zona })
    setTurnos(
      (t.data ?? [])
        .filter((x) => x.cerrado_en == null || dDe(x.abierto_en) === dia || dDe(x.cerrado_en) === dia)
        .map((x) => ({ ...x, nombre: nombres[x.usuario_id] ?? 'Sin nombre' }))
    )
  }, [restaurante.id, restaurante.zona_horaria, dia])

  useEffect(() => {
    setRes(null)
    setConfirmar(false)
    setReabrir(false)
    cargar()
  }, [cargar])

  if (!res) return <div style={{ display: 'grid', gap: 10 }}><Mensaje tipo="error">{error}</Mensaje>{!error && <Cargando filas={3} alto={72} />}</div>

  const metodos = res.metodos ?? []
  const cierre = res.cierre
  const ventas = metodos.reduce((n, m) => n + Number(m.ventas), 0)
  const propinas = metodos.reduce((n, m) => n + Number(m.propinas), 0)
  // Con pagos divididos una cuenta aparece en varios métodos: el total de cuentas viene aparte.
  const pedidos = res.pedidos != null ? Number(res.pedidos) : metodos.reduce((n, m) => n + Number(m.pedidos), 0)
  const efVentas = metodos.filter((m) => esEfectivo(m.nombre)).reduce((n, m) => n + Number(m.ventas) + Number(m.propinas), 0)
  // El fondo del día es el de la primera caja que se abrió ese día (no se escribe a mano).
  const zonaDia = restaurante.zona_horaria || 'America/Santiago'
  const primeraCaja = turnos
    .filter((x) => new Date(x.abierto_en).toLocaleDateString('en-CA', { timeZone: zonaDia }) === dia)
    .sort((a, b) => new Date(a.abierto_en) - new Date(b.abierto_en))[0]
  const fondoDia = primeraCaja ? Number(primeraCaja.fondo_inicial) : 0
  const hayTurnoAbierto = turnos.some((x) => x.cerrado_en == null)
  const fondoN = fondoDia
  const esperado = fondoN + efVentas
  const contadoN = contado === '' ? null : leerPrecio(contado, restaurante)
  const diferencia = contadoN == null ? null : contadoN - esperado

  function exportarPDF() {
    sentir('toque')
    const ok = abrirPDFCaja({ restaurante, dia, res, turnos, cierre })
    if (!ok) setError('El navegador bloqueó la ventana del PDF. Permite las ventanas emergentes e inténtalo de nuevo.')
  }

  async function cerrar() {
    setTrabajando(true)
    setError('')
    const { error } = await supabase.rpc('cerrar_caja', {
      p_restaurante: restaurante.id,
      p_dia: dia,
      p_fondo: fondoN,
      p_contado: contadoN,
      p_nota: nota,
    })
    setTrabajando(false)
    if (error) {
      setError(error.message)
      return
    }
    sentir('toque', 'exito')
    avisar(`Caja del ${fechaLarga(dia)} cerrada`, 'ok')
    setConfirmar(false)
    setContado('')
    setNota('')
    cargar()
  }

  async function cerrarTurnoAdmin() {
    const n = leerPrecio(contadoTurno, restaurante)
    if (contadoTurno === '' || n == null) return setErrTurno('Escribe el efectivo contado.')
    setTrabajando(true)
    setErrTurno('')
    const { error } = await supabase.rpc('cerrar_turno', { p_turno: cerrarTurno.id, p_contado: n, p_nota: 'Cerrado por administración' })
    setTrabajando(false)
    if (error) return setErrTurno(error.message)
    avisar('Turno cerrado', 'ok')
    setCerrarTurno(null)
    setContadoTurno('')
    cargar()
  }

  async function reabrirCaja() {
    setTrabajando(true)
    const { error } = await supabase.rpc('reabrir_caja', { p_cierre: cierre.id })
    setTrabajando(false)
    if (error) {
      setError(error.message)
      return
    }
    avisar('Caja reabierta', 'info')
    setReabrir(false)
    cargar()
  }

  const tarjeta = (titulo, valor, extra) => (
    <div style={s.kpi}>
      <small className="suave">{titulo}</small>
      <b style={{ fontSize: 22 }}>{valor}</b>
      {extra && <small className="suave">{extra}</small>}
    </div>
  )

  const colorDif = (d) => (d == null ? 'inherit' : Math.abs(d) < 0.005 ? 'var(--menta-tinta)' : 'var(--rosa-tinta)')
  const textoDif = (d) => (Math.abs(d) < 0.005 ? 'Cuadra perfecto' : d > 0 ? `Sobran ${$(d)}` : `Faltan ${$(-d)}`)

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Cierre de caja</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="campo-chico" type="date" value={dia} max={hoy} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Día" />
          <button className="btn btn-chico btn-sec" onClick={exportarPDF} title="Informe de una hoja para guardar como PDF">
            <Icono n="recibo" tam={15} className="it" /> Exportar PDF
          </button>
        </div>
      </div>
      <small className="suave">{mayus(fechaLarga(dia))}</small>
      <Mensaje tipo="error">{error}</Mensaje>

      {cierre && (
        <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--menta)', border: '1px solid var(--borde-menta)', color: 'var(--menta-tinta)', fontWeight: 800 }}>
          <Icono n="check" tam={15} className="it" /> Caja cerrada el {new Date(cierre.cerrado_en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: restaurante.zona_horaria })}
        </p>
      )}
      {!cierre && res.abiertos > 0 && (
        <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--durazno)', border: '1px solid var(--borde-aviso)', color: 'var(--aviso-tinta)', fontWeight: 700 }}>
          <Icono n="alerta" tam={15} className="it" /> Hay {res.abiertos} cuenta{res.abiertos === 1 ? '' : 's'} abierta{res.abiertos === 1 ? '' : 's'} de este día. Cóbralas o anúlalas para poder cerrar la caja.
        </p>
      )}

      {!cierre && hayTurnoAbierto && (
        <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--durazno)', border: '1px solid var(--borde-aviso)', color: 'var(--aviso-tinta)', fontWeight: 700 }}>
          <Icono n="alerta" tam={15} className="it" /> Hay cajas de meseras sin cerrar. Deben cerrarlas (o cerrarlas tú abajo) para poder cerrar el día.
        </p>
      )}

      <div style={s.kpis}>
        {tarjeta('Vendido', $(ventas), `${pedidos} pedido${pedidos === 1 ? '' : 's'}`)}
        {tarjeta('Propinas', $(propinas), 'aparte de lo vendido')}
        {Number(res.descuentos) > 0 && tarjeta('Descuentos', $(res.descuentos), `${res.n_descuentos} cuenta${Number(res.n_descuentos) === 1 ? '' : 's'}`)}
        {Number(res.anulado) > 0 && tarjeta('Anulado', $(res.anulado))}
      </div>

      <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <b>Cajas de las meseras</b>
        {turnos.length === 0 && <small className="suave">Nadie abrió caja este día.</small>}
        {turnos.map((x) => (
          <div key={x.id} style={{ display: 'grid', gap: 2, paddingTop: 8, borderTop: '1px solid var(--linea)' }}>
            <div style={s.fila}>
              <b>{x.nombre}</b>
              {x.cerrado_en == null ? (
                <button className="btn btn-sec btn-chico" onClick={() => { sentir('toque'); setCerrarTurno(x) }}>Cerrar caja</button>
              ) : (
                <small style={{ color: colorDif(Number(x.diferencia)), fontWeight: 800 }}>{textoDif(Number(x.diferencia))}</small>
              )}
            </div>
            <small className="suave">
              {new Date(x.abierto_en).toLocaleTimeString('es-CL', { timeStyle: 'short', timeZone: restaurante.zona_horaria })}
              {x.cerrado_en ? ` – ${new Date(x.cerrado_en).toLocaleTimeString('es-CL', { timeStyle: 'short', timeZone: restaurante.zona_horaria })}` : ' · abierta'}
              {' · fondo '}{$(x.fondo_inicial)}
              {x.cerrado_en ? ` · vendió ${$(x.ventas_total)} · contó ${$(x.efectivo_contado)}` : ''}
            </small>
          </div>
        ))}
        <Confirmar
          abierto={!!cerrarTurno}
          titulo={`Cerrar la caja de ${cerrarTurno?.nombre ?? ''}`}
          texto="Cuenta el efectivo de esa caja y escríbelo."
          textoConfirmar="Cerrar caja"
          peligro={false}
          trabajando={trabajando}
          error={errTurno}
          onCancelar={() => { setCerrarTurno(null); setErrTurno('') }}
          onConfirmar={cerrarTurnoAdmin}
        >
          <input className="campo-chico" inputMode="decimal" placeholder="Efectivo contado" value={contadoTurno} onChange={(e) => setContadoTurno(soloPrecio(e.target.value, restaurante))} />
        </Confirmar>
      </div>

      <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <b>Por método de pago</b>
        {metodos.length === 0 && <small className="suave">No hay métodos de pago.</small>}
        {metodos.map((m) => (
          <div key={m.id} style={s.fila}>
            <span style={{ fontWeight: 700 }}>{m.nombre}</span>
            <span style={{ textAlign: 'right' }}>
              <b>{$(m.ventas)}</b>
              <small className="suave" style={{ display: 'block' }}>
                {m.pedidos} pedido{m.pedidos === 1 ? '' : 's'}
                {Number(m.propinas) > 0 ? ` · propina ${$(m.propinas)}` : ''}
              </small>
            </span>
          </div>
        ))}
      </div>

      {cierre ? (
        <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 8 }}>
          <b>Efectivo</b>
          <div style={s.fila}><span>Fondo inicial</span><b>{$(cierre.fondo_inicial)}</b></div>
          <div style={s.fila}><span>Debería haber</span><b>{$(cierre.efectivo_esperado)}</b></div>
          <div style={s.fila}><span>Contado</span><b>{cierre.efectivo_contado == null ? 'No se contó' : $(cierre.efectivo_contado)}</b></div>
          {cierre.diferencia != null && (
            <div style={{ ...s.fila, color: colorDif(Number(cierre.diferencia)) }}>
              <b>Diferencia</b><b>{textoDif(Number(cierre.diferencia))}</b>
            </div>
          )}
          {cierre.nota && <small className="suave">Nota: {cierre.nota}</small>}
          <button className="btn btn-sec btn-chico" style={{ justifySelf: 'start' }} onClick={() => { sentir('toque'); setReabrir(true) }}>
            Reabrir caja
          </button>
          <Confirmar
            abierto={reabrir}
            titulo="¿Reabrir la caja de este día?"
            texto="Se borra este cierre para que puedas corregir y volver a cerrar. Las ventas no se tocan."
            textoConfirmar="Sí, reabrir"
            peligro={false}
            trabajando={trabajando}
            onCancelar={() => setReabrir(false)}
            onConfirmar={reabrirCaja}
          />
        </div>
      ) : (
        <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 12 }}>
          <b>Cerrar la caja</b>
          <div style={s.fila}>
            <span>
              <span style={{ fontWeight: 700 }}>Fondo inicial en efectivo</span>
              <small className="suave" style={{ display: 'block' }}>
                {primeraCaja ? `Lo anotó ${primeraCaja.nombre} al abrir su caja. No se puede cambiar.` : 'Nadie abrió caja este día.'}
              </small>
            </span>
            <b style={{ fontSize: 18 }}>{$(fondoDia)}</b>
          </div>
          <div style={s.fila}>
            <span>Efectivo que debería haber<small className="suave" style={{ display: 'block' }}>fondo + ventas y propinas en efectivo</small></span>
            <b style={{ fontSize: 18 }}>{$(esperado)}</b>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 700 }}>Efectivo contado (opcional)</span>
            <input className="campo-chico" inputMode="decimal" placeholder="Lo que hay en la caja" value={contado} onChange={(e) => setContado(soloPrecio(e.target.value, restaurante))} />
          </label>
          {diferencia != null && (
            <p className="aparece" style={{ margin: 0, fontWeight: 800, color: colorDif(diferencia) }}>
              {Math.abs(diferencia) < 0.005 ? <><Icono n="check" tam={15} className="it" /></> : <><Icono n="alerta" tam={15} className="it" /></>}{textoDif(diferencia)}
            </p>
          )}
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 700 }}>Nota (opcional)</span>
            <input className="campo-chico" maxLength={500} placeholder="Ej: se dio vuelto de más en la mesa 4" value={nota} onChange={(e) => setNota(e.target.value)} />
          </label>
          <button className="btn btn-principal" disabled={res.abiertos > 0 || hayTurnoAbierto || trabajando} onClick={() => { sentir('toque'); setConfirmar(true) }}>
            Cerrar caja del día
          </button>
          <Confirmar
            abierto={confirmar}
            titulo={`¿Cerrar la caja del ${fechaLarga(dia)}?`}
            texto={`Se cierra el día con ${$(ventas)} vendidos. Después podrás reabrirla si algo estaba mal.`}
            textoConfirmar="Sí, cerrar"
            peligro={false}
            trabajando={trabajando}
            error={error}
            onCancelar={() => setConfirmar(false)}
            onConfirmar={cerrar}
          />
        </div>
      )}

      <PinCaja restaurante={restaurante} />

      {historial.length > 0 && (
        <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 4 }}>
          <b style={{ marginBottom: 4 }}>Cierres anteriores</b>
          {historial.map((c) => (
            <button key={c.id} onClick={() => { sentir('toque'); setDia(c.dia) }} style={s.hist} aria-label={`Ver cierre del ${c.dia}`}>
              <span style={{ textTransform: 'capitalize' }}>{new Date(c.dia + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <b>{$(c.ventas_total)}</b>
              <small style={{ color: colorDif(c.diferencia == null ? null : Number(c.diferencia)), minWidth: 90, textAlign: 'right' }}>
                {c.diferencia == null ? 'sin contar' : textoDif(Number(c.diferencia))}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const s = {
  kpis: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  kpi: { display: 'grid', gap: 2, padding: 12, borderRadius: 16, background: 'var(--sup)', border: '1px solid var(--linea)' },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  hist: { all: 'unset', boxSizing: 'border-box', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 4px', borderTop: '1px solid var(--linea)', cursor: 'pointer' },
}
