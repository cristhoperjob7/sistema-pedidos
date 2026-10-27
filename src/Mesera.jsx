import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Cargando, Desplegable, Mensaje, NumeroAnimado, Segmento } from './ui'
import { avisar, celebrar, sentir, sonar, vibrar } from './feedback'
import Anclar from './Anclar'
import Agotados from './Agotados'
import { esPropio, estaAgotado, hoyEn, useHoy } from './agotado'

// Pedidos para llevar: no tienen mesa, se identifican como "Llevar 3" (y el nombre del cliente, si se pidió).
const esLlevar = (p) => p?.llevar_numero != null
const etiquetaLlevar = (p) => (p.cliente ? `Llevar ${p.llevar_numero} · ${p.cliente}` : `Llevar ${p.llevar_numero}`)
const etiquetaPedido = (p, mesas) =>
  esLlevar(p) ? etiquetaLlevar(p) : `Mesa ${mesas.find((m) => m.id === p?.mesa_id)?.numero ?? '?'}`
// "Mesa" ficticia para armar un pedido para llevar con la misma pantalla de las mesas.
const MESA_LLEVAR = { id: null, numero: null, nombre: null, llevar: true }

// Pantallas del salón: mapa de mesas, pedidos para llevar, toma de pedido y cobro.
// rol: 'admin' o 'mesera'. Solo cambia lo que se muestra; la base de datos hace cumplir los permisos.
export default function Mesera({ restaurante, rol = 'mesera' }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [vista, setVista] = useState({ nombre: 'mesas' }) // { nombre: 'mesas' | 'mesa' | 'llevar' | 'cobrar', mesaId, llevarId, atras }
  const temporizador = useRef(null)
  const listosVistos = useRef(null) // pedidos listos ya conocidos; null en la primera carga para no avisar de golpe

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
    let envios = [] // tickets de cocina ya marcados "Listo" de los pedidos abiertos
    if (pe.data.length) {
      const ids = pe.data.map((x) => x.id)
      const [it, le] = await Promise.all([
        supabase.from('items_pedido').select('*').in('pedido_id', ids).order('creado_en'),
        // Si esta consulta falla, el resto del salón sigue funcionando (solo se pierden los avisos de "listo").
        supabase
          .from('envios_cocina')
          .select('id, pedido_id, modalidad, entregado_en')
          .eq('restaurante_id', rid)
          .eq('estado', 'listo')
          .in('tipo', ['pedido', 'adicion'])
          .in('pedido_id', ids),
      ])
      if (it.error) {
        setError(it.error.message)
        return
      }
      items = it.data
      envios = le.data ?? []
    }
    setError('')

    // "Preparados": todo lo que cocina ya dejó listo (el salón no lo puede anular).
    // "Listos": lo preparado que todavía nadie retiró (avisa y marca la mesa).
    const preparados = new Set(envios.map((e) => e.id))
    const listos = envios.filter((e) => !e.entregado_en)

    // Aviso de "pedido listo": solo para los que no conocíamos (no en la primera carga).
    if (listosVistos.current) {
      const nuevos = listos.filter((e) => !listosVistos.current.has(e.id))
      if (nuevos.length) {
        const porPedido = new Map()
        nuevos.forEach((e) => porPedido.set(e.pedido_id, [...(porPedido.get(e.pedido_id) ?? []), e]))
        porPedido.forEach((es, pedidoId) => {
          const ped = pe.data.find((x) => x.id === pedidoId)
          const llevar = es.some((e) => e.modalidad === 'llevar') && !esLlevar(ped)
          avisar(`${etiquetaPedido(ped, m.data)} · listo para retirar${llevar ? ' (para llevar)' : ''}`, 'listo')
        })
        sonar('listo')
        vibrar('listo')
      }
    }
    listosVistos.current = new Set(listos.map((e) => e.id))

    setDatos({ mesas: m.data, cats: c.data, prods: p.data, pagos: mp.data, pedidos: pe.data, items, listos, preparados })
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
      // Cocina marcó un ticket como listo (o el salón lo entregó): se vuelve a leer lo pendiente de retirar.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'envios_cocina', filter: filtro }, programar)
      // Un plato se agotó (o volvió): se actualiza el menú y se avisa si lo hizo otra persona.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'productos', filter: filtro }, (carga) => {
        programar()
        const antes = carga.old
        const ahora = carga.new
        if (!ahora?.id || !antes || !('agotado_dia' in antes) || esPropio(ahora.id)) return
        const hoy = hoyEn(restaurante.zona_horaria)
        const estabaAgotado = antes.agotado_dia === hoy
        const estaAhora = ahora.agotado_dia === hoy
        if (estaAhora && !estabaAgotado) {
          avisar(`Se agotó: ${ahora.nombre}`, 'agotado')
          sonar('baja')
          vibrar('aviso')
        } else if (!estaAhora && estabaAgotado) {
          avisar(`Disponible otra vez: ${ahora.nombre}`, 'ok')
          sonar('pop')
        }
      })
      .subscribe()
    // Respaldo por si el tiempo real se corta: se actualiza cada minuto.
    const respaldo = setInterval(cargar, 60000)
    return () => {
      clearTimeout(temporizador.current)
      clearInterval(respaldo)
      supabase.removeChannel(canal)
    }
  }, [cargar, restaurante.id, restaurante.zona_horaria])

  const pedidoPorMesa = useMemo(() => {
    const mapa = new Map()
    datos?.pedidos.forEach((p) => p.mesa_id && mapa.set(p.mesa_id, p))
    return mapa
  }, [datos])

  const itemsPorPedido = useMemo(() => {
    const mapa = new Map()
    datos?.items.forEach((i) => mapa.set(i.pedido_id, [...(mapa.get(i.pedido_id) ?? []), i]))
    return mapa
  }, [datos])

  const listosPorPedido = useMemo(() => {
    const mapa = new Map()
    datos?.listos.forEach((e) => mapa.set(e.pedido_id, [...(mapa.get(e.pedido_id) ?? []), e]))
    return mapa
  }, [datos])

  // El salón retiró lo que cocina dejó listo en esa mesa.
  async function entregar(pedido) {
    sentir('toque', 'exito')
    // La marca "Lista" se apaga al instante; si algo falla se vuelve a leer la verdad.
    setDatos((d) => ({ ...d, listos: d.listos.filter((e) => e.pedido_id !== pedido.id) }))
    const { error } = await supabase.rpc('marcar_entregado', { p_pedido: pedido.id })
    if (error) {
      setError(error.message)
      cargar()
      return
    }
    setError('')
    avisar(`${etiquetaPedido(pedido, datos.mesas)} · entregado`, 'ok')
  }

  if (error && !datos) return <Mensaje tipo="error">{error}</Mensaje>
  if (!datos) return <Cargando filas={4} alto={84} />

  const enVistaLlevar = vista.nombre === 'llevar' || (vista.nombre === 'cobrar' && vista.llevarId !== undefined)
  const mesa = enVistaLlevar ? MESA_LLEVAR : vista.mesaId ? datos.mesas.find((m) => m.id === vista.mesaId) : null
  const pedido = enVistaLlevar
    ? vista.llevarId
      ? datos.pedidos.find((p) => p.id === vista.llevarId)
      : undefined
    : mesa
      ? pedidoPorMesa.get(mesa.id)
      : undefined
  const items = pedido ? itemsPorPedido.get(pedido.id) ?? [] : []

  if ((vista.nombre === 'mesa' || vista.nombre === 'llevar') && mesa) {
    return (
      <Mesa
        key={mesa.id ?? 'llevar'}
        restaurante={restaurante}
        datos={datos}
        rol={rol}
        mesa={mesa}
        pedido={pedido}
        items={items}
        listos={pedido ? listosPorPedido.get(pedido.id) : undefined}
        onEntregar={() => pedido && entregar(pedido)}
        atras={vista.atras}
        recargar={cargar}
        // Un pedido para llevar nuevo recién enviado: se sigue en la misma pantalla, ya con su número.
        onCreado={(id) => setVista({ nombre: 'llevar', llevarId: id })}
        onVolver={() => {
          sentir('toque')
          setVista({ nombre: 'mesas', atras: true })
        }}
        onCobrar={() => {
          sentir('toque')
          setVista(mesa.llevar ? { nombre: 'cobrar', llevarId: pedido.id } : { nombre: 'cobrar', mesaId: mesa.id })
        }}
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
        onVolver={() => {
          sentir('toque')
          setVista(mesa.llevar ? { nombre: 'llevar', llevarId: vista.llevarId, atras: true } : { nombre: 'mesa', mesaId: mesa.id, atras: true })
        }}
        onListo={() => {
          cargar()
          setVista({ nombre: 'mesas', atras: true })
        }}
      />
    )
  }

  const llevarAbiertos = datos.pedidos.filter(esLlevar).sort((x, y) => x.llevar_numero - y.llevar_numero)
  const ocupadas = datos.mesas.filter((m) => pedidoPorMesa.has(m.id)).length

  return (
    <div className={vista.atras ? 'entra-izquierda' : 'aparece'}>
      <div style={s.cabeceraMesas}>
        <h2 style={{ margin: 0 }}>Mesas</h2>
        {datos.mesas.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...s.pastilla, background: 'var(--durazno)', color: '#8a4b00' }}>
              <b key={ocupadas} className="contador-pop">
                {ocupadas}
              </b>{' '}
              ocupada{ocupadas === 1 ? '' : 's'}
            </span>
            <span style={{ ...s.pastilla, background: 'var(--menta)', color: 'var(--menta-tinta)' }}>
              <b key={datos.mesas.length - ocupadas} className="contador-pop">
                {datos.mesas.length - ocupadas}
              </b>{' '}
              libre{datos.mesas.length - ocupadas === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
      <Agotados restaurante={restaurante} />
      <Mensaje tipo="error">{error}</Mensaje>

      {/* Cliente que viene solo a buscar: no necesita mesa. El nombre se pide al enviar. */}
      <button
        className="btn btn-morado btn-bloque"
        style={{ marginBottom: 12 }}
        onClick={() => {
          sentir('toque')
          setVista({ nombre: 'llevar', llevarId: null })
        }}
      >
        🥡 Pedido para llevar
      </button>

      {llevarAbiertos.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>🥡 Para llevar</h3>
          <div style={s.grid}>
            {llevarAbiertos.map((p, i) => {
              const its = itemsPorPedido.get(p.id) ?? []
              const lista = listosPorPedido.get(p.id)
              return (
                <div
                  key={p.id}
                  className={`entra${lista ? ' mesa-lista' : ''}`}
                  style={{ ...s.mesa, ...(lista ? s.mesaLista : s.mesaOcupada), animationDelay: `${Math.min(i, 12) * 30}ms` }}
                >
                  <button
                    style={s.mesaBoton}
                    onClick={() => {
                      sentir('toque')
                      setVista({ nombre: 'llevar', llevarId: p.id })
                    }}
                  >
                    <span style={s.mesaArriba}>
                      <b style={{ fontSize: 24, lineHeight: 1 }}>🥡 {p.llevar_numero}</b>
                      <span
                        key={String(!!lista)}
                        className="contador-pop"
                        style={{ ...s.punto, background: lista ? '#2E9E62' : '#F28C38' }}
                        aria-hidden="true"
                      />
                    </span>
                    {p.cliente && <small style={s.mesaNombre}>{p.cliente}</small>}
                    <span
                      key={lista ? 'lista' : 'normal'}
                      className={lista ? 'contador-pop' : undefined}
                      style={{ fontWeight: 800, fontSize: 14, color: lista ? '#1f6b43' : '#8a4b00' }}
                    >
                      {lista ? '🔔 Lista' : 'En preparación'}
                    </span>
                    <small className="suave" style={{ lineHeight: 1.3 }}>
                      {`#${p.numero} · ${its.reduce((n, x) => n + x.cantidad, 0)} ítems · ${formatear(p.total, restaurante)}`}
                    </small>
                  </button>
                  <Desplegable abierto={!!lista}>
                    <button className="btn btn-principal btn-chico btn-bloque" style={{ marginTop: 6 }} onClick={() => entregar(p)}>
                      ✓ Entregado
                    </button>
                  </Desplegable>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {datos.mesas.length > 0 && llevarAbiertos.length > 0 && <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>🍽️ Mesas</h3>}
      {datos.mesas.length === 0 && (
        <div className="vacio">
          <span className="vacio-icono">🪑</span>
          <b>No hay mesas activas</b>
          <span>El administrador puede agregarlas en “Mesas y ajustes”.</span>
        </div>
      )}
      <div style={s.grid}>
        {datos.mesas.map((m, i) => {
          const p = pedidoPorMesa.get(m.id)
          const its = p ? itemsPorPedido.get(p.id) ?? [] : []
          const ocupada = !!p
          const lista = p ? listosPorPedido.get(p.id) : undefined
          const listaLlevar = !!lista?.some((e) => e.modalidad === 'llevar')
          return (
            <div
              key={m.id}
              className={`entra${lista ? ' mesa-lista' : ''}`}
              style={{
                ...s.mesa,
                ...(lista ? s.mesaLista : ocupada ? s.mesaOcupada : s.mesaLibre),
                animationDelay: `${Math.min(i, 12) * 30}ms`,
              }}
            >
              <button
                style={s.mesaBoton}
                onClick={() => {
                  sentir('toque')
                  setVista({ nombre: 'mesa', mesaId: m.id })
                }}
              >
                <span style={s.mesaArriba}>
                  <b style={{ fontSize: 28, lineHeight: 1 }}>{m.numero}</b>
                  <span
                    key={`${ocupada}${!!lista}`}
                    className="contador-pop"
                    style={{ ...s.punto, background: lista ? '#2E9E62' : ocupada ? '#F28C38' : '#6cc497' }}
                    aria-hidden="true"
                  />
                </span>
                {m.nombre && <small style={s.mesaNombre}>{m.nombre}</small>}
                <span
                  key={lista ? 'lista' : 'normal'}
                  className={lista ? 'contador-pop' : undefined}
                  style={{ fontWeight: 800, fontSize: 14, color: lista ? '#1f6b43' : ocupada ? '#8a4b00' : 'var(--menta-tinta)' }}
                >
                  {lista ? `🔔 Lista${listaLlevar ? ' · para llevar' : ''}` : ocupada ? 'Ocupada' : 'Libre'}
                </span>
                <small className="suave" style={{ lineHeight: 1.3 }}>
                  {ocupada
                    ? `#${p.numero} · ${its.reduce((n, x) => n + x.cantidad, 0)} ítems · ${formatear(p.total, restaurante)}`
                    : 'Tocar para abrir'}
                </small>
              </button>
              {/* Un toque y listo: se retira el pedido y la marca se apaga. */}
              <Desplegable abierto={!!lista}>
                <button
                  className="btn btn-principal btn-chico btn-bloque"
                  style={{ marginTop: 6 }}
                  onClick={() => entregar(p)}
                >
                  ✓ Entregado
                </button>
              </Desplegable>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Mesa({ restaurante, datos, rol, mesa, pedido, items, listos, onEntregar, onCreado, atras, onVolver, onCobrar, recargar }) {
  const hoy = useHoy(restaurante.zona_horaria)
  const esAdmin = rol === 'admin'
  const esLlevarVista = !!mesa.llevar // pedido para llevar (sin mesa)
  const rotulo = esLlevarVista ? (pedido ? etiquetaLlevar(pedido) : 'Pedido para llevar') : `Mesa ${mesa.numero}`
  const [pidiendoNombre, setPidiendoNombre] = useState(false) // pedido para llevar nuevo: se pregunta el nombre antes de enviar
  const [nombreCliente, setNombreCliente] = useState('')
  const [catId, setCatId] = useState(datos.cats[0]?.id ?? null)
  const [pend, setPend] = useState({}) // productos elegidos que todavía no se confirman: { [productoId]: { n, nota } }
  const [editandoNota, setEditandoNota] = useState(null) // id del producto cuya nota se está escribiendo
  const [conf, setConf] = useState(null) // clave de la línea que se está por anular
  const [cq, setCq] = useState(1) // cuántas unidades anular
  const [confTodo, setConfTodo] = useState(false)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [llevar, setLlevar] = useState(false) // false = servir en el local
  const [resaltar, setResaltar] = useState(() => new Set()) // nombres recién enviados (destello)
  const tResaltar = useRef(null)

  useEffect(() => () => clearTimeout(tResaltar.current), [])

  const catsPorId = useMemo(() => new Map(datos.cats.map((c) => [c.id, c])), [datos.cats])
  const prodsPorId = useMemo(() => new Map(datos.prods.map((p) => [p.id, p])), [datos.prods])
  const catActual = catsPorId.get(catId)
  const agotado = (p) => estaAgotado(p, hoy)
  // Lo agotado desaparece de las opciones. Si ya estaba elegido, se deja a la vista (marcado) para poder quitarlo.
  const prodsDeCat = datos.prods.filter((p) => p.categoria_id === catId)
  const prodsCat = prodsDeCat.filter((p) => !agotado(p) || pend[p.id])
  const soloAgotados = prodsDeCat.length > 0 && prodsCat.length === 0

  // Lo confirmado, juntando los productos iguales en una sola línea.
  const grupos = useMemo(() => {
    const g = new Map()
    for (const i of items) {
      const nota = i.nota ?? ''
      const clave = `${i.nombre}|${i.va_a_cocina}|${nota}`
      const x = g.get(clave) ?? { clave, nombre: i.nombre, nota, va_a_cocina: i.va_a_cocina, cantidad: 0, llevar: 0, total: 0, preparado: 0 }
      x.cantidad += i.cantidad
      if (i.envio_id && datos.preparados?.has(i.envio_id)) x.preparado += i.cantidad
      if (i.para_llevar) x.llevar += i.cantidad
      x.total += i.cantidad * Number(i.precio_unitario)
      g.set(clave, x)
    }
    return [...g.values()]
  }, [items, datos.preparados])

  const lineasPend = Object.entries(pend)
    .map(([id, v]) => ({ prod: prodsPorId.get(id), n: v.n, nota: v.nota ?? '' }))
    .filter((x) => x.prod && x.n > 0)
  const cocinaTab = !!catActual?.va_a_cocina
  const lineasTab = lineasPend.filter((x) => !!catsPorId.get(x.prod.categoria_id)?.va_a_cocina === cocinaTab)
  const hayOtras = lineasPend.length - lineasTab.length
  const hayAgotadoEnEnvio = lineasTab.some((x) => agotado(x.prod))

  const totalConf = items.reduce((t, i) => t + i.cantidad * Number(i.precio_unitario), 0)
  const totalPend = lineasPend.reduce((t, x) => t + x.n * Number(x.prod.precio), 0)
  const unidades = items.reduce((n, i) => n + i.cantidad, 0) + lineasPend.reduce((n, x) => n + x.n, 0)

  function cambiar(prod, d) {
    sentir('toque', d > 0 ? 'pop' : 'popBajo')
    setPend((p) => {
      const actual = p[prod.id] ?? { n: 0, nota: '' }
      const n = Math.max(0, Math.min(99, actual.n + d))
      const c = { ...p }
      if (n === 0) delete c[prod.id]
      else c[prod.id] = { ...actual, n }
      return c
    })
    if (d < 0 && (pend[prod.id]?.n ?? 0) <= 1) setEditandoNota((e) => (e === prod.id ? null : e))
  }

  function cambiarNota(prod, texto) {
    setPend((p) => (p[prod.id] ? { ...p, [prod.id]: { ...p[prod.id], nota: texto.slice(0, 120) } } : p))
  }

  // Atajo: "Sin…" y "Agregar…" dejan escrita la primera palabra y el cursor listo para seguir.
  function empezarNota(prod, prefijo) {
    sentir('toque', 'tic')
    const actual = (pend[prod.id]?.nota ?? '').trim()
    cambiarNota(prod, actual ? `${actual}, ${prefijo.toLowerCase()} ` : `${prefijo} `)
    // El cursor vuelve al campo para seguir escribiendo (en el celular, el teclado no se cierra).
    setTimeout(() => {
      const campo = document.getElementById(`nota-${prod.id}`)
      campo?.focus()
      campo?.setSelectionRange?.(campo.value.length, campo.value.length)
    }, 0)
  }

  async function llamar(nombre, args) {
    setError('')
    setTrabajando(true)
    const { data, error } = await supabase.rpc(nombre, args)
    setTrabajando(false)
    if (error) {
      setError(error.message)
      return false
    }
    return data ?? true
  }

  async function confirmar() {
    if (!lineasTab.length) return
    // Pedido para llevar nuevo: antes de enviarlo se pregunta el nombre del cliente.
    if (esLlevarVista && !pedido && !pidiendoNombre) {
      sentir('toque', 'tic')
      setPidiendoNombre(true)
      return
    }
    sentir('toque')
    const enviados = lineasTab.map((x) => x.prod.nombre)
    const productos = lineasTab.map((x) => ({ producto_id: x.prod.id, cantidad: x.n, nota: x.nota.trim() }))
    const ok = esLlevarVista
      ? await llamar('enviar_items_llevar', {
          p_restaurante: restaurante.id,
          p_items: productos,
          p_cliente: pedido ? null : nombreCliente.trim(),
          p_pedido: pedido?.id ?? null,
        })
      : await llamar('enviar_items', { p_mesa: mesa.id, p_items: productos, p_llevar: llevar })
    if (ok) {
      vibrar('exito')
      sonar('exito')
      const etiquetaEnvio = esLlevarVista
        ? ok.llevar_numero
          ? etiquetaLlevar({ llevar_numero: ok.llevar_numero, cliente: nombreCliente.trim() })
          : rotulo
        : rotulo
      avisar(cocinaTab ? `Enviado a cocina · ${etiquetaEnvio}` : `Añadido al pedido · ${etiquetaEnvio}`, cocinaTab ? 'cocina' : 'ok')
      setPidiendoNombre(false)
      if (esLlevarVista && !pedido && ok.pedido_id) onCreado(ok.pedido_id)
      setResaltar(new Set(enviados))
      clearTimeout(tResaltar.current)
      tResaltar.current = setTimeout(() => setResaltar(new Set()), 1600)
      setLlevar(false)
      setPend((p) => {
        const c = { ...p }
        lineasTab.forEach((x) => delete c[x.prod.id])
        return c
      })
      setEditandoNota(null)
      recargar()
    }
  }

  // El salón solo puede anular lo que cocina todavía no dejó listo; el administrador puede anular todo.
  const anulables = (g) => (esAdmin ? g.cantidad : g.cantidad - g.preparado)
  const hayPreparado = grupos.some((g) => g.preparado > 0)

  async function anular(g) {
    sentir('aviso')
    const ok = await llamar('anular_linea', {
      p_pedido: pedido.id,
      p_nombre: g.nombre,
      p_va_a_cocina: g.va_a_cocina,
      p_cantidad: Math.min(cq, anulables(g)),
      p_nota: g.nota,
    })
    setConf(null)
    if (ok) {
      sonar('baja')
      avisar(`Anulado: ${Math.min(cq, anulables(g))} × ${g.nombre}`, 'borrar')
      recargar()
    }
  }

  async function anularTodo() {
    sentir('aviso')
    const ok = await llamar('anular_pedido', { p_pedido: pedido.id })
    setConfTodo(false)
    if (ok) {
      sonar('baja')
      avisar(`Orden anulada · ${rotulo}`, 'borrar')
      recargar()
      if (lineasPend.length === 0) onVolver()
    }
  }

  const puedeCobrar = grupos.length > 0 && lineasPend.length === 0 && !trabajando
  const hayParaEnviar = lineasTab.length > 0 && !hayAgotadoEnEnvio
  const preguntaNombre = pidiendoNombre && hayParaEnviar

  return (
    <>
      <div
        className={atras ? 'entra-izquierda' : 'entra-derecha'}
        style={{ ...s.contenido, paddingBottom: `calc(${preguntaNombre ? 340 : hayParaEnviar ? (esLlevarVista ? 170 : 250) : 150}px + var(--seguro-abajo))` }}
      >
        <div style={s.cabecera}>
          <button className="btn btn-fantasma" onClick={onVolver}>
            ‹ Mesas
          </button>
          <h2 style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
            {esLlevarVista ? '🥡 ' : ''}
            {rotulo}
            {!esLlevarVista && mesa.nombre ? <span className="suave" style={{ fontWeight: 600 }}> · {mesa.nombre}</span> : ''}
          </h2>
        </div>

        <Mensaje tipo="error">{error}</Mensaje>

        {/* Cocina dejó el pedido listo: queda este aviso hasta que se retire. */}
        <Desplegable abierto={!!listos?.length}>
          <div style={s.bannerListo}>
            <span style={{ flex: 1, minWidth: 150 }}>
              <b>🔔 Pedido listo para retirar</b>
              <br />
              <small className="suave">
                {esLlevarVista ? 'El cliente ya puede retirarlo.' : listos?.some((e) => e.modalidad === 'llevar') ? 'Incluye pedido para llevar.' : 'Cocina ya lo dejó en la ventanilla.'}
              </small>
            </span>
            <button className="btn btn-principal" onClick={onEntregar}>
              ✓ Entregado
            </button>
          </div>
        </Desplegable>

        <Desplegable abierto={grupos.length > 0 && !!pedido}>
          {pedido && (
            <div style={s.pedidoCard}>
              <h3 style={{ ...s.titulo, margin: '0 0 4px' }}>
                Pedido #{pedido.numero} <small className="suave" style={{ fontWeight: 600 }}>· ya enviado</small>
              </h3>
              {grupos.map((g) => (
                <div key={g.clave} className={`entra${resaltar.has(g.nombre) ? ' brilla' : ''}`} style={s.filaEnviada}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <b>
                      <span key={g.cantidad} className="contador-pop">
                        {g.cantidad}
                      </span>{' '}
                      × {g.nombre}
                    </b>
                    {g.nota && <span style={s.notaChip}>📝 {g.nota}</span>}
                    {g.preparado > 0 && (
                      <span style={s.preparadoChip}>
                        🍳 {g.preparado === g.cantidad ? 'Ya preparado' : `${g.preparado} ya preparado${g.preparado === 1 ? '' : 's'}`}
                      </span>
                    )}
                    <br />
                    <small className="suave">
                      {g.va_a_cocina ? '🍳 En cocina' : 'No va a cocina'}
                      {g.llevar > 0 ? ` · ${g.llevar === g.cantidad ? 'para llevar' : `${g.llevar} para llevar`}` : ''} ·{' '}
                      {formatear(g.total, restaurante)}
                    </small>
                  </div>
                  {conf === g.clave ? (
                    <div className="infla" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {esAdmin && g.preparado > 0 && (
                        <small style={s.avisoPerdida}>
                          Cocina ya preparó {g.preparado === g.cantidad ? 'todo esto' : `${g.preparado} de ${g.cantidad}`}. Si lo anulas, se
                          contará como pérdida.
                        </small>
                      )}
                      {anulables(g) > 1 && (
                        <div style={s.cantidad}>
                          <button
                            className="btn-redondo btn-suave"
                            aria-label="Una menos"
                            onClick={() => {
                              sentir('toque', 'popBajo')
                              setCq((n) => Math.max(1, n - 1))
                            }}
                          >
                            −
                          </button>
                          <b key={cq} className="contador-pop numero" style={{ minWidth: 20, textAlign: 'center' }}>
                            {Math.min(cq, anulables(g))}
                          </b>
                          <button
                            className="btn-redondo btn-suave"
                            aria-label="Una más"
                            onClick={() => {
                              sentir('toque', 'pop')
                              setCq((n) => Math.min(anulables(g), n + 1))
                            }}
                          >
                            +
                          </button>
                        </div>
                      )}
                      <button className="btn btn-peligro" disabled={trabajando} onClick={() => anular(g)}>
                        {trabajando ? <span className="puntos">Anulando</span> : 'Sí, anular'}
                      </button>
                      <button className="btn btn-sec" onClick={() => setConf(null)}>
                        No
                      </button>
                    </div>
                  ) : anulables(g) > 0 ? (
                    <button
                      className="btn btn-chico btn-peligro-suave"
                      onClick={() => {
                        sentir('toque')
                        setConf(g.clave)
                        setCq(1)
                        setConfTodo(false)
                      }}
                    >
                      Anular
                    </button>
                  ) : (
                    <small className="suave" style={s.sinAnular}>
                      Cocina ya lo preparó. Si fue un error, avisa al administrador.
                    </small>
                  )}
                </div>
              ))}

              {!esAdmin && hayPreparado && (
                <small className="suave" style={s.sinAnular}>
                  Cocina ya preparó parte del pedido. Solo el administrador puede anularlo completo.
                </small>
              )}
              <Desplegable abierto={!confTodo && (esAdmin || !hayPreparado)}>
                <button
                  className="btn btn-peligro-suave btn-bloque"
                  style={{ marginTop: 4 }}
                  onClick={() => {
                    sentir('toque')
                    setConfTodo(true)
                    setConf(null)
                  }}
                >
                  Anular orden completa
                </button>
              </Desplegable>
              <Desplegable abierto={confTodo}>
                <div style={s.confirmarTodo}>
                  <b>¿Anular la orden completa?</b>
                  <small className="suave">Se avisa a la cocina de todo lo que ya se envió.</small>
                  {esAdmin && hayPreparado && (
                    <small style={s.avisoPerdida}>Cocina ya preparó parte del pedido: se contará como pérdida.</small>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sec" style={{ flex: 1 }} onClick={() => setConfTodo(false)}>
                      No
                    </button>
                    <button className="btn btn-peligro" style={{ flex: 1 }} disabled={trabajando} onClick={anularTodo}>
                      {trabajando ? <span className="puntos">Anulando</span> : 'Sí, anular todo'}
                    </button>
                  </div>
                </div>
              </Desplegable>
            </div>
          )}
        </Desplegable>

        {grupos.length > 0 && pedido && <h3 style={s.titulo}>Agregar al pedido</h3>}

        <div className="chips">
          {datos.cats.map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={c.id === catId}
              onClick={() => {
                if (c.id !== catId) sentir('toque')
                setCatId(c.id)
              }}
            >
              {c.nombre}
            </button>
          ))}
        </div>

        {datos.cats.length === 0 && (
          <div className="vacio">
            <span className="vacio-icono">📋</span>
            <b>El menú está vacío</b>
            <span>El administrador puede cargarlo en la pestaña “Menú”.</span>
          </div>
        )}
        {catActual && !catActual.va_a_cocina && (
          <p className="nota aparece">Estos productos no pasan por cocina. Toca AÑADIR para sumarlos al pedido.</p>
        )}

        <div key={catId} style={s.lista}>
          {prodsCat.map((p, i) => {
            const q = pend[p.id]?.n ?? 0
            const nota = pend[p.id]?.nota ?? ''
            const escribiendo = editandoNota === p.id
            const sinStock = agotado(p) // solo se ve si ya estaba elegido: hay que quitarlo
            return (
              <div
                key={p.id}
                className="entra"
                style={{
                  ...s.producto,
                  ...(sinStock ? s.productoAgotado : q > 0 ? s.productoElegido : null),
                  animationDelay: `${Math.min(i, 10) * 25}ms`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block' }}>{p.nombre}</b>
                  {sinStock ? (
                    <span className="infla" style={s.etiquetaAgotado}>
                      🚫 Se agotó · quítalo del pedido
                    </span>
                  ) : (
                    <small className="suave">{formatear(p.precio, restaurante)}</small>
                  )}
                </div>
                <div style={s.cantidad}>
                  {q > 0 && (
                    <>
                      <button className="btn-redondo btn-suave infla" aria-label={`Quitar ${p.nombre}`} onClick={() => cambiar(p, -1)}>
                        −
                      </button>
                      <b key={q} className="contador-pop numero" style={{ minWidth: 22, textAlign: 'center', fontSize: 18 }}>
                        {q}
                      </b>
                    </>
                  )}
                  {!sinStock && (
                    <button className="btn-redondo btn-principal" aria-label={`Agregar ${p.nombre}`} onClick={() => cambiar(p, 1)}>
                      +
                    </button>
                  )}
                </div>

                {/* Nota para cocina: aparece solo cuando el producto ya está elegido. */}
                <div style={{ flexBasis: '100%', minWidth: 0 }}>
                  <Desplegable abierto={q > 0}>
                    <div style={s.notaArea}>
                      {escribiendo ? (
                        <form
                          style={{ display: 'grid', gap: 8, scrollMarginBottom: 260 }}
                          onSubmit={(e) => {
                            e.preventDefault()
                            sentir('toque', 'tic')
                            setEditandoNota(null)
                          }}
                        >
                          <Anclar block="center" />
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-chico btn-suave"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => empezarNota(p, 'Sin')}
                            >
                              ➖ Sin…
                            </button>
                            <button
                              type="button"
                              className="btn btn-chico btn-suave"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => empezarNota(p, 'Agregar')}
                            >
                              ➕ Agregar…
                            </button>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              id={`nota-${p.id}`}
                              className="campo-chico"
                              style={{ flex: 1, minWidth: 0 }}
                              autoFocus
                              maxLength={120}
                              placeholder="Ej: sin cebolla, bien cocido"
                              value={nota}
                              onChange={(e) => cambiarNota(p, e.target.value)}
                            />
                            <button className="btn btn-chico btn-morado">Listo</button>
                          </div>
                        </form>
                      ) : (
                        <button
                          className="btn btn-chico btn-fantasma"
                          style={nota ? s.notaPuesta : s.notaVacia}
                          onClick={() => {
                            sentir('toque')
                            setEditandoNota(p.id)
                          }}
                        >
                          {nota ? `📝 ${nota}` : '✎ Agregar nota (sin cebolla, extra queso…)'}
                        </button>
                      )}
                    </div>
                  </Desplegable>
                </div>
              </div>
            )
          })}
        </div>
        {datos.cats.length > 0 && prodsCat.length === 0 && (
          <p className="nota aparece">
            {soloAgotados ? '🚫 Todo lo de esta categoría está agotado por hoy.' : 'Esta categoría no tiene productos activos.'}
          </p>
        )}
        {hayAgotadoEnEnvio && (
          <p className="nota aparece">
            🚫 Se agotó: {lineasTab.filter((x) => agotado(x.prod)).map((x) => x.prod.nombre).join(', ')}. Quítalo (con −) para
            poder enviar el pedido.
          </p>
        )}

        {hayOtras > 0 && (
          <p className="nota aparece">Tienes productos pendientes en otra categoría. Cámbiate a ella para confirmarlos.</p>
        )}
        {lineasPend.length > 0 && grupos.length > 0 && (
          <p className="nota aparece">Para cobrar, primero confirma o quita los productos pendientes.</p>
        )}
      </div>

      <div className="sube" style={s.barra}>
        <div style={s.barraAncho}>
          {/* Pedido para llevar nuevo: el nombre se pregunta aquí, al final, justo antes de enviarlo. */}
          <Desplegable abierto={preguntaNombre}>
            <form
              style={s.formNombre}
              onSubmit={(e) => {
                e.preventDefault()
                confirmar()
              }}
            >
              <b>¿A nombre de quién?</b>
              <small className="suave">Así lo llaman cuando esté listo. Puedes dejarlo vacío.</small>
              <input
                className="campo"
                autoFocus
                maxLength={40}
                placeholder="Nombre del cliente (opcional)"
                value={nombreCliente}
                onChange={(e) => setNombreCliente(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sec"
                  onClick={() => {
                    sentir('toque')
                    setPidiendoNombre(false)
                  }}
                >
                  Volver
                </button>
                <button className="btn btn-morado" style={{ flex: 1 }} disabled={trabajando}>
                  {trabajando ? <span className="puntos">Enviando</span> : cocinaTab ? '🍳 Enviar a cocina' : 'Añadir al pedido'}
                </button>
              </div>
            </form>
          </Desplegable>
          <Desplegable abierto={hayParaEnviar && !esLlevarVista && !preguntaNombre}>
            <div style={{ paddingBottom: 10 }}>
              <Segmento
                oscuro
                etiqueta="Modalidad del pedido"
                valor={llevar}
                onChange={setLlevar}
                opciones={[
                  [false, '🍽️ Servir'],
                  [true, '🥡 Para llevar'],
                ]}
              />
            </div>
          </Desplegable>
          <Desplegable abierto={!preguntaNombre}>
          <div style={s.barraInterior}>
            <div style={{ flex: '1 1 110px', minWidth: 0 }}>
              <small className="suave" style={{ display: 'block' }}>
                <span key={unidades} className="contador-pop">
                  {unidades}
                </span>{' '}
                ítem{unidades === 1 ? '' : 's'}
              </small>
              <b style={s.total}>
                <NumeroAnimado valor={totalConf + totalPend} duracion={380} formato={(n) => formatear(n, restaurante)} />
              </b>
            </div>
            <div style={s.botonesBarra}>
            <button
              className={`btn ${hayParaEnviar ? 'btn-morado' : 'btn-suave'}`}
              style={s.botonBarra}
              disabled={!hayParaEnviar || trabajando}
              onClick={confirmar}
            >
              {trabajando && hayParaEnviar ? (
                <span className="puntos">Enviando</span>
              ) : cocinaTab ? (
                '🍳 A cocina'
              ) : (
                'AÑADIR'
              )}
            </button>
            <button className="btn btn-principal" style={s.botonBarra} disabled={!puedeCobrar} onClick={onCobrar}>
              Cobrar
            </button>
            </div>
          </div>
          </Desplegable>
        </div>
      </div>
    </>
  )
}

function Cobrar({ restaurante, datos, mesa, pedido, items, onVolver, onListo }) {
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(null) // id del método que se está cobrando

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

  async function cobrar(metodo, e) {
    const boton = e.currentTarget
    sentir('toque')
    setError('')
    setTrabajando(metodo.id)
    const { error } = await supabase.rpc('cobrar_pedido', { p_pedido: pedido.id, p_metodo: metodo.id })
    if (error) {
      setTrabajando(null)
      setError(error.message)
      return
    }
    celebrar(boton)
    vibrar('exito')
    sonar('cobro')
    avisar(`${pedido && mesa.llevar ? etiquetaLlevar(pedido) : `Mesa ${mesa.numero}`} cobrada · ${formatear(total, restaurante)}`, 'cobro')
    // Una pausa breve para que se alcance a disfrutar la confirmación antes de volver.
    setTimeout(onListo, 550)
  }

  if (!pedido) {
    return (
      <div className="vacio aparece">
        <span className="vacio-icono">🧾</span>
        <b>Esta cuenta ya no está abierta.</b>
        <button className="btn btn-sec" onClick={onListo}>
          Volver a las mesas
        </button>
      </div>
    )
  }

  return (
    <div className="entra-derecha" style={s.contenido}>
      <div style={s.cabecera}>
        <button className="btn btn-fantasma" onClick={onVolver} disabled={!!trabajando}>
          ‹ Volver
        </button>
        <h2 style={{ margin: 0, overflowWrap: 'anywhere' }}>{mesa.llevar ? `Cobrar · ${etiquetaLlevar(pedido)}` : `Cobrar mesa ${mesa.numero}`}</h2>
      </div>

      <div className="tarjeta" style={{ display: 'grid', gap: 2, padding: 6 }}>
        <small className="suave" style={{ padding: '6px 10px 2px' }}>
          Pedido #{pedido.numero}
        </small>
        {lineas.map((l, i) => (
          <div key={l.nombre} className="entra" style={{ ...s.lineaCobro, animationDelay: `${Math.min(i, 10) * 35}ms` }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{l.cantidad}</b> × {l.nombre}
            </span>
            <b className="numero">{formatear(l.total, restaurante)}</b>
          </div>
        ))}
      </div>

      <div style={s.totalCobro}>
        <small style={{ opacity: 0.8 }}>Total a cobrar</small>
        <b style={{ fontSize: 'clamp(30px, 9vw, 40px)', lineHeight: 1.1 }}>
          <NumeroAnimado valor={total} duracion={650} formato={(n) => formatear(n, restaurante)} />
        </b>
      </div>

      <Mensaje tipo="error">{error}</Mensaje>
      {datos.pagos.length === 0 && (
        <p className="nota">No hay métodos de pago activos. El administrador puede agregarlos en “Mesas y ajustes”.</p>
      )}
      <h3 style={s.titulo}>¿Cómo paga?</h3>
      <div style={s.pagos}>
        {datos.pagos.map((m, i) => (
          <button
            key={m.id}
            className="btn btn-principal btn-grande entra"
            style={{ animationDelay: `${120 + i * 50}ms`, opacity: trabajando === m.id ? 1 : undefined }}
            disabled={!!trabajando}
            onClick={(e) => cobrar(m, e)}
          >
            {trabajando === m.id ? <span className="puntos">Cobrando</span> : m.nombre}
          </button>
        ))}
      </div>
    </div>
  )
}

const s = {
  contenido: { maxWidth: 820, margin: '0 auto' },
  cabeceraMesas: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 },
  pastilla: { padding: '5px 12px', borderRadius: 99, fontSize: 14, fontWeight: 700 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(140px, 40vw), 1fr))', gap: 12 },
  mesa: {
    display: 'grid',
    gap: 4,
    alignContent: 'start',
    textAlign: 'left',
    padding: 14,
    minHeight: 124,
    borderRadius: 18,
    border: '1.5px solid',
    color: 'var(--tinta)',
    boxShadow: 'var(--sombra)',
  },
  // El botón que abre la mesa ocupa toda la tarjeta; "Entregado" va aparte, debajo.
  mesaBoton: {
    display: 'grid',
    gap: 4,
    alignContent: 'start',
    width: '100%',
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'none',
    textAlign: 'left',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  },
  mesaLista: { background: 'linear-gradient(180deg, #f3fcf6 0%, #e4f6ec 100%)', borderColor: '#7ccb9e' },
  mesaLibre: { background: '#fff', borderColor: '#cdebd9' },
  mesaOcupada: { background: 'linear-gradient(180deg, #fff8ee 0%, #fff1de 100%)', borderColor: '#f6cf9b' },
  mesaArriba: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  mesaNombre: { color: 'var(--suave)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  punto: { display: 'inline-block', width: 12, height: 12, borderRadius: '50%', boxShadow: '0 0 0 4px rgba(255,255,255,.8)' },
  cabecera: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, marginLeft: -8, flexWrap: 'wrap' },
  titulo: { margin: '16px 0 8px', fontSize: 17 },
  pedidoCard: {
    background: 'var(--lavanda)',
    border: '1px solid var(--lavanda-2)',
    borderRadius: 18,
    padding: 12,
    marginBottom: 6,
    display: 'grid',
    gap: 8,
  },
  filaEnviada: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    background: 'white',
    borderRadius: 14,
    padding: '10px 12px',
  },
  confirmarTodo: {
    display: 'grid',
    gap: 8,
    marginTop: 4,
    padding: 12,
    borderRadius: 14,
    background: 'var(--rosa)',
    border: '1px solid #f3c9c5',
  },
  bannerListo: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    padding: '12px 14px',
    borderRadius: 16,
    background: 'var(--menta)',
    border: '1px solid #9bd7b4',
    color: 'var(--menta-tinta)',
  },
  etiquetaAgotado: { display: 'inline-block', marginTop: 2, padding: '2px 8px', borderRadius: 8, background: 'var(--rosa)', color: '#B3261E', fontSize: 12, fontWeight: 800 },
  lista: { display: 'grid', gap: 8 },
  producto: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    background: 'white',
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: 'var(--linea)',
    borderRadius: 16,
    padding: '10px 10px 10px 14px',
    boxShadow: 'var(--sombra)',
    transition: 'background-color 220ms var(--ease), border-color 220ms var(--ease)',
  },
  productoElegido: { background: '#fffaf0', borderColor: '#f7d48a' },
  productoAgotado: { background: 'var(--rosa)', borderColor: '#f0a9a3' },
  cantidad: { display: 'flex', alignItems: 'center', gap: 8, flex: 'none' },
  notaArea: { paddingTop: 8, marginTop: 8, borderTop: '1px dashed #f1dfae' },
  notaVacia: { color: 'var(--suave)', fontWeight: 700, padding: '4px 2px', minHeight: 36 },
  notaPuesta: { color: '#8a4b00', background: 'var(--durazno)', padding: '6px 10px', borderRadius: 10, textAlign: 'left', whiteSpace: 'normal' },
  preparadoChip: { display: 'inline-block', marginTop: 4, marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'var(--menta)', color: 'var(--menta-tinta)', fontSize: 13, fontWeight: 700 },
  avisoPerdida: { flexBasis: '100%', color: '#B3261E', fontWeight: 700, lineHeight: 1.3 },
  sinAnular: { maxWidth: 190, textAlign: 'right', lineHeight: 1.3, fontSize: 12 },
  formNombre: { display: 'grid', gap: 8, paddingBottom: 10 },
  notaChip: { display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 8, background: 'var(--durazno)', color: '#8a4b00', fontSize: 13, fontWeight: 700 },
  barra: {
    position: 'fixed',
    zIndex: 40,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(255,255,255,.9)',
    WebkitBackdropFilter: 'blur(16px) saturate(1.3)',
    backdropFilter: 'blur(16px) saturate(1.3)',
    borderTop: '1px solid var(--linea)',
    boxShadow: '0 -10px 30px -18px rgba(75,30,77,.35)',
    padding: '12px 16px calc(12px + var(--seguro-abajo))',
    borderRadius: '20px 20px 0 0',
  },
  barraAncho: { maxWidth: 820, margin: '0 auto' },
  barraInterior: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  // En celulares muy angostos los botones bajan a su propia fila, a todo el ancho.
  botonesBarra: { display: 'flex', gap: 8, flex: '1 1 190px' },
  total: { display: 'block', fontSize: 'clamp(17px, 5.2vw, 24px)', fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  botonBarra: { flex: '1 1 auto', minHeight: 50, padding: '10px clamp(10px, 3.2vw, 16px)' },
  lineaCobro: { display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 10px', borderTop: '1px solid var(--linea)' },
  totalCobro: {
    display: 'grid',
    gap: 2,
    marginTop: 12,
    padding: '16px 18px',
    borderRadius: 18,
    color: 'white',
    background: 'linear-gradient(135deg, #5c2a5f 0%, #4B1E4D 60%, #3a173c 100%)',
    boxShadow: '0 14px 30px -18px rgba(75,30,77,.9)',
  },
  pagos: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
}
