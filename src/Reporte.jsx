import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Cargando, Desplegable, Mensaje, NumeroAnimado } from './ui'
import { sentir } from './feedback'

// Fecha de hoy (AAAA-MM-DD) en la zona horaria del restaurante.
function hoyEn(zona) {
  return new Date().toLocaleDateString('en-CA', { timeZone: zona || 'America/Santiago' })
}

// Para separar "lo más vendido" según el Tipo de cada categoría (se edita en el Menú).
// Así un restaurante de helados ve "Postres más vendidos" y no "Platos más vendidos".
const TIPOS_INFO = {
  plato: { icono: '🍽️', titulo: 'Platos más vendidos' },
  postre: { icono: '🍰', titulo: 'Postres más vendidos' },
  bebida: { icono: '🥤', titulo: 'Bebidas más vendidas' },
  otro: { icono: '📦', titulo: 'Otros más vendidos' },
}
const ORDEN_TIPOS = ['plato', 'postre', 'bebida', 'otro']

export default function Reporte({ restaurante }) {
  const [dia, setDia] = useState(() => hoyEn(restaurante.zona_horaria))
  const [pedidos, setPedidos] = useState(null)
  const [nombres, setNombres] = useState({}) // usuario_id -> nombre
  const [error, setError] = useState('')
  const [recarga, setRecarga] = useState(0)
  const [verDetalle, setVerDetalle] = useState(false)
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
        'id, numero, total, estado, mesero_id, mesa_numero, metodos_pago(nombre), items_pedido(nombre, cantidad, productos(categorias(tipo))), anulaciones(nombre, cantidad, monto, anulado_por, envio_id)'
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

  useEffect(() => {
    setVerDetalle(false)
  }, [dia])

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

    const porTipo = { plato: new Map(), postre: new Map(), bebida: new Map(), otro: new Map() }
    const pagos = new Map()
    const meseras = new Map()
    pagados.forEach((p) => {
      p.items_pedido.forEach((i) => {
        const tipo = i.productos?.categorias?.tipo ?? 'otro'
        const m = porTipo[tipo] ?? porTipo.otro
        m.set(i.nombre, (m.get(i.nombre) ?? 0) + i.cantidad)
      })
      const metodo = p.metodos_pago?.nombre ?? 'Sin método'
      pagos.set(metodo, (pagos.get(metodo) ?? 0) + Number(p.total))
      const m = meseras.get(nombre(p.mesero_id)) ?? { cuentas: 0, total: 0 }
      m.cuentas += 1
      m.total += Number(p.total)
      meseras.set(nombre(p.mesero_id), m)
    })

    // ---- Anulaciones: resumen + detalle
    const todas = pedidos.flatMap((p) => p.anulaciones)
    const montoAnulado = todas.reduce((t, a) => t + Number(a.monto), 0)
    const unidadesAnuladas = todas.reduce((t, a) => t + a.cantidad, 0)
    const deCocina = todas.filter((a) => a.envio_id)
    const porPersona = new Map()
    const porProducto = new Map()
    todas.forEach((a) => {
      const x = porPersona.get(nombre(a.anulado_por)) ?? { unidades: 0, monto: 0 }
      x.unidades += a.cantidad
      x.monto += Number(a.monto)
      porPersona.set(nombre(a.anulado_por), x)
      porProducto.set(a.nombre, (porProducto.get(a.nombre) ?? 0) + a.cantidad)
    })

    const detalle = pedidos
      .filter((p) => p.anulaciones.length > 0)
      .map((p) => {
        const lineas = new Map()
        p.anulaciones.forEach((a) => {
          const x = lineas.get(a.nombre) ?? { cantidad: 0, monto: 0 }
          x.cantidad += a.cantidad
          x.monto += Number(a.monto)
          lineas.set(a.nombre, x)
        })
        return {
          id: p.id,
          mesa: p.mesa_numero ?? '?',
          numero: p.numero,
          completa: p.estado === 'anulado',
          lineas: [...lineas.entries()],
          total: p.anulaciones.reduce((t, a) => t + Number(a.monto), 0),
        }
      })
      .sort((a, b) => a.numero - b.numero)

    return {
      vendido,
      cuentas: pagados.length,
      abiertas: pedidos.filter((p) => p.estado === 'abierto').length,
      topPorTipo: ORDEN_TIPOS.map((tipo) => [tipo, [...porTipo[tipo].entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)]).filter(
        ([, lista]) => lista.length > 0
      ),
      pagos: [...pagos.entries()].sort((a, b) => b[1] - a[1]),
      meseras: [...meseras.entries()].sort((a, b) => b[1].total - a[1].total),
      anul: {
        monto: montoAnulado,
        unidades: unidadesAnuladas,
        porcentaje: vendido + montoAnulado > 0 ? (montoAnulado / (vendido + montoAnulado)) * 100 : 0,
        completas: pedidos.filter((p) => p.estado === 'anulado').length,
        cocinaUnidades: deCocina.reduce((t, a) => t + a.cantidad, 0),
        cocinaMonto: deCocina.reduce((t, a) => t + Number(a.monto), 0),
        porPersona: [...porPersona.entries()].sort((a, b) => b[1].monto - a[1].monto),
        topProductos: [...porProducto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
        detalle,
      },
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
              <small style={s.suave}>Anulado</small>
              <b style={{ ...s.kpiValor, color: r.anul.monto > 0 ? '#B3261E' : undefined }}>
                <NumeroAnimado valor={r.anul.monto} formato={(n) => formatear(n, restaurante)} />
              </b>
              <small style={s.suave}>{r.anul.porcentaje.toFixed(1)}% de lo pedido</small>
            </div>
          </div>
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
                  {info.icono} {info.titulo}
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

          <h4 style={s.titulo}>Por salón</h4>
          {r.meseras.length === 0 && <small style={s.suave}>Sin ventas todavía.</small>}
          {r.meseras.map(([nombre, m], i) => (
            <div key={nombre} className="entra" style={{ ...s.fila, animationDelay: `${i * 40}ms` }}>
              <span>
                {nombre} <small style={s.suave}>· {m.cuentas} cuenta(s)</small>
              </span>
              <b>{formatear(m.total, restaurante)}</b>
            </div>
          ))}

          <h4 style={s.titulo}>Por método de pago</h4>
          {r.pagos.length === 0 && <small style={s.suave}>Sin ventas todavía.</small>}
          {r.pagos.map(([nombre, total], i) => (
            <div key={nombre} className="entra" style={{ ...s.fila, animationDelay: `${i * 40}ms` }}>
              <span>{nombre}</span>
              <b>{formatear(total, restaurante)}</b>
            </div>
          ))}

          <h4 style={s.titulo}>Anulaciones</h4>
          {r.anul.unidades === 0 ? (
            <small style={s.suave}>Sin anulaciones.</small>
          ) : (
            <div style={s.grupo}>
              <div style={s.resumen}>
                <span>
                  <b>{r.anul.unidades}</b> productos anulados
                </span>
                <span>
                  <b>{r.anul.completas}</b> pedidos anulados completos
                </span>
                <span>
                  <b>{formatear(r.anul.cocinaMonto, restaurante)}</b> ya estaban en cocina ({r.anul.cocinaUnidades}{' '}
                  platos, posible pérdida)
                </span>
              </div>

              <b style={s.subtitulo}>Quién anuló</b>
              {r.anul.porPersona.map(([nombre, x]) => (
                <p key={nombre} style={s.grupoLinea}>
                  <span>
                    {nombre} <small style={s.suave}>· {x.unidades} productos</small>
                  </span>
                  <span>{formatear(x.monto, restaurante)}</span>
                </p>
              ))}

              <b style={s.subtitulo}>Más anulados</b>
              {r.anul.topProductos.map(([nombre, cantidad]) => (
                <p key={nombre} style={s.grupoLinea}>
                  <span>{nombre}</span>
                  <span>{cantidad}</span>
                </p>
              ))}

              <button
                className="btn btn-chico btn-sec"
                style={{ marginTop: 10 }}
                aria-expanded={verDetalle}
                onClick={() => {
                  sentir('toque')
                  setVerDetalle((v) => !v)
                }}
              >
                {verDetalle ? 'Ocultar detalle' : `Ver detalle por pedido (${r.anul.detalle.length})`}
                <span style={{ ...s.flecha, transform: verDetalle ? 'rotate(180deg)' : 'none' }} aria-hidden="true">
                  ▾
                </span>
              </button>
            </div>
          )}

          <Desplegable abierto={verDetalle} style={{ display: 'grid', gap: 10 }}>
            {r.anul.detalle.map((a) => (
              <div key={a.id} style={s.grupo}>
                <div style={s.grupoCabecera}>
                  <b>
                    Pedido #{a.numero} · Mesa {a.mesa}
                    {a.completa && <small style={{ color: '#B3261E' }}> · completo</small>}
                  </b>
                  <b>{formatear(a.total, restaurante)}</b>
                </div>
                {a.lineas.map(([nombre, x]) => (
                  <p key={nombre} style={s.grupoLinea}>
                    <span>
                      {x.cantidad} × {nombre}
                    </span>
                    <span>{formatear(x.monto, restaurante)}</span>
                  </p>
                ))}
              </div>
            ))}
          </Desplegable>
        </>
      )}
    </div>
  )
}

