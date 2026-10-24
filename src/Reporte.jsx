import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'

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
            style={s.fecha}
            value={dia}
            max={hoyEn(restaurante.zona_horaria)}
            onChange={(e) => e.target.value && setDia(e.target.value)}
          />
          <button style={s.botonSec} onClick={() => setRecarga((n) => n + 1)}>
            Actualizar
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
      {!r && !error && <p>Cargando...</p>}

      {r && (
        <>
          <div className="aparece" style={s.kpis}>
            <div style={s.kpi}>
              <small style={s.suave}>Vendido</small>
              <b style={s.kpiValor}>{formatear(r.vendido, restaurante)}</b>
            </div>
            <div style={s.kpi}>
              <small style={s.suave}>Cuentas cerradas</small>
              <b style={s.kpiValor}>{r.cuentas}</b>
            </div>
            <div style={s.kpi}>
              <small style={s.suave}>Anulado</small>
              <b style={{ ...s.kpiValor, color: r.anul.monto > 0 ? '#B3261E' : undefined }}>
                {formatear(r.anul.monto, restaurante)}
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
                {lista.map(([nombre, cantidad]) => (
                  <div key={nombre} style={s.barra}>
                    <span style={{ width: 130, flex: 'none', fontSize: 14 }}>{nombre}</span>
                    <i style={{ ...s.relleno, width: `${Math.max(6, (cantidad / maximo) * 55)}%` }} />
                    <b>{cantidad}</b>
                  </div>
                ))}
              </div>
            )
          })}

          <h4 style={s.titulo}>Por salón</h4>
          {r.meseras.length === 0 && <small style={s.suave}>Sin ventas todavía.</small>}
          {r.meseras.map(([nombre, m]) => (
            <div key={nombre} style={s.fila}>
              <span>
                {nombre} <small style={s.suave}>· {m.cuentas} cuenta(s)</small>
              </span>
              <b>{formatear(m.total, restaurante)}</b>
            </div>
          ))}

          <h4 style={s.titulo}>Por método de pago</h4>
          {r.pagos.length === 0 && <small style={s.suave}>Sin ventas todavía.</small>}
          {r.pagos.map(([nombre, total]) => (
            <div key={nombre} style={s.fila}>
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

              <button style={{ ...s.botonSec, marginTop: 8 }} onClick={() => setVerDetalle((v) => !v)}>
                {verDetalle ? 'Ocultar detalle' : `Ver detalle por pedido (${r.anul.detalle.length})`}
              </button>
            </div>
          )}

          {verDetalle &&
            r.anul.detalle.map((a) => (
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
        </>
      )}
    </div>
  )
}

const s = {
  cabecera: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  fecha: { padding: 8, fontSize: 15, borderRadius: 8, border: '1px solid #bbb' },
  botonSec: { padding: 8, fontSize: 14, borderRadius: 8, border: '1px solid #bbb', background: 'white', cursor: 'pointer' },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 },
  kpi: { background: 'white', border: '1px solid #e2dce8', borderRadius: 14, padding: 14, display: 'grid', gap: 2 },
  kpiValor: { fontSize: 24, fontWeight: 800 },
  suave: { color: '#6f6477' },
  titulo: { margin: '12px 0 2px', fontSize: 16 },
  subtitulo: { display: 'block', fontSize: 14, margin: '10px 0 2px' },
  barra: { display: 'flex', alignItems: 'center', gap: 10 },
  relleno: { display: 'block', height: 10, borderRadius: 5, background: '#F2A900' },
  resumen: { display: 'grid', gap: 4, fontSize: 14 },
  grupo: { background: 'white', border: '1px solid #e2dce8', borderRadius: 12, padding: '10px 12px' },
  grupoCabecera: { display: 'flex', justifyContent: 'space-between', paddingBottom: 6, marginBottom: 6, borderBottom: '1px solid #e2dce8' },
  grupoLinea: { display: 'flex', justifyContent: 'space-between', margin: 0, fontSize: 14, padding: '2px 0' },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', border: '1px solid #e2dce8', borderRadius: 12, padding: '10px 12px' },
}
