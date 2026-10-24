import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { audioCtx, sentir, sonar } from './feedback'
import { Cargando, Desplegable, Mensaje } from './ui'

const TIPOS_ANULACION = ['anulacion', 'anulacion_total']

// Pantalla de la tablet de cocina: tickets en tiempo real, con sonido y alertas por tiempo.
export default function Cocina({ restaurante }) {
  const [tickets, setTickets] = useState(null)
  const [ajustes, setAjustes] = useState({ alerta_amarilla_min: 5, alerta_roja_min: 10, sonido_activo: true })
  const [listos, setListos] = useState(0)
  const [error, setError] = useState('')
  const [sonidoListo, setSonidoListo] = useState(false)
  const [ahora, setAhora] = useState(Date.now())
  const [saliendo, setSaliendo] = useState(() => new Map()) // id -> 'listo' | 'visto' mientras se despide
  const [recientes, setRecientes] = useState(() => new Set()) // tickets recién llegados (anillo de aviso)
  const vistos = useRef(null) // tickets ya conocidos; null en la primera carga para no sonar
  const ajustesRef = useRef(ajustes)
  const temporizador = useRef(null)

  useEffect(() => {
    ajustesRef.current = ajustes
  }, [ajustes])

  // Timbre de dos notas para pedidos nuevos; aviso grave de tres tonos para anulaciones.
  // Es más fuerte que los sonidos de la interfaz: tiene que oírse en una cocina con ruido.
  function timbre(tipo) {
    const ctx = audioCtx()
    if (!ctx) return
    try {
      const notas = tipo === 'anulacion' ? [[330, 0], [262, 0.24], [330, 0.48]] : [[784, 0], [988, 0.18]]
      notas.forEach(([frecuencia, retraso]) => {
        const osc = ctx.createOscillator()
        const ganancia = ctx.createGain()
        osc.type = tipo === 'anulacion' ? 'square' : 'sine'
        osc.frequency.value = frecuencia
        const inicio = ctx.currentTime + retraso
        ganancia.gain.setValueAtTime(0.0001, inicio)
        ganancia.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02)
        ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.3)
        osc.connect(ganancia)
        ganancia.connect(ctx.destination)
        osc.start(inicio)
        osc.stop(inicio + 0.32)
      })
    } catch {
      // sin audio disponible: la pantalla sigue funcionando
    }
  }

  function activarSonido() {
    // En iPhone/iPad (Safari 17+) esto hace que el aviso suene aunque el equipo esté en silencio.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback'
    } catch {
      // no soportado
    }
    sentir('exito')
    timbre('nuevo')
    setSonidoListo(true)
  }

  const cargar = useCallback(async () => {
    const rid = restaurante.id
    const inicioDia = new Date()
    inicioDia.setHours(0, 0, 0, 0)
    const [t, a, l] = await Promise.all([
      supabase
        .from('envios_cocina')
        .select(
          'id, tipo, modalidad, creado_en, pedidos(numero, mesa_numero, mesas(numero)), items_pedido(nombre, cantidad), anulaciones(nombre, cantidad)'
        )
        .eq('restaurante_id', rid)
        .eq('estado', 'pendiente')
        .order('creado_en'),
      supabase.from('ajustes').select('*').eq('restaurante_id', rid).maybeSingle(),
      supabase
        .from('envios_cocina')
        .select('id', { count: 'exact', head: true })
        .eq('restaurante_id', rid)
        .eq('estado', 'listo')
        .gte('resuelto_en', inicioDia.toISOString()),
    ])
    if (t.error) {
      setError(t.error.message)
      return
    }
    setError('')
    if (a.data) setAjustes(a.data)
    setListos(l.count ?? 0)

    // Un ticket de pedido sin platos (todo se anuló) no tiene nada que mostrar.
    const visibles = t.data.filter((x) => TIPOS_ANULACION.includes(x.tipo) || x.items_pedido.length > 0)

    if (vistos.current) {
      const nuevos = visibles.filter((x) => !vistos.current.has(x.id))
      if (nuevos.length) {
        if (ajustesRef.current.sonido_activo) {
          timbre(nuevos.some((x) => TIPOS_ANULACION.includes(x.tipo)) ? 'anulacion' : 'nuevo')
        }
        const ids = nuevos.map((x) => x.id)
        setRecientes((r) => new Set([...r, ...ids]))
        setTimeout(
          () =>
            setRecientes((r) => {
              const n = new Set(r)
              ids.forEach((id) => n.delete(id))
              return n
            }),
          6000
        )
      }
    }
    vistos.current = new Set(visibles.map((x) => x.id))
    setTickets(visibles)
  }, [restaurante.id])

  useEffect(() => {
    cargar()
    const programar = () => {
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(cargar, 250)
    }
    const filtro = `restaurante_id=eq.${restaurante.id}`
    const canal = supabase.channel(`cocina-${restaurante.id}`)
    ;['envios_cocina', 'items_pedido', 'anulaciones'].forEach((tabla) =>
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla, filter: filtro }, programar)
    )
    canal.subscribe()
    // Respaldo por si el tiempo real se corta: recarga cada minuto.
    const respaldo = setInterval(cargar, 60000)
    const reloj = setInterval(() => setAhora(Date.now()), 20000)
    return () => {
      clearTimeout(temporizador.current)
      clearInterval(respaldo)
      clearInterval(reloj)
      supabase.removeChannel(canal)
    }
  }, [cargar, restaurante.id])

  async function resolver(ticket, estado) {
    sentir('toque', estado === 'listo' ? 'exito' : 'tic')
    // Se pinta de menta con un ✓, se encoge suave y recién al terminar se quita de la lista.
    setSaliendo((s) => new Map(s).set(ticket.id, estado))
    if (estado === 'listo') setListos((n) => n + 1)
    setTimeout(() => {
      setTickets((prev) => prev.filter((x) => x.id !== ticket.id))
      setSaliendo((s) => {
        const n = new Map(s)
        n.delete(ticket.id)
        return n
      })
    }, 420)
    const { error } = await supabase
      .from('envios_cocina')
      .update({ estado, resuelto_en: new Date().toISOString() })
      .eq('id', ticket.id)
    if (error) setError(error.message)
    cargar()
  }

  function juntar(lista) {
    const g = new Map()
    lista.forEach((i) => g.set(i.nombre, (g.get(i.nombre) ?? 0) + i.cantidad))
    return [...g.entries()]
  }

  if (!tickets) {
    return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={140} />
  }

  return (
    <div>
      <div style={s.cabecera}>
        <div>
          <h2 style={{ margin: 0 }}>Cocina</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <span style={{ ...s.pastilla, background: 'var(--durazno)', color: '#8a4b00' }}>
              <b key={tickets.length} className="contador-pop">
                {tickets.length}
              </b>{' '}
              pendiente{tickets.length === 1 ? '' : 's'}
            </span>
            <span style={{ ...s.pastilla, background: 'var(--menta)', color: 'var(--menta-tinta)' }}>
              <b key={listos} className="contador-pop">
                {listos}
              </b>{' '}
              listo{listos === 1 ? '' : 's'} hoy
            </span>
          </div>
        </div>
        <Desplegable abierto={ajustes.sonido_activo && !sonidoListo}>
          <button className="btn btn-principal respira" onClick={activarSonido}>
            🔔 Activar sonido
          </button>
        </Desplegable>
      </div>

      <Mensaje tipo="error">{error}</Mensaje>
      {tickets.length === 0 && (
        <div className="vacio aparece">
          <span className="vacio-icono">✨</span>
          <b>Todo al día</b>
          <span>No hay pedidos pendientes. Los nuevos aparecen aquí solos.</span>
        </div>
      )}

      <div style={s.grid}>
        {tickets.map((t) => {
          const min = Math.max(0, Math.floor((ahora - new Date(t.creado_en).getTime()) / 60000))
          const numero = `#${t.pedidos?.numero ?? '?'}`
          const mesa = `Mesa ${t.pedidos?.mesas?.numero ?? t.pedidos?.mesa_numero ?? '?'}`
          const llevar = t.modalidad === 'llevar'
          const esAnulacion = TIPOS_ANULACION.includes(t.tipo)
          const salida = saliendo.get(t.id)
          const estiloSalida = salida ? (salida === 'listo' ? s.ticketListo : s.ticketVisto) : null
          const clase = `entra${recientes.has(t.id) ? ' ticket-nuevo' : ''}`

          if (esAnulacion) {
            return (
              <div
                key={t.id}
                className={clase}
                style={{ ...s.ticket, borderColor: '#f0a9a3', background: '#fff6f5', ...estiloSalida }}
              >
                <div style={s.titulo}>
                  <b>
                    {mesa} · {numero}
                  </b>
                  <span style={{ color: '#B3261E' }}>{min} min</span>
                </div>
                <p style={{ margin: 0, fontWeight: 900, color: '#B3261E', fontSize: 18 }}>
                  {t.tipo === 'anulacion_total' ? 'ORDEN COMPLETA ANULADA' : 'ANULADO'}
                </p>
                {juntar(t.anulaciones).map(([nombre, cantidad]) => (
                  <p key={nombre} style={{ ...s.linea, textDecoration: 'line-through', textDecorationColor: '#e7a7a2' }}>
                    <b>{cantidad}×</b> {nombre}
                  </p>
                ))}
                <button className="btn btn-sec btn-grande" style={s.boton} disabled={!!salida} onClick={() => resolver(t, 'visto')}>
                  Enterado
                </button>
              </div>
            )
          }

          const nivel = min >= ajustes.alerta_roja_min ? 'rojo' : min >= ajustes.alerta_amarilla_min ? 'amarillo' : 'ok'
          const borde = nivel === 'rojo' ? '#e98a83' : nivel === 'amarillo' ? '#f6c95b' : 'var(--linea)'
          return (
            <div
              key={t.id}
              className={`${clase}${nivel === 'rojo' && !salida ? ' ticket-urgente' : ''}`}
              style={{ ...s.ticket, borderColor: borde, ...estiloSalida }}
            >
              {salida === 'listo' && (
                <span className="infla" style={s.check} aria-hidden="true">
                  ✓
                </span>
              )}
              <div style={s.titulo}>
                <b>
                  {mesa} ·{' '}
                  <span style={llevar ? s.badgeLlevar : s.badgeServir}>{llevar ? 'Para llevar' : 'Servir'}</span>
                </b>
                <span
                  style={{
                    ...s.minutos,
                    background: nivel === 'rojo' ? 'var(--rosa)' : nivel === 'amarillo' ? 'var(--durazno)' : 'var(--lavanda)',
                    color: nivel === 'rojo' ? '#B3261E' : nivel === 'amarillo' ? '#8a4b00' : 'var(--suave)',
                  }}
                >
                  {min} min
                </span>
              </div>
              <small className="suave" style={{ fontSize: 15 }}>
                Pedido {numero}
                {t.tipo === 'adicion' ? ' · adición' : ''}
              </small>
              {juntar(t.items_pedido).map(([nombre, cantidad]) => (
                <p key={nombre} style={s.linea}>
                  <b>{cantidad}×</b> {nombre}
                </p>
              ))}
              <button className="btn btn-principal btn-grande" style={s.boton} disabled={!!salida} onClick={() => resolver(t, 'listo')}>
                Listo
              </button>
            </div>
          )
        })}
      </div>

      <p className="nota" style={{ marginTop: 16 }}>
        Los pedidos llegan solos. Borde amarillo: más de {ajustes.alerta_amarilla_min} min. Rojo: más de{' '}
        {ajustes.alerta_roja_min} min.
      </p>
    </div>
  )
}

