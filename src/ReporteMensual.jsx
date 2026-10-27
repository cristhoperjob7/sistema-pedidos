import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Cargando, Mensaje, NumeroAnimado } from './ui'
import { traerTodo } from './consultas'
import { BotonEstadisticas } from './Estadisticas'

// Mes actual (AAAA-MM) en la zona horaria del restaurante.
function mesEn(zona) {
  return new Date().toLocaleDateString('en-CA', { timeZone: zona || 'America/Santiago' }).slice(0, 7)
}

// Primer y último día (AAAA-MM-DD) de un mes "AAAA-MM".
function rangoDelMes(mes) {
  const [anio, m] = mes.split('-').map(Number)
  const ultimo = new Date(anio, m, 0).getDate() // día 0 del mes siguiente = último día de este mes
  return [`${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`]
}

// Un mes antes de "AAAA-MM".
function mesAnterior(mes) {
  const [anio, m] = mes.split('-').map(Number)
  const d = new Date(anio, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nombreMes(mes) {
  const [anio, m] = mes.split('-').map(Number)
  const texto = new Date(anio, m - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function nombreDia(dia) {
  const texto = new Date(`${dia}T12:00:00`).toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

// Para separar "lo más vendido" según el Tipo de cada categoría (se edita en el Menú).
// Así un restaurante de helados ve "Postres más vendidos" y no "Platos más vendidos".
const TIPOS_INFO = {
  plato: { icono: '🍽️', titulo: 'Platos más vendidos' },
  postre: { icono: '🍰', titulo: 'Postres más vendidos' },
  bebida: { icono: '🥤', titulo: 'Bebidas más vendidas' },
  otro: { icono: '📦', titulo: 'Otros más vendidos' },
}
const ORDEN_TIPOS = ['plato', 'postre', 'bebida', 'otro']

export default function ReporteMensual({ restaurante }) {
  const [mes, setMes] = useState(() => mesEn(restaurante.zona_horaria))
  const [pedidos, setPedidos] = useState(null)
  const [vendidoMesAnterior, setVendidoMesAnterior] = useState(null)
  const [nombres, setNombres] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('miembros')
      .select('usuario_id, nombre')
      .eq('restaurante_id', restaurante.id)
      .then(({ data }) => setNombres(Object.fromEntries((data ?? []).map((m) => [m.usuario_id, m.nombre]))))
  }, [restaurante.id])

  useEffect(() => {
    let vigente = true
    setPedidos(null)
    const [desde, hasta] = rangoDelMes(mes)
    // Un mes puede tener más de 1000 cuentas: se lee por tandas para no perder ventas.
    traerTodo(() =>
      supabase
        .from('pedidos')
        .select('id, dia, total, estado, mesero_id, items_pedido(nombre, cantidad, tipo)')
        .eq('restaurante_id', restaurante.id)
        .gte('dia', desde)
        .lte('dia', hasta)
        .order('id')
    ).then(({ data, error }) => {
      if (!vigente) return
      if (error) setError(error.message)
      else {
        setError('')
        setPedidos(data)
      }
    })

    const [desdeAnt, hastaAnt] = rangoDelMes(mesAnterior(mes))
    traerTodo(() =>
      supabase
        .from('pedidos')
        .select('total')
        .eq('restaurante_id', restaurante.id)
        .eq('estado', 'pagado')
        .gte('dia', desdeAnt)
        .lte('dia', hastaAnt)
        .order('id')
    ).then(({ data }) => {
      if (vigente) setVendidoMesAnterior((data ?? []).reduce((t, p) => t + Number(p.total), 0))
    })

    return () => {
      vigente = false
    }
  }, [restaurante.id, mes])

  const r = useMemo(() => {
    if (!pedidos) return null
    const nombre = (id) => nombres[id] ?? 'Sin asignar'
    const pagados = pedidos.filter((p) => p.estado === 'pagado')
    const vendido = pagados.reduce((t, p) => t + Number(p.total), 0)

    // Ventas por día (para el mejor día y el mejor día de la semana)
    const porDia = new Map()
    pagados.forEach((p) => porDia.set(p.dia, (porDia.get(p.dia) ?? 0) + Number(p.total)))
    const mejorDia = [...porDia.entries()].sort((a, b) => b[1] - a[1])[0] ?? null

    const porSemana = new Map() // 0..6 -> { total, dias }
    porDia.forEach((total, dia) => {
      const sem = new Date(`${dia}T12:00:00`).getDay()
      const x = porSemana.get(sem) ?? { total: 0, dias: 0 }
      x.total += total
      x.dias += 1
      porSemana.set(sem, x)
    })
    const mejorSemana = [...porSemana.entries()].sort((a, b) => b[1].total / b[1].dias - a[1].total / a[1].dias)[0] ?? null

    // Platos y postres más vendidos (según el "Tipo" de cada categoría, editable en el Menú)
    const porTipo = { plato: new Map(), postre: new Map(), bebida: new Map(), otro: new Map() }
    pagados.forEach((p) =>
      p.items_pedido.forEach((i) => {
        const tipo = i.tipo ?? 'otro'
        const m = porTipo[tipo] ?? porTipo.otro
        m.set(i.nombre, (m.get(i.nombre) ?? 0) + i.cantidad)
      })
    )
    const topPorTipo = ORDEN_TIPOS.map((tipo) => [
      tipo,
      [...porTipo[tipo].entries()].sort((a, b) => b[1] - a[1]).slice(0, 2),
    ]).filter(([, lista]) => lista.length > 0)

    // Meseras del mes
    const meseras = new Map()
    pagados.forEach((p) => {
      const m = meseras.get(nombre(p.mesero_id)) ?? { cuentas: 0, total: 0 }
      m.cuentas += 1
      m.total += Number(p.total)
      meseras.set(nombre(p.mesero_id), m)
    })

    return {
      vendido,
      cuentas: pagados.length,
      ticketPromedio: pagados.length ? vendido / pagados.length : 0,
      diasConVentas: porDia.size,
      mejorDia: mejorDia && { dia: mejorDia[0], total: mejorDia[1] },
      mejorSemana: mejorSemana && { nombre: DIAS_SEMANA[mejorSemana[0]], promedio: mejorSemana[1].total / mejorSemana[1].dias },
      topPorTipo,
      meseras: [...meseras.entries()].sort((a, b) => b[1].total - a[1].total),
    }
  }, [pedidos, nombres])

  const cambio = r && vendidoMesAnterior != null && vendidoMesAnterior > 0 ? ((r.vendido - vendidoMesAnterior) / vendidoMesAnterior) * 100 : null

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={s.cabecera}>
        <h3 style={{ margin: 0 }}>Reporte mensual</h3>
        <input
          type="month"
          className="campo-chico"
          value={mes}
          max={mesEn(restaurante.zona_horaria)}
          onChange={(e) => e.target.value && setMes(e.target.value)}
        />
      </div>
      <small style={s.suave}>{nombreMes(mes)}</small>

      <BotonEstadisticas />

      <Mensaje tipo="error">{error}</Mensaje>
      {!r && !error && <Cargando filas={3} alto={96} />}

      {r && r.cuentas === 0 && (
        <div className="vacio aparece">
          <span className="vacio-icono">📅</span>
          <b>Este mes todavía no hay ventas cerradas</b>
          <span>Cuando se cobren cuentas, aquí verás cómo va el mes.</span>
        </div>
      )}

      {r && r.cuentas > 0 && (
        <>
          <div className="aparece" style={s.tarjetaGrande}>
            <small style={s.suaveClaro}>Total vendido en el mes</small>
            <b style={s.numeroGrande}>
              <NumeroAnimado valor={r.vendido} duracion={900} formato={(n) => formatear(n, restaurante)} />
            </b>
            {cambio != null && (
              <small
                className="infla"
                style={{
                  ...s.cambio,
                  background: cambio >= 0 ? 'rgba(156,230,168,.18)' : 'rgba(246,180,175,.18)',
                  color: cambio >= 0 ? '#9CE6A8' : '#F6B4AF',
                  animationDelay: '500ms',
                }}
              >
                {cambio >= 0 ? '▲' : '▼'} {Math.abs(cambio).toFixed(0)}% respecto al mes anterior
              </small>
            )}
            <small style={s.suaveClaro}>
              {r.cuentas} cuentas cerradas · ticket promedio {formatear(r.ticketPromedio, restaurante)}
            </small>
          </div>

          <div style={s.grilla}>
            {r.mejorDia && (
              <div className="entra" style={{ ...s.tarjeta, animationDelay: '80ms' }}>
                <small style={s.suave}>🏆 Tu mejor día</small>
                <b style={{ fontSize: 18 }}>{nombreDia(r.mejorDia.dia)}</b>
                <span>Vendiste {formatear(r.mejorDia.total, restaurante)}</span>
              </div>
            )}
            {r.mejorSemana && (
              <div className="entra" style={{ ...s.tarjeta, animationDelay: '140ms' }}>
                <small style={s.suave}>📅 Tu mejor día de la semana</small>
                <b style={{ fontSize: 18 }}>{r.mejorSemana.nombre}</b>
                <span>En promedio vendes {formatear(r.mejorSemana.promedio, restaurante)}</span>
                <small style={s.suave}>Te puede servir para reforzar el personal ese día</small>
              </div>
            )}
          </div>

          {r.topPorTipo.length === 0 ? (
            <small style={s.suave}>Todavía no hay suficientes ventas para mostrar lo más pedido.</small>
          ) : (
            <div style={s.grilla}>
              {r.topPorTipo.map(([tipo, lista], i) => {
                const info = TIPOS_INFO[tipo]
                return (
                  <div key={tipo} className="entra" style={{ ...s.tarjeta, animationDelay: `${200 + i * 60}ms` }}>
                    <small style={s.suave}>
                      {info.icono} {info.titulo}
                    </small>
                    {lista.map(([nombre, cantidad], i) => (
                      <span key={nombre}>
                        {i + 1}. {nombre} <b>· {cantidad}</b>
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
          <small style={s.suave}>
            ¿Algo aparece en la sección equivocada? Corrige el "Tipo" de esa categoría en el Menú.
          </small>

          <h4 style={s.titulo}>Por salón</h4>
          {r.meseras.map(([nombre, m], i) => (
            <div key={nombre} className="entra" style={{ ...s.fila, animationDelay: `${i * 40}ms` }}>
              <span>
                {nombre} <small style={s.suave}>· {m.cuentas} cuenta(s)</small>
              </span>
              <b>{formatear(m.total, restaurante)}</b>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

const s = {
  cabecera: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  suave: { color: '#6f6477' },
  suaveClaro: { color: '#e6d9ea' },
  titulo: { margin: '4px 0 2px', fontSize: 16 },
  tarjeta: { display: 'grid', gap: 4, alignContent: 'start', background: 'white', border: '1px solid var(--linea)', borderRadius: 18, padding: 14, boxShadow: 'var(--sombra)' },
  tarjetaGrande: {
    display: 'grid',
    gap: 6,
    justifyItems: 'start',
    color: 'white',
    borderRadius: 20,
    padding: 18,
    background: 'linear-gradient(135deg, #5c2a5f 0%, #4B1E4D 60%, #3a173c 100%)',
    boxShadow: '0 16px 34px -20px rgba(75,30,77,.95)',
  },
  numeroGrande: { fontSize: 'clamp(28px, 8.5vw, 36px)', fontWeight: 900, lineHeight: 1.1 },
  cambio: { padding: '3px 10px', borderRadius: 99, fontWeight: 800 },
  grilla: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'white', border: '1px solid var(--linea)', borderRadius: 14, padding: '10px 12px', boxShadow: 'var(--sombra)' },
}
