import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { aplicarColores, quitarColores } from './paletas'
import { Cargando, Mensaje } from './ui'
import { fotoOk } from './imagenes'
import Icono from './iconos'
import { ordenarNombre } from './orden'

// Dirección de la carta: tu-sitio/#/carta/<codigo-del-local>/<codigo-de-la-mesa>
export function rutaCarta() {
  const m = /^#\/carta\/([^/?#]+)\/([^/?#]+)/.exec(window.location.hash || '')
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
  const [catActiva, setCatActiva] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [mesaEstado, setMesaEstado] = useState({ cuenta_abierta: false, cuenta_pedida: false, qr_bloqueado: false })
  const [finalizada, setFinalizada] = useState(() => leer('qr-fin-' + token) === '1')
  const vioCuenta = useRef(false) // ¿se vio la cuenta abierta desde este celular?
  const refs = useRef({})

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

  // Resalta en la barra la categoría que se está leyendo (la última cuyo encabezado ya pasó bajo la barra).
  useEffect(() => {
    if (!carta?.categorias?.length) return
    let pendiente = false
    const medir = () => {
      pendiente = false
      let activa = null
      for (const c of carta.categorias) {
        const el = document.getElementById(`cat-${c.id}`)
        if (el && el.getBoundingClientRect().top <= 180) activa = c.id
      }
      // Al llegar al final de la página, queda marcada la última categoría.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 6) activa = carta.categorias[carta.categorias.length - 1].id
      setCatActiva(activa ?? carta.categorias[0].id)
    }
    const alMover = () => {
      if (!pendiente) {
        pendiente = true
        requestAnimationFrame(medir)
      }
    }
    medir()
    window.addEventListener('scroll', alMover, { passive: true })
    window.addEventListener('resize', alMover)
    return () => {
      window.removeEventListener('scroll', alMover)
      window.removeEventListener('resize', alMover)
    }
  }, [carta?.categorias])

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

  function irA(id) {
    setCatActiva(id)
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
  const L = carta.landing ?? {}
  const sobre = L.sobre?.activo ? L.sobre : null
  const galeria = L.galeria?.activo && (L.galeria.fotos ?? []).some(fotoOk) ? L.galeria : null
  const bloques = (L.bloques ?? []).filter((b) => b.titulo || b.texto || fotoOk(b.foto))
  const info = L.info?.activo ? L.info : null
  const hayPortada = fotoOk(L.portada)
  const completa = hayPortada && L.portada_modo === 'completa'
  const velo = Math.min(0.7, Math.max(0, Number(L.portada_vel ?? 30) / 100))
  const rotulo = carta.llevar ? <><Icono n="bolsa" tam={15} className="it" /> Pedido para llevar</> : `Mesa ${carta.mesa?.numero}${carta.mesa?.nombre ? ` · ${carta.mesa.nombre}` : ''}`

  const digitos = (t) => String(t ?? '').replace(/\D/g, '')
  const wa = digitos(info?.whatsapp)
  const tel = digitos(info?.telefono)
  const insta = String(info?.instagram ?? '').replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '')
  const hayInfo = info && (info.horario || info.direccion || tel || wa || insta || info.wifi_red)

  const irCarta = () => document.getElementById('carta')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="cp">
      <style>{CSS}</style>

      {/* PORTADA */}
      <header className={`cp-hero${completa ? ' completa' : ''}`} style={{ '--vel': velo }}>
        {hayPortada && (
          <img
            className={`cp-hero-img${completa ? ' difuso' : ''}`}
            src={L.portada}
            alt=""
            fetchpriority="high"
            decoding="async"
            style={completa ? undefined : { objectPosition: `${Number(L.portada_x ?? 50)}% ${Number(L.portada_y ?? 50)}%` }}
          />
        )}
        <div className="cp-vel" />
        <div className="cp-hero-in">
          {hayPortada && completa && <img className="cp-marco" src={L.portada} alt="" />}
          {rest.logo ? <img className="cp-logo" src={rest.logo} alt="" /> : null}
          <h1>{rest.nombre}</h1>
          {L.eslogan ? <p className="cp-eslogan">{L.eslogan}</p> : null}
          <span className="cp-pill">{rotulo}</span>
          <div className="cp-cta">
            <button className="cp-boton cp-boton-fuerte" onClick={irCarta}>Ver la carta</button>
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

      {/* NOVEDADES */}
      {bloques.length > 0 && (
        <section className="cp-wrap cp-seccion">
          <div className="cp-novedades">
            {bloques.map((b) => (
              <article key={b.id} className="cp-novedad">
                {fotoOk(b.foto) && <img src={b.foto} alt="" loading="lazy" decoding="async" />}
                <div>
                  {b.titulo ? <h3>{b.titulo}</h3> : null}
                  {b.texto ? <p>{b.texto}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* CARTA */}
      <section id="carta" className="cp-seccion">
        <div className="cp-wrap">
          <h2 className="cp-titulo">Nuestra carta</h2>
          {bloqueado ? (
            <p className="cp-suave" role="status">Los pedidos desde el celular están pausados {carta.llevar ? 'por ahora' : 'en esta mesa'}. Pídele ayuda a la mesera.</p>
          ) : !puedePedir ? (
            <p className="cp-suave">Mira la carta con calma y pídele a la mesera lo que quieras.</p>
          ) : null}
        </div>
        {carta.categorias.length > 1 && (
          <nav className="cp-nav" aria-label="Categorías">
            <div className="cp-wrap cp-nav-in">
              {carta.categorias.map((c) => (
                <button key={c.id} className={catActiva === c.id ? 'on' : ''} onClick={() => irA(c.id)}>{c.nombre}</button>
              ))}
            </div>
          </nav>
        )}
        <div className="cp-wrap">
          {carta.categorias.length === 0 && <p className="cp-suave">Aún no hay productos en la carta.</p>}
          {carta.categorias.map((c) => (
            <div key={c.id} id={`cat-${c.id}`} ref={(el) => (refs.current[c.id] = el)} className="cp-cat">
              <div className="cp-cat-cab">
                <h3 className="cp-cat-t">{c.nombre}</h3>
                <span className="cp-cat-n">{c.productos.length} {c.productos.length === 1 ? 'opción' : 'opciones'}</span>
              </div>
              <div className="cp-cat-lista">
              {c.productos.map((p) => {
                const n = cant[p.id] ?? 0
                return (
                  <article key={p.id} className={`cp-plato${p.agotado ? ' agotado' : ''}`}>
                    <div className="cp-plato-txt">
                      {p.destacado && !p.agotado ? <span className="cp-star"><Icono n="estrella" tam={15} className="it" /> Destacado</span> : null}
                      <h4>{p.nombre}</h4>
                      {p.descripcion ? <p>{p.descripcion}</p> : null}
                      <div className="cp-plato-pie">
                        <b>{p.agotado ? 'Agotado por hoy' : $(p.precio)}</b>
                        {puedePedir && !p.agotado && (
                          n === 0 ? (
                            <button className="cp-add" onClick={() => cambiar(p.id, 1)} aria-label={`Agregar ${p.nombre}`}>Agregar</button>
                          ) : (
                            <div className="cp-paso">
                              <button onClick={() => cambiar(p.id, -1)} aria-label={`Quitar uno de ${p.nombre}`}>−</button>
                              <b>{n}</b>
                              <button onClick={() => cambiar(p.id, 1)} aria-label={`Agregar otro ${p.nombre}`}>+</button>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                    {fotoOk(p.foto) && <img className="cp-foto" src={p.foto} alt={p.nombre} loading="lazy" decoding="async" />}
                  </article>
                )
              })}
                          </div>
            </div>
          ))}
        </div>
      </section>

      {/* SOBRE NOSOTROS */}
      {sobre && (sobre.texto || fotoOk(sobre.foto)) && (
        <section className="cp-wrap cp-seccion">
          <h2 className="cp-titulo">{sobre.titulo || 'Sobre nosotros'}</h2>
          <div className="cp-sobre">
            {fotoOk(sobre.foto) && <img src={sobre.foto} alt="" loading="lazy" decoding="async" />}
            {sobre.texto ? <p>{sobre.texto}</p> : null}
          </div>
        </section>
      )}

      {/* GALERÍA */}
      {galeria && (
        <section className="cp-wrap cp-seccion">
          <h2 className="cp-titulo">{galeria.titulo || 'Galería'}</h2>
          <div className="cp-galeria">
            {galeria.fotos.filter(fotoOk).map((u) => (
              <button key={u} onClick={() => setZoom(u)} aria-label="Ver foto grande">
                <img src={u} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* CONTACTO */}
      {hayInfo && (
        <section className="cp-wrap cp-seccion">
          <h2 className="cp-titulo">Visítanos</h2>
          <div className="cp-info">
            {info.horario ? (
              <div><span><Icono n="reloj" tam={15} className="it" /> Horario</span><p style={{ whiteSpace: 'pre-line' }}>{info.horario}</p></div>
            ) : null}
            {info.direccion ? (
              <div>
                <span><Icono n="pin" tam={15} className="it" /> Dirección</span>
                <p>{info.direccion}</p>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.direccion)}`} target="_blank" rel="noreferrer">Cómo llegar</a>
              </div>
            ) : null}
            {(tel || wa || insta) && (
              <div className="cp-links">
                {tel ? <a href={`tel:+${tel}`}><Icono n="telefono" tam={15} className="it" /> Llamar</a> : null}
                {wa ? <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"><Icono n="chat" tam={15} className="it" /> WhatsApp</a> : null}
                {insta ? <a href={`https://instagram.com/${insta}`} target="_blank" rel="noreferrer"><Icono n="camara" tam={15} className="it" /> @{insta}</a> : null}
              </div>
            )}
            {info.wifi_red ? (
              <div><span><Icono n="wifi" tam={15} className="it" /> Wi‑Fi</span><p>{info.wifi_red}{info.wifi_clave ? ` · clave: ${info.wifi_clave}` : ''}</p></div>
            ) : null}
          </div>
        </section>
      )}

      <footer className="cp-pie">{rest.nombre}</footer>

      {puedePedir && unidades > 0 && (
        <div className="cp-barra">
          <button onClick={() => setVerPedido(true)}>
            <span>Ver mi pedido ({unidades})</span>
            <b>{$(total)}</b>
          </button>
        </div>
      )}

      {zoom && createPortal(
        <div className="cp-zoom" onClick={() => setZoom(null)} role="dialog" aria-modal="true" aria-label="Foto">
          <img src={zoom} alt="" />
          <button aria-label="Cerrar" onClick={() => setZoom(null)}><Icono n="cerrar" tam={15} className="it" /></button>
        </div>,
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
.cp-hero{position:relative;overflow:hidden;min-height:min(80svh,600px);display:grid;align-items:end;background:linear-gradient(160deg,color-mix(in srgb,var(--marca) 60%,var(--fondo)),var(--fondo) 85%);color:#fff}
.cp-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cp-hero-img.difuso{filter:blur(34px) brightness(.55) saturate(1.1);transform:scale(1.2)}
.cp-vel{position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,var(--fondo) 100%),linear-gradient(rgba(0,0,0,var(--vel,.3)),rgba(0,0,0,var(--vel,.3)))}
.cp-hero.completa{min-height:0;align-items:start}
.cp-hero.completa .cp-hero-in{padding-top:26px}
.cp-marco{width:auto;max-width:min(100%,600px);max-height:46svh;object-fit:contain;border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.5)}
.cp-hero-in{position:relative;max-width:720px;width:100%;margin:0 auto;padding:56px 18px 30px;display:grid;gap:12px;justify-items:center;text-align:center}
.cp-logo{max-height:84px;max-width:200px;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,.4))}
.cp-hero h1{margin:0;font-family:'Fraunces',Georgia,'Times New Roman',serif;font-size:clamp(34px,9vw,52px);line-height:1.05;text-shadow:0 2px 14px rgba(0,0,0,.55);overflow-wrap:anywhere}
.cp-eslogan{margin:0;font-size:17px;max-width:30ch;text-shadow:0 1px 10px rgba(0,0,0,.6)}
.cp-pill{display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(0,0,0,.45);backdrop-filter:blur(6px);font-weight:800;font-size:13px;letter-spacing:.4px}
.cp-cta{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:6px}
.cp-boton{all:unset;box-sizing:border-box;cursor:pointer;padding:11px 18px;border-radius:999px;background:rgba(255,255,255,.16);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.35);font-weight:800;font-size:15px;color:#fff}
.cp-boton:disabled{opacity:.55;cursor:default}
.cp-boton-fuerte{background:var(--marca);border-color:var(--marca);color:var(--sobre-marca)}
.cp-aviso{padding:8px 14px;border-radius:12px;background:rgba(0,0,0,.55);font-size:14px}
.cp-novedades{display:grid;gap:12px}
.cp-novedad{display:grid;border-radius:18px;overflow:hidden;background:var(--sup);border:1px solid var(--linea)}
.cp-novedad img{width:100%;height:170px;object-fit:cover;display:block}
.cp-novedad div{padding:14px 16px}
.cp-novedad h3{margin:0 0 4px;font-size:18px}
.cp-novedad p{margin:0;color:var(--suave);line-height:1.45;white-space:pre-line}
.cp-nav{position:sticky;top:0;z-index:20;box-shadow:0 6px 14px -12px rgba(0,0,0,.6);background:color-mix(in srgb,var(--fondo) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--linea);margin:6px 0 4px}
.cp-nav-in{display:flex;gap:8px;overflow-x:auto;padding-top:10px;padding-bottom:10px;scrollbar-width:none}
.cp-nav-in::-webkit-scrollbar{display:none}
.cp-nav button{all:unset;cursor:pointer;white-space:nowrap;padding:8px 16px;border-radius:999px;border:1px solid var(--linea);background:var(--sup);font-weight:700;font-size:14px}
.cp-nav button.on{background:var(--marca);border-color:var(--marca);color:var(--sobre-marca)}
.cp-cat{scroll-margin-top:68px;margin-top:34px;border-radius:20px;overflow:hidden;background:var(--sup);border:1px solid var(--linea)}
.cp-cat-cab{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:16px 18px 14px;background:color-mix(in srgb,var(--marca) 16%,var(--sup));border-bottom:3px solid var(--marca)}
.cp-cat-t{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-size:27px;line-height:1.1;margin:0;letter-spacing:.2px}
.cp-cat-n{font-size:13px;font-weight:700;color:var(--suave);white-space:nowrap}
.cp-cat-lista{padding:0 18px}
.cp-cat-lista .cp-plato:last-child{border-bottom:0}
.cp-plato{display:flex;gap:14px;justify-content:space-between;align-items:stretch;padding:16px 0;border-bottom:1px solid var(--linea)}
.cp-plato.agotado{opacity:.55}
.cp-plato-txt{min-width:0;flex:1;display:flex;flex-direction:column;gap:4px}
.cp-plato h4{margin:0;font-size:17px;line-height:1.25;overflow-wrap:anywhere}
.cp-plato p{margin:0;color:var(--suave);font-size:14px;line-height:1.4}
.cp-star{align-self:flex-start;font-size:11px;font-weight:800;letter-spacing:.3px;padding:2px 9px;border-radius:999px;background:var(--durazno);color:var(--aviso-tinta)}
.cp-plato-pie{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:6px}
.cp-plato-pie>b{font-size:16px;white-space:nowrap}
.cp-foto{width:104px;height:104px;object-fit:cover;border-radius:14px;flex:none;align-self:flex-start}
.cp-add{all:unset;cursor:pointer;padding:8px 16px;border-radius:999px;background:var(--marca);color:var(--sobre-marca);font-weight:800;font-size:14px}
.cp-paso{display:flex;align-items:center;gap:8px}
.cp-paso button{all:unset;cursor:pointer;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--sup);border:1px solid var(--linea);font-size:20px;line-height:1}
.cp-paso b{min-width:20px;text-align:center}
.cp-sobre{display:grid;gap:14px}
.cp-sobre img{width:100%;max-height:320px;object-fit:cover;border-radius:20px;display:block}
.cp-sobre p{margin:0;line-height:1.6;white-space:pre-line;color:var(--tinta)}
.cp-galeria{display:grid;gap:8px;grid-template-columns:repeat(2,1fr)}
@media(min-width:560px){.cp-galeria{grid-template-columns:repeat(3,1fr)}}
.cp-galeria button{all:unset;cursor:pointer;display:block;border-radius:14px;overflow:hidden;aspect-ratio:1}
.cp-galeria img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s}
.cp-galeria button:hover img{transform:scale(1.04)}
.cp-info{display:grid;gap:12px}
.cp-info>div{padding:14px 16px;border-radius:16px;background:var(--sup);border:1px solid var(--linea)}
.cp-info span{font-weight:800;font-size:14px;color:var(--suave)}
.cp-info p{margin:4px 0 0;line-height:1.45}
.cp-info a{color:var(--marca);font-weight:800;text-decoration:none}
.cp-links{display:flex;gap:8px;flex-wrap:wrap}
.cp-links a{padding:9px 16px;border-radius:999px;background:var(--sup);border:1px solid var(--linea);color:var(--tinta)}
.cp-pie{text-align:center;color:var(--suave);font-size:13px;padding:36px 18px 8px}
.cp-barra{position:fixed;left:0;right:0;bottom:0;z-index:30;max-width:720px;margin:0 auto;padding:10px 16px calc(10px + var(--seguro-abajo,0px));background:var(--fondo);border-top:1px solid var(--linea)}
.cp-barra button{all:unset;box-sizing:border-box;width:100%;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-radius:16px;background:var(--marca);color:var(--sobre-marca);font-weight:800}
.cp-zoom{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.92);display:grid;place-items:center;padding:16px}
.cp-zoom img{max-width:100%;max-height:92dvh;border-radius:12px;object-fit:contain}
.cp-zoom button{all:unset;cursor:pointer;position:absolute;top:calc(14px + env(safe-area-inset-top,0px));right:16px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;color:#fff;font-size:18px}
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
