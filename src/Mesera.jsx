import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { formatear, leerPrecio, soloPrecio } from './moneda'
import { Cargando, Desplegable, Mensaje, NumeroAnimado, Segmento, Confirmar } from './ui'
import { avisar, celebrar, sentir, sonar, vibrar } from './feedback'
import { createPortal } from 'react-dom'
import { abrirPrecuenta } from './precuenta'
import Anclar from './Anclar'
import Icono from './iconos'
import './orden.css'
import { esPropio, estaAgotado, hoyEn, useHoy } from './agotado'
import { ordenarNombre } from './orden'

// Pedidos para llevar: no tienen mesa, se identifican como "Llevar 3" (y el nombre del cliente, si se pidió).
const esLlevar = (p) => p?.llevar_numero != null
const etiquetaLlevar = (p) => (p.cliente ? `Llevar ${p.llevar_numero} · ${p.cliente}` : `Llevar ${p.llevar_numero}`)
const etiquetaPedido = (p, mesas) =>
  esLlevar(p) ? etiquetaLlevar(p) : `Mesa ${mesas.find((m) => m.id === p?.mesa_id)?.numero ?? '?'}`
// "Mesa" ficticia para armar un pedido para llevar con la misma pantalla de las mesas.
const MESA_LLEVAR = { id: null, numero: null, nombre: null, llevar: true }
// Método de pago "Efectivo" (misma regla que usa el cierre de caja): pide con cuánto paga el cliente y calcula el vuelto.
const esEfectivo = (nombre) => /(efectivo|cash)/i.test(nombre ?? '')

// ¿La pantalla es lo bastante ancha (tablet horizontal o computador) para mostrar mesas y cuenta lado a lado?
function useAnchoGrande(minimo) {
  const consulta = `(min-width: ${minimo}px)`
  const [ancho, setAncho] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches)
  useEffect(() => {
    const m = window.matchMedia(consulta)
    const alCambiar = () => setAncho(m.matches)
    m.addEventListener('change', alCambiar)
    return () => m.removeEventListener('change', alCambiar)
  }, [])
  return ancho
}

