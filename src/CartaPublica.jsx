import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { aplicarColores, quitarColores } from './paletas'
import { Cargando, Mensaje } from './ui'
import { fotoOk } from './imagenes'
import Icono from './iconos'
import { ordenarNombre } from './orden'

// Dirección de la carta (la que llevan los QR): tu-sitio/c/<codigo-del-local>/<codigo-de-la-mesa>
// Las direcciones antiguas (tu-sitio/#/carta/<local>/<mesa>) siguen funcionando, así que ningún QR ya impreso se rompe.
export function rutaCarta() {
  const m =
    /^\/c\/([^/?#]+)\/([^/?#]+)\/?$/.exec(window.location.pathname || '') ||
    /^#\/carta\/([^/?#]+)\/([^/?#]+)/.exec(window.location.hash || '')
  return m ? { slug: decodeURIComponent(m[1]), token: decodeURIComponent(m[2]) } : null
}

const guardar = (k, v) => {
  try {
    v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v)
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}
const leer = (k) => {
  try {
    return sessionStorage.getItem(k)
  } catch {
    return null
  }
}

// Identifica este celular (solo importa en los pedidos para llevar, donde varios clientes comparten el mismo QR).
function claveCelular() {
  let c = leer('qr-clave')
  if (!c) {
    const azar = () => Math.random().toString(36).slice(2)
    c = (globalThis.crypto?.randomUUID?.() ?? azar() + azar() + Date.now().toString(36)).replace(/-/g, '')
    guardar('qr-clave', c)
  }
  return c.slice(0, 64)
}

// Imagen de portada de cada categoría: la foto de uno de sus platos (los destacados primero). Si no hay, se dibuja una tarjeta de color.
function portadaDe(c) {
  const conFoto = c.productos.filter((p) => fotoOk(p.foto))
  return (conFoto.find((p) => p.destacado) ?? conFoto[0])?.foto ?? null
}
function iconoDe(c) {
  const t = String(c.nombre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (c.tipo === 'bebida' || /bebida|jugo|cerveza|trago|vino|cafe/.test(t)) return 'bebida'
  if (c.tipo === 'postre' || /postre|dulce|helado|torta/.test(t)) return 'postre'
  if (/llevar|envase|extra/.test(t)) return 'bolsa'
  return 'cubiertos'
}

// Lo que ve el cliente al escanear el QR de su mesa: la carta, un carrito, y avisos a la mesera.
// Sin sesión: todo pasa por funciones públicas del servidor. Los precios los pone siempre el servidor.
export default function CartaPublica({ slug, token }) {
  const [carta, setCarta] = useState(null)
  const [error, setError] = useState('')
  const [cant, setCant] = useState({}) // producto_id -> unidades
  const [notas, setNotas] = useState({}) // producto_id -> nota
  const [verPedido, setVerPedido] = useState(false)
  const [cliente, setCliente] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errPedido, setErrPedido] = useState('')
  const [pedidoId, setPedidoId] = useState(() => leer('qr-pedido-' + token))
  const [estado, setEstado] = useState(null) // { estado, motivo } del pedido enviado
  const [aviso, setAviso] = useState('')
  const [enfriando, setEnfriando] = useState(false)
  const [vistaCat, setVistaCat] = useState(null) // categoría abierta (null = se ven las tarjetas)
  const [buscando, setBuscando] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [aut, setAut] = useState(null) // { exige, estado: ninguna | pendiente | autorizada | rechazada, motivo }
  const [pidiendo, setPidiendo] = useState(false)
  const [avisoAut, setAvisoAut] = useState('')
  const [rechOculta, setRechOculta] = useState(null) // aviso de rechazo que el cliente ya cerró (o que se escondió solo)
  const [detalle, setDetalle] = useState(null) // { p, cat }: ficha de un plato
  const [clave] = useState(claveCelular)
  const [mesaEstado, setMesaEstado] = useState({ cuenta_abierta: false, cuenta_pedida: false, qr_bloqueado: false })
  const [finalizada, setFinalizada] = useState(() => leer('qr-fin-' + token) === '1')
  const vioCuenta = useRef(false) // ¿se vio la cuenta abierta desde este celular?

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('carta_publica', { p_slug: slug, p_token: token })
    if (error) {
      setError(error.message)
      return
    }
    setError('')
    // Los platos de cada categoría siempre salen en orden alfabético (el destacado se marca con su etiqueta).
    setCarta({ ...data, categorias: data.categorias.map((c) => ({ ...c, productos: ordenarNombre(c.productos) })) })
    setMesaEstado({ cuenta_abierta: !!data.cuenta_abierta, cuenta_pedida: !!data.cuenta_pedida, qr_bloqueado: !!data.qr_bloqueado })
  }, [slug, token])

  useEffect(() => {
    cargar()
    const alVolver = () => document.visibilityState === 'visible' && cargar()
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cargar])

  useEffect(() => {
    if (carta?.restaurante) aplicarColores(carta.restaurante)
    return () => quitarColores()
  }, [carta?.restaurante])

  // Estado de la mesa (liviano): cada pocos segundos. Sirve para activar "Pedir la cuenta" solo cuando hay cuenta
  // y para despedir al cliente cuando la cuenta se cobra.
  useEffect(() => {
    if (!carta || carta.llevar) return
    let vivo = true
    const consultar = async () => {
      if (document.visibilityState !== 'visible') return
      const { data } = await supabase.rpc('estado_mesa_qr', { p_slug: slug, p_token: token })
      if (vivo && data) setMesaEstado({ cuenta_abierta: !!data.cuenta_abierta, cuenta_pedida: !!data.cuenta_pedida, qr_bloqueado: !!data.qr_bloqueado })
    }
    const t = setInterval(consultar, 6000)
    document.addEventListener('visibilitychange', consultar)
    return () => {
      vivo = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', consultar)
    }
  }, [carta?.llevar, !!carta, slug, token])

  useEffect(() => {
    if (!carta || carta.llevar) return
    if (mesaEstado.cuenta_abierta) {
      vioCuenta.current = true
      if (finalizada) {
        // alguien abrió una cuenta nueva en la mesa: la despedida ya no corresponde
        guardar('qr-fin-' + token, null)
        setFinalizada(false)
      }
    } else if (vioCuenta.current) {
      // la cuenta que se veía ya no está: se cobró (o se anuló). Se despide al cliente.
      vioCuenta.current = false
      guardar('qr-fin-' + token, '1')
      guardar('qr-pedido-' + token, null)
      setFinalizada(true)
      setPedidoId(null)
      setEstado(null)
      setCant({})
      setNotas({})
      setVerPedido(false)
      // La visita terminó: se olvida la autorización (y cualquier aviso de rechazo) de esa visita.
      setAut(null)
      setAvisoAut('')
      setRechOculta(null)
      setVistaCat(null)
      setDetalle(null)
      setBuscando(false)
    }
  }, [mesaEstado.cuenta_abierta, carta?.llevar, !!carta])

  // Mientras la mesera no confirma, se consulta cada pocos segundos.
  useEffect(() => {
    if (!pedidoId) return
    let vivo = true
    const consultar = async () => {
      const { data } = await supabase.rpc('estado_pedido_qr', { p_id: pedidoId })
      if (vivo && data) {
        setEstado(data)
        if (data.estado === 'aprobado' && !carta?.llevar) vioCuenta.current = true
      }
    }
    consultar()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') consultar()
    }, 4000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [pedidoId])

  // ¿El local ya autorizó a esta mesa a pedir? Mientras espera, se consulta cada pocos segundos.
  const estadoAut = aut?.estado
  useEffect(() => {
    if (!carta?.puede_pedir) return
    let vivo = true
    const consultar = async () => {
      if (document.visibilityState !== 'visible') return
      const { data, error } = await supabase.rpc('estado_autorizacion_qr', { p_slug: slug, p_token: token, p_clave: clave })
      if (!vivo) return
      if (error) {
        // Aún sin ejecutar paso32: el local funciona como antes (sin autorización previa).
        if (/estado_autorizacion_qr|schema cache|could not find/i.test(error.message ?? '')) setAut({ exige: false, estado: 'autorizada' })
        return
      }
      if (data) setAut(data)
    }
    consultar()
    const t = setInterval(consultar, estadoAut === 'pendiente' ? 3000 : 8000)
    document.addEventListener('visibilitychange', consultar)
    return () => {
      vivo = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', consultar)
    }
  }, [!!carta, carta?.puede_pedir, slug, token, clave, estadoAut])

  // Al abrir o cerrar una categoría, la pantalla vuelve al inicio de la carta.
  const primeraVez = useRef(true)
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false
      return
    }
    document.getElementById('carta')?.scrollIntoView({ block: 'start' })
  }, [vistaCat])

  // El aviso «No pudimos autorizar tu pedido» se puede cerrar con la X y, si no, se esconde solo a los 20 segundos.
  const claveRech = aut?.estado === 'rechazada' ? String(aut.id ?? aut.motivo ?? 'rechazada') : null
  useEffect(() => {
    if (!claveRech) return
    const t = setTimeout(() => setRechOculta(claveRech), 20000)
    return () => clearTimeout(t)
  }, [claveRech])

  useEffect(() => {
    if (!avisoAut) return
    const t = setTimeout(() => setAvisoAut(''), 12000)
    return () => clearTimeout(t)
  }, [avisoAut])

  useEffect(() => {
    if (!detalle) return
    const alTeclear = (e) => e.key === 'Escape' && setDetalle(null)
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [detalle])

  useEffect(() => {
    if (!buscando) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const alTeclear = (e) => e.key === 'Escape' && setBuscando(false)
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.body.style.overflow = previo
      window.removeEventListener('keydown', alTeclear)
    }
  }, [buscando])

  const rest = carta?.restaurante
  const $ = (v) => formatear(v, rest ?? { moneda_simbolo: '$', moneda_decimales: 0 })

  const productos = useMemo(() => {
    const m = new Map()
    carta?.categorias.forEach((c) => c.productos.forEach((p) => m.set(p.id, p)))
    return m
  }, [carta])

  const lineas = useMemo(
    () =>
      Object.entries(cant)
        .filter(([id, n]) => n > 0 && productos.has(id))
        .map(([id, n]) => ({ ...productos.get(id), n, nota: notas[id] ?? '' })),
    [cant, notas, productos]
  )
  const unidades = lineas.reduce((n, l) => n + l.n, 0)
  const total = lineas.reduce((n, l) => n + l.n * Number(l.precio), 0)

  const cambiar = (id, d) => setCant((c) => ({ ...c, [id]: Math.max(0, Math.min(20, (c[id] ?? 0) + d)) }))

  async function enviar() {
    setErrPedido('')
    if (carta.llevar && !cliente.trim()) return setErrPedido('Escribe tu nombre para el pedido.')
    setEnviando(true)
    const { data, error } = await supabase.rpc('enviar_pedido_qr', {
      p_slug: slug,
      p_token: token,
      p_items: lineas.map((l) => ({ producto_id: l.id, cantidad: l.n, nota: l.nota })),
      p_cliente: cliente,
      ...(aut?.exige ? { p_clave: clave } : {}),
    })
    setEnviando(false)
    if (error) {
      setErrPedido(error.message)
      cargar() // por si algo se agotó
      return
    }
    guardar('qr-pedido-' + token, data.id)
    setEstado({ estado: 'pendiente' })
    setPedidoId(data.id)
    setVerPedido(false)
  }

  async function solicitar() {
    if (pidiendo) return
    setPidiendo(true)
    setAvisoAut('')
    const { data, error } = await supabase.rpc('solicitar_autorizacion_qr', { p_slug: slug, p_token: token, p_clave: clave })
    setPidiendo(false)
    if (error) {
      setAvisoAut(error.message)
      return
    }
    if (data) setAut(data)
  }

  function otroPedido() {
    guardar('qr-pedido-' + token, null)
    setPedidoId(null)
    setEstado(null)
    setCant({})
    setNotas({})
    cargar()
  }

  async function llamar(tipo) {
    if (enfriando) return
    setEnfriando(true)
    setTimeout(() => setEnfriando(false), 20000)
    const { data, error } = await supabase.rpc('llamar_mesera', { p_slug: slug, p_token: token, p_tipo: tipo })
    if (error) return setAviso(error.message)
    if (tipo === 'cuenta') setMesaEstado((m) => ({ ...m, cuenta_pedida: true }))
    setAviso(
      data?.ya
        ? 'Ya avisamos. En un momento te atienden.'
        : tipo === 'cuenta'
          ? 'Listo, la mesera te lleva la cuenta.'
          : 'Listo, ya avisamos a la mesera.'
    )
    setTimeout(() => setAviso(''), 7000)
  }

  if (error) {
    return (
      <div style={s.centro}>
        <Mensaje tipo="error">{error}</Mensaje>
        <small className="suave">Pídele a la mesera que te muestre la carta.</small>
      </div>
    )
  }
  if (!carta) {
    return (
      <div style={s.centro}>
        <Cargando filas={4} alto={64} />
      </div>
    )
  }

  // ---- La cuenta ya se pagó: despedida (sin botones de llamar ni de pedir la cuenta)
  if (finalizada && !carta.llevar) {
    return (
      <div style={s.centro}>
        <div className="tarjeta aparece" style={{ padding: 24, display: 'grid', gap: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--marca)' }}><Icono n="corazon" tam={46} ancho={1.5} /></div>
          <h2 style={{ margin: 0 }}>¡Gracias por tu visita!</h2>
          <p className="suave" style={{ margin: 0 }}>Tu cuenta ya está pagada. ¡Esperamos verte pronto en {rest.nombre}!</p>
          <button
            className="btn btn-sec"
            onClick={() => {
              guardar('qr-fin-' + token, null)
              setFinalizada(false)
            }}
          >
            Ver la carta de nuevo
          </button>
        </div>
      </div>
    )
  }

  // ---- Pedido enviado: pantalla de espera / confirmación
  if (pedidoId && estado) {
    const e = estado.estado
    const pendiente = e === 'pendiente'
    const ok = e === 'aprobado'
    return (
      <div style={s.centro}>
        <div className="tarjeta aparece" style={{ padding: 22, display: 'grid', gap: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--marca)' }}><Icono n={pendiente ? 'arena' : ok ? 'circulocheck' : 'alerta'} tam={44} ancho={1.5} /></div>
          <h2 style={{ margin: 0 }}>
            {pendiente && 'Esperando confirmación'}
            {ok && '¡Pedido confirmado!'}
            {e === 'rechazado' && 'No pudimos tomar tu pedido'}
            {(e === 'vencido' || e === 'desconocido') && 'Tu pedido venció'}
          </h2>
          <p className="suave" style={{ margin: 0 }}>
            {pendiente && 'Una persona del local lo está revisando. No cierres esta página.'}
            {ok && 'Ya lo estamos preparando. Si quieres algo más, puedes pedir de nuevo.'}
            {e === 'rechazado' && (estado.motivo || 'Habla con la mesera y te ayuda enseguida.')}
            {(e === 'vencido' || e === 'desconocido') && 'Pasó mucho rato sin confirmarse. Llama a la mesera o envíalo de nuevo.'}
          </p>
          {pendiente && (
            <button className="btn btn-sec" disabled={enfriando} onClick={() => llamar('mesera')}>
              Llamar a la mesera
            </button>
          )}
          {!pendiente && (
            <button className="btn btn-principal" onClick={otroPedido}>
              {ok ? 'Pedir algo más' : 'Volver a la carta'}
            </button>
          )}
          {aviso && <small className="suave">{aviso}</small>}
        </div>
      </div>
    )
  }

  const bloqueado = !!mesaEstado.qr_bloqueado
  const puedePedir = carta.puede_pedir && !bloqueado
  // Diseño fijo para todos los locales: la foto de fondo de la portada sale sola de los platos
  // (el destacado con foto primero). Si ningún plato tiene foto, se usa un degradado con el color del local.
  const conFoto = carta.categorias.flatMap((c) => c.productos).filter((p) => fotoOk(p.foto) && !p.agotado)
  const fondoPortada = (conFoto.find((p) => p.destacado) ?? conFoto[0])?.foto ?? null
  const rotulo = carta.llevar ? <><Icono n="bolsa" tam={15} className="it" /> Pedido para llevar</> : `Mesa ${carta.mesa?.numero}${carta.mesa?.nombre ? ` · ${carta.mesa.nombre}` : ''}`

  const irCarta = () => document.getElementById('carta')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Autorización previa del local: sin ella se ve la carta, pero no se puede agregar nada.
  const necesitaAut = puedePedir && !!aut?.exige && aut.estado !== 'autorizada'
  const puedeAgregar = puedePedir && !!aut && !necesitaAut
  const esperando = necesitaAut && aut.estado === 'pendiente'
  const catAbierta = carta.categorias.find((c) => c.id === vistaCat) ?? null
  const q = String(consulta).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const resultados = q
    ? carta.categorias
        .flatMap((c) => c.productos.map((p) => ({ p, cat: c.nombre })))
        .filter(({ p }) => String(p.nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q))
        .slice(0, 40)
    : []

  // Color de respaldo (cuando un plato no tiene foto): el mismo tono de la tarjeta de su categoría.
  const tono = (cat) => Math.max(0, carta.categorias.findIndex((c) => c.id === cat?.id)) % 5
  const catDe = (p) => carta.categorias.find((c) => c.productos.some((x) => x.id === p.id)) ?? null

  // Foto del plato, o un recuadro de color con un ícono si no tiene.
  const media = (p, cat, clase, tamIc = 34) =>
    fotoOk(p.foto) ? (
      <img className={clase} src={p.foto} alt="" loading="lazy" decoding="async" />
    ) : (
      <span className={`${clase} cp-ph v${tono(cat)}`} aria-hidden="true"><Icono n={iconoDe(cat ?? {})} tam={tamIc} ancho={1.4} /></span>
    )

  // Botón + (o − n +) para pedir. Solo aparece cuando el local ya autorizó.
  const control = (p) => {
    if (!puedeAgregar || p.agotado) return null
    const n = cant[p.id] ?? 0
    return n === 0 ? (
      <button className="cp-mas" onClick={() => cambiar(p.id, 1)} aria-label={`Agregar ${p.nombre}`}><Icono n="mas" tam={20} ancho={2.4} /></button>
    ) : (
      <div className="cp-paso">
        <button onClick={() => cambiar(p.id, -1)} aria-label={`Quitar uno de ${p.nombre}`}><Icono n="menos" tam={18} ancho={2.4} /></button>
        <b aria-live="polite">{n}</b>
        <button onClick={() => cambiar(p.id, 1)} aria-label={`Agregar otro ${p.nombre}`}><Icono n="mas" tam={18} ancho={2.4} /></button>
      </div>
    )
  }

  // Lista rápida (cuando ya puede pedir, y en la búsqueda): foto chica, nombre, precio y el botón +.
  const fila = (p, cat, etiqueta = null) => (
    <div key={p.id} className={`cp-fila${p.agotado ? ' agotado' : ''}`}>
      <button className="cp-fila-info" onClick={() => setDetalle({ p, cat })} aria-label={`Ver detalle de ${p.nombre}`}>
        {media(p, cat, 'cp-fila-media', 22)}
        <span className="cp-fila-txt">
          <b>{p.nombre}</b>
          {etiqueta ? <small>{etiqueta}</small> : null}
          <span className="cp-fila-pr">{p.agotado ? 'Agotado por hoy' : $(p.precio)}</span>
        </span>
      </button>
      {control(p)}
    </div>
  )

  // Vista elegante de una categoría (antes de que el local autorice): portada, plato destacado y grilla.
  const vitrina = (cat) => {
    const prods = cat.productos
    const disponibles = prods.filter((p) => !p.agotado)
    const dest = disponibles.find((p) => p.destacado) ?? disponibles.find((p) => fotoOk(p.foto)) ?? null
    const resto = prods.filter((p) => p !== dest)
    const portada = portadaDe(cat)
    return (
      <div className="cp-vit">
        <div className={`cp-vit-hero${portada ? '' : ` sin-foto v${tono(cat)}`}`}>
          {portada ? <img src={portada} alt="" decoding="async" /> : <span className="cp-cat-ic" aria-hidden="true"><Icono n={iconoDe(cat)} tam={130} ancho={1.1} /></span>}
          <span className="cp-vit-vel" />
          <button className="cp-vit-volver" onClick={() => setVistaCat(null)} aria-label="Volver a las categorías"><Icono n="atras" tam={18} ancho={2.4} /></button>
          <div className="cp-vit-txt">
            <small>Nuestra carta</small>
            <h3>{cat.nombre}</h3>
            <span>{prods.length} {prods.length === 1 ? 'opción' : 'opciones'}</span>
          </div>
        </div>

        {prods.length === 0 && <p className="cp-suave" style={{ textAlign: 'center' }}>Pronto habrá platos en esta categoría.</p>}

        {dest && (
          <button className="cp-vit-dest" onClick={() => setDetalle({ p: dest, cat })} aria-label={`Ver detalle de ${dest.nombre}`}>
            {media(dest, cat, 'cp-vit-dest-media', 40)}
            <span className="cp-vit-dest-txt">
              {dest.destacado ? <span className="cp-star"><Icono n="estrella" tam={13} className="it" /> Destacado</span> : null}
              <b className="cp-vit-n">{dest.nombre}</b>
              {dest.descripcion ? <span className="cp-vit-d">{dest.descripcion}</span> : null}
              <span className="cp-vit-p">{$(dest.precio)}</span>
            </span>
          </button>
        )}

        {resto.length > 0 && (
          <div className="cp-vit-grilla">
            {resto.map((p, k) => (
              <button
                key={p.id}
                className={`cp-vit-card${p.agotado ? ' agotado' : ''}${resto.length % 2 === 1 && k === resto.length - 1 ? ' ancho' : ''}`}
                onClick={() => setDetalle({ p, cat })}
                aria-label={`Ver detalle de ${p.nombre}`}
              >
                {media(p, cat, 'cp-vit-card-media', 30)}
                <span className="cp-vit-card-txt">
                  <b className="cp-vit-n">{p.nombre}</b>
                  <span className="cp-vit-p">{p.agotado ? 'Agotado por hoy' : $(p.precio)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {prods.length > 0 && <small className="cp-vit-ayuda">Toca un plato para ver su descripción.</small>}
      </div>
    )
  }

  return (
    <div className="cp">
      <style>{CSS}</style>

      {/* PORTADA */}
      <header className="cp-hero">
        {fondoPortada && <img className="cp-hero-img" src={fondoPortada} alt="" fetchpriority="high" decoding="async" />}
        <div className="cp-vel" />
        <div className="cp-hero-in">
          {rest.logo ? <img className="cp-logo" src={rest.logo} alt="" /> : null}
          <h1>{rest.nombre}</h1>
          <span className="cp-pill">{rotulo}</span>
          <div className="cp-cta">
            <button className="cp-boton cp-boton-fuerte" onClick={irCarta}>Ver la carta</button>
            {necesitaAut && (
              <button className="cp-boton" disabled={pidiendo || esperando} onClick={solicitar}>
                {esperando ? <><Icono n="arena" tam={15} className="it" /> Esperando autorización…</> : <><Icono n="orden" tam={15} className="it" /> Realizar pedido</>}
              </button>
            )}
            {!carta.llevar && (
              <>
                <button className="cp-boton" disabled={enfriando} onClick={() => llamar('mesera')}><Icono n="timbre" tam={15} className="it" /> Llamar a la mesera</button>
                {mesaEstado.cuenta_abierta && (
                  <button className="cp-boton" disabled={enfriando || mesaEstado.cuenta_pedida} onClick={() => llamar('cuenta')}>
                    {mesaEstado.cuenta_pedida ? <><Icono n="check" tam={15} className="it" /> Cuenta solicitada</> : <><Icono n="recibo" tam={15} className="it" /> Pedir la cuenta</>}
                  </button>
                )}
              </>
            )}
          </div>
          {aviso && <div className="cp-aviso" role="status">{aviso}</div>}
        </div>
      </header>

      {/* CARTA */}
      <section id="carta" className="cp-seccion">
        <div className="cp-wrap">
          <div className="cp-carta-cab">
            <h2 className="cp-titulo" style={{ margin: 0 }}>Nuestra carta</h2>
            {carta.categorias.length > 0 && (
              <button className="cp-lupa" aria-label="Buscar un plato" onClick={() => { setConsulta(''); setBuscando(true) }}>
                <Icono n="buscar" tam={20} />
              </button>
            )}
          </div>
          {bloqueado ? (
            <p className="cp-suave" role="status">Los pedidos desde el celular están pausados {carta.llevar ? 'por ahora' : 'en esta mesa'}. Pídele ayuda a la mesera.</p>
          ) : !puedePedir ? (
            <p className="cp-suave">Mira la carta con calma y pídele a la mesera lo que quieras.</p>
          ) : null}
          {necesitaAut && (
            <div className={`cp-aut${esperando ? ' espera' : ''}`} role="status">
              {esperando ? (
                <><Icono n="arena" tam={18} className="it" /> <span><b>Esperando autorización del local.</b> Puedes ir mirando la carta; apenas te autoricen podrás agregar tus platos.</span></>
              ) : claveRech && rechOculta !== claveRech ? (
                <>
                  <Icono n="alerta" tam={18} className="it" />{' '}
                  <span style={{ flex: 1 }}><b>No pudimos autorizar tu pedido.</b> {aut.motivo || 'Habla con la mesera y te ayuda enseguida.'}</span>
                  <button className="cp-aut-x" onClick={() => setRechOculta(claveRech)} aria-label="Cerrar este aviso"><Icono n="cerrar" tam={16} /></button>
                </>
              ) : (
                <><Icono n="orden" tam={18} className="it" /> <span>Para pedir desde el celular, toca <b>Realizar pedido</b>. El local te autoriza y ahí eliges tus platos.</span></>
              )}
            </div>
          )}
          {puedeAgregar && aut?.exige && (
            <div className="cp-aut ok" role="status"><Icono n="circulocheck" tam={18} className="it" /> <span><b>El local autorizó tu pedido.</b> Agrega tus platos con el botón +.</span></div>
          )}
          {avisoAut && <div className="cp-aut" role="alert"><Icono n="alerta" tam={18} className="it" /> <span>{avisoAut}</span></div>}
        </div>

        <div className="cp-wrap">
          {carta.categorias.length === 0 && <p className="cp-suave">Aún no hay productos en la carta.</p>}

          {!catAbierta && carta.categorias.length > 0 && (
            <div className="cp-cats">
              {carta.categorias.map((c, i) => {
                const foto = portadaDe(c)
                return (
                  <button key={c.id} className={`cp-cat-card${foto ? '' : ' sin-foto'} v${i % 5}`} onClick={() => setVistaCat(c.id)} aria-label={`Ver ${c.nombre}`}>
                    {foto ? (
                      <img src={foto} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span className="cp-cat-ic" aria-hidden="true"><Icono n={iconoDe(c)} tam={120} ancho={1.1} /></span>
                    )}
                    <span className="cp-cat-vel" />
                    <span className="cp-cat-txt">
                      <b>{c.nombre}</b>
                      <small>{c.productos.length} {c.productos.length === 1 ? 'opción' : 'opciones'}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {catAbierta && !puedeAgregar && vitrina(catAbierta)}
          {catAbierta && puedeAgregar && (
            <div className="cp-cat">
              <div className="cp-cat-cab">
                <button className="cp-volver" onClick={() => setVistaCat(null)} aria-label="Volver a las categorías"><Icono n="atras" tam={18} ancho={2.4} /></button>
                <h3 className="cp-cat-t">{catAbierta.nombre}</h3>
                <span className="cp-cat-n">{catAbierta.productos.length} {catAbierta.productos.length === 1 ? 'opción' : 'opciones'}</span>
              </div>
              <div className="cp-cat-lista">
                {catAbierta.productos.length === 0 && <p className="cp-suave" style={{ padding: '16px 0' }}>Pronto habrá platos en esta categoría.</p>}
                {catAbierta.productos.map((p) => fila(p, catAbierta))}
              </div>
            </div>
          )}
          {catAbierta && (
            <button className="cp-sec-boton" onClick={() => setVistaCat(null)}>Ver todas las categorías</button>
          )}
        </div>
      </section>

      <footer className="cp-pie">{rest.nombre}</footer>

      {puedePedir && aut && (necesitaAut || unidades > 0 || aut.exige) && (
        <div className="cp-barra">
          {necesitaAut ? (
            <button disabled={pidiendo || esperando} onClick={solicitar}>
              {esperando ? (
                <span><Icono n="arena" tam={18} className="it" /> Espera autorización del local…</span>
              ) : (
                <span>{pidiendo ? <span className="puntos">Enviando</span> : <><Icono n="orden" tam={18} className="it" /> Realizar pedido</>}</span>
              )}
            </button>
          ) : unidades > 0 ? (
            <button onClick={() => setVerPedido(true)}>
              <span>Ver mi pedido ({unidades})</span>
              <b>{$(total)}</b>
            </button>
          ) : (
            <div className="cp-barra-ok"><Icono n="circulocheck" tam={18} className="it" /> Pedido autorizado · elige tus platos</div>
          )}
        </div>
      )}

      {buscando && createPortal(
        <div className="cp-buscar-velo" onClick={() => setBuscando(false)}>
          <div className="cp-buscar" role="dialog" aria-modal="true" aria-label="Buscar un plato" onClick={(e) => e.stopPropagation()}>
            <div className="cp-buscar-cab">
              <Icono n="buscar" tam={20} />
              <input
                className="campo-chico"
                autoFocus
                autoComplete="off"
                maxLength={60}
                placeholder="Escribe el nombre del plato"
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
              />
              <button className="cp-buscar-x" aria-label="Cerrar la búsqueda" onClick={() => setBuscando(false)}><Icono n="cerrar" tam={18} /></button>
            </div>
            <div className="cp-buscar-res">
              {!q && <small className="cp-suave">Escribe parte del nombre, con o sin tildes.</small>}
              {q && resultados.length === 0 && <small className="cp-suave">No hay platos con ese nombre.</small>}
              {necesitaAut && resultados.length > 0 && <small className="cp-suave">Para agregar platos, primero toca «Realizar pedido» y espera la autorización del local.</small>}
              {resultados.map(({ p, cat }) => fila(p, catDe(p), cat))}
            </div>
            {resultados.length > 0 && puedeAgregar && unidades > 0 && (
              <button className="cp-sec-boton fuerte" onClick={() => setBuscando(false)}>Listo · ver mi pedido ({unidades})</button>
            )}
          </div>
        </div>,
        document.body
      )}

      {detalle && createPortal(
        (() => {
          const { p, cat } = detalle
          return (
            <div className="hoja-velo funde" style={{ zIndex: 88 }} onClick={() => setDetalle(null)}>
              <div className="hoja sube cp-det" role="dialog" aria-modal="true" aria-label={p.nombre} onClick={(e) => e.stopPropagation()}>
                <div className="cp-det-media-caja">
                  {media(p, cat, 'cp-det-media', 64)}
                  <button className="cp-det-x" onClick={() => setDetalle(null)} aria-label="Cerrar"><Icono n="cerrar" tam={18} /></button>
                </div>
                <div className="hoja-cuerpo" style={{ paddingTop: 16, paddingBottom: 'calc(20px + var(--seguro-abajo, 0px))' }}>
                  {p.destacado && !p.agotado ? <span className="cp-star"><Icono n="estrella" tam={13} className="it" /> Destacado</span> : null}
                  <div>
                    <h3 className="cp-det-n">{p.nombre}</h3>
                    {cat ? <small className="cp-suave">{cat.nombre}</small> : null}
                  </div>
                  {p.descripcion ? <p className="cp-det-d">{p.descripcion}</p> : null}
                  <div className="cp-det-pie">
                    <b>{p.agotado ? 'Agotado por hoy' : $(p.precio)}</b>
                    {control(p)}
                  </div>
                  {necesitaAut && !p.agotado && (
                    esperando ? (
                      <div className="cp-aut espera" style={{ margin: 0 }}><Icono n="arena" tam={18} className="it" /> <span>Esperando autorización del local. Apenas te autoricen podrás agregarlo.</span></div>
                    ) : (
                      <button className="cp-sec-boton fuerte" style={{ marginTop: 0 }} disabled={pidiendo} onClick={solicitar}>
                        {pidiendo ? <span className="puntos">Enviando</span> : <><Icono n="orden" tam={16} className="it" /> Realizar pedido</>}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          )
        })(),
        document.body
      )}

      {verPedido && createPortal(
        <div className="hoja-velo funde" onClick={() => !enviando && setVerPedido(false)}>
          <div className="hoja sube" role="dialog" aria-modal="true" aria-label="Mi pedido" onClick={(e) => e.stopPropagation()}>
            <div className="hoja-asa" aria-hidden="true" />
            <div className="hoja-cab">
              <h3 style={{ margin: 0 }}>Mi pedido</h3>
              <button className="btn btn-chico btn-sec" style={{ width: 40, padding: 0 }} aria-label="Cerrar" onClick={() => setVerPedido(false)}>
                <Icono n="cerrar" tam={18} />
              </button>
            </div>
            <div className="hoja-cuerpo" style={{ paddingBottom: 'calc(18px + var(--seguro-abajo, 0px))' }}>
              {lineas.map((l) => (
                <div key={l.id} style={{ display: 'grid', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--linea)' }}>
                  <div style={s.fila0}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{l.nombre}</div>
                      <small className="suave">{$(Number(l.precio) * l.n)}</small>
                    </div>
                    <div style={s.paso}>
                      <button className="btn btn-chico btn-sec" style={s.mas} onClick={() => cambiar(l.id, -1)} aria-label={`Quitar uno de ${l.nombre}`}>−</button>
                      <b style={{ minWidth: 22, textAlign: 'center' }}>{l.n}</b>
                      <button className="btn btn-chico btn-sec" style={s.mas} onClick={() => cambiar(l.id, 1)} aria-label={`Agregar otro ${l.nombre}`}>+</button>
                    </div>
                  </div>
                  <input
                    className="campo-chico"
                    maxLength={120}
                    placeholder="Nota (ej: sin cebolla)"
                    value={notas[l.id] ?? ''}
                    onChange={(e) => setNotas((x) => ({ ...x, [l.id]: e.target.value }))}
                  />
                </div>
              ))}

              {carta.llevar && (
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontWeight: 700 }}>Tu nombre</span>
                  <input className="campo-chico" maxLength={40} placeholder="Para llamarte cuando esté listo" value={cliente} onChange={(e) => setCliente(e.target.value)} />
                </label>
              )}

              <div style={s.fila0}>
                <b>Total</b>
                <b style={{ fontSize: 20 }}>{$(total)}</b>
              </div>
              <small className="suave">Una persona del local confirma tu pedido antes de prepararlo. La propina y el pago se hacen al final.</small>
              <Mensaje tipo="error">{errPedido}</Mensaje>
              <button className="btn btn-principal" disabled={enviando || unidades === 0} onClick={enviar}>
                {enviando ? <span className="puntos">Enviando</span> : 'Enviar pedido'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

const CSS = `
.cp{background:var(--fondo);color:var(--tinta);min-height:100dvh;padding-bottom:calc(96px + var(--seguro-abajo,0px))}
.cp-wrap{max-width:720px;margin:0 auto;padding:0 18px}
.cp-seccion{padding-top:34px}
.cp-titulo{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-size:27px;line-height:1.15;margin:0 0 12px}
.cp-suave{color:var(--suave);margin:0 0 8px;font-size:15px}
.cp-hero{position:relative;overflow:hidden;min-height:min(72svh,560px);display:grid;align-items:end;background:linear-gradient(160deg,color-mix(in srgb,var(--marca) 60%,var(--fondo)),var(--fondo) 85%);color:#fff}
.cp-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cp-vel{position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,var(--fondo) 100%),linear-gradient(rgba(0,0,0,.42),rgba(0,0,0,.42))}
.cp-hero-in{position:relative;max-width:720px;width:100%;margin:0 auto;padding:56px 18px 30px;display:grid;gap:12px;justify-items:center;text-align:center}
.cp-logo{max-height:84px;max-width:200px;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,.4))}
.cp-hero h1{margin:0;font-family:'Fraunces',Georgia,'Times New Roman',serif;font-size:clamp(34px,9vw,52px);line-height:1.05;text-shadow:0 2px 14px rgba(0,0,0,.55);overflow-wrap:anywhere}
.cp-pill{display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(0,0,0,.45);backdrop-filter:blur(6px);font-weight:800;font-size:13px;letter-spacing:.4px}
.cp-cta{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:6px}
.cp-boton{all:unset;box-sizing:border-box;cursor:pointer;padding:11px 18px;border-radius:999px;background:rgba(255,255,255,.16);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.35);font-weight:800;font-size:15px;color:#fff}
.cp-boton:disabled{opacity:.55;cursor:default}
.cp-boton-fuerte{background:var(--marca);border-color:var(--marca);color:var(--sobre-marca)}
.cp-aviso{padding:8px 14px;border-radius:12px;background:rgba(0,0,0,.55);font-size:14px}
.cp-carta-cab{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.cp-lupa{all:unset;cursor:pointer;box-sizing:border-box;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:var(--marca);color:var(--sobre-marca)}
.cp-lupa:active{transform:scale(.94)}
.cp-aut{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:16px;margin:0 0 12px;background:var(--durazno);border:1px solid var(--borde-aviso);color:var(--aviso-tinta);font-size:14px;line-height:1.4}
.cp-aut.ok{background:var(--menta);border-color:var(--borde-menta);color:var(--menta-tinta)}
.cp-aut.espera{background:color-mix(in srgb,var(--marca) 14%,var(--sup));border-color:color-mix(in srgb,var(--marca) 45%,var(--linea));color:var(--tinta)}
.cp-aut .it{flex:none;margin-top:2px}
.cp-cats{display:grid;gap:14px;margin-top:6px}
.cp-cat-card{all:unset;box-sizing:border-box;cursor:pointer;position:relative;display:grid;place-items:center;min-height:150px;border-radius:30px;overflow:hidden;color:#fff;isolation:isolate;box-shadow:0 10px 26px -16px rgba(0,0,0,.55);transition:transform .18s}
.cp-cat-card:active{transform:scale(.985)}
.cp-cat-card>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}
.cp-cat-vel{position:absolute;inset:0;z-index:-1;background:rgba(0,0,0,.38)}
.cp-cat-card.sin-foto{background:linear-gradient(135deg,color-mix(in srgb,var(--marca) 78%,#000),color-mix(in srgb,var(--marca) 38%,#000))}
.cp-cat-card.sin-foto.v1{background:linear-gradient(135deg,#7a3b2e,#c0694a)}
.cp-cat-card.sin-foto.v2{background:linear-gradient(135deg,#2f5d50,#5e9c85)}
.cp-cat-card.sin-foto.v3{background:linear-gradient(135deg,#4a3b6b,#8c76c2)}
.cp-cat-card.sin-foto.v4{background:linear-gradient(135deg,#6b5a2a,#c2a24d)}
.cp-cat-card.sin-foto .cp-cat-vel{background:rgba(0,0,0,.12)}
.cp-cat-ic{position:absolute;right:-14px;bottom:-22px;z-index:-1;opacity:.22;color:#fff;transform:rotate(-12deg)}
.cp-cat-txt{display:grid;gap:4px;justify-items:center;text-align:center;padding:18px 20px}
.cp-cat-txt b{font-size:clamp(22px,6.4vw,30px);line-height:1.12;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;text-shadow:0 2px 12px rgba(0,0,0,.5);overflow-wrap:anywhere}
.cp-cat-txt small{font-size:13px;font-weight:700;letter-spacing:.3px;opacity:.92;text-shadow:0 1px 8px rgba(0,0,0,.5)}
@media(min-width:620px){.cp-cats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cp-volver{all:unset;cursor:pointer;flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:var(--sup);border:1px solid var(--linea);color:var(--tinta)}
.cp-cat-cab{align-items:center}
.cp-cat-cab .cp-cat-t{flex:1;min-width:0;overflow-wrap:anywhere}
.cp-sec-boton{all:unset;box-sizing:border-box;cursor:pointer;display:block;width:100%;margin-top:14px;padding:13px 18px;text-align:center;border-radius:16px;border:1px solid var(--linea);background:var(--sup);font-weight:800;font-size:15px}
.cp-sec-boton.fuerte{background:var(--marca);border-color:var(--marca);color:var(--sobre-marca)}
.cp-barra button:disabled{opacity:.8;cursor:default}
.cp-barra-ok{display:flex;gap:8px;align-items:center;justify-content:center;padding:14px 18px;border-radius:16px;background:var(--menta);border:1px solid var(--borde-menta);color:var(--menta-tinta);font-weight:800;font-size:15px}
.cp-buscar-velo{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;padding:12vh 14px 14px}
.cp-buscar{width:100%;max-width:520px;max-height:78vh;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;gap:10px;background:var(--fondo);color:var(--tinta);border-radius:22px;padding:14px;box-shadow:0 24px 60px -20px rgba(0,0,0,.6)}
.cp-buscar-cab{display:flex;gap:10px;align-items:center}
.cp-buscar-cab .campo-chico{flex:1;min-width:0}
.cp-buscar-x{all:unset;cursor:pointer;flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--sup);border:1px solid var(--linea)}
.cp-buscar-res{overflow-y:auto;overflow-x:hidden;min-height:60px;display:grid;grid-template-columns:minmax(0,1fr);align-content:start}
.cp-nav{position:sticky;top:0;padding-top:env(safe-area-inset-top,0px);z-index:20;box-shadow:0 6px 14px -12px rgba(0,0,0,.6);background:color-mix(in srgb,var(--fondo) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--linea);margin:6px 0 4px}
.cp-nav-in{display:flex;gap:8px;overflow-x:auto;padding-top:10px;padding-bottom:10px;scrollbar-width:none}
.cp-nav-in::-webkit-scrollbar{display:none}
.cp-nav button{all:unset;cursor:pointer;white-space:nowrap;padding:8px 16px;border-radius:999px;border:1px solid var(--linea);background:var(--sup);font-weight:700;font-size:14px}
.cp-nav button.on{background:var(--marca);border-color:var(--marca);color:var(--sobre-marca)}
.cp-cat{scroll-margin-top:68px;margin-top:34px;border-radius:20px;overflow:hidden;background:var(--sup);border:1px solid var(--linea)}
.cp-cat-cab{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:16px 18px 14px;background:color-mix(in srgb,var(--marca) 16%,var(--sup));border-bottom:3px solid var(--marca)}
.cp-cat-t{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-size:27px;line-height:1.1;margin:0;letter-spacing:.2px}
.cp-cat-n{font-size:13px;font-weight:700;color:var(--suave);white-space:nowrap}
.cp-cat-lista{padding:0 18px}
.cp-star{align-self:flex-start;justify-self:start;display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;letter-spacing:.3px;padding:3px 9px;border-radius:999px;background:var(--durazno);color:var(--aviso-tinta)}
.cp-ph{display:grid;place-items:center;color:rgba(255,255,255,.88);background:linear-gradient(135deg,color-mix(in srgb,var(--marca) 78%,#000),color-mix(in srgb,var(--marca) 38%,#000))}
.cp-ph.v1{background:linear-gradient(135deg,#7a3b2e,#c0694a)}
.cp-ph.v2{background:linear-gradient(135deg,#2f5d50,#5e9c85)}
.cp-ph.v3{background:linear-gradient(135deg,#4a3b6b,#8c76c2)}
.cp-ph.v4{background:linear-gradient(135deg,#6b5a2a,#c2a24d)}
/* Vista elegante de una categoría (opción C): portada + destacado + grilla */
.cp-vit{margin-top:22px;display:grid;gap:12px}
.cp-vit-hero{position:relative;isolation:isolate;overflow:hidden;min-height:168px;border-radius:26px;display:grid;place-items:center;color:#fff;box-shadow:0 12px 30px -18px rgba(0,0,0,.6)}
.cp-vit-hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}
.cp-vit-hero.sin-foto{background:linear-gradient(135deg,color-mix(in srgb,var(--marca) 78%,#000),color-mix(in srgb,var(--marca) 38%,#000))}
.cp-vit-hero.sin-foto.v1{background:linear-gradient(135deg,#7a3b2e,#c0694a)}
.cp-vit-hero.sin-foto.v2{background:linear-gradient(135deg,#2f5d50,#5e9c85)}
.cp-vit-hero.sin-foto.v3{background:linear-gradient(135deg,#4a3b6b,#8c76c2)}
.cp-vit-hero.sin-foto.v4{background:linear-gradient(135deg,#6b5a2a,#c2a24d)}
.cp-vit-vel{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.5))}
.cp-vit-hero.sin-foto .cp-vit-vel{background:rgba(0,0,0,.14)}
.cp-vit-volver{all:unset;cursor:pointer;position:absolute;top:12px;left:12px;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.35);color:#fff}
.cp-vit-txt{display:grid;gap:4px;justify-items:center;text-align:center;padding:26px 56px}
.cp-vit-txt small{font-size:12px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;opacity:.9}
.cp-vit-txt h3{margin:0;font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:600;font-size:clamp(28px,8vw,38px);line-height:1.08;text-shadow:0 2px 14px rgba(0,0,0,.45);overflow-wrap:anywhere}
.cp-vit-txt span{font-size:13px;font-weight:700;opacity:.9}
.cp-vit-n{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:600;line-height:1.2;overflow-wrap:anywhere}
.cp-vit-p{font-weight:800;font-variant-numeric:tabular-nums}
.cp-vit-dest{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:118px minmax(0,1fr);min-height:140px;border-radius:20px;overflow:hidden;background:var(--sup);border:1px solid var(--linea);color:var(--tinta)}
.cp-vit-dest-media{width:100%;height:100%;min-height:140px;object-fit:cover;display:grid}
.cp-vit-dest-txt{display:flex;flex-direction:column;gap:5px;padding:14px 16px;min-width:0}
.cp-vit-dest-txt .cp-vit-n{font-size:20px}
.cp-vit-d{color:var(--suave);font-size:13.5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cp-vit-dest-txt .cp-vit-p{font-size:17px;margin-top:auto;padding-top:2px}
.cp-vit-grilla{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media(min-width:620px){.cp-vit-grilla{grid-template-columns:repeat(3,minmax(0,1fr))}.cp-vit-card.ancho{grid-column:auto}}
.cp-vit-card{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;border-radius:18px;overflow:hidden;background:var(--sup);border:1px solid var(--linea);color:var(--tinta)}
.cp-vit-card.ancho{grid-column:1/-1}
.cp-vit-card-media{width:100%;height:112px;object-fit:cover;display:grid;flex:none}
.cp-vit-card.ancho .cp-vit-card-media{height:128px}
.cp-vit-card-txt{display:flex;flex-direction:column;gap:4px;padding:10px 12px 12px;flex:1}
.cp-vit-card-txt .cp-vit-n{font-size:16.5px}
.cp-vit-card-txt .cp-vit-p{font-size:15px;margin-top:auto}
.cp-vit-card.agotado,.cp-vit-dest.agotado{opacity:.55}
.cp-vit-card:active,.cp-vit-dest:active{transform:scale(.985)}
.cp-vit-ayuda{display:block;text-align:center;color:var(--suave);font-size:13px}
/* Lista rápida para pedir (cuando el local ya autorizó) */
.cp-fila{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--linea)}
.cp-fila:last-child{border-bottom:0}
.cp-fila.agotado{opacity:.55}
.cp-fila-info{all:unset;cursor:pointer;flex:1;min-width:0;display:flex;align-items:center;gap:12px}
.cp-fila-media{width:56px;height:56px;border-radius:12px;object-fit:cover;flex:none;display:grid}
.cp-fila-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.cp-fila-txt b{font-size:16px;line-height:1.25;overflow-wrap:anywhere}
.cp-fila-txt small{font-size:12px;color:var(--suave)}
.cp-fila-pr{font-size:14px;font-weight:700;color:var(--suave);font-variant-numeric:tabular-nums}
.cp-mas{all:unset;cursor:pointer;flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--marca);color:var(--sobre-marca)}
.cp-mas:active{transform:scale(.92)}
.cp-paso{flex:none;display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:var(--sup);border:1px solid var(--linea)}
.cp-paso button{all:unset;cursor:pointer;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--marca) 16%,transparent);color:var(--tinta)}
.cp-paso button:active{transform:scale(.92)}
.cp-paso b{min-width:28px;text-align:center;font-size:16px}
/* Ficha de un plato */
.cp-det{overflow:hidden}
.cp-det-media-caja{position:relative;flex:none}
.cp-det-media{width:100%;height:220px;object-fit:cover;display:grid}
.cp-det-media.cp-ph{height:150px}
.cp-det-x{all:unset;cursor:pointer;position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.4);backdrop-filter:blur(6px);color:#fff}
.cp-det-n{margin:0;font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:600;font-size:26px;line-height:1.15;overflow-wrap:anywhere}
.cp-det-d{margin:0;color:var(--suave);font-size:15px;line-height:1.5;white-space:pre-line}
.cp-det-pie{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}
.cp-det-pie>b{font-size:21px;font-variant-numeric:tabular-nums}
.cp-aut-x{all:unset;cursor:pointer;flex:none;width:30px;height:30px;margin:-4px -6px -4px 0;border-radius:50%;display:grid;place-items:center;color:inherit}
.cp-sec-boton:disabled{opacity:.6;cursor:default}
.cp-pie{text-align:center;color:var(--suave);font-size:13px;padding:36px 18px 8px}
.cp-barra{position:fixed;left:0;right:0;bottom:0;z-index:30;max-width:720px;margin:0 auto;padding:10px 16px calc(10px + var(--seguro-abajo,0px));background:var(--fondo);border-top:1px solid var(--linea)}
.cp-barra button{all:unset;box-sizing:border-box;width:100%;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-radius:16px;background:var(--marca);color:var(--sobre-marca);font-weight:800}
`

const s = {
  centro: { maxWidth: 420, margin: '0 auto', padding: '40px 16px', display: 'grid', gap: 14 },
  cab: { position: 'sticky', top: 0, zIndex: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '14px 16px 10px', background: 'var(--fondo)', borderBottom: '1px solid var(--linea)' },
  llamar: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 16px 6px' },
  chips: { display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 16px', position: 'sticky', top: 62, zIndex: 15, background: 'var(--fondo)' },
  chip: { all: 'unset', boxSizing: 'border-box', cursor: 'pointer', whiteSpace: 'nowrap', padding: '8px 14px', borderRadius: 999, border: '1px solid var(--linea)', background: 'var(--sup)', fontWeight: 700, fontSize: 14 },
  chipOn: { borderColor: 'var(--marca, currentColor)' },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--linea)' },
  fila0: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  paso: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' },
  mas: { width: 38, height: 38, padding: 0, fontSize: 20, lineHeight: 1 },
  barra: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, padding: '10px 16px calc(10px + var(--seguro-abajo, 0px))', background: 'var(--fondo)', borderTop: '1px solid var(--linea)', maxWidth: 640, margin: '0 auto' },
}