const s = {
  cabecera: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14 },
  pastilla: { padding: '4px 12px', borderRadius: 99, fontSize: 14, fontWeight: 700 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 14 },
  ticket: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: 'white',
    border: '3px solid',
    borderRadius: 18,
    padding: 14,
    boxShadow: 'var(--sombra)',
    transition:
      'opacity 380ms var(--ease), transform 380ms var(--ease), background-color 200ms var(--ease), border-color 600ms var(--ease)',
  },
  ticketListo: { opacity: 0, transform: 'scale(0.9) translateY(-6px)', background: '#effaf3', borderColor: '#8fd3ad', pointerEvents: 'none' },
  ticketVisto: { opacity: 0, transform: 'scale(0.94)', pointerEvents: 'none' },
  check: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    fontSize: 64,
    fontWeight: 900,
    color: '#2E7D4F',
    zIndex: 1,
  },
  titulo: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 20, paddingBottom: 8, borderBottom: '1px solid var(--linea)' },
  minutos: { flex: 'none', padding: '2px 10px', borderRadius: 99, fontSize: 15, fontWeight: 800, transition: 'background-color 600ms var(--ease), color 600ms var(--ease)' },
  badgeServir: { color: '#4B1E4D' },
  badgeLlevar: { color: 'white', background: '#4B1E4D', padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap', fontSize: 16 },
  linea: { margin: 0, fontSize: 19 },
  boton: { marginTop: 'auto' },
}
