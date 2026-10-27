import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Cargando, Mensaje, NumeroAnimado, Segmento } from './ui'
import { sentir } from './feedback'
import { hoyEn } from './agotado'
import { traerTodo } from './consultas'

// =============================================================================================
// PÁGINA DE ESTADÍSTICAS (solo administrador). Se abre en otra pestaña desde los reportes.
//
// CÓMO AGREGAR UNA ESTADÍSTICA NUEVA:
//   1. Escribe un componente como TiemposCocina o HorasPunta más abajo. Recibe
//      { restaurante, desde, hasta } (días en formato AAAA-MM-DD) y se encarga de leer sus propios datos.
//   2. Agrégalo a la lista SECCIONES (al final del archivo de componentes). Listo: aparece en la página.
// =============================================================================================

// ---------- Útiles ----------
const DIAS_CORTO = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] // de lunes a domingo
const DIAS_LARGO = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const SEMANA_EN = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

const formateadores = new Map()
// Día, hora y día de la semana de un instante, según la zona horaria del restaurante.
function partesLocales(iso, zona) {
  let f = formateadores.get(zona)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
    formateadores.set(zona, f)
  }
  const o = {}
  f.formatToParts(new Date(iso)).forEach((p) => {
    o[p.type] = p.value
  })
  return { dia: `${o.year}-${o.month}-${o.day}`, hora: Number(o.hour) % 24, semana: SEMANA_EN[o.weekday] ?? 0 }
}

function sumarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function percentil(valores, p) {
  if (!valores.length) return null
  const s = [...valores].sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const mediana = (valores) => percentil(valores, 0.5)

const minutosEntre = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60000
const fmtMin = (m) => (m == null ? '—' : m < 1 ? '<1 min' : `${Math.round(m)} min`)
const fmtHora = (h) => `${String(h).padStart(2, '0')}:00`

function agregar(mapa, clave, valor) {
  const lista = mapa.get(clave)
  if (lista) lista.push(valor)
  else mapa.set(clave, [valor])
}

function fechaCorta(dia) {
  return new Date(`${dia}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

// Número compacto para las celdas del mapa de calor: 12500 -> "13k".
const compacto = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))

// ---------- Piezas visuales ----------
function Tarjeta({ titulo, descripcion, retraso = 0, children }) {
  return (
    <section className="tarjeta entra" style={{ ...s.seccion, animationDelay: `${retraso}ms` }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 18 }}>{titulo}</h3>
        {descripcion && <small style={s.suave}>{descripcion}</small>}
      </div>
      {children}
    </section>
  )
}

function Dato({ etiqueta, valor, nota, color }) {
  return (
    <div style={s.dato}>
      <small style={s.suave}>{etiqueta}</small>
      <b style={{ ...s.datoValor, color }}>{valor}</b>
      {nota && <small style={s.suave}>{nota}</small>}
    </div>
  )
}

// Barras horizontales: filas = [[etiqueta, valor, detalle?]]
function Barras({ filas, formato = (v) => v, resaltarMayor = false }) {
  const maximo = Math.max(...filas.map(([, v]) => v), 1)
  const mayor = filas.reduce((m, [, v]) => Math.max(m, v), 0)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {filas.map(([etiqueta, valor, detalle], i) => (
        <div key={etiqueta} style={s.barra}>
          <span style={s.barraNombre} title={etiqueta}>
            {etiqueta}
          </span>
          <span style={s.pista}>
            <i
              className="barra-crece"
              style={{
                ...s.relleno,
                width: `${Math.max(5, (valor / maximo) * 100)}%`,
                animationDelay: `${i * 60}ms`,
                ...(resaltarMayor && valor === mayor ? { background: 'linear-gradient(90deg, #f6b4af, #e98a83)' } : null),
              }}
            />
          </span>
          <b className="numero" style={s.barraValor}>
            {formato(valor)}
            {detalle && <small style={{ ...s.suave, fontWeight: 600 }}> {detalle}</small>}
          </b>
        </div>
      ))}
    </div>
  )
}

function Vacio({ icono, titulo, texto }) {
  return (
    <div className="vacio" style={{ padding: '18px 8px' }}>
      <span className="vacio-icono">{icono}</span>
      <b>{titulo}</b>
      <span>{texto}</span>
    </div>
  )
}

// =============================================================================================
// SECCIÓN 1: tiempos de cocina y de retiro
// =============================================================================================
function TiemposCocina({ restaurante, desde, hasta }) {
  const zona = restaurante.zona_horaria || 'America/Santiago'
  const [filas, setFilas] = useState(null)
  const [ajustes, setAjustes] = useState({ alerta_amarilla_min: 5, alerta_roja_min: 10 })
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    setFilas(null)
    setError('')
    // Se pide un día de más por las diferencias de zona horaria; abajo se filtra con exactitud.
    const desdeISO = `${sumarDias(desde, -1)}T00:00:00Z`
    Promise.all([
      traerTodo(() =>
        supabase
          .from('envios_cocina')
          .select('id, creado_en, resuelto_en, entregado_en, items_pedido(nombre)')
          .eq('restaurante_id', restaurante.id)
          .eq('estado', 'listo')
          .in('tipo', ['pedido', 'adicion'])
          .gte('creado_en', desdeISO)
          .order('id')
      ),
      supabase.from('ajustes').select('alerta_amarilla_min, alerta_roja_min').eq('restaurante_id', restaurante.id).maybeSingle(),
    ]).then(([e, a]) => {
      if (!vigente) return
      if (e.error) {
        setError(
          /entregado_en|column/i.test(e.error.message)
            ? 'Falta ejecutar el paso 12 en Supabase para ver estos tiempos.'
            : e.error.message
        )
        return
      }
      if (a.data) setAjustes(a.data)
      setFilas(e.data)
    })
    return () => {
      vigente = false
    }
  }, [restaurante.id, desde, hasta])

  const r = useMemo(() => {
    if (!filas) return null
    const cocina = []
    const retiro = []
    const total = []
    const porHora = new Map()
    const porPlato = new Map()
    filas.forEach((f) => {
      if (!f.resuelto_en) return
      const { dia, hora } = partesLocales(f.creado_en, zona)
      if (dia < desde || dia > hasta) return
      const m = minutosEntre(f.creado_en, f.resuelto_en)
      if (m < 0 || m > 240) return // tickets olvidados abiertos horas: no representan la cocina
      cocina.push(m)
      agregar(porHora, hora, m)
      new Set((f.items_pedido ?? []).map((i) => i.nombre)).forEach((nombre) => agregar(porPlato, nombre, m))
      if (f.entregado_en) {
        const w = minutosEntre(f.resuelto_en, f.entregado_en)
        if (w >= 0 && w <= 120) {
          retiro.push(w)
          total.push(m + w)
        }
      }
    })
    return {
      n: cocina.length,
      mediana: mediana(cocina),
      p90: percentil(cocina, 0.9),
      pctAmarilla: cocina.length ? (cocina.filter((m) => m >= ajustes.alerta_amarilla_min).length / cocina.length) * 100 : 0,
      pctRoja: cocina.length ? (cocina.filter((m) => m >= ajustes.alerta_roja_min).length / cocina.length) * 100 : 0,
      horas: [...porHora.entries()]
        .filter(([, v]) => v.length >= 3)
        .map(([h, v]) => [fmtHora(h), mediana(v), `· ${v.length}`])
        .sort((a, b) => a[0].localeCompare(b[0])),
      platos: [...porPlato.entries()]
        .filter(([, v]) => v.length >= 5)
        .map(([nombre, v]) => [nombre, mediana(v), `· ${v.length}`])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      retiro: { n: retiro.length, mediana: mediana(retiro), p90: percentil(retiro, 0.9) },
      total: { mediana: mediana(total) },
    }
  }, [filas, zona, desde, hasta, ajustes])

  return (
    <Tarjeta
      titulo="⏱️ Tiempos de cocina y retiro"
      descripcion="Cuánto tarda cocina en dejar un pedido listo y cuánto espera después en la ventanilla."
    >
      <Mensaje tipo="error">{error}</Mensaje>
      {!r && !error && <Cargando filas={2} alto={70} />}
      {r && r.n === 0 && (
        <Vacio icono="⏱️" titulo="Todavía no hay datos" texto="Aparecerán cuando cocina marque pedidos como listos en este período." />
      )}
      {r && r.n > 0 && (
        <>
          <div style={s.datos}>
            <Dato etiqueta="Tiempo típico en cocina" valor={fmtMin(r.mediana)} nota={`${r.n} pedidos`} />
            <Dato etiqueta="9 de cada 10 salen en" valor={fmtMin(r.p90)} nota="o menos" />
            <Dato
              etiqueta="Pasan la alerta roja"
              valor={`${r.pctRoja.toFixed(0)}%`}
              nota={`más de ${ajustes.alerta_roja_min} min`}
              color={r.pctRoja >= 20 ? '#B3261E' : undefined}
            />
            <Dato etiqueta="Pasan la alerta amarilla" valor={`${r.pctAmarilla.toFixed(0)}%`} nota={`más de ${ajustes.alerta_amarilla_min} min`} />
          </div>

          {r.horas.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <b style={s.subtitulo}>¿A qué hora se demora más?</b>
              <Barras filas={r.horas} formato={fmtMin} resaltarMayor />
              <small style={s.suave}>Tiempo típico por hora de llegada del pedido (la cifra pequeña es la cantidad de pedidos).</small>
            </div>
          )}

          {r.platos.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <b style={s.subtitulo}>Platos que más tardan</b>
              <Barras filas={r.platos} formato={fmtMin} />
              <small style={s.suave}>
                Tiempo típico de los pedidos que incluyen ese plato. Si un pedido lleva varios platos, cuenta para todos.
              </small>
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <b style={s.subtitulo}>Espera en ventanilla (desde “Listo” hasta “Entregado”)</b>
            {r.retiro.n === 0 ? (
              <small style={s.suave}>
                Aún no hay datos: aparecerán cuando el salón empiece a marcar “Entregado”.
              </small>
            ) : (
              <div style={s.datos}>
                <Dato etiqueta="Espera típica" valor={fmtMin(r.retiro.mediana)} nota={`${r.retiro.n} pedidos`} />
                <Dato etiqueta="9 de cada 10 esperan" valor={fmtMin(r.retiro.p90)} nota="o menos" />
                <Dato etiqueta="Pedido → entregado" valor={fmtMin(r.total.mediana)} nota="tiempo típico total" />
              </div>
            )}
          </div>
        </>
      )}
    </Tarjeta>
  )
}

// =============================================================================================
// SECCIÓN 2: horas y días punta, ticket promedio y tiempo en mesa
// =============================================================================================
function HorasPunta({ restaurante, desde, hasta }) {
  const zona = restaurante.zona_horaria || 'America/Santiago'
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')
  const [metrica, setMetrica] = useState('pedidos')
  const [sel, setSel] = useState(null) // { semana, hora }

  useEffect(() => {
    let vigente = true
    setFilas(null)
    setError('')
    setSel(null)
    traerTodo(() =>
      supabase
        .from('pedidos')
        .select('id, total, dia, abierto_en, cerrado_en')
        .eq('restaurante_id', restaurante.id)
        .eq('estado', 'pagado')
        .gte('dia', desde)
        .lte('dia', hasta)
        .order('id')
    ).then(({ data, error }) => {
      if (!vigente) return
      if (error) setError(error.message)
      else setFilas(data)
    })
    return () => {
      vigente = false
    }
  }, [restaurante.id, desde, hasta])

  const r = useMemo(() => {
    if (!filas) return null
    const celdas = new Map() // "semana-hora" -> { pedidos, ventas }
    const diasPorSemana = Array.from({ length: 7 }, () => new Set())
    const ventasPorSemana = Array(7).fill(0)
    const enMesa = []
    let vendido = 0
    let horaMin = 24
    let horaMax = -1
    filas.forEach((p) => {
      const t = Number(p.total)
      vendido += t
      const { hora, semana, dia } = partesLocales(p.abierto_en, zona)
      const clave = `${semana}-${hora}`
      const c = celdas.get(clave) ?? { pedidos: 0, ventas: 0 }
      c.pedidos += 1
      c.ventas += t
      celdas.set(clave, c)
      diasPorSemana[semana].add(dia)
      ventasPorSemana[semana] += t
      horaMin = Math.min(horaMin, hora)
      horaMax = Math.max(horaMax, hora)
      if (p.cerrado_en) {
        const m = minutosEntre(p.abierto_en, p.cerrado_en)
        if (m >= 1 && m <= 360) enMesa.push(m)
      }
    })
    const horas = horaMax >= 0 ? Array.from({ length: horaMax - horaMin + 1 }, (_, i) => horaMin + i) : []
    const maximo = { pedidos: 0, ventas: 0 }
    celdas.forEach((c) => {
      maximo.pedidos = Math.max(maximo.pedidos, c.pedidos)
      maximo.ventas = Math.max(maximo.ventas, c.ventas)
    })
    const fuertes = [...celdas.entries()]
      .map(([k, c]) => ({ semana: Number(k.split('-')[0]), hora: Number(k.split('-')[1]), ...c }))
      .sort((a, b) => b.pedidos - a.pedidos || b.ventas - a.ventas)
      .slice(0, 3)
    return {
      cuentas: filas.length,
      vendido,
      ticket: filas.length ? vendido / filas.length : 0,
      enMesa: mediana(enMesa),
      celdas,
      horas,
      maximo,
      diasPorSemana: diasPorSemana.map((d) => d.size),
      promedioDia: ventasPorSemana.map((v, i) => (diasPorSemana[i].size ? v / diasPorSemana[i].size : 0)),
      fuertes,
    }
  }, [filas, zona])

  const detalle = (() => {
    if (!r || !sel) return null
    const c = r.celdas.get(`${sel.semana}-${sel.hora}`) ?? { pedidos: 0, ventas: 0 }
    const dias = r.diasPorSemana[sel.semana] || 1
    return (
      <>
        <b>
          {DIAS_LARGO[sel.semana].charAt(0).toUpperCase() + DIAS_LARGO[sel.semana].slice(1)} {fmtHora(sel.hora)} a{' '}
          {fmtHora((sel.hora + 1) % 24)}
        </b>
        <span>
          {c.pedidos} pedido{c.pedidos === 1 ? '' : 's'} · {formatear(c.ventas, restaurante)}
        </span>
        <small style={s.suave}>
          En promedio {(c.pedidos / dias).toFixed(1).replace('.', ',')} pedidos por {DIAS_LARGO[sel.semana]} en ese horario.
        </small>
      </>
    )
  })()

  return (
    <Tarjeta
      titulo="🔥 Horas y días punta"
      descripcion="Cuándo se concentra el movimiento, cuánto gasta cada cuenta y cuánto rota cada mesa."
      retraso={80}
    >
      <Mensaje tipo="error">{error}</Mensaje>
      {!r && !error && <Cargando filas={2} alto={70} />}
      {r && r.cuentas === 0 && (
        <Vacio icono="🔥" titulo="Todavía no hay ventas en este período" texto="Cuando se cobren cuentas, aquí verás tus horas fuertes." />
      )}
      {r && r.cuentas > 0 && (
        <>
          <div style={s.datos}>
            <Dato etiqueta="Cuentas cerradas" valor={<NumeroAnimado valor={r.cuentas} />} />
            <Dato etiqueta="Vendido" valor={<NumeroAnimado valor={r.vendido} formato={(n) => formatear(n, restaurante)} />} />
            <Dato etiqueta="Ticket promedio" valor={<NumeroAnimado valor={r.ticket} formato={(n) => formatear(n, restaurante)} />} nota="por cuenta" />
            <Dato etiqueta="Tiempo en mesa" valor={fmtMin(r.enMesa)} nota="típico, de abrir a cobrar" />
          </div>

          {r.fuertes.length > 0 && (
            <div style={s.destacado}>
              <b>Tus franjas más fuertes</b>
              {r.fuertes.map((f, i) => (
                <span key={`${f.semana}-${f.hora}`}>
                  {i + 1}. {DIAS_LARGO[f.semana].charAt(0).toUpperCase() + DIAS_LARGO[f.semana].slice(1)} a las {fmtHora(f.hora)}{' '}
                  <small style={s.suave}>· {f.pedidos} pedidos</small>
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={s.filaTitulo}>
              <b style={s.subtitulo}>Mapa de calor</b>
              <Segmento
                etiqueta="Qué mostrar en el mapa"
                valor={metrica}
                onChange={(v) => setMetrica(v)}
                opciones={[
                  ['pedidos', 'Pedidos'],
                  ['ventas', 'Ventas'],
                ]}
              />
            </div>

            <div style={s.mapa} role="table" aria-label="Mapa de calor de pedidos por día y hora">
              <span />
              {DIAS_CORTO.map((d, i) => (
                <b key={i} style={s.diaCabecera}>
                  {d}
                </b>
              ))}
              {r.horas.map((h) => (
                <FilaMapa key={h} hora={h} r={r} metrica={metrica} sel={sel} onSel={(semana) => {
                  sentir('toque', 'tic')
                  setSel((a) => (a && a.semana === semana && a.hora === h ? null : { semana, hora: h }))
                }} />
              ))}
            </div>
            <div style={s.detalle} aria-live="polite">
              {detalle ?? <small style={s.suave}>Toca un cuadro para ver el detalle de esa hora.</small>}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <b style={s.subtitulo}>Venta promedio por día de la semana</b>
            <Barras
              filas={DIAS_LARGO.map((d, i) => [d.charAt(0).toUpperCase() + d.slice(1), r.promedioDia[i]]).filter(([, v]) => v > 0)}
              formato={(v) => formatear(v, restaurante)}
              resaltarMayor
            />
            <small style={s.suave}>Se promedia solo entre los días en que hubo ventas, así un día cerrado no baja la cifra.</small>
          </div>
        </>
      )}
    </Tarjeta>
  )
}

function FilaMapa({ hora, r, metrica, sel, onSel }) {
  return (
    <>
      <small style={s.horaEtiqueta}>{fmtHora(hora)}</small>
      {DIAS_CORTO.map((_, semana) => {
        const c = r.celdas.get(`${semana}-${hora}`)
        const valor = c ? c[metrica] : 0
        const intensidad = r.maximo[metrica] ? valor / r.maximo[metrica] : 0
        const elegido = sel && sel.semana === semana && sel.hora === hora
        return (
          <button
            key={semana}
            aria-label={`${DIAS_LARGO[semana]} ${fmtHora(hora)}: ${c ? c.pedidos : 0} pedidos`}
            aria-pressed={!!elegido}
            onClick={() => onSel(semana)}
            style={{
              ...s.celda,
              background: valor ? `rgba(242, 169, 0, ${0.14 + 0.86 * intensidad})` : 'var(--lavanda)',
              color: intensidad > 0.62 ? '#3b2200' : 'var(--tinta)',
              outline: elegido ? '2.5px solid var(--morado)' : 'none',
            }}
          >
            {valor ? (metrica === 'pedidos' ? valor : compacto(valor)) : ''}
          </button>
        )
      })}
    </>
  )
}

// =============================================================================================
// Lista de secciones. Para sumar una estadística nueva, agrega su componente aquí.
// =============================================================================================
const SECCIONES = [
  { id: 'cocina', Componente: TiemposCocina },
  { id: 'punta', Componente: HorasPunta },
]

const RANGOS = [
  [7, '7 días'],
  [30, '30 días'],
  [90, '90 días'],
]

export default function Estadisticas({ restaurante, onVolver }) {
  const [dias, setDias] = useState(30)
  const hasta = hoyEn(restaurante.zona_horaria)
  const desde = sumarDias(hasta, -(dias - 1))

  return (
    <div style={s.pagina}>
      <div style={s.cabecera}>
        <button className="btn btn-fantasma" onClick={onVolver}>
          ‹ Volver al panel
        </button>
      </div>
      <div className="aparece">
        <h2 style={{ margin: 0 }}>📊 Estadísticas</h2>
        <small style={s.suave}>
          {restaurante.nombre} · del {fechaCorta(desde)} al {fechaCorta(hasta)}
        </small>
      </div>

      <Segmento etiqueta="Período" valor={dias} onChange={(v) => setDias(v)} opciones={RANGOS} />

      {SECCIONES.map(({ id, Componente }) => (
        <Componente key={id} restaurante={restaurante} desde={desde} hasta={hasta} />
      ))}

      <small style={s.suave}>
        Pronto se irán sumando más estadísticas aquí. Los tiempos y las horas se calculan con la zona horaria de tu local.
      </small>
    </div>
  )
}

// Botón para llevar a esta página (se pone en los reportes). Abre otra pestaña.
export function BotonEstadisticas() {
  return (
    <button
      className="btn btn-sec btn-bloque"
      style={{ display: 'grid', gap: 2, justifyItems: 'start', textAlign: 'left', padding: '12px 14px', whiteSpace: 'normal', boxSizing: 'border-box', maxWidth: '100%' }}
      onClick={() => {
        sentir('toque')
        const url = `${window.location.pathname}${window.location.search}#/estadisticas`
        const nueva = window.open(url, '_blank')
        if (!nueva) window.location.hash = '#/estadisticas'
      }}
    >
      <b>📊 Estadísticas avanzadas ↗</b>
      <small style={{ color: '#6f6477', fontWeight: 600 }}>Tiempos de cocina, horas punta y más. Se abre en otra pestaña.</small>
    </button>
  )
}