const s = {
  cabecera: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  gira: { display: 'inline-block', animation: 'gira 600ms var(--resorte)' },
  flecha: { display: 'inline-block', transition: 'transform 320ms var(--resorte)' },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12 },
  kpi: { background: 'white', border: '1px solid var(--linea)', borderRadius: 18, padding: 14, display: 'grid', gap: 2, boxShadow: 'var(--sombra)' },
  kpiPrincipal: {
    gridColumn: '1 / -1',
    color: 'white',
    border: 'none',
    background: 'linear-gradient(135deg, #5c2a5f 0%, #4B1E4D 60%, #3a173c 100%)',
    boxShadow: '0 14px 30px -18px rgba(75,30,77,.9)',
  },
  kpiValor: { fontSize: 'clamp(22px, 6vw, 26px)', fontWeight: 900 },
  suave: { color: '#6f6477' },
  titulo: { margin: '12px 0 2px', fontSize: 16 },
  subtitulo: { display: 'block', fontSize: 14, margin: '10px 0 2px' },
  barras: { display: 'grid', gap: 10, borderRadius: 16 },
  barra: { display: 'flex', alignItems: 'center', gap: 10 },
  barraNombre: { width: '38%', flex: 'none', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pista: { flex: 1, height: 12, borderRadius: 99, background: 'var(--lavanda)', overflow: 'hidden' },
  relleno: { display: 'block', height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #FFC23D, #F2A900)' },
  resumen: { display: 'grid', gap: 4, fontSize: 14 },
  grupo: { background: 'white', border: '1px solid var(--linea)', borderRadius: 16, padding: '10px 12px', boxShadow: 'var(--sombra)' },
  grupoCabecera: { display: 'flex', justifyContent: 'space-between', gap: 8, paddingBottom: 6, marginBottom: 6, borderBottom: '1px solid var(--linea)' },
  grupoLinea: { display: 'flex', justifyContent: 'space-between', gap: 8, margin: 0, fontSize: 14, padding: '2px 0' },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'white', border: '1px solid var(--linea)', borderRadius: 14, padding: '10px 12px', boxShadow: 'var(--sombra)' },
}
