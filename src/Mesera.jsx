import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'

// Pantallas de la mesera: mapa de mesas, toma de pedido y cobro.
export default function Mesera({ restaurante }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [vista, setVista] = useState({ nombre: 'mesas' }) // { nombre: 'mesas' | 'mesa' | 'cobrar', mesaId }
  const temporizador = useRef(null)

  const cargar = useCallback(async () => {
    const rid = restaurante.id
    const [m, c, p, mp, pe] = await Promise.all([
      supabase.from('mesas').select('*').eq('restaurante_id', rid).eq('activo', true).order('numero'),
      supabase.from('categorias').select('*').eq('restaurante_id', rid).eq('activo', true).order('orden'),
      supabase.from('productos').select('*').eq('restaurante_id', rid).eq('activo', true).order('nombre'),
      supabase.from('metodos_pago').select('*').eq('restaurante_id', rid).eq('activo', true).order('orden'),
      supabase.from('pedidos').select('*').eq('restaurante_id', rid).eq('estado', 'abierto'),
    ])
    const fallo = m.error || c.error || p.error || mp.error || pe.error
    if (fallo) {
      setError(fallo.message)
      return
    }
    let items = []
    if (pe.data.length) {
      const it = await supabase
        .from('items_pedido')
        .select('*')
        .in('pedido_id', pe.data.map((x) => x.id))
        .order('creado_en')
      if (it.error) {
        setError(it.error.message)
        return
      }
      items = it.data
    }
    setError('')
    setDatos({ mesas: m.data, cats: c.data, prods: p.data, pagos: mp.data, pedidos: pe.data, items })
  }, [restaurante.id])

  // Carga inicial + tiempo real: si otro dispositivo cambia un pedido, esta pantalla se actualiza sola.
  useEffect(() => {
    cargar()
    const programar = () => {
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(cargar, 250)
    }
    const filtro = `restaurante_id=eq.${restaurante.id}`
    const canal = supabase
      .channel(`salon-${restaurante.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: filtro }, programar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items_pedido', filter: filtro }, programar)
      .subscribe()
    return () => {
      clearTimeout(temporizador.current)
      supabase.removeChannel(canal)
    }
  }, [cargar, restaurante.id])

  const pedidoPorMesa = useMemo(() => {
    const mapa = new Map()
    datos?.pedidos.forEach((p) => mapa.set(p.mesa_id, p))
    return mapa
  }, [datos])

  const itemsPorPedido = useMemo(() => {
    const mapa = new Map()
    datos?.items.forEach((i) => mapa.set(i.pedido_id, [...(mapa.get(i.pedido_id) ?? []), i]))
    return mapa
  }, [datos])

  if (error && !datos) return <p style={{ color: 'crimson' }}>Error: {error}</p>
  if (!datos) return <p>Cargando...</p>

  const mesa = vista.mesaId ? datos.mesas.find((m) => m.id === vista.mesaId) : null
  const pedido = mesa ? pedidoPorMesa.get(mesa.id) : undefined
  const items = pedido ? itemsPorPedido.get(pedido.id) ?? [] : []

  if (vista.nombre === 'mesa' && mesa) {
    return (
      <Mesa
        key={mesa.id}
        restaurante={restaurante}
        datos={datos}
        mesa={mesa}
        pedido={pedido}
        items={items}
        recargar={cargar}
        onVolver={() => setVista({ nombre: 'mesas' })}
        onCobrar={() => setVista({ nombre: 'cobrar', mesaId: mesa.id })}
      />
    )
  }

  if (vista.nombre === 'cobrar' && mesa) {
    return (
      <Cobrar
        restaurante={restaurante}
        datos={datos}
        mesa={mesa}
        pedido={pedido}
        items={items}
        onVolver={() => setVista({ nombre: 'mesa', mesaId: mesa.id })}
        onListo={() => {
          cargar()
          setVista({ nombre: 'mesas' })
        }}
      />
    )
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 12px' }}>Mesas</h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {datos.mesas.length === 0 && <p>No hay mesas activas. El administrador puede agregarlas en “Mesas y ajustes”.</p>}
      <div style={s.grid}>
        {datos.mesas.map((m) => {
          const p = pedidoPorMesa.get(m.id)
          const its = p ? itemsPorPedido.get(p.id) ?? [] : []
          const ocupada = !!p
          return (
            <button
              key={m.id}
              style={{ ...s.mesa, borderColor: ocupada ? '#B3261E' : '#2E7D4F' }}
              onClick={() => setVista({ nombre: 'mesa', mesaId: m.id })}
            >
              <b style={{ fontSize: 26 }}>{m.numero}</b>
              {m.nombre && <small style={{ color: '#6f6477' }}>{m.nombre}</small>}
              <span style={{ fontWeight: 600, fontSize: 14, color: ocupada ? '#B3261E' : '#2E7D4F' }}>
                {ocupada ? 'Ocupada' : 'Libre'}
              </span>
              <small style={{ color: '#6f6477' }}>
                {ocupada
                  ? `#${p.numero} · ${its.reduce((n, i) => n + i.cantidad, 0)} ítems · ${formatear(p.total, restaurante)}`
                  : 'Tocar para abrir'}
              </small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Mesa({ restaurante, datos, mesa, pedido, items, onVolver, onCobrar, recargar }) {
  const [catId, setCatId] = useState(datos.cats[0]?.id ?? null)
  const [pend, setPend] = useState({}) // productos elegidos que todavía no se confirman: { [productoId]: cantidad }
  const [conf, setConf] = useState(null) // clave de la línea que se está por anular
  const [cq, setCq] = useState(1) // cuántas unidades anular
  const [confTodo, setConfTodo] = useState(false)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [llevar, setLlevar] = useState(false) // false = servir en el local

  const catsPorId = useMemo(() => new Map(datos.cats.map((c) => [c.id, c])), [datos.cats])
  const prodsPorId = useMemo(() => new Map(datos.prods.map((p) => [p.id, p])), [datos.prods])
  const catActual = catsPorId.get(catId)
  const prodsCat = datos.prods.filter((p) => p.categoria_id === catId)

  // Lo confirmado, juntando los productos iguales en una sola línea.
  const grupos = useMemo(() => {
    const g = new Map()
    for (const i of items) {
      const clave = `${i.nombre}|${i.va_a_cocina}`
      const x = g.get(clave) ?? { clave, nombre: i.nombre, va_a_cocina: i.va_a_cocina, cantidad: 0, llevar: 0, total: 0 }
      x.cantidad += i.cantidad
      if (i.para_llevar) x.llevar += i.cantidad
      x.total += i.cantidad * Number(i.precio_unitario)
      g.set(clave, x)
    }
    return [...g.values()]
  }, [items])

  const lineasPend = Object.entries(pend)
    .map(([id, n]) => ({ prod: prodsPorId.get(id), n }))
    .filter((x) => x.prod && x.n > 0)
  const cocinaTab = !!catActual?.va_a_cocina
  const lineasTab = lineasPend.filter((x) => !!catsPorId.get(x.prod.categoria_id)?.va_a_cocina === cocinaTab)
  const hayOtras = lineasPend.length - lineasTab.length

  const totalConf = items.reduce((t, i) => t + i.cantidad * Number(i.precio_unitario), 0)
  const totalPend = lineasPend.reduce((t, x) => t + x.n * Number(x.prod.precio), 0)
  const unidades = items.reduce((n, i) => n + i.cantidad, 0) + lineasPend.reduce((n, x) => n + x.n, 0)

  function cambiar(prod, d) {
    setPend((p) => {
      const n = Math.max(0, Math.min(99, (p[prod.id] ?? 0) + d))
      const c = { ...p }
      if (n === 0) delete c[prod.id]
      else c[prod.id] = n
      return c
    })
  }

  async function llamar(nombre, args) {
    setError('')
    setTrabajando(true)
    const { error } = await supabase.rpc(nombre, args)
    setTrabajando(false)
    if (error) {
      setError(error.message)
      return false
    }
    return true
  }

  async function confirmar() {
    if (!lineasTab.length) return
    const ok = await llamar('enviar_items', {
      p_mesa: mesa.id,
      p_items: lineasTab.map((x) => ({ producto_id: x.prod.id, cantidad: x.n })),
      p_llevar: llevar,
    })
    if (ok) {
      setLlevar(false)
      setPend((p) => {
        const c = { ...p }
        lineasTab.forEach((x) => delete c[x.prod.id])
        return c
      })
      recargar()
    }
  }

  async function anular(g) {
    const ok = await llamar('anular_linea', {
      p_pedido: pedido.id,
      p_nombre: g.nombre,
      p_va_a_cocina: g.va_a_cocina,
      p_cantidad: Math.min(cq, g.cantidad),
    })
    setConf(null)
    if (ok) recargar()
  }

  async function anularTodo() {
    const ok = await llamar('anular_pedido', { p_pedido: pedido.id })
    setConfTodo(false)
    if (ok) {
      recargar()
      if (lineasPend.length === 0) onVolver()
    }
  }

  const puedeCobrar = grupos.length > 0 && lineasPend.length === 0 && !trabajando

  return (
    <div style={{ paddingBottom: lineasTab.length > 0 ? 170 : 110 }}>
      <div style={s.cabecera}>
        <button style={s.volver} onClick={onVolver}>
          ‹ Mesas
        </button>
        <h2 style={{ margin: 0 }}>
          Mesa {mesa.numero}
          {mesa.nombre ? ` · ${mesa.nombre}` : ''}
        </h2>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {grupos.length > 0 && pedido && (
        <>
          <h3 style={s.titulo}>Pedido #{pedido.numero}</h3>
          {grupos.map((g) => (
            <div key={g.clave} style={s.fila}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <b>
                  {g.cantidad} × {g.nombre}
                </b>
                <br />
                <small style={{ color: '#6f6477' }}>
                  {g.va_a_cocina ? 'En cocina' : 'No va a cocina'}
                  {g.llevar > 0 ? ` · ${g.llevar === g.cantidad ? 'para llevar' : `${g.llevar} para llevar`}` : ''} ·{' '}
                  {formatear(g.total, restaurante)}
                </small>
              </div>
              {conf === g.clave ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {g.cantidad > 1 && (
                    <div style={s.cantidad}>
                      <button style={s.menos} onClick={() => setCq((n) => Math.max(1, n - 1))}>
                        −
                      </button>
                      <b>{Math.min(cq, g.cantidad)}</b>
                      <button style={s.mas} onClick={() => setCq((n) => Math.min(g.cantidad, n + 1))}>
                        +
                      </button>
                    </div>
                  )}
                  <button style={s.peligro} disabled={trabajando} onClick={() => anular(g)}>
                    Sí, anular
                  </button>
                  <button style={s.secundario} onClick={() => setConf(null)}>
                    No
                  </button>
                </div>
              ) : (
                <button
                  style={s.secundario}
                  onClick={() => {
                    setConf(g.clave)
                    setCq(1)
                    setConfTodo(false)
                  }}
                >
                  Anular
                </button>
              )}
            </div>
          ))}

          {confTodo ? (
            <div style={s.fila}>
              <b style={{ flex: '1 1 100%' }}>¿Anular la orden completa?</b>
              <button style={s.peligro} disabled={trabajando} onClick={anularTodo}>
                Sí, anular todo
              </button>
              <button style={s.secundario} onClick={() => setConfTodo(false)}>
                No
              </button>
            </div>
          ) : (
            <button
              style={{ ...s.peligro, width: '100%', marginTop: 6 }}
              onClick={() => {
                setConfTodo(true)
                setConf(null)
              }}
            >
              ANULAR ORDEN COMPLETA
            </button>
          )}
          <h3 style={s.titulo}>Agregar al pedido</h3>
        </>
      )}

      <div style={s.chips}>
        {datos.cats.map((c) => (
          <button key={c.id} style={c.id === catId ? s.chipOn : s.chip} onClick={() => setCatId(c.id)}>
            {c.nombre}
          </button>
        ))}
      </div>

      {datos.cats.length === 0 && <p>El menú está vacío. El administrador puede cargarlo en la pestaña “Menú”.</p>}
      {catActual && !catActual.va_a_cocina && (
        <p style={s.nota}>Estos productos no pasan por cocina. Toca AÑADIR para sumarlos al pedido.</p>
      )}

      {prodsCat.map((p) => {
        const q = pend[p.id] ?? 0
        return (
          <div key={p.id} style={s.fila}>
            <div style={{ flex: 1 }}>
              <b>{p.nombre}</b>
              <br />
              <small style={{ color: '#6f6477' }}>{formatear(p.precio, restaurante)}</small>
            </div>
            <div style={s.cantidad}>
              {q > 0 && (
                <>
                  <button style={s.menos} onClick={() => cambiar(p, -1)}>
                    −
                  </button>
                  <b style={{ minWidth: 18, textAlign: 'center' }}>{q}</b>
                </>
              )}
              <button style={s.mas} onClick={() => cambiar(p, 1)}>
                +
              </button>
            </div>
          </div>
        )
      })}
      {datos.cats.length > 0 && prodsCat.length === 0 && <p>Esta categoría no tiene productos activos.</p>}

      {hayOtras > 0 && (
        <p style={s.nota}>Tienes productos pendientes en otra categoría. Cámbiate a ella para confirmarlos.</p>
      )}
      {lineasPend.length > 0 && grupos.length > 0 && (
        <p style={s.nota}>Para cobrar, primero confirma o quita los productos pendientes.</p>
      )}

      <div style={s.barra}>
        {lineasTab.length > 0 && (
          <div style={{ ...s.barraInterior, marginBottom: 10 }}>
            <div style={s.segmento} role="group" aria-label="Modalidad del pedido">
              <button style={!llevar ? s.segOn : s.segOff} onClick={() => setLlevar(false)} aria-pressed={!llevar}>
                🍽️ Servir
              </button>
              <button style={llevar ? s.segOn : s.segOff} onClick={() => setLlevar(true)} aria-pressed={llevar}>
                🥡 Para llevar
              </button>
            </div>
          </div>
        )}
        <div style={s.barraInterior}>
          <div style={{ flex: 1 }}>
            <small style={{ color: '#6f6477', display: 'block' }}>{unidades} ítems</small>
            <b style={{ fontSize: 22 }}>{formatear(totalConf + totalPend, restaurante)}</b>
          </div>
          <button
            style={{ ...s.secundario, opacity: lineasTab.length && !trabajando ? 1 : 0.5 }}
            disabled={!lineasTab.length || trabajando}
            onClick={confirmar}
          >
            {cocinaTab ? 'A cocina' : 'AÑADIR'}
          </button>
          <button
            style={{ ...s.principal, opacity: puedeCobrar ? 1 : 0.5 }}
            disabled={!puedeCobrar}
            onClick={onCobrar}
          >
            Cobrar
          </button>
        </div>
      </div>
    </div>
  )
}

function Cobrar({ restaurante, datos, mesa, pedido, items, onVolver, onListo }) {
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  const lineas = useMemo(() => {
    const g = new Map()
    for (const i of items) {
      const x = g.get(i.nombre) ?? { nombre: i.nombre, cantidad: 0, total: 0 }
      x.cantidad += i.cantidad
      x.total += i.cantidad * Number(i.precio_unitario)
      g.set(i.nombre, x)
    }
    return [...g.values()]
  }, [items])
  const total = lineas.reduce((t, l) => t + l.total, 0)

  async function cobrar(metodo) {
    setError('')
    setTrabajando(true)
    const { error } = await supabase.rpc('cobrar_pedido', { p_pedido: pedido.id, p_metodo: metodo.id })
    setTrabajando(false)
    if (error) setError(error.message)
    else onListo()
  }

  if (!pedido) {
    return (
      <div>
        <p>Esta cuenta ya no está abierta.</p>
        <button style={s.secundario} onClick={onListo}>
          Volver a las mesas
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={s.cabecera}>
        <button style={s.volver} onClick={onVolver}>
          ‹ Volver
        </button>
        <h2 style={{ margin: 0 }}>Cobrar mesa {mesa.numero}</h2>
      </div>
      <small style={{ color: '#6f6477' }}>Pedido #{pedido.numero}</small>

      {lineas.map((l) => (
        <div key={l.nombre} style={s.fila}>
          <b style={{ flex: 1 }}>
            {l.cantidad} × {l.nombre}
          </b>
          <b>{formatear(l.total, restaurante)}</b>
        </div>
      ))}

      <h2>Total {formatear(total, restaurante)}</h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {datos.pagos.length === 0 && (
        <p>No hay métodos de pago activos. El administrador puede agregarlos en “Mesas y ajustes”.</p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {datos.pagos.map((m) => (
          <button key={m.id} style={s.principal} disabled={trabajando} onClick={() => cobrar(m)}>
            {m.nombre}
          </button>
        ))}
      </div>
    </div>
  )
}

const s = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 },
  mesa: {
    display: 'grid',
    gap: 2,
    textAlign: 'left',
    padding: 14,
    borderRadius: 14,
    border: '2px solid',
    background: 'white',
    cursor: 'pointer',
    font: 'inherit',
  },
  cabecera: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 },
  volver: { border: 'none', background: 'none', fontSize: 16, color: '#4B1E4D', cursor: 'pointer', fontWeight: 600 },
  titulo: { margin: '16px 0 8px', fontSize: 17 },
  fila: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    background: 'white',
    border: '1px solid #e2dce8',
    borderRadius: 12,
    padding: '10px 12px',
    marginBottom: 8,
  },
  chips: { display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 0 10px' },
  chip: { flex: 'none', padding: '9px 14px', borderRadius: 99, border: '1px solid #bbb', background: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  chipOn: { flex: 'none', padding: '9px 14px', borderRadius: 99, border: '1px solid #F2A900', background: '#F2A900', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  cantidad: { display: 'flex', alignItems: 'center', gap: 10 },
  menos: { width: 38, height: 38, borderRadius: '50%', border: 'none', background: '#efe9f3', fontSize: 20, fontWeight: 800, cursor: 'pointer' },
  mas: { width: 38, height: 38, borderRadius: '50%', border: 'none', background: '#F2A900', fontSize: 20, fontWeight: 800, cursor: 'pointer' },
  nota: { background: '#efe9f3', borderRadius: 10, padding: 10, fontSize: 13, color: '#5b4d63', margin: '8px 0' },
  barra: { position: 'fixed', left: 0, right: 0, bottom: 0, background: 'white', borderTop: '1px solid #e2dce8', padding: '12px 16px' },
  segmento: { display: 'flex', flex: 1, background: '#efe9f3', borderRadius: 12, padding: 4, gap: 4 },
  segOff: { flex: 1, padding: '10px 12px', borderRadius: 9, border: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, color: '#5b4d63', cursor: 'pointer' },
  segOn: { flex: 1, padding: '10px 12px', borderRadius: 9, border: 'none', background: '#4B1E4D', color: 'white', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  barraInterior: { maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'center' },
  principal: { padding: '14px 18px', borderRadius: 12, border: 'none', background: '#F2A900', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  secundario: { padding: '12px 16px', borderRadius: 12, border: 'none', background: '#efe9f3', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  peligro: { padding: '12px 16px', borderRadius: 12, border: 'none', background: '#B3261E', color: 'white', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
}
