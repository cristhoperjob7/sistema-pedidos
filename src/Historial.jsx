import { useEffect, useMemo, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Cargando, Desplegable, Mensaje, Confirmar } from './ui'
import { sentir } from './feedback'

const hoyEn = (zona) => new Date().toLocaleDateString('en-CA', { timeZone: zona || 'America/Santiago' })

// Historial de ventas (solo administración): las últimas 20 cuentas cerradas, con su detalle.
// "Limpiar" solo oculta la lista; las ventas siguen contando en reportes y cierre de caja.
export default function Historial({ restaurante }) {
  const $ = (v) => formatear(v, restaurante)
  const hoy = hoyEn(restaurante.zona_horaria)
  const [dia, setDia] = useState('') // vacío = las más recientes
  const [filtro, setFiltro] = useState('todos') // todos | pagado | anulado
  const [lista, setLista] = useState(null)
  const [nombres, setNombres] = useState({})
  const [abierto, setAbierto] = useState(null)
  const [error, setError] = useState('')
  const [limpiar, setLimpiar] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [recarga, setRecarga] = useState(0)
  const TOPE = 20 // solo se muestran las últimas 20

  useEffect(() => {
    supabase
      .from('miembros')
      .select('usuario_id, nombre')
      .eq('restaurante_id', restaurante.id)
      .then(({ data }) => setNombres(Object.fromEntries((data ?? []).map((m) => [m.usuario_id, m.nombre]))))
  }, [restaurante.id])

  useEffect(() => {
    let vigente = true
    let q = supabase
      .from('pedidos')
      .select(
        'id, numero, total, propina, descuento, descuento_motivo, estado, mesero_id, mesa_numero, llevar_numero, cliente, abierto_en, cerrado_en, dia, metodos_pago(nombre), pagos_pedido(monto_venta, monto_propina, metodos_pago(nombre)), items_pedido(nombre, cantidad, precio_unitario), anulaciones(nombre, cantidad, monto)'
      )
      .eq('restaurante_id', restaurante.id)
      .in('estado', filtro === 'todos' ? ['pagado', 'anulado'] : [filtro])
      .eq('oculto_historial', false)
    if (dia) q = q.eq('dia', dia)
    q.order('abierto_en', { ascending: false })
      .limit(TOPE)
      .then(({ data, error }) => {
        if (!vigente) return
        if (error) setError(error.message)
        else {
          setError('')
          setLista(data)
        }
      })
    return () => {
      vigente = false
    }
  }, [restaurante.id, dia, filtro, recarga])

  const hora = (f) => (f ? new Date(f).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: restaurante.zona_horaria }) : '')
  const fecha = (f) => new Date(f).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: restaurante.zona_horaria })
  // "Efectivo", "Efectivo + Tarjeta", "Mixto" (3 o más) o "Cortesía" si no hubo pago.
  const formaDePago = (p) => {
    const nombres = [...new Set((p.pagos_pedido ?? []).map((l) => l.metodos_pago?.nombre).filter(Boolean))]
    if (nombres.length === 0) return Number(p.descuento) > 0 && Number(p.total) === 0 ? 'Cortesía' : p.metodos_pago?.nombre ?? ''
    return nombres.length > 2 ? 'Mixto' : nombres.join(' + ')
  }
  const titulo = (p) =>
    p.llevar_numero != null ? `Llevar ${p.llevar_numero}${p.cliente ? ` · ${p.cliente}` : ''}` : `Mesa ${p.mesa_numero ?? '?'}`

  async function limpiarTodo() {
    setTrabajando(true)
    const { error } = await supabase.rpc('limpiar_historial', { p_restaurante: restaurante.id })
    setTrabajando(false)
    if (error) {
      setError(error.message)
      return
    }
    sentir('toque', 'exito')
    setLimpiar(false)
    setLista(null)
    setRecarga((n) => n + 1)
  }

  const resumen = useMemo(() => {
    const pagadas = (lista ?? []).filter((p) => p.estado === 'pagado')
    return { n: pagadas.length, total: pagadas.reduce((n, p) => n + Number(p.total), 0) }
  }, [lista])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Historial de ventas</h2>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-chico btn-peligro-suave" disabled={!lista || lista.length === 0} onClick={() => { sentir('toque'); setLimpiar(true) }}>
            <Icono n="basura" tam={15} className="it" /> Limpiar historial
          </button>
          <input className="campo-chico" type="date" value={dia} max={hoy} onChange={(e) => { setLista(null); setDia(e.target.value) }} aria-label="Filtrar por día" />
          {dia && (
            <button className="btn btn-chico btn-sec" onClick={() => { setLista(null); setDia('') }}>
              Recientes
            </button>
          )}
        </span>
      </div>

      <div className="chips">
        {[['todos', 'Todas'], ['pagado', 'Cobradas'], ['anulado', 'Anuladas']].map(([v, t]) => (
          <button key={v} className="chip" aria-pressed={filtro === v} onClick={() => { sentir('toque'); setLista(null); setFiltro(v) }}>
            {t}
          </button>
        ))}
      </div>

      <Mensaje tipo="error">{error}</Mensaje>
      {!lista && !error && <Cargando filas={4} alto={64} />}
      {lista && lista.length === 0 && (
        <div className="vacio">
          <span className="vacio-icono"><Icono n="recibo" tam={34} ancho={1.5} /></span>
          <b>No hay ventas para mostrar</b>
          <span>{dia ? 'Prueba con otro día.' : 'Cuando se cobre la primera cuenta aparecerá aquí.'}</span>
        </div>
      )}
      {lista && lista.length > 0 && (
        <small className="suave">
          {lista.length} cuenta{lista.length === 1 ? '' : 's'}
          {resumen.n > 0 ? ` · ${resumen.n} cobrada${resumen.n === 1 ? '' : 's'} por ${$(resumen.total)}` : ''}
        </small>
      )}

      {(lista ?? []).map((p) => {
        const anulado = p.estado === 'anulado'
        const on = abierto === p.id
        return (
          <div key={p.id} className="tarjeta" style={{ padding: 0, overflow: 'hidden', opacity: anulado ? 0.75 : 1 }}>
            <button
              aria-expanded={on}
              onClick={() => { sentir('toque', 'tic'); setAbierto(on ? null : p.id) }}
              style={{ all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}
            >
              <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                <b>{titulo(p)} <small className="suave" style={{ fontWeight: 600 }}>· #{p.numero}</small></b>
                <small className="suave">
                  {fecha(p.abierto_en)} · {hora(p.cerrado_en ?? p.abierto_en)}
                  {anulado ? ' · Anulada' : formaDePago(p) ? ` · ${formaDePago(p)}` : ''}
                </small>
              </span>
              <b style={{ fontSize: 17, textDecoration: anulado ? 'line-through' : 'none' }}>{$(p.total)}</b>
              <span aria-hidden="true" style={{ fontSize: 12, transform: on ? 'rotate(180deg)' : 'none', transition: 'transform 260ms var(--ease)' }}>▾</span>
            </button>
            <Desplegable abierto={on}>
              <div style={{ display: 'grid', gap: 6, padding: '0 14px 14px', borderTop: '1px solid var(--linea)', paddingTop: 10 }}>
                {p.items_pedido.map((it, k) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span>{it.cantidad} × {it.nombre}</span>
                    <span className="suave">{$(it.cantidad * Number(it.precio_unitario))}</span>
                  </div>
                ))}
                {p.items_pedido.length === 0 && <small className="suave">Sin productos.</small>}
                {Number(p.descuento) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--rosa-tinta)', fontWeight: 700 }}>
                    <span>{Number(p.total) === 0 ? 'Cortesía' : 'Descuento'}{p.descuento_motivo ? ` · ${p.descuento_motivo}` : ''}</span>
                    <span>− {$(p.descuento)}</span>
                  </div>
                )}
                {p.pagos_pedido?.length > 1 &&
                  p.pagos_pedido.map((l, k) => (
                    <div key={`pago${k}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <small className="suave">Pagó con {l.metodos_pago?.nombre ?? '—'}</small>
                      <small className="suave">{$(Number(l.monto_venta) + Number(l.monto_propina))}</small>
                    </div>
                  ))}
                {Number(p.propina) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--menta-tinta)', fontWeight: 700 }}>
                    <span>Propina</span><span>{$(p.propina)}</span>
                  </div>
                )}
                {p.anulaciones.length > 0 && (
                  <small style={{ color: 'var(--rosa-tinta)' }}>
                    Anulado: {p.anulaciones.map((a) => `${a.cantidad} × ${a.nombre}`).join(', ')}
                  </small>
                )}
                <small className="suave">Atendió: {nombres[p.mesero_id] ?? 'Sin asignar'}</small>
              </div>
            </Desplegable>
          </div>
        )
      })}

      <Confirmar
        abierto={limpiar}
        titulo="¿Limpiar el historial?"
        texto={<>Se vacía esta lista. <b>Las ventas no se borran</b>: los reportes, el cierre de caja y las estadísticas siguen igual.</>}
        textoConfirmar="Sí, limpiar todo"
        trabajando={trabajando}
        onCancelar={() => setLimpiar(false)}
        onConfirmar={limpiarTodo}
      />
    </div>
  )
}
