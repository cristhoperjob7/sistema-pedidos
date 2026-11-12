import { useEffect, useMemo, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Cargando, Mensaje, NumeroAnimado } from './ui'
import { sentir } from './feedback'
import { hoyEn } from './agotado'
import { traerTodo } from './consultas'
import Asistente from './Asistente'
import './inicio.css'

// =============================================================================================
// INICIO DEL ADMINISTRADOR: lo más importante del día de un vistazo.
// Se refresca solo cada 30 segundos. Todo se calcula con los pedidos cobrados del día
// (y los de ayer y del mismo día de la semana pasada, para comparar).
// =============================================================================================

// Suma o resta días a una fecha "AAAA-MM-DD".
function mover(dia, n) {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

// Hora (0-23) de un instante en la zona horaria del restaurante.
function horaLocal(iso, zona) {
  try {
    const h = Number(new Date(iso).toLocaleString('en-US', { timeZone: zona, hour: 'numeric', hourCycle: 'h23' }))
    return Number.isFinite(h) ? h % 24 : 0
  } catch {
    return new Date(iso).getHours()
  }
}

function saludo(zona) {
  const h = horaLocal(new Date().toISOString(), zona || 'America/Santiago')
  return h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}

// Cambio porcentual entre dos valores; null si no hay con qué comparar.
function variacion(actual, antes) {
  if (!antes) return null
  return Math.round(((actual - antes) / antes) * 100)
}

function Cambio({ valor, contra }) {
  if (valor === null) return <small className="suave">Sin datos {contra}</small>
  const sube = valor >= 0
  return (
    <small className={`ini-cambio ${valor === 0 ? '' : sube ? 'sube' : 'baja'}`}>
      <Icono n="tendencia" tam={13} style={{ transform: sube ? 'none' : 'scaleY(-1)' }} />
      {sube ? '+' : ''}
      {valor}% {contra}
    </small>
  )
}

export default function Inicio({ restaurante, conPedidos, ir }) {
  const zona = restaurante.zona_horaria
  const hoy = hoyEn(zona)
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    if (!conPedidos) return
    let vigente = true
    ;(async () => {
      const dias = [hoy, mover(hoy, -1), mover(hoy, -7)]
      const [pedidos, abiertos, mesas] = await Promise.all([
        traerTodo(() =>
          supabase
            .from('pedidos')
            .select('id, dia, total, propina, estado, cerrado_en, llevar_numero, metodos_pago(nombre), pagos_pedido(monto_venta, metodos_pago(nombre)), items_pedido(nombre, cantidad)')
            .eq('restaurante_id', restaurante.id)
            .in('dia', dias)
            .order('id')
        ),
        supabase.from('pedidos').select('id, llevar_numero').eq('restaurante_id', restaurante.id).eq('estado', 'abierto'),
        supabase.from('mesas').select('id, unida_a').eq('restaurante_id', restaurante.id).eq('activo', true),
      ])
      if (!vigente) return
      const fallo = pedidos.error ?? abiertos.error ?? mesas.error
      if (fallo) return setError(fallo.message)
      setError('')
      setDatos({ pedidos: pedidos.data, abiertos: abiertos.data ?? [], mesas: mesas.data ?? [] })
    })()
    return () => {
      vigente = false
    }
  }, [restaurante.id, hoy, recarga, conPedidos])

  useEffect(() => {
    if (!conPedidos) return
    const id = setInterval(() => setRecarga((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [conPedidos])

  const r = useMemo(() => {
    if (!datos) return null
    const pagados = (d) => datos.pedidos.filter((p) => p.dia === d && p.estado === 'pagado')
    const suma = (l) => l.reduce((t, p) => t + Number(p.total), 0)
    const delHoy = pagados(hoy)
    const ventas = suma(delHoy)
    const propinas = delHoy.reduce((t, p) => t + Number(p.propina ?? 0), 0)

    // Ventas por hora
    const porHora = new Array(24).fill(0)
    delHoy.forEach((p) => {
      if (p.cerrado_en) porHora[horaLocal(p.cerrado_en, zona)] += Number(p.total)
    })
    const conVenta = porHora.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0)
    const ahora = horaLocal(new Date().toISOString(), zona)

    const platos = new Map()
    const pagos = new Map()
    delHoy.forEach((p) => {
      p.items_pedido.forEach((i) => platos.set(i.nombre, (platos.get(i.nombre) ?? 0) + i.cantidad))
      if (p.pagos_pedido?.length) {
        p.pagos_pedido.forEach((l) => {
          const m = l.metodos_pago?.nombre ?? 'Sin método'
          pagos.set(m, (pagos.get(m) ?? 0) + Number(l.monto_venta))
        })
      } else if (Number(p.total) > 0) {
        const m = p.metodos_pago?.nombre ?? 'Sin método'
        pagos.set(m, (pagos.get(m) ?? 0) + Number(p.total))
      }
    })

    const mesasVisibles = datos.mesas.filter((m) => !m.unida_a).length
    const mesasOcupadas = new Set(datos.abiertos.filter((p) => p.llevar_numero == null).map((p) => p.id)).size

    return {
      ventas,
      propinas,
      cuentas: delHoy.length,
      ticket: delHoy.length ? ventas / delHoy.length : 0,
      vsAyer: variacion(ventas, suma(pagados(mover(hoy, -1)))),
      vsSemana: variacion(ventas, suma(pagados(mover(hoy, -7)))),
      porHora,
      desde: conVenta.length ? conVenta[0] : null,
      hasta: conVenta.length ? Math.max(conVenta[conVenta.length - 1], ahora >= conVenta[0] ? ahora : 0) : null,
      ahora,
      top: [...platos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      pagos: [...pagos.entries()].sort((a, b) => b[1] - a[1]),
      mesasVisibles,
      mesasOcupadas,
      porCobrar: datos.abiertos.length,
    }
  }, [datos, hoy, zona])

  const fmt = (n) => formatear(n, restaurante)
  const fecha = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: zona || 'America/Santiago' })

  return (
    <div className="ini">
      <header className="ini-cab">
        <div>
          <h2 style={{ margin: 0 }}>
            {saludo(zona)} <span className="ini-nombre">· {restaurante.nombre}</span>
          </h2>
          <small className="suave ini-fecha">{fecha}</small>
        </div>
        {conPedidos && (
          <button
            className="btn btn-chico btn-sec"
            onClick={() => {
              sentir('toque')
              setRecarga((n) => n + 1)
            }}
          >
            <Icono n="reloj" tam={15} className="it" /> Actualizar
          </button>
        )}
      </header>

      <Asistente restaurante={restaurante} ir={ir} />

      {conPedidos && (
        <>
          <Mensaje tipo="error">{error}</Mensaje>
          {!r && !error && <Cargando filas={2} alto={96} />}
          {r && (
            <>
              <section className="ini-kpis" aria-label="Resumen de hoy">
                <article className="ini-kpi ini-kpi-grande">
                  <small className="suave">Ventas de hoy</small>
                  <b className="ini-num">
                    <NumeroAnimado valor={r.ventas} formato={(n) => fmt(n)} />
                  </b>
                  <div className="ini-cambios">
                    <Cambio valor={r.vsAyer} contra="vs ayer" />
                    <Cambio valor={r.vsSemana} contra="vs mismo día de la semana pasada" />
                  </div>
                </article>
                <article className="ini-kpi">
                  <small className="suave">Cuentas cobradas</small>
                  <b className="ini-num">
                    <NumeroAnimado valor={r.cuentas} />
                  </b>
                  <small className="suave">{r.porCobrar > 0 ? `${r.porCobrar} abierta${r.porCobrar === 1 ? '' : 's'} ahora` : 'Ninguna abierta'}</small>
                </article>
                <article className="ini-kpi">
                  <small className="suave">Ticket promedio</small>
                  <b className="ini-num">
                    <NumeroAnimado valor={r.ticket} formato={(n) => fmt(n)} />
                  </b>
                  <small className="suave">por cuenta</small>
                </article>
                <article className="ini-kpi">
                  <small className="suave">Mesas ocupadas</small>
                  <b className="ini-num">
                    <NumeroAnimado valor={r.mesasOcupadas} />
                    <span className="suave" style={{ fontSize: '.55em', fontWeight: 700 }}> / {r.mesasVisibles}</span>
                  </b>
                  <div className="ini-barrita" aria-hidden="true">
                    <span style={{ width: `${r.mesasVisibles ? Math.min(100, (r.mesasOcupadas / r.mesasVisibles) * 100) : 0}%` }} />
                  </div>
                </article>
                <article className="ini-kpi">
                  <small className="suave">Propinas</small>
                  <b className="ini-num">
                    <NumeroAnimado valor={r.propinas} formato={(n) => fmt(n)} />
                  </b>
                  <small className="suave">de hoy</small>
                </article>
              </section>

              <div className="ini-dos">
                <GraficoHoras r={r} fmt={fmt} />
                <section className="ini-tarjeta">
                  <h3>Lo más vendido hoy</h3>
                  {r.top.length === 0 ? (
                    <Vacio texto="Cuando se cobren cuentas, aquí verás los platos estrella del día." />
                  ) : (
                    <ol className="ini-top">
                      {r.top.map(([nombre, n], i) => (
                        <li key={nombre}>
                          <span className="ini-pos">{i + 1}</span>
                          <span className="ini-top-nombre">{nombre}</span>
                          <b>{n}</b>
                          <span className="ini-top-barra" aria-hidden="true">
                            <span style={{ width: `${(n / r.top[0][1]) * 100}%` }} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>

              {r.pagos.length > 0 && (
                <section className="ini-tarjeta">
                  <h3>Cómo pagaron hoy</h3>
                  <ul className="ini-pagos">
                    {r.pagos.map(([nombre, total]) => (
                      <li key={nombre}>
                        <span>{nombre}</span>
                        <span className="ini-pago-barra" aria-hidden="true">
                          <span style={{ width: `${r.ventas ? (total / r.ventas) * 100 : 0}%` }} />
                        </span>
                        <b>{fmt(total)}</b>
                        <small className="suave">{r.ventas ? Math.round((total / r.ventas) * 100) : 0}%</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}

      <section aria-label="Accesos rápidos">
        <h3 className="ini-sub">Accesos rápidos</h3>
        <div className="ini-acc">
          {[
            conPedidos && ['pedidos', 'Tomar pedidos', 'orden'],
            conPedidos && ['cocina', 'Cocina', 'fuego'],
            conPedidos && ['caja', 'Cierre de caja', 'caja'],
            ['menu', 'Editar el menú', 'libro'],
            ['qr', 'Carta y QR', 'qr'],
            ['personal', 'Personal', 'personas'],
          ]
            .filter(Boolean)
            .map(([id, nombre, ic]) => (
              <button
                key={id}
                className="ini-acceso"
                onClick={() => {
                  ir(id)
                }}
              >
                <Icono n={ic} tam={22} />
                <span>{nombre}</span>
              </button>
            ))}
        </div>
      </section>
    </div>
  )
}

function Vacio({ texto }) {
  return (
    <div className="ini-vacio">
      <Icono n="barras" tam={26} ancho={1.5} />
      <small className="suave">{texto}</small>
    </div>
  )
}

// Ventas por hora: una sola serie, así que va sin leyenda (el título dice qué es).
// La barra de la hora actual va en el color de la marca y las demás en un tono más suave;
// solo se rotula el valor más alto. Cada barra explica su dato al pasar el cursor, tocarla o enfocarla.
function GraficoHoras({ r, fmt }) {
  const [activa, setActiva] = useState(null)
  if (r.desde === null) {
    return (
      <section className="ini-tarjeta">
        <h3>Ventas por hora</h3>
        <Vacio texto="Aún no hay ventas hoy. Aquí verás en qué horas se vende más." />
      </section>
    )
  }
  const horas = []
  for (let h = r.desde; h <= r.hasta; h++) horas.push(h)
  const max = Math.max(...horas.map((h) => r.porHora[h]), 1)
  const pico = horas.reduce((a, h) => (r.porHora[h] > r.porHora[a] ? h : a), horas[0])
  const paso = horas.length > 12 ? 2 : 1
  const etiqueta = (h) => `${String(h).padStart(2, '0')}:00`
  const resumen = `Ventas por hora de hoy. La hora más fuerte es ${etiqueta(pico)} con ${fmt(r.porHora[pico])}.`

  return (
    <section className="ini-tarjeta">
      <h3>Ventas por hora</h3>
      <div className="ini-graf" role="img" aria-label={resumen} onMouseLeave={() => setActiva(null)}>
        {activa !== null && (
          <div className="ini-tip" role="status">
            <b>{etiqueta(activa)}</b> · {fmt(r.porHora[activa])}
          </div>
        )}
        <div className="ini-barras">
          {horas.map((h) => {
            const v = r.porHora[h]
            return (
              <button
                key={h}
                type="button"
                className={`ini-barra${h === r.ahora ? ' ahora' : ''}${activa === h ? ' activa' : ''}`}
                aria-label={`${etiqueta(h)}: ${fmt(v)}`}
                onMouseEnter={() => setActiva(h)}
                onFocus={() => setActiva(h)}
                onClick={() => setActiva(h)}
              >
                {h === pico && v > 0 && <span className="ini-barra-val">{fmt(v)}</span>}
                <span className="ini-barra-col" style={{ height: `${Math.max(v > 0 ? 4 : 0, (v / max) * 100)}%` }} />
              </button>
            )
          })}
        </div>
        <div className="ini-eje" aria-hidden="true">
          {horas.map((h, i) => (
            <span key={h}>{i % paso === 0 ? String(h).padStart(2, '0') : ''}</span>
          ))}
        </div>
      </div>
      <details className="ini-tabla">
        <summary>Ver como tabla</summary>
        <table>
          <tbody>
            {horas.map((h) => (
              <tr key={h}>
                <td>{etiqueta(h)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(r.porHora[h])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