const s = {
  pagina: { display: 'grid', gap: 14, maxWidth: 860, margin: '0 auto', width: '100%' },
  cabecera: { marginLeft: -8 },
  suave: { color: '#6f6477' },
  seccion: { display: 'grid', gap: 14, padding: 16, borderRadius: 20 },
  subtitulo: { fontSize: 15 },
  filaTitulo: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  datos: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 10 },
  dato: { display: 'grid', gap: 2, alignContent: 'start', background: 'var(--lavanda)', borderRadius: 14, padding: '10px 12px' },
  datoValor: { fontSize: 'clamp(20px, 5.6vw, 24px)', fontWeight: 900, lineHeight: 1.15, overflowWrap: 'anywhere' },
  destacado: { display: 'grid', gap: 4, background: '#fff8e8', border: '1px solid #f7dca0', borderRadius: 14, padding: '10px 12px', fontSize: 15 },
  barra: { display: 'flex', alignItems: 'center', gap: 10 },
  barraNombre: { width: '34%', flex: 'none', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pista: { flex: 1, minWidth: 0, height: 12, borderRadius: 99, background: 'var(--lavanda)', overflow: 'hidden' },
  relleno: { display: 'block', height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #FFC23D, #F2A900)' },
  barraValor: { flex: 'none', width: 92, textAlign: 'right', fontSize: 14 },
  mapa: { display: 'grid', gridTemplateColumns: '44px repeat(7, minmax(0, 1fr))', gap: 4, alignItems: 'center' },
  diaCabecera: { textAlign: 'center', fontSize: 13, color: 'var(--suave)' },
  horaEtiqueta: { color: 'var(--suave)', fontWeight: 700, fontSize: 12 },
  celda: {
    minHeight: 34,
    padding: 0,
    border: 'none',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'transform 160ms var(--resorte), outline-color 160ms var(--ease)',
  },
  detalle: { display: 'grid', gap: 2, minHeight: 64, alignContent: 'center', background: 'var(--lavanda)', borderRadius: 14, padding: '10px 12px' },
}
