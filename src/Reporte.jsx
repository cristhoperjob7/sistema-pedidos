import { useEffect, useMemo, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Cargando, Mensaje, NumeroAnimado } from './ui'
import { sentir } from './feedback'
import { BotonEstadisticas } from './Estadisticas'

// Fecha de hoy (AAAA-MM-DD) en la zona horaria del restaurante.
function hoyEn(zona) {
  return new Date().toLocaleDateString('en-CA', { timeZone: zona || 'America/Santiago' })
}

// Para separar "lo más vendido" según el Tipo de cada categoría (se edita en el Menú).
// Así un restaurante de helados ve "Postres más vendidos" y no "Platos más vendidos".
const TIPOS_INFO = {
  plato: { icono: 'cubiertos', titulo: 'Platos más vendidos' },
  postre: { icono: 'postre', titulo: 'Postres más vendidos' },
  bebida: { icono: 'bebida', titulo: 'Bebidas más vendidas' },
  otro: { icono: 'paquete', titulo: 'Otros más vendidos' },
}
const ORDEN_TIPOS = ['plato', 'postre', 'bebida', 'otro']

export default function Reporte({ restaurante }) {
  const [dia, setDia] = useState(() => hoyEn(restaurante.zona_horaria))
  const [pedidos, setPedidos] = useState(null)
  const [nombres, setNombres] = useState({}) // usuario_id -> nombre
  const [error, setError] = useState('')
  const [recarga, setRecarga] = useState(0)
  const [girando, setGirando] = useState(0) // para que el ícono ↻ dé una vuelta al actualizar

  useEffect(() => {
    supabase
      .from('miembros')
      .select('usuario_id, nombre')
      .eq('restaurante_id', restaurante.id)
      .then(({ data }) => setNombres(Object.fromEntries((data ?? []).map((m) => [m.usuario_id, m.nombre]))))
  }, [restaurante.id])

  useEffect(() => {
    let vigente = true
    supabase
      .from('pedidos')
      .select(
        'id, numero, total, propina, estado, mesero_id, mesa_numero, llevar_numero, items_pedido(nombre, cantidad, tipo)'
      )
      .eq('restaurante_id', restaurante.id)
      .eq('dia', dia)
      .then(({ data, error }) => {
        if (!vigente) return
        if (error) setError(error.message)
        else {
          setError('')
          setPedidos(data)
        }
      })
    return () => {
      vigente = false
    }
  }, [restaurante.id, dia, recarga])

  // El reporte de hoy se refresca solo cada medio minuto.
  useEffect(() => {
    if (dia !== hoyEn(restaurante.zona_horaria)) return
    const id = setInterval(() => setRecarga((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [dia, restaurante.zona_horaria])

  const r = useMemo(() => {
    if (!pedidos) return null
    const nombre = (id) => nombres[id] ?? 'Sin asignar'
    const pagados = pedidos.filter((p) => p.estado === 'pagado')
    const vendido = pagados.reduce((t, p) => t + Number(p.total), 0)
    const llevar = pagados.filter((p) => p.llevar_numero != null).reduce((t, p) => t + Number(p.total), 0)

    const porTipo = { plato: new Map(), postre: new Map(), bebida: new Map(), otro: new Map() }
    const meseras = new Map()
    pagados.forEach((p) => {
      p.items_pedido.forEach((i) => {
        const tipo = i.tipo ?? 'otro'
        const m = porTipo[tipo] ?? porTipo.otro
        m.set(i.nombre, (m.get(i.nombre) ?? 0) + i.cantidad)
      })
      const m = meseras.get(nombre(p.mesero_id)) ?? { cuentas: 0, total: 0, propinas: 0 }
      m.cuentas += 1
      m.total += Number(p.total)
      m.propinas += Number(p.propina ?? 0)
      meseras.set(nombre(p.mesero_id), m)
    })

    return {
      vendido,
      salon: vendido - llevar,
      llevar,
      cuentas: pagados.length,
      ticketPromedio: pagados.length ? vendido / pagados.length : 0,
      abiertas: pedidos.filter((p) => p.estado === 'abierto').length,
      topPorTipo: ORDEN_TIPOS.map((tipo) => [tipo, [...porTipo[tipo].entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)]).filter(
        ([, lista]) => lista.length > 0
      ),
      meseras: [...meseras.entries()].sort((a, b) => b[1].total - a[1].total),
    }
  }, [pedidos, nombres])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={s.cabecera}>
        <h3 style={{ margin: 0 }}>Reporte del día</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            className="campo-chico"
            value={dia}
            max={hoyEn(restaurante.zona_horaria)}
            onChange={(e) => e.target.value && setDia(e.target.value)}
          />
          <button
            className="btn btn-chico btn-sec"
            onClick={() => {
              sentir('toque', 'tic')
              setGirando((n) => n + 1)
              setRecarga((n) => n + 1)
            }}
          >
            <span key={girando} style={girando ? s.gira : undefined} aria-hidden="true">
              ↻
            </span>
            Actualizar
          </button>
        </div>
      </div>

      <BotonEstadisticas />

      <Mensaje tipo="error">{error}</Mensaje>
      {!r && !error && <Cargando filas={3} alto={80} />}

      {r && (
        <>
          <div className="aparece" style={s.kpis}>
            <div style={{ ...s.kpi, ...s.kpiPrincipal }}>
              <small style={{ opacity: 0.8 }}>Vendido</small>
              <b style={s.kpiValor}>
                <NumeroAnimado valor={r.vendido} formato={(n) => formatear(n, restaurante)} />
              </b>
            </div>
            <div style={s.kpi}>
              <small style={s.suave}>Cuentas cerradas</small>
              <b style={s.kpiValor}>
                <NumeroAnimado valor={r.cuentas} />
              </b>
            </div>
            <div style={s.kpi}>
              <small style={s.suave}>Ticket promedio</small>
              <b style={s.kpiValor}>
                <NumeroAnimado valor={r.ticketPromedio} formato={(n) => formatear(n, restaurante)} />
              </b>
            </div>
          </div>
          {r.vendido > 0 && (
            <div className="tarjeta aparece" style={{ display: 'grid', gap: 8, borderRadius: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span><Icono n="cubiertos" tam={15} className="it" /> En el salón <b>{formatear(r.salon, restaurante)}</b></span>
                <span><Icono n="bolsa" tam={15} className="it" /> Para llevar <b>{formatear(r.llevar, restaurante)}</b></span>
              </div>
              <span style={{ ...s.pista, display: 'flex' }} aria-hidden="true">
                <i style={{ ...s.relleno, width: `${(r.salon / r.vendido) * 100}%` }} />
              </span>
              <small style={s.suave}>
                {Math.round((r.salon / r.vendido) * 100)}% salón · {Math.round((r.llevar / r.vendido) * 100)}% para llevar. El cobro por método de pago está en Cierre de caja.
              </small>
            </div>
          )}
          {r.abiertas > 0 && (
            <small style={s.suave}>Hay {r.abiertas} cuenta(s) abierta(s) que todavía no se suman a las ventas.</small>
          )}

          {r.topPorTipo.length === 0 && (
            <>
              <h4 style={s.titulo}>Lo más vendido</h4>
              <small style={s.suave}>Sin ventas todavía.</small>
            </>
          )}
          {r.topPorTipo.map(([tipo, lista]) => {
            const info = TIPOS_INFO[tipo]
            const maximo = lista[0][1]
            return (
              <div key={tipo}>
                <h4 style={s.titulo}>
                  <Icono n={info.icono} tam={16} className="it" /> {info.titulo}
                </h4>
                <div className="tarjeta" style={s.barras}>
                  {lista.map(([nombre, cantidad], i) => (
                    <div key={nombre} style={s.barra}>
                      <span style={s.barraNombre}>{nombre}</span>
                      <span style={s.pista}>
                        <i
                          className="barra-crece"
                          style={{
                            ...s.relleno,
                            width: `${Math.max(6, (cantidad / maximo) * 100)}%`,
                            animationDelay: `${i * 70}ms`,
                          }}
                        />
                      </span>
                      <b className="numero" style={{ minWidth: 24, textAlign: 'right' }}>
                        {cantidad}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          <h4 style={s.titulo}>Por persona</h4>
          {r.meseras.length === 0 && <small style={s.suave}>Sin ventas todavía.</small>}
          {r.meseras.map(([nombre, m], i) => (
            <div key={nombre} className="entra" style={{ ...s.fila, animationDelay: `${i * 40}ms` }}>
              <span style={{ minWidth: 0 }}>
                <b>{nombre}</b>
                <small style={{ ...s.suave, display: 'block' }}>
                  {m.cuentas} cuenta{m.cuentas === 1 ? '' : 's'}
                  {m.propinas > 0 ? ` · propinas ${formatear(m.propinas, restaurante)}` : ''}
                </small>
              </span>
              <b style={{ whiteSpace: 'nowrap' }}>{formatear(m.total, restaurante)}</b>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

const s = {
  cabecera: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  gira: { display: 'inline-block', animation: 'gira 600ms var(--resorte)' },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12 },
  kpi: { background: 'var(--sup)', border: '1px solid var(--linea)', borderRadius: 18, padding: 14, display: 'grid', gap: 2, boxShadow: 'var(--sombra)' },
  kpiPrincipal: {
    gridColumn: '1 / -1',
    color: 'var(--tinta)',
    background: 'linear-gradient(135deg, color-mix(in srgb, var(--marca) 30%, var(--sup)) 0%, var(--sup) 100%)',
    boxShadow: 'var(--sombra)',
  },
  kpiValor: { fontSize: 'clamp(22px, 6vw, 26px)', fontWeight: 900 },
  suave: { color: 'var(--suave)' },
  titulo: { margin: '12px 0 2px', fontSize: 16 },
  barras: { display: 'grid', gap: 10, borderRadius: 16 },
  barra: { display: 'flex', alignItems: 'center', gap: 10 },
  barraNombre: { width: '38%', flex: 'none', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pista: { flex: 1, height: 12, borderRadius: 99, background: 'var(--lavanda)', overflow: 'hidden' },
  relleno: { display: 'block', height: '100%', borderRadius: 99, background: 'var(--marca)' },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'var(--sup)', border: '1px solid var(--linea)', borderRadius: 14, padding: '10px 12px', boxShadow: 'var(--sombra)' },
}