// Pantallas del salón: mapa de mesas, pedidos para llevar, toma de pedido y cobro.
// rol: 'admin' o 'mesera'. Solo cambia lo que se muestra; la base de datos hace cumplir los permisos.
export default function Mesera({ restaurante, rol = 'mesera' }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [juntando, setJuntando] = useState(false) // ventana para juntar mesas (antes de pedir)
  const [vista, setVista] = useState({ nombre: 'mesas' }) // { nombre: 'mesas' | 'mesa' | 'llevar' | 'cobrar', mesaId, llevarId, atras }
  const temporizador = useRef(null)
  // El administrador tiene además el menú lateral, por eso necesita más ancho para el modo de dos paneles.
  const ancho = useAnchoGrande(rol === 'admin' ? 1440 : 1100)
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

    setDatos({ mesas: m.data, cats: c.data, prods: ordenarNombre(p.data), pagos: mp.data, pedidos: pe.data, items, listos, preparados })
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mesas', filter: filtro }, programar)
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
  async function entregar(pedido, ircobrar = false) {
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
    if (ircobrar) setVista({ nombre: 'cobrar', llevarId: pedido.id })
  }

  if (error && !datos) return <Mensaje tipo="error">{error}</Mensaje>
  if (!datos) return <Cargando filas={4} alto={84} />

  const enVistaLlevar = vista.nombre === 'llevar' || (vista.nombre === 'cobrar' && vista.llevarId !== undefined)
  // Una mesa unida a otra se atiende desde la principal.
  const mesaPedida = enVistaLlevar ? MESA_LLEVAR : vista.mesaId ? datos.mesas.find((m) => m.id === vista.mesaId) : null
  const mesa = mesaPedida?.unida_a ? datos.mesas.find((m) => m.id === mesaPedida.unida_a) ?? mesaPedida : mesaPedida
  const miembrosDe = new Map()
  datos.mesas.forEach((m) => m.unida_a && miembrosDe.set(m.unida_a, [...(miembrosDe.get(m.unida_a) ?? []), m]))
  const pedido = enVistaLlevar
    ? vista.llevarId
      ? datos.pedidos.find((p) => p.id === vista.llevarId)
      : undefined
    : mesa
      ? pedidoPorMesa.get(mesa.id)
      : undefined
  const items = pedido ? itemsPorPedido.get(pedido.id) ?? [] : []

  let detalle = null
  if ((vista.nombre === 'mesa' || vista.nombre === 'llevar') && mesa) {
    detalle = (
      <Mesa
        key={mesa.id ?? 'llevar'}
        restaurante={restaurante}
        datos={datos}
        rol={rol}
        mesa={mesa}
        miembros={mesa?.llevar ? [] : miembrosDe.get(mesa?.id) ?? []}
        pedido={pedido}
        items={items}
        listos={pedido ? listosPorPedido.get(pedido.id) : undefined}
        onEntregar={() => pedido && entregar(pedido, esLlevar(pedido))}
        atras={vista.atras}
        recargar={cargar}
        // Un pedido para llevar nuevo recién enviado: se sigue en la misma pantalla, ya con su número.
        onCreado={(id) => setVista({ nombre: 'llevar', llevarId: id })}
        onVolver={() => {
          sentir('toque')
          setVista({ nombre: 'mesas', atras: true })
        }}
        onIrAMesa={(id) => setVista({ nombre: 'mesa', mesaId: id })}
        onCobrar={() => {
          sentir('toque')
          setVista(mesa.llevar ? { nombre: 'cobrar', llevarId: pedido.id } : { nombre: 'cobrar', mesaId: mesa.id })
        }}
      />
    )
  }

  if (vista.nombre === 'cobrar' && mesa) {
    detalle = (
      <Cobrar
        restaurante={restaurante}
        datos={datos}
        rol={rol}
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

  // En pantalla chica el detalle ocupa todo; en pantalla ancha va a la derecha de la lista de mesas.
  if (detalle && !ancho) return detalle

  const llevarAbiertos = datos.pedidos.filter(esLlevar).sort((x, y) => x.llevar_numero - y.llevar_numero)
  const mesasVisibles = datos.mesas.filter((m) => !m.unida_a)
  const ocupadas = mesasVisibles.filter((m) => pedidoPorMesa.has(m.id) || miembrosDe.has(m.id)).length
  const libresN = mesasVisibles.length - ocupadas

  const panelMesas = (
    <div className={ancho ? 'aparece' : vista.atras ? 'entra-izquierda' : 'aparece'}>
      <div style={s.cabeceraMesas}>
        <h2 style={{ margin: 0 }}>Mesas</h2>
        {datos.mesas.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...s.pastilla, background: 'var(--durazno)', color: 'var(--aviso-tinta)' }}>
              <b key={ocupadas} className="contador-pop">
                {ocupadas}
              </b>{' '}
              ocupada{ocupadas === 1 ? '' : 's'}
            </span>
            <span style={{ ...s.pastilla, background: 'var(--menta)', color: 'var(--menta-tinta)' }}>
              <b key={libresN} className="contador-pop">
                {libresN}
              </b>{' '}
              libre{libresN === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
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
        <Icono n="bolsa" tam={15} className="it" /> Pedido para llevar
      </button>
      {mesasVisibles.length > 1 && (
        <button
          className="btn btn-sec btn-bloque"
          style={{ marginBottom: 12 }}
          onClick={() => {
            sentir('toque')
            setJuntando(true)
          }}
        >
          <Icono n="enlace" tam={15} className="it" /> Juntar mesas
        </button>
      )}
      {juntando && (
        <JuntarMesas
          datos={datos}
          principal={null}
          miembros={[]}
          pedidoPorMesa={pedidoPorMesa}
          onCerrar={() => setJuntando(false)}
          onHecho={async (id) => {
            setJuntando(false)
            await cargar()
            setVista({ nombre: 'mesa', mesaId: id })
          }}
        />
      )}

      {llevarAbiertos.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}><Icono n="bolsa" tam={15} className="it" /> Para llevar</h3>
          <div style={s.grid}>
            {llevarAbiertos.map((p, i) => {
              const its = itemsPorPedido.get(p.id) ?? []
              const lista = listosPorPedido.get(p.id)
              // Cocina ya lo dejó todo listo y ya se entregó: lo único que falta es cobrar.
              const porCobrar =
                !lista && its.length > 0 && its.every((x) => !x.va_a_cocina || (x.envio_id && datos.preparados?.has(x.envio_id)))
              return (
                <div
                  key={p.id}
                  className={`entra${lista ? ' mesa-lista' : ''}${ancho && mesa && mesa.id === m.id ? ' mesa-sel' : ''}`}
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
                      <b style={{ fontSize: 24, lineHeight: 1 }}><Icono n="bolsa" tam={15} className="it" /> {p.llevar_numero}</b>
                      <span
                        key={String(!!lista)}
                        className="contador-pop"
                        style={{ ...s.punto, background: lista ? 'var(--menta-tinta)' : porCobrar ? 'var(--marca)' : 'var(--aviso-tinta)' }}
                        aria-hidden="true"
                      />
                    </span>
                    {p.cliente && <small style={s.mesaNombre}>{p.cliente}</small>}
                    <span
                      key={lista ? 'lista' : porCobrar ? 'cobrar' : 'normal'}
                      className={lista || porCobrar ? 'contador-pop' : undefined}
                      style={{ fontWeight: 800, fontSize: 14, color: lista ? 'var(--menta-tinta)' : porCobrar ? 'var(--marca)' : 'var(--aviso-tinta)' }}
                    >
                      {lista ? <><Icono n="timbre" tam={15} className="it" /> Lista</> : porCobrar ? <><Icono n="tarjeta" tam={15} className="it" /> Por cobrar</> : 'En preparación'}
                    </span>
                    <small className="suave" style={{ lineHeight: 1.3 }}>
                      {`#${p.numero} · ${its.reduce((n, x) => n + x.cantidad, 0)} ítems · ${formatear(p.total, restaurante)}`}
                    </small>
                  </button>
                  <Desplegable abierto={!!lista || porCobrar}>
                    {lista ? (
                      <button className="btn btn-principal btn-chico btn-bloque" style={{ marginTop: 6 }} onClick={() => entregar(p, true)}>
                        <Icono n="check" tam={15} className="it" /> Entregar y cobrar
                      </button>
                    ) : (
                      <button
                        className="btn btn-principal btn-chico btn-bloque"
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          sentir('toque')
                          setVista({ nombre: 'cobrar', llevarId: p.id })
                        }}
                      >
                        <Icono n="tarjeta" tam={15} className="it" /> Cobrar
                      </button>
                    )}
                  </Desplegable>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {datos.mesas.length > 0 && llevarAbiertos.length > 0 && <h3 style={{ margin: '0 0 8px', fontSize: 16 }}><Icono n="cubiertos" tam={15} className="it" /> Mesas</h3>}
      {datos.mesas.length === 0 && (
        <div className="vacio">
          <span className="vacio-icono"><Icono n="silla" tam={34} ancho={1.5} /></span>
          <b>No hay mesas activas</b>
          <span>El administrador puede agregarlas en “Mesas y ajustes”.</span>
        </div>
      )}
      <div style={s.grid}>
        {mesasVisibles.map((m, i) => {
          const grupo = miembrosDe.get(m.id) ?? []
          const p = pedidoPorMesa.get(m.id)
          const its = p ? itemsPorPedido.get(p.id) ?? [] : []
          const ocupada = !!p || grupo.length > 0
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
                  <b style={{ fontSize: 28, lineHeight: 1 }}>{m.numero}{grupo.length > 0 && <span style={{ fontSize: 15, fontWeight: 800 }}> +{grupo.map((g) => g.numero).join(' +')}</span>}</b>
                  <span
                    key={`${ocupada}${!!lista}`}
                    className="contador-pop"
                    style={{ ...s.punto, background: lista ? 'var(--menta-tinta)' : ocupada ? 'var(--aviso-tinta)' : 'var(--menta-tinta)' }}
                    aria-hidden="true"
                  />
                </span>
                {m.nombre && <small style={s.mesaNombre}>{m.nombre}</small>}
                <span
                  key={lista ? 'lista' : 'normal'}
                  className={lista ? 'contador-pop' : undefined}
                  style={{ fontWeight: 800, fontSize: 14, color: lista ? 'var(--menta-tinta)' : ocupada ? 'var(--aviso-tinta)' : 'var(--menta-tinta)' }}
                >
                  {lista ? <><Icono n="timbre" tam={15} className="it" /> Lista{listaLlevar ? ' · para llevar' : ''}</> : p ? 'Ocupada' : grupo.length > 0 ? <><Icono n="enlace" tam={15} className="it" /> Juntas</> : 'Libre'}
                </span>
                <small className="suave" style={{ lineHeight: 1.3 }}>
                  {grupo.length > 0 && !p
                    ? 'Toca para tomar el pedido'
                    : ocupada
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
                  <Icono n="check" tam={15} className="it" /> Entregado
                </button>
              </Desplegable>
            </div>
          )
        })}
      </div>
    </div>
  )

  if (!ancho) return panelMesas
  return (
    <div className="salon-dividido">
      <div className="salon-lista">{panelMesas}</div>
      <div className="salon-detalle">
        {detalle ?? (
          <div className="vacio salon-vacio">
            <span className="vacio-icono">
              <Icono n="silla" tam={34} ancho={1.5} />
            </span>
            <b>Elige una mesa</b>
            <span>Toca una mesa de la izquierda para ver su cuenta y tomar el pedido.</span>
          </div>
        )}
      </div>
    </div>
  )
}

// Juntar mesas ANTES de pedir (una familia grande): las elegidas quedan unidas a una principal y
// comparten una sola cuenta. Desde la mesa principal también se agregan o se quitan mesas.
function JuntarMesas({ datos, principal, miembros, pedidoPorMesa, onCerrar, onHecho }) {
  const [sel, setSel] = useState(() => new Set())
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const enGrupo = (m) => !!m.unida_a || datos.mesas.some((x) => x.unida_a === m.id)
  const libres = datos.mesas.filter((m) => m.id !== principal?.id && !pedidoPorMesa.has(m.id) && !enGrupo(m))
  const elegidas = datos.mesas.filter((m) => sel.has(m.id))
  const minimo = principal ? 1 : 2
  const pri = principal ?? [...elegidas].sort((a, b) => a.numero - b.numero)[0]
  const otras = elegidas.filter((m) => m.id !== pri?.id)

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
  async function juntar() {
    if (!pri || elegidas.length < minimo) return
    const ids = principal ? elegidas.map((m) => m.id) : otras.map((m) => m.id)
    if (!(await llamar('unir_mesas', { p_principal: pri.id, p_otras: ids }))) return
    sonar('exito')
    avisar(`Mesas ${[pri.numero, ...(principal ? [] : []), ...(principal ? elegidas : otras).map((m) => m.numero)].join(' + ')} juntas`, 'ok')
    onHecho(pri.id)
  }
  async function quitar(m) {
    if (!(await llamar('separar_mesa', { p_mesa: m.id }))) return
    sentir('toque', 'tic')
    onHecho(principal.id)
  }
  async function separarTodo() {
    if (!(await llamar('separar_mesa', { p_mesa: principal.id }))) return
    sonar('pop')
    avisar('Mesas separadas', 'info')
    onHecho(principal.id)
  }

  return createPortal(
    <div className="hoja-velo funde" onClick={onCerrar}>
      <div className="hoja sube" role="dialog" aria-modal="true" aria-label="Juntar mesas" onClick={(e) => e.stopPropagation()}>
        <div className="hoja-asa" aria-hidden="true" />
        <div className="hoja-cab">
          <h3 style={{ margin: 0 }}>{principal ? `Mesa ${principal.numero} · juntar mesas` : 'Juntar mesas'}</h3>
          <button className="btn btn-chico btn-sec" style={{ width: 40, padding: 0 }} aria-label="Cerrar" onClick={onCerrar}>
            <Icono n="cerrar" tam={18} />
          </button>
        </div>
        <div className="hoja-cuerpo" style={{ paddingBottom: 'calc(18px + var(--seguro-abajo))' }}>
          <Mensaje tipo="error">{error}</Mensaje>

          {principal && miembros.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <h4 className="hoja-sec">Mesas juntas</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {miembros.map((m) => (
                  <span key={m.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    Mesa {m.numero}
                    <button style={{ all: 'unset', cursor: 'pointer', fontWeight: 900 }} disabled={trabajando} aria-label={`Quitar la mesa ${m.numero}`} onClick={() => quitar(m)}>
                      <Icono n="cerrar" tam={15} className="it" />
                    </button>
                  </span>
                ))}
              </div>
              <button className="btn btn-sec btn-chico" style={{ justifySelf: 'start' }} disabled={trabajando} onClick={separarTodo}>
                Separar todas
              </button>
            </div>
          )}

          <small className="suave">
            {principal
              ? 'Elige las mesas libres que quieres sumar a esta cuenta.'
              : 'Elige 2 o más mesas libres. Quedan como una sola, con una sola cuenta.'}
          </small>
          {libres.length === 0 && <small className="suave">No hay mesas libres para juntar.</small>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 10 }}>
            {libres.map((m) => {
              const on = sel.has(m.id)
              return (
                <button
                  key={m.id}
                  className={`btn ${on ? 'btn-principal' : 'btn-sec'}`}
                  style={{ display: 'grid', gap: 2, padding: '12px 8px' }}
                  aria-pressed={on}
                  onClick={() => {
                    sentir('toque', 'tic')
                    setSel((s0) => {
                      const n = new Set(s0)
                      n.has(m.id) ? n.delete(m.id) : n.add(m.id)
                      return n
                    })
                  }}
                >
                  <b style={{ fontSize: 22 }}>{m.numero}</b>
                  <small>{on ? <><Icono n="check" tam={15} className="it" /></> : 'Libre'}</small>
                </button>
              )
            })}
          </div>

          {elegidas.length >= minimo && (
            <p className="aparece" style={{ margin: 0, fontSize: 16 }}>
              {principal
                ? <>Se suman a la <b>mesa {principal.numero}</b>: {elegidas.map((m) => m.numero).join(', ')}.</>
                : <>Quedan juntas las mesas <b>{[pri, ...otras].map((m) => m.numero).sort((a, b) => a - b).join(' + ')}</b>, y se atienden desde la mesa <b>{pri.numero}</b>.</>}
            </p>
          )}
          <button className="btn btn-principal" disabled={elegidas.length < minimo || trabajando} onClick={juntar}>
            {trabajando ? 'Juntando…' : 'Juntar mesas'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Mesa({ restaurante, datos, rol, mesa, miembros = [], pedido, items, listos, onEntregar, onCreado, atras, onVolver, onCobrar, onIrAMesa, recargar }) {
  const hoy = useHoy(restaurante.zona_horaria)
  const esAdmin = rol === 'admin'
  const esLlevarVista = !!mesa.llevar // pedido para llevar (sin mesa)
  const rotulo = esLlevarVista
    ? pedido
      ? etiquetaLlevar(pedido)
      : 'Pedido para llevar'
    : miembros.length > 0
      ? `Mesas ${[mesa.numero, ...miembros.map((x) => x.numero)].join(' + ')}`
      : `Mesa ${mesa.numero}`
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
  const [abierta, setAbierta] = useState(false) // ventana de la orden
  const [juntando, setJuntando] = useState(false) // ventana para agregar o quitar mesas del grupo
  const [moviendo, setMoviendo] = useState(false) // ventana para cambiar o juntar mesa
  const [destino, setDestino] = useState(null) // mesa elegida, pendiente de confirmar
  const [resaltar, setResaltar] = useState(() => new Set()) // nombres recién enviados (destello)
  const tResaltar = useRef(null)

  useEffect(() => () => clearTimeout(tResaltar.current), [])

  // Con la orden abierta: la página de fondo no se mueve y Escape la cierra.
  useEffect(() => {
    if (!abierta) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const alTeclear = (e) => e.key === 'Escape' && setAbierta(false)
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.body.style.overflow = previo
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierta])

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
  // Se envía todo lo pendiente junto: lo que va a cocina genera ticket, lo demás se suma directo al pedido.
  const hayCocina = lineasPend.some((x) => !!catsPorId.get(x.prod.categoria_id)?.va_a_cocina)
  const hayAgotadoEnEnvio = lineasPend.some((x) => agotado(x.prod))

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
    if (!lineasPend.length) return
    // Pedido para llevar nuevo: antes de enviarlo se pregunta el nombre del cliente.
    if (esLlevarVista && !pedido && !pidiendoNombre) {
      sentir('toque', 'tic')
      setPidiendoNombre(true)
      return
    }
    // El nombre es obligatorio: con él se llama al cliente cuando el pedido está listo.
    if (esLlevarVista && !pedido && !nombreCliente.trim()) {
      sentir('aviso')
      setError('Escribe el nombre del cliente para poder llamarlo cuando esté listo.')
      return
    }
    sentir('toque')
    const enviados = lineasPend.map((x) => x.prod.nombre)
    const productos = lineasPend.map((x) => ({ producto_id: x.prod.id, cantidad: x.n, nota: x.nota.trim() }))
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
      avisar(hayCocina ? `Enviado a cocina · ${etiquetaEnvio}` : `Añadido al pedido · ${etiquetaEnvio}`, hayCocina ? 'cocina' : 'ok')
      setPidiendoNombre(false)
      if (esLlevarVista && !pedido && ok.pedido_id) onCreado(ok.pedido_id)
      setResaltar(new Set(enviados))
      clearTimeout(tResaltar.current)
      tResaltar.current = setTimeout(() => setResaltar(new Set()), 1600)
      setLlevar(false)
      setAbierta(false)
      setPend((p) => {
        const c = { ...p }
        lineasPend.forEach((x) => delete c[x.prod.id])
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

  // Cambiar la cuenta a otra mesa libre, o juntarla con la cuenta de una mesa ocupada.
  async function mover() {
    if (!destino) return
    const ok = await llamar('mover_pedido', { p_pedido: pedido.id, p_mesa_destino: destino.id })
    if (!ok) return
    sonar('exito')
    avisar(ok.unido ? `Mesa ${mesa.numero} juntada con la mesa ${destino.numero}` : `Cuenta pasada a la mesa ${destino.numero}`, 'ok')
    setMoviendo(false)
    setDestino(null)
    await recargar()
    onIrAMesa(ok.mesa_id ?? destino.id)
  }
  const puedeMover = !esLlevarVista && !!pedido && miembros.length === 0 && grupos.length > 0 && lineasPend.length === 0 && !trabajando

  const puedeCobrar = grupos.length > 0 && lineasPend.length === 0 && !trabajando
  const hayParaEnviar = lineasPend.length > 0 && !hayAgotadoEnEnvio
  const preguntaNombre = pidiendoNombre && hayParaEnviar

  const sinEnviar = lineasPend.reduce((n, x) => n + x.n, 0)

  return (
    <>
      <div
        className={atras ? 'entra-izquierda' : 'entra-derecha'}
        style={{ ...s.contenido, paddingBottom: 'calc(120px + var(--seguro-abajo))' }}
      >
        <div style={s.cabecera}>
          <button className="btn btn-fantasma" onClick={onVolver}>
            ‹ Mesas
          </button>
          <h2 style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
            {esLlevarVista ? <><Icono n="bolsa" tam={15} className="it" /></> : ''}
            {rotulo}
            {!esLlevarVista && mesa.nombre ? <span className="suave" style={{ fontWeight: 600 }}> · {mesa.nombre}</span> : ''}
          </h2>
          {!esLlevarVista && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flex: 'none' }}>
              <button
                className="btn btn-chico btn-sec"
                onClick={() => {
                  sentir('toque')
                  setJuntando(true)
                }}
              >
                <Icono n="enlace" tam={15} className="it" /> Juntar
              </button>
              {!!pedido && (
                <button
                  className="btn btn-chico btn-sec"
                  disabled={!puedeMover}
                  title={puedeMover ? 'Pasar la cuenta a otra mesa' : miembros.length ? 'Separa las mesas juntas antes de cambiar de mesa' : 'Envía a cocina lo que falta antes de cambiar de mesa'}
                  onClick={() => {
                    sentir('toque')
                    setDestino(null)
                    setMoviendo(true)
                  }}
                >
                  <Icono n="enlace" tam={15} className="it" /> Cambiar
                </button>
              )}
            </div>
          )}
        </div>

        <Mensaje tipo="error">{error}</Mensaje>

        {/* Cocina dejó el pedido listo: queda este aviso hasta que se retire. */}
        <Desplegable abierto={!!listos?.length}>
          <div style={s.bannerListo}>
            <span style={{ flex: 1, minWidth: 150 }}>
              <b><Icono n="timbre" tam={15} className="it" /> Pedido listo para retirar</b>
              <br />
              <small className="suave">
                {esLlevarVista ? 'El cliente ya puede retirarlo.' : listos?.some((e) => e.modalidad === 'llevar') ? 'Incluye pedido para llevar.' : 'Cocina ya lo dejó en la ventanilla.'}
              </small>
            </span>
            <button className="btn btn-principal" onClick={onEntregar}>
              {esLlevarVista ? <><Icono n="check" tam={15} className="it" /> Entregar y cobrar</> : <><Icono n="check" tam={15} className="it" /> Entregado</>}
            </button>
          </div>
        </Desplegable>


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
            <span className="vacio-icono"><Icono n="lista" tam={34} ancho={1.5} /></span>
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
                      <Icono n="prohibido" tam={15} className="it" /> Se agotó · quítalo del pedido
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
              </div>
            )
          })}
        </div>
        {datos.cats.length > 0 && prodsCat.length === 0 && (
          <p className="nota aparece">
            {soloAgotados ? <><Icono n="prohibido" tam={15} className="it" /> Todo lo de esta categoría está agotado por hoy.</> : 'Esta categoría no tiene productos activos.'}
          </p>
        )}
      </div>

      {/* Barra de la orden: siempre a la vista, con el ícono de papel y lápiz. */}
      <div className="sube barra-orden-caja">
        <button
          className={`barra-orden${sinEnviar > 0 ? ' pendiente' : ''}`}
          disabled={unidades === 0}
          aria-label={`Ver la orden de ${rotulo}`}
          onClick={() => {
            sentir('toque')
            setAbierta(true)
          }}
        >
          <span className="barra-orden-ic">
            <Icono n="orden" tam={24} />
            {unidades > 0 && (
              <em key={unidades} className="contador-pop">
                {unidades}
              </em>
            )}
          </span>
          <span className="barra-orden-t">
            <small>
              {unidades === 0 ? 'Orden vacía' : sinEnviar > 0 ? `${sinEnviar} sin enviar` : 'Orden enviada'}
            </small>
            <b>
              <NumeroAnimado valor={totalConf + totalPend} duracion={380} formato={(n) => formatear(n, restaurante)} />
            </b>
          </span>
          <span className="barra-orden-ir">
            Ver orden <Icono n="siguiente" tam={18} />
          </span>
        </button>
      </div>

      {juntando && (
        <JuntarMesas
          datos={datos}
          principal={mesa}
          miembros={miembros}
          pedidoPorMesa={new Map(datos.pedidos.filter((p) => p.mesa_id).map((p) => [p.mesa_id, p]))}
          onCerrar={() => setJuntando(false)}
          onHecho={async () => {
            setJuntando(false)
            await recargar()
          }}
        />
      )}
      {moviendo &&
        createPortal(
          <div className="hoja-velo funde" onClick={() => setMoviendo(false)}>
            <div className="hoja sube" role="dialog" aria-modal="true" aria-label="Cambiar o juntar mesa" onClick={(e) => e.stopPropagation()}>
              <div className="hoja-asa" aria-hidden="true" />
              <div className="hoja-cab">
                <h3 style={{ margin: 0 }}>Mesa {mesa.numero} · ¿a dónde va?</h3>
                <button className="btn btn-chico btn-sec" style={{ width: 40, padding: 0 }} aria-label="Cerrar" onClick={() => setMoviendo(false)}>
                  <Icono n="cerrar" tam={18} />
                </button>
              </div>
              <div className="hoja-cuerpo" style={{ paddingBottom: 'calc(18px + var(--seguro-abajo))' }}>
                <Mensaje tipo="error">{error}</Mensaje>
                {!destino ? (
                  <>
                    <small className="suave">Elige una mesa libre para cambiar la cuenta, o una ocupada para juntarlas.</small>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 }}>
                      {datos.mesas
                        .filter((m) => m.id !== mesa.id && !m.unida_a)
                        .map((m) => {
                          const ocupada = datos.pedidos.find((p) => p.mesa_id === m.id)
                          return (
                            <button
                              key={m.id}
                              className="btn btn-sec"
                              style={{ display: 'grid', gap: 2, padding: '12px 8px', borderColor: ocupada ? 'var(--borde-aviso)' : 'var(--borde-menta)' }}
                              onClick={() => {
                                sentir('toque')
                                setDestino({ ...m, ocupada: !!ocupada })
                              }}
                            >
                              <b style={{ fontSize: 22 }}>{m.numero}</b>
                              <small style={{ color: ocupada ? 'var(--aviso-tinta)' : 'var(--menta-tinta)', fontWeight: 800 }}>{ocupada ? 'Ocupada' : 'Libre'}</small>
                            </button>
                          )
                        })}
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <p style={{ margin: 0, fontSize: 17, lineHeight: 1.4 }}>
                      {destino.ocupada ? (
                        <>La cuenta de la <b>mesa {mesa.numero}</b> se junta con la de la <b>mesa {destino.numero}</b>. Quedan en una sola cuenta, en la mesa {destino.numero}.</>
                      ) : (
                        <>La cuenta de la <b>mesa {mesa.numero}</b> pasa a la <b>mesa {destino.numero}</b>. La mesa {mesa.numero} queda libre.</>
                      )}
                    </p>
                    <button className="btn btn-principal" disabled={trabajando} onClick={mover}>
                      {trabajando ? 'Moviendo…' : destino.ocupada ? `Juntar con la mesa ${destino.numero}` : `Pasar a la mesa ${destino.numero}`}
                    </button>
                    <button className="btn btn-sec" disabled={trabajando} onClick={() => setDestino(null)}>
                      Elegir otra mesa
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {abierta && (
        <div className="hoja-velo funde" onClick={() => setAbierta(false)}>
          <div className="hoja sube" role="dialog" aria-modal="true" aria-label={`Orden · ${rotulo}`} onClick={(e) => e.stopPropagation()}>
            <div className="hoja-asa" aria-hidden="true" />
            <div className="hoja-cab">
              <h3 style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>Orden · {rotulo}</h3>
              <button className="btn btn-chico btn-sec" style={{ width: 40, padding: 0 }} aria-label="Cerrar la orden" onClick={() => setAbierta(false)}>
                <Icono n="cerrar" tam={18} />
              </button>
            </div>

            <div className="hoja-cuerpo">
              <Mensaje tipo="error">{error}</Mensaje>

              {unidades === 0 && (
                <div className="vacio">
                  <span className="vacio-icono"><Icono n="nota" tam={34} ancho={1.5} /></span>
                  <b>La orden está vacía</b>
                  <span>Vuelve y toca “+” en los productos.</span>
                </div>
              )}

              {lineasPend.length > 0 && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <h4 className="hoja-sec">Por enviar</h4>
                  {lineasPend.map((x) => {
                    const p = x.prod
                    const nota = x.nota
                    const escribiendo = editandoNota === p.id
                    const sinStock = agotado(p)
                    return (
                      <div key={p.id} className="entra" style={{ ...s.producto, ...(sinStock ? s.productoAgotado : s.productoElegido) }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <b style={{ display: 'block' }}>{p.nombre}</b>
                          {sinStock ? (
                            <span className="infla" style={s.etiquetaAgotado}>
                              <Icono n="prohibido" tam={15} className="it" /> Se agotó · quítalo con −
                            </span>
                          ) : (
                            <small className="suave">{formatear(x.n * Number(p.precio), restaurante)}</small>
                          )}
                        </div>
                        <div style={s.cantidad}>
                          <button className="btn-redondo btn-suave" aria-label={`Quitar ${p.nombre}`} onClick={() => cambiar(p, -1)}>
                            −
                          </button>
                          <b key={x.n} className="contador-pop numero" style={{ minWidth: 22, textAlign: 'center', fontSize: 18 }}>
                            {x.n}
                          </b>
                          {!sinStock && (
                            <button className="btn-redondo btn-principal" aria-label={`Agregar ${p.nombre}`} onClick={() => cambiar(p, 1)}>
                              +
                            </button>
                          )}
                        </div>
                        <div style={{ flexBasis: '100%', minWidth: 0 }}>
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
                              <Icono n="menos" tam={15} className="it" /> Sin…
                            </button>
                            <button
                              type="button"
                              className="btn btn-chico btn-suave"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => empezarNota(p, 'Agregar')}
                            >
                              <Icono n="mas" tam={15} className="it" /> Agregar…
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
                          {nota ? <><Icono n="nota" tam={15} className="it" /> {nota}</> : <><Icono n="lapiz" tam={15} className="it" /> Agregar nota (sin cebolla, extra queso…)</>}
                        </button>
                      )}
                    </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

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
                    {g.nota && <span style={s.notaChip}><Icono n="nota" tam={15} className="it" /> {g.nota}</span>}
                    {g.preparado > 0 && (
                      <span style={s.preparadoChip}>
                        <Icono n="gorro" tam={15} className="it" /> {g.preparado === g.cantidad ? 'Ya preparado' : `${g.preparado} ya preparado${g.preparado === 1 ? '' : 's'}`}
                      </span>
                    )}
                    <br />
                    <small className="suave">
                      {g.va_a_cocina ? <><Icono n="gorro" tam={15} className="it" /> En cocina</> : 'No va a cocina'}
                      {g.llevar > 0 ? ` · ${g.llevar === g.cantidad ? 'para llevar' : `${g.llevar} para llevar`}` : ''} ·{' '}
                      {formatear(g.total, restaurante)}
                    </small>
                  </div>
                  {anulables(g) > 0 ? (
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
              <Confirmar
                abierto={confTodo}
                titulo="¿Anular la orden completa?"
                texto={
                  <>
                    Se avisa a la cocina de todo lo que ya se envió.
                    {esAdmin && hayPreparado && (
                      <small style={{ ...s.avisoPerdida, display: 'block', marginTop: 8 }}>
                        Cocina ya preparó parte del pedido: se contará como pérdida.
                      </small>
                    )}
                  </>
                }
                textoConfirmar="Sí, anular todo"
                trabajando={trabajando}
                onCancelar={() => setConfTodo(false)}
                onConfirmar={anularTodo}
              />
              <Confirmar
                abierto={!!conf && !!grupos.find((x) => x.clave === conf)}
                titulo={`¿Anular ${grupos.find((x) => x.clave === conf)?.nombre ?? ''}?`}
                texto={(() => {
                  const g = grupos.find((x) => x.clave === conf)
                  if (!g) return null
                  return (
                    <>
                      {esAdmin && g.preparado > 0 && (
                        <small style={{ ...s.avisoPerdida, display: 'block', marginBottom: 8 }}>
                          Cocina ya preparó {g.preparado === g.cantidad ? 'todo esto' : `${g.preparado} de ${g.cantidad}`}. Si lo anulas, se contará como pérdida.
                        </small>
                      )}
                      {anulables(g) > 1 ? 'Elige cuántas unidades anular:' : 'Se quita de la cuenta y se avisa a cocina.'}
                    </>
                  )
                })()}
                textoConfirmar="Sí, anular"
                trabajando={trabajando}
                onCancelar={() => setConf(null)}
                onConfirmar={() => anular(grupos.find((x) => x.clave === conf))}
              >
                {(() => {
                  const g = grupos.find((x) => x.clave === conf)
                  if (!g || anulables(g) <= 1) return null
                  return (
                    <div style={{ ...s.cantidad, justifySelf: 'center' }}>
                      <button className="btn-redondo btn-suave" aria-label="Una menos" onClick={() => { sentir('toque', 'popBajo'); setCq((n) => Math.max(1, n - 1)) }}>
                        −
                      </button>
                      <b key={cq} className="contador-pop numero" style={{ minWidth: 28, textAlign: 'center', fontSize: 20 }}>
                        {Math.min(cq, anulables(g))}
                      </b>
                      <button className="btn-redondo btn-suave" aria-label="Una más" onClick={() => { sentir('toque', 'pop'); setCq((n) => Math.min(anulables(g), n + 1)) }}>
                        +
                      </button>
                    </div>
                  )
                })()}
              </Confirmar>
            </div>
          )}
        </Desplegable>
            </div>

            <div className="hoja-pie">
              <div className="hoja-total">
                <span>Total</span>
                <b>
                  <NumeroAnimado valor={totalConf + totalPend} duracion={380} formato={(n) => formatear(n, restaurante)} />
                </b>
              </div>

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
                  <small className="suave">Con este nombre lo llaman cuando el pedido esté listo.</small>
                  <input
                    className="campo"
                    autoFocus
                    maxLength={40}
                    placeholder="Nombre del cliente"
                    required
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
                    <button className="btn btn-principal" style={{ flex: 1 }} disabled={trabajando || !nombreCliente.trim()}>
                      {trabajando ? <span className="puntos">Enviando</span> : hayCocina ? <><Icono n="gorro" tam={15} className="it" /> Enviar a cocina</> : 'Añadir al pedido'}
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
                      [false, <><Icono n="cubiertos" tam={15} className="it" /> Servir</>],
                      [true, <><Icono n="bolsa" tam={15} className="it" /> Para llevar</>],
                    ]}
                  />
                </div>
              </Desplegable>

              {hayAgotadoEnEnvio && (
                <p className="nota aparece">
                  <Icono n="prohibido" tam={15} className="it" /> Se agotó: {lineasPend.filter((x) => agotado(x.prod)).map((x) => x.prod.nombre).join(', ')}. Quítalo (con −) para poder
                  enviar la orden.
                </p>
              )}

              <Desplegable abierto={!preguntaNombre}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-sec" style={{ flex: '1 1 130px', minHeight: 50 }} onClick={() => setAbierta(false)}>
                    Seguir agregando
                  </button>
                  {lineasPend.length > 0 ? (
                    <button className="btn btn-principal" style={{ flex: '2 1 190px', minHeight: 50 }} disabled={!hayParaEnviar || trabajando} onClick={confirmar}>
                      {trabajando && hayParaEnviar ? <span className="puntos">Enviando</span> : hayCocina ? <><Icono n="gorro" tam={15} className="it" /> Enviar a cocina</> : 'Añadir al pedido'}
                    </button>
                  ) : (
                    <button
                      className="btn btn-principal"
                      style={{ flex: '2 1 190px', minHeight: 50 }}
                      disabled={!puedeCobrar}
                      onClick={() => {
                        setAbierta(false)
                        onCobrar()
                      }}
                    >
                      Cobrar
                    </button>
                  )}
                </div>
              </Desplegable>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Cobrar({ restaurante, datos, rol, mesa, pedido, items, onVolver, onListo }) {
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(null) // id del método (o 'dividido') que se está cobrando
  const [propinaModo, setPropinaModo] = useState('10') // '0' | '5' | '10' | 'otro'
  const [propinaOtro, setPropinaOtro] = useState('')
  const [efectivo, setEfectivo] = useState(null) // método "Efectivo" mientras se pide el monto recibido
  const [recibido, setRecibido] = useState('')
  const entradaRecibido = useRef(null)

  // Descuento / cortesía aplicado: { monto, motivo, adminId, pin, etiqueta }
  const [desc, setDesc] = useState(null)
  const [descAbierto, setDescAbierto] = useState(false)
  const [dTipo, setDTipo] = useState('10') // '5' | '10' | '15' | '20' | '100' (cortesía) | 'monto'
  const [dMonto, setDMonto] = useState('')
  const [dMotivo, setDMotivo] = useState('')
  const [admins, setAdmins] = useState([])
  const [dAdmin, setDAdmin] = useState('')
  const [dPin, setDPin] = useState('')
  const [dError, setDError] = useState('')
  const [dTrabajando, setDTrabajando] = useState(false)

  // Pago dividido: varias líneas método + monto
  const [divAbierto, setDivAbierto] = useState(false)
  const [lineasPago, setLineasPago] = useState([])
  const [personas, setPersonas] = useState('2')

  const esAdmin = rol === 'admin'

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

  const decimales = restaurante.moneda_decimales ?? 0
  const redondear = (n) => Math.round(n * 10 ** decimales) / 10 ** decimales
  const descuento = desc ? Math.min(desc.monto, total) : 0
  const neto = redondear(total - descuento)
  const cortesia = total > 0 && neto === 0

  // Propina: sugerida (10 %) o cualquier otro monto, siempre sobre lo ya descontado. Es voluntaria.
  const otro = leerPrecio(propinaOtro === '' ? '0' : propinaOtro, restaurante)
  const propina = cortesia ? 0 : propinaModo === 'otro' ? (otro ?? 0) : redondear((neto * Number(propinaModo)) / 100)
  const propinaInvalida = !cortesia && propinaModo === 'otro' && otro === null
  const aPagar = redondear(neto + propina)

  // Efectivo: con cuánto paga el cliente y cuánto hay que devolver.
  const recibidoNum = leerPrecio(recibido, restaurante)
  const falta = recibidoNum != null && recibidoNum < aPagar ? redondear(aPagar - recibidoNum) : 0
  const vuelto = recibidoNum != null && recibidoNum >= aPagar ? redondear(recibidoNum - aPagar) : null
  const efectivoListo = recibidoNum != null && recibidoNum >= aPagar

  useEffect(() => {
    if (!efectivo) return
    const t = setTimeout(() => entradaRecibido.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [efectivo])

  const etiquetaCuenta = pedido && mesa.llevar ? etiquetaLlevar(pedido) : `Mesa ${mesa.numero}`

  function abrirEfectivo(metodo) {
    if (propinaInvalida) return setError('La propina no es válida.')
    sentir('toque')
    setError('')
    setRecibido('')
    setEfectivo(metodo)
  }

  // Cobra la cuenta con una o varias líneas de pago. Una cortesía no lleva pagos.
  async function cobrarCuenta(pagos, boton, clave) {
    if (propinaInvalida) return setError('La propina no es válida.')
    sentir('toque')
    setError('')
    setTrabajando(clave)
    const { data, error } = await supabase.rpc('cobrar_cuenta', {
      p_pedido: pedido.id,
      p_pagos: pagos,
      p_propina: propina,
      p_descuento: descuento,
      p_motivo: desc ? desc.motivo : null,
      p_admin: desc && !esAdmin ? desc.adminId : null,
      p_pin: desc && !esAdmin ? desc.pin : null,
    })
    if (error || data?.ok === false) {
      setTrabajando(null)
      setError(error?.message ?? data?.error ?? 'No se pudo cobrar.')
      return
    }
    celebrar(boton)
    vibrar('exito')
    sonar('cobro')
    avisar(cortesia ? `${etiquetaCuenta} · cortesía registrada` : `${etiquetaCuenta} cobrada · ${formatear(aPagar, restaurante)}`, 'cobro')
    // Una pausa breve para que se alcance a disfrutar la confirmación antes de volver.
    setTimeout(onListo, 550)
  }

  const cobrar = (metodo, e) => cobrarCuenta([{ metodo: metodo.id, monto: aPagar }], e.currentTarget, metodo.id)

  // ---------- Descuento ----------
  async function abrirDescuento() {
    sentir('toque')
    setDError('')
    setDPin('')
    if (!desc) {
      setDTipo('10')
      setDMonto('')
      setDMotivo('')
    }
    setDescAbierto(true)
    if (!esAdmin && admins.length === 0) {
      const { data } = await supabase.rpc('admins_para_caja', { p_restaurante: restaurante.id })
      setAdmins(data ?? [])
      if (data?.length === 1) setDAdmin(data[0].usuario_id)
    }
  }

  const montoDesc =
    dTipo === 'monto'
      ? (() => {
          const v = leerPrecio(dMonto === '' ? '0' : dMonto, restaurante)
          return v == null ? null : Math.min(v, total)
        })()
      : redondear((total * Number(dTipo)) / 100)

  async function aplicarDescuento() {
    setDError('')
    if (montoDesc == null || montoDesc <= 0) return setDError('Indica cuánto se descuenta.')
    if (dTipo === 'monto' && leerPrecio(dMonto, restaurante) > total) return setDError('El descuento no puede superar la cuenta.')
    const motivo = dMotivo.trim()
    if (motivo.length < 3) return setDError('Escribe el motivo (mínimo 3 letras).')
    if (!esAdmin) {
      if (!dAdmin) return setDError('Elige quién autoriza.')
      if (!/^\d{4}$/.test(dPin)) return setDError('El PIN del administrador tiene 4 dígitos.')
      setDTrabajando(true)
      const { data, error } = await supabase.rpc('verificar_pin_admin', { p_restaurante: restaurante.id, p_admin: dAdmin, p_pin: dPin })
      setDTrabajando(false)
      if (error) return setDError(error.message)
      if (data?.ok === false) {
        setDPin('')
        return setDError(data.error ?? 'PIN incorrecto.')
      }
    }
    sentir('exito')
    setDesc({
      monto: montoDesc,
      motivo,
      adminId: dAdmin,
      pin: dPin,
      etiqueta: dTipo === '100' || montoDesc >= total ? 'Cortesía' : dTipo === 'monto' ? 'Descuento' : `Descuento ${dTipo} %`,
    })
    setDescAbierto(false)
  }

  // ---------- Pago dividido ----------
  const metodoInicial = datos.pagos[0]?.id ?? ''
  const montoLinea = (l) => leerPrecio(l.monto === '' ? '0' : l.monto, restaurante)
  const sumaLineas = redondear(lineasPago.reduce((t, l) => t + (montoLinea(l) ?? 0), 0))
  const pendiente = redondear(aPagar - sumaLineas)
  const lineasValidas = lineasPago.length > 0 && lineasPago.every((l) => l.metodo && (montoLinea(l) ?? 0) > 0)
  const divisionLista = lineasValidas && pendiente === 0

  function repartir(n) {
    const k = Math.max(1, Math.min(12, Number(n) || 1))
    const base = Math.floor((aPagar / k) * 10 ** decimales) / 10 ** decimales
    const nuevas = Array.from({ length: k }, (_, i) => ({
      metodo: lineasPago[i]?.metodo || metodoInicial,
      monto: String(i === k - 1 ? redondear(aPagar - base * (k - 1)) : base),
    }))
    setLineasPago(nuevas)
  }

  function abrirDividido() {
    if (propinaInvalida) return setError('La propina no es válida.')
    sentir('toque')
    setError('')
    setPersonas('2')
    const base = Math.floor((aPagar / 2) * 10 ** decimales) / 10 ** decimales
    setLineasPago([
      { metodo: metodoInicial, monto: String(base) },
      { metodo: metodoInicial, monto: String(redondear(aPagar - base)) },
    ])
    setDivAbierto(true)
  }

  const cambiarLinea = (i, parche) => setLineasPago((ls) => ls.map((l, j) => (j === i ? { ...l, ...parche } : l)))

  function confirmarDividido(e) {
    if (!divisionLista) return
    cobrarCuenta(
      lineasPago.map((l) => ({ metodo: l.metodo, monto: montoLinea(l) })),
      e.currentTarget,
      'dividido'
    )
  }

  function verPrecuenta() {
    sentir('toque')
    const ok = abrirPrecuenta({
      restaurante,
      titulo: etiquetaCuenta,
      numero: pedido.numero,
      lineas,
      subtotal: total,
      descuento,
      motivoDescuento: desc?.motivo ?? '',
    })
    if (!ok) setError('El navegador bloqueó la ventana. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.')
  }

  if (!pedido) {
    return (
      <div className="vacio aparece">
        <span className="vacio-icono"><Icono n="recibo" tam={34} ancho={1.5} /></span>
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
        <h2 style={{ margin: 0, overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}>{mesa.llevar ? `Cobrar · ${etiquetaLlevar(pedido)}` : `Cobrar mesa ${mesa.numero}`}</h2>
        <button className="btn btn-sec" onClick={verPrecuenta} disabled={!!trabajando}>
          Precuenta
        </button>
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
        {desc && (
          <div className="entra" style={{ ...s.lineaCobro, color: 'var(--rosa-tinta)' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{desc.etiqueta}</b> <small className="suave">· {desc.motivo}</small>
            </span>
            <b className="numero">− {formatear(descuento, restaurante)}</b>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {desc ? (
          <>
            <button className="btn btn-sec" disabled={!!trabajando} onClick={abrirDescuento}>Cambiar descuento</button>
            <button
              className="btn btn-fantasma"
              disabled={!!trabajando}
              onClick={() => {
                sentir('toque')
                setDesc(null)
              }}
            >
              Quitar descuento
            </button>
          </>
        ) : (
          <button className="btn btn-sec" disabled={!!trabajando} onClick={abrirDescuento}>
            Descuento o cortesía
          </button>
        )}
      </div>

      {!cortesia && (
        <div className="tarjeta" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <b>Propina</b>
            <small className="suave">Voluntaria · el cliente decide</small>
          </div>
          <div className="propina-opciones" role="group" aria-label="Propina">
            {[
              ['0', 'Sin propina'],
              ['5', '5 %'],
              ['10', '10 % sugerida'],
              ['otro', 'Otro monto'],
            ].map(([id, texto]) => (
              <button
                key={id}
                className="chip"
                aria-pressed={propinaModo === id}
                disabled={!!trabajando}
                onClick={() => {
                  sentir('toque', 'tic')
                  setPropinaModo(id)
                }}
              >
                {texto}
              </button>
            ))}
          </div>
          <Desplegable abierto={propinaModo === 'otro'}>
            <label className="etiqueta" style={{ paddingTop: 2 }}>
              Monto de la propina ({restaurante.moneda_simbolo})
              <input
                className="campo"
                inputMode={decimales > 0 ? 'decimal' : 'numeric'}
                placeholder={decimales > 0 ? '0.00' : '0'}
                value={propinaOtro}
                disabled={!!trabajando}
                onChange={(e) => setPropinaOtro(soloPrecio(e.target.value, restaurante))}
              />
            </label>
          </Desplegable>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--suave)', fontWeight: 700, flexWrap: 'wrap', gap: 6 }}>
            <span>Cuenta {formatear(neto, restaurante)}</span>
            <span style={{ color: propina > 0 ? 'var(--menta-tinta)' : undefined }}>
              + Propina {formatear(propina, restaurante)}
            </span>
          </div>
        </div>
      )}

      <div style={s.totalCobro}>
        <small style={{ opacity: 0.8 }}>{cortesia ? 'Cortesía · nada que cobrar' : 'Total a cobrar'}</small>
        <b style={{ fontSize: 'clamp(30px, 9vw, 40px)', lineHeight: 1.1 }}>
          <NumeroAnimado valor={aPagar} duracion={650} formato={(n) => formatear(n, restaurante)} />
        </b>
      </div>

      <Mensaje tipo="error">{error}</Mensaje>
      {datos.pagos.length === 0 && !cortesia && (
        <p className="nota">No hay métodos de pago activos. El administrador puede agregarlos en “Mesas y ajustes”.</p>
      )}

      {cortesia ? (
        <button className="btn btn-principal btn-grande" disabled={!!trabajando} onClick={(e) => cobrarCuenta([], e.currentTarget, 'cortesia')}>
          {trabajando ? <span className="puntos">Registrando</span> : 'Registrar cortesía'}
        </button>
      ) : (
        <>
          <h3 style={s.titulo}>¿Cómo paga?</h3>
          <div style={s.pagos}>
            {datos.pagos.map((m, i) => (
              <button
                key={m.id}
                className="btn btn-principal btn-grande entra"
                style={{ animationDelay: `${120 + i * 50}ms`, opacity: trabajando === m.id ? 1 : undefined }}
                disabled={!!trabajando || propinaInvalida}
                onClick={(e) => (esEfectivo(m.nombre) ? abrirEfectivo(m) : cobrar(m, e))}
              >
                {trabajando === m.id ? <span className="puntos">Cobrando</span> : m.nombre}
              </button>
            ))}
          </div>
          {datos.pagos.length > 0 && aPagar > 0 && (
            <button className="btn btn-sec" disabled={!!trabajando || propinaInvalida} onClick={abrirDividido}>
              Dividir o pagar con varios métodos
            </button>
          )}
        </>
      )}

      <Confirmar
        abierto={!!efectivo}
        titulo="Cobro en efectivo"
        peligro={false}
        textoConfirmar={trabajando ? 'Cobrando…' : 'Confirmar cobro'}
        trabajando={!!trabajando}
        bloqueado={!efectivoListo}
        error={efectivo ? error : ''}
        onCancelar={() => setEfectivo(null)}
        onConfirmar={(e) => efectivoListo && cobrar(efectivo, e)}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span className="suave">Total a cobrar</span>
            <b className="numero" style={{ fontSize: 22 }}>{formatear(aPagar, restaurante)}</b>
          </div>
          <label className="etiqueta">
            Monto con el que paga ({restaurante.moneda_simbolo})
            <input
              ref={entradaRecibido}
              className="campo"
              inputMode={decimales > 0 ? 'decimal' : 'numeric'}
              placeholder={decimales > 0 ? '0.00' : '0'}
              value={recibido}
              disabled={!!trabajando}
              onChange={(e) => setRecibido(soloPrecio(e.target.value, restaurante))}
              onKeyDown={(e) => e.key === 'Enter' && efectivoListo && !trabajando && cobrar(efectivo, e)}
              style={{ fontSize: 22, fontWeight: 800 }}
            />
          </label>
          <div
            aria-live="polite"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 8,
              padding: '12px 14px',
              borderRadius: 14,
              background: vuelto != null ? 'var(--menta)' : 'var(--sup)',
              border: '1px solid var(--linea)',
            }}
          >
            <b>{falta > 0 ? 'Falta' : 'Vuelto'}</b>
            <b
              className="numero"
              style={{ fontSize: 26, color: falta > 0 ? 'var(--rosa-tinta)' : vuelto != null ? 'var(--menta-tinta)' : 'var(--suave)' }}
            >
              {falta > 0 ? formatear(falta, restaurante) : vuelto != null ? formatear(vuelto, restaurante) : '—'}
            </b>
          </div>
        </div>
      </Confirmar>

      <Confirmar
        abierto={descAbierto}
        titulo="Descuento o cortesía"
        peligro={false}
        textoConfirmar={dTrabajando ? 'Verificando…' : 'Aplicar'}
        trabajando={dTrabajando}
        error={dError}
        onCancelar={() => setDescAbierto(false)}
        onConfirmar={aplicarDescuento}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="propina-opciones" role="group" aria-label="Tipo de descuento">
            {[
              ['5', '5 %'],
              ['10', '10 %'],
              ['15', '15 %'],
              ['20', '20 %'],
              ['monto', 'Monto'],
              ['100', 'Cortesía'],
            ].map(([id, texto]) => (
              <button key={id} className="chip" aria-pressed={dTipo === id} onClick={() => { sentir('toque', 'tic'); setDTipo(id) }}>
                {texto}
              </button>
            ))}
          </div>
          <Desplegable abierto={dTipo === 'monto'}>
            <label className="etiqueta">
              Monto a descontar ({restaurante.moneda_simbolo})
              <input
                className="campo"
                inputMode={decimales > 0 ? 'decimal' : 'numeric'}
                placeholder={decimales > 0 ? '0.00' : '0'}
                value={dMonto}
                onChange={(e) => setDMonto(soloPrecio(e.target.value, restaurante))}
              />
            </label>
          </Desplegable>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span className="suave">Se descuenta</span>
            <b className="numero" style={{ fontSize: 20, color: 'var(--rosa-tinta)' }}>− {formatear(montoDesc ?? 0, restaurante)}</b>
          </div>
          <label className="etiqueta">
            Motivo
            <input className="campo" maxLength={200} placeholder="Ej.: cumpleaños, error en la cocina…" value={dMotivo} onChange={(e) => setDMotivo(e.target.value)} />
          </label>
          {!esAdmin && (
            <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 14, background: 'var(--sup)', border: '1px solid var(--linea)' }}>
              <small className="suave">Un administrador debe autorizarlo con su PIN.</small>
              <label className="etiqueta">
                Autoriza
                <select className="campo" value={dAdmin} onChange={(e) => setDAdmin(e.target.value)}>
                  <option value="">Elige…</option>
                  {admins.map((a) => (
                    <option key={a.usuario_id} value={a.usuario_id}>{a.nombre}</option>
                  ))}
                </select>
              </label>
              <label className="etiqueta">
                PIN del administrador
                <input
                  className="campo"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={dPin}
                  onChange={(e) => setDPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onKeyDown={(e) => e.key === 'Enter' && !dTrabajando && aplicarDescuento()}
                />
              </label>
            </div>
          )}
        </div>
      </Confirmar>

      <Confirmar
        abierto={divAbierto}
        titulo="Dividir el pago"
        peligro={false}
        textoConfirmar={trabajando ? 'Cobrando…' : 'Confirmar cobro'}
        trabajando={!!trabajando}
        bloqueado={!divisionLista}
        error={divAbierto ? error : ''}
        onCancelar={() => setDivAbierto(false)}
        onConfirmar={confirmarDividido}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span className="suave">Total a cobrar</span>
            <b className="numero" style={{ fontSize: 22 }}>{formatear(aPagar, restaurante)}</b>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label className="etiqueta" style={{ flex: 1 }}>
              Repartir en partes iguales entre
              <input
                className="campo"
                inputMode="numeric"
                value={personas}
                disabled={!!trabajando}
                onChange={(e) => setPersonas(e.target.value.replace(/\D/g, '').slice(0, 2))}
              />
            </label>
            <button className="btn btn-sec" disabled={!!trabajando} onClick={() => repartir(personas)}>
              Repartir
            </button>
          </div>
          {lineasPago.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select className="campo" style={{ flex: 1.7, minWidth: 0 }} value={l.metodo} disabled={!!trabajando} onChange={(e) => cambiarLinea(i, { metodo: e.target.value })}>
                {datos.pagos.map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre}</option>
                ))}
              </select>
              <input
                className="campo"
                style={{ flex: 1, minWidth: 0 }}
                inputMode={decimales > 0 ? 'decimal' : 'numeric'}
                aria-label={`Monto del pago ${i + 1}`}
                value={l.monto}
                disabled={!!trabajando}
                onChange={(e) => cambiarLinea(i, { monto: soloPrecio(e.target.value, restaurante) })}
              />
              <button
                className="btn btn-fantasma"
                aria-label={`Poner lo que falta en el pago ${i + 1}`}
                title="Poner lo que falta"
                disabled={!!trabajando || pendiente === 0}
                onClick={() => cambiarLinea(i, { monto: String(redondear(Math.max(0, (montoLinea(l) ?? 0) + pendiente))) })}
              >
                Resto
              </button>
              {lineasPago.length > 1 && (
                <button className="btn btn-fantasma" aria-label={`Quitar el pago ${i + 1}`} disabled={!!trabajando} onClick={() => setLineasPago((ls) => ls.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {lineasPago.length < 12 && (
            <button
              className="btn btn-sec"
              disabled={!!trabajando}
              onClick={() => setLineasPago((ls) => [...ls, { metodo: metodoInicial, monto: pendiente > 0 ? String(pendiente) : '' }])}
            >
              + Agregar pago
            </button>
          )}
          <div
            aria-live="polite"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 8,
              padding: '12px 14px',
              borderRadius: 14,
              background: pendiente === 0 ? 'var(--menta)' : 'var(--sup)',
              border: '1px solid var(--linea)',
            }}
          >
            <b>{pendiente > 0 ? 'Falta' : pendiente < 0 ? 'Sobra' : 'Cuadra'}</b>
            <b className="numero" style={{ fontSize: 24, color: pendiente === 0 ? 'var(--menta-tinta)' : 'var(--rosa-tinta)' }}>
              {formatear(Math.abs(pendiente), restaurante)}
            </b>
          </div>
        </div>
      </Confirmar>
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
  mesaLista: { background: 'var(--menta)', borderColor: 'var(--menta-tinta)' },
  mesaLibre: { background: 'var(--sup)', borderColor: 'var(--linea)' },
  mesaOcupada: { background: 'var(--durazno)', borderColor: 'var(--borde-aviso)' },
  mesaArriba: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  mesaNombre: { color: 'var(--suave)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  punto: { display: 'inline-block', width: 12, height: 12, borderRadius: '50%', boxShadow: '0 0 0 4px var(--sup)' },
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
    background: 'var(--sup)',
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
    border: '1px solid var(--borde-rosa)',
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
    border: '1px solid var(--borde-menta)',
    color: 'var(--menta-tinta)',
  },
  etiquetaAgotado: { display: 'inline-block', marginTop: 2, padding: '2px 8px', borderRadius: 8, background: 'var(--rosa)', color: 'var(--rosa-tinta)', fontSize: 12, fontWeight: 800 },
  lista: { display: 'grid', gap: 8 },
  producto: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    background: 'var(--sup)',
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: 'var(--linea)',
    borderRadius: 16,
    padding: '10px 10px 10px 14px',
    boxShadow: 'var(--sombra)',
    transition: 'background-color 220ms var(--ease), border-color 220ms var(--ease)',
  },
  productoElegido: { background: 'color-mix(in srgb, var(--marca) 10%, var(--sup))', borderColor: 'var(--marca)' },
  productoAgotado: { background: 'var(--rosa)', borderColor: 'var(--borde-rosa)' },
  cantidad: { display: 'flex', alignItems: 'center', gap: 8, flex: 'none' },
  notaArea: { paddingTop: 8, marginTop: 8, borderTop: '1px dashed var(--linea)' },
  notaVacia: { color: 'var(--suave)', fontWeight: 700, padding: '4px 2px', minHeight: 36 },
  notaPuesta: { color: 'var(--aviso-tinta)', background: 'var(--durazno)', padding: '6px 10px', borderRadius: 10, textAlign: 'left', whiteSpace: 'normal' },
  preparadoChip: { display: 'inline-block', marginTop: 4, marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'var(--menta)', color: 'var(--menta-tinta)', fontSize: 13, fontWeight: 700 },
  avisoPerdida: { flexBasis: '100%', color: 'var(--rosa-tinta)', fontWeight: 700, lineHeight: 1.3 },
  sinAnular: { maxWidth: 190, textAlign: 'right', lineHeight: 1.3, fontSize: 12 },
  formNombre: { display: 'grid', gap: 8, paddingBottom: 10 },
  notaChip: { display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 8, background: 'var(--durazno)', color: 'var(--aviso-tinta)', fontSize: 13, fontWeight: 700 },
  barra: {
    position: 'fixed',
    zIndex: 40,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'color-mix(in srgb, var(--sup) 92%, transparent)',
    WebkitBackdropFilter: 'blur(16px) saturate(1.3)',
    backdropFilter: 'blur(16px) saturate(1.3)',
    borderTop: '1px solid var(--linea)',
    boxShadow: '0 -10px 30px -18px rgba(0,0,0,.5)',
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
    color: 'var(--tinta)',
    background: 'linear-gradient(135deg, color-mix(in srgb, var(--marca) 30%, var(--sup)) 0%, var(--sup) 100%)',
    border: '1px solid color-mix(in srgb, var(--marca) 35%, transparent)',
    boxShadow: 'var(--sombra)',
  },
  pagos: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
}
