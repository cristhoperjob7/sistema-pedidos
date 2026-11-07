import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { formatear, leerPrecio, soloPrecio } from './moneda'
import { Cargando, Desplegable, Mensaje, Confirmar } from './ui'
import { avisar, sentir } from './feedback'

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
  const [fondo, setFondo] = useState('')
  const [contado, setContado] = useState('')
  const [nota, setNota] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [reabrir, setReabrir] = useState(false)

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
  }, [restaurante.id, dia])

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
  const pedidos = metodos.reduce((n, m) => n + Number(m.pedidos), 0)
  const efVentas = metodos.filter((m) => esEfectivo(m.nombre)).reduce((n, m) => n + Number(m.ventas) + Number(m.propinas), 0)
  const fondoN = leerPrecio(fondo || '0', restaurante) ?? 0
  const esperado = fondoN + efVentas
  const contadoN = contado === '' ? null : leerPrecio(contado, restaurante)
  const diferencia = contadoN == null ? null : contadoN - esperado

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
    setFondo('')
    setContado('')
    setNota('')
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
        <input className="campo-chico" type="date" value={dia} max={hoy} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Día" />
      </div>
      <small className="suave">{mayus(fechaLarga(dia))}</small>
      <Mensaje tipo="error">{error}</Mensaje>

      {cierre && (
        <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--menta)', border: '1px solid var(--borde-menta)', color: 'var(--menta-tinta)', fontWeight: 800 }}>
          ✓ Caja cerrada el {new Date(cierre.cerrado_en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: restaurante.zona_horaria })}
        </p>
      )}
      {!cierre && res.abiertos > 0 && (
        <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--durazno)', border: '1px solid var(--borde-aviso)', color: 'var(--aviso-tinta)', fontWeight: 700 }}>
          ⚠️ Hay {res.abiertos} cuenta{res.abiertos === 1 ? '' : 's'} abierta{res.abiertos === 1 ? '' : 's'} de este día. Cóbralas o anúlalas para poder cerrar la caja.
        </p>
      )}

      <div style={s.kpis}>
        {tarjeta('Vendido', $(ventas), `${pedidos} pedido${pedidos === 1 ? '' : 's'}`)}
        {tarjeta('Propinas', $(propinas), 'aparte de lo vendido')}
        {tarjeta('En el salón', $(res.ventas_salon))}
        {tarjeta('Para llevar', $(res.ventas_llevar))}
        {Number(res.anulado) > 0 && tarjeta('Anulado', $(res.anulado))}
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
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 700 }}>Fondo inicial en efectivo</span>
            <small className="suave">El dinero con el que partió la caja (puede ser 0).</small>
            <input className="campo-chico" inputMode="decimal" placeholder="0" value={fondo} onChange={(e) => setFondo(soloPrecio(e.target.value, restaurante))} />
          </label>
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
              {Math.abs(diferencia) < 0.005 ? '✓ ' : '⚠️ '}{textoDif(diferencia)}
            </p>
          )}
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 700 }}>Nota (opcional)</span>
            <input className="campo-chico" maxLength={500} placeholder="Ej: se dio vuelto de más en la mesa 4" value={nota} onChange={(e) => setNota(e.target.value)} />
          </label>
          <button className="btn btn-principal" disabled={res.abiertos > 0 || trabajando} onClick={() => { sentir('toque'); setConfirmar(true) }}>
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
