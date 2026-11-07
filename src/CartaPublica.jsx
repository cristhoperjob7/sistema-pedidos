import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { aplicarColores, quitarColores } from './paletas'
import { Cargando, Mensaje } from './ui'
import Icono from './iconos'

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
  const refs = useRef({})

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('carta_publica', { p_slug: slug, p_token: token })
    if (error) {
      setError(error.message)
      return
    }
    setError('')
    setCarta(data)
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

  // Mientras la mesera no confirma, se consulta cada pocos segundos.
  useEffect(() => {
    if (!pedidoId) return
    let vivo = true
    const consultar = async () => {
      const { data } = await supabase.rpc('estado_pedido_qr', { p_id: pedidoId })
      if (vivo && data) setEstado(data)
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

  // ---- Pedido enviado: pantalla de espera / confirmación
  if (pedidoId && estado) {
    const e = estado.estado
    const pendiente = e === 'pendiente'
    const ok = e === 'aprobado'
    return (
      <div style={s.centro}>
        <div className="tarjeta aparece" style={{ padding: 22, display: 'grid', gap: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>{pendiente ? '⏳' : ok ? '✅' : e === 'rechazado' ? '🙁' : '⌛'}</div>
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

  const puedePedir = carta.puede_pedir
  const rotulo = carta.llevar ? '🥡 Para llevar' : `Mesa ${carta.mesa?.numero}${carta.mesa?.nombre ? ` · ${carta.mesa.nombre}` : ''}`

  return (
    <div style={{ paddingBottom: 'calc(110px + var(--seguro-abajo, 0px))', maxWidth: 640, margin: '0 auto' }}>
      <header style={s.cab}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.15, overflowWrap: 'anywhere' }}>{rest.nombre}</h1>
          <small className="suave">{rotulo}</small>
        </div>
      </header>

      {!carta.llevar && (
        <div style={s.llamar}>
          <button className="btn btn-sec btn-chico" disabled={enfriando} onClick={() => llamar('mesera')}>
            🔔 Llamar a la mesera
          </button>
          <button className="btn btn-sec btn-chico" disabled={enfriando} onClick={() => llamar('cuenta')}>
            🧾 Pedir la cuenta
          </button>
        </div>
      )}
      {aviso && (
        <div style={{ padding: '0 16px 8px' }}>
          <Mensaje tipo="ok">{aviso}</Mensaje>
        </div>
      )}

      {carta.categorias.length > 1 && (
        <nav style={s.chips} aria-label="Categorías">
          {carta.categorias.map((c) => (
            <button key={c.id} onClick={() => irA(c.id)} style={{ ...s.chip, ...(catActiva === c.id ? s.chipOn : null) }}>
              {c.nombre}
            </button>
          ))}
        </nav>
      )}

      {!puedePedir && (
        <p className="suave" style={{ margin: '4px 16px 8px', fontSize: 14 }}>
          Mira la carta con calma y pídele a la mesera lo que quieras.
        </p>
      )}

      {carta.categorias.length === 0 && <p className="suave" style={{ padding: 16 }}>Aún no hay productos en la carta.</p>}

      {carta.categorias.map((c) => (
        <section key={c.id} ref={(el) => (refs.current[c.id] = el)} style={{ scrollMarginTop: 70, padding: '8px 16px' }}>
          <h2 style={{ margin: '10px 0 4px', fontSize: 18 }}>{c.nombre}</h2>
          {c.productos.map((p) => {
            const n = cant[p.id] ?? 0
            return (
              <div key={p.id} style={{ ...s.fila, opacity: p.agotado ? 0.55 : 1 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{p.nombre}</div>
                  <small className="suave">{p.agotado ? 'Agotado por hoy' : $(p.precio)}</small>
                </div>
                {puedePedir && !p.agotado && (
                  n === 0 ? (
                    <button className="btn btn-chico btn-principal" onClick={() => cambiar(p.id, 1)} aria-label={`Agregar ${p.nombre}`}>
                      Agregar
                    </button>
                  ) : (
                    <div style={s.paso}>
                      <button className="btn btn-chico btn-sec" style={s.mas} onClick={() => cambiar(p.id, -1)} aria-label={`Quitar uno de ${p.nombre}`}>−</button>
                      <b style={{ minWidth: 22, textAlign: 'center' }}>{n}</b>
                      <button className="btn btn-chico btn-sec" style={s.mas} onClick={() => cambiar(p.id, 1)} aria-label={`Agregar otro ${p.nombre}`}>+</button>
                    </div>
                  )
                )}
              </div>
            )
          })}
        </section>
      ))}

      {puedePedir && unidades > 0 && (
        <div style={s.barra}>
          <button className="btn btn-principal" style={{ width: '100%', justifyContent: 'space-between', display: 'flex' }} onClick={() => setVerPedido(true)}>
            <span>Ver mi pedido ({unidades})</span>
            <b>{$(total)}</b>
          </button>
        </div>
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
