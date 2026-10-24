import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const TIPOS_ANULACION = ['anulacion', 'anulacion_total']

// Pantalla de la tablet de cocina: tickets en tiempo real, con sonido y alertas por tiempo.
export default function Cocina({ restaurante }) {
  const [tickets, setTickets] = useState(null)
  const [ajustes, setAjustes] = useState({ alerta_amarilla_min: 5, alerta_roja_min: 10, sonido_activo: true })
  const [listos, setListos] = useState(0)
  const [error, setError] = useState('')
  const [sonidoListo, setSonidoListo] = useState(false)
  const [ahora, setAhora] = useState(Date.now())
  const [saliendo, setSaliendo] = useState(() => new Set()) // ids que se están desvaneciendo antes de quitarse
  const vistos = useRef(null) // tickets ya conocidos; null en la primera carga para no sonar
  const audio = useRef(null)
  const ajustesRef = useRef(ajustes)
  const temporizador = useRef(null)

  useEffect(() => {
    ajustesRef.current = ajustes
  }, [ajustes])

  // Timbre de dos notas para pedidos nuevos; aviso grave de tres tonos para anulaciones.
  function sonar(tipo) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      audio.current = audio.current || new Ctx()
      const ctx = audio.current
      if (ctx.state === 'suspended') ctx.resume()
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
    } catch (_e) {
      // sin audio disponible: la pantalla sigue funcionando
    }
  }

  function activarSonido() {
    sonar('nuevo')
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
      if (nuevos.length && ajustesRef.current.sonido_activo) {
        sonar(nuevos.some((x) => TIPOS_ANULACION.includes(x.tipo)) ? 'anulacion' : 'nuevo')
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
    // Se desvanece suave y recién al terminar la animación se quita de la lista.
    setSaliendo((s) => new Set(s).add(ticket.id))
    setTimeout(() => {
      setTickets((prev) => prev.filter((x) => x.id !== ticket.id))
      setSaliendo((s) => {
        const n = new Set(s)
        n.delete(ticket.id)
        return n
      })
    }, 200)
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

  if (!tickets) return <p>{error ? `Error: ${error}` : 'Cargando...'}</p>

  return (
    <div>
      <div style={s.cabecera}>
        <div>
          <h2 style={{ margin: 0 }}>Cocina</h2>
          <small style={{ color: '#6f6477' }}>
            {tickets.length} pendientes · {listos} listos hoy
          </small>
        </div>
        {ajustes.sonido_activo && !sonidoListo && (
          <button style={s.activar} onClick={activarSonido}>
            🔔 Activar sonido
          </button>
        )}
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {tickets.length === 0 && <p style={{ color: '#6f6477' }}>No hay pedidos pendientes.</p>}

      <div style={s.grid}>
        {tickets.map((t) => {
          const min = Math.max(0, Math.floor((ahora - new Date(t.creado_en).getTime()) / 60000))
          const numero = `#${t.pedidos?.numero ?? '?'}`
          const mesa = `Mesa ${t.pedidos?.mesas?.numero ?? t.pedidos?.mesa_numero ?? '?'}`
          const llevar = t.modalidad === 'llevar'
          const esAnulacion = TIPOS_ANULACION.includes(t.tipo)

          const estiloSalida = saliendo.has(t.id) ? s.ticketSaliendo : null

          if (esAnulacion) {
            return (
              <div
                key={t.id}
                className="aparece"
                style={{ ...s.ticket, borderColor: '#B3261E', background: '#fdf0ef', ...estiloSalida }}
              >
                <div style={s.titulo}>
                  <b>
                    {mesa} · {numero}
                  </b>
                  <span style={{ color: '#B3261E' }}>{min} min</span>
                </div>
                <p style={{ margin: 0, fontWeight: 800, color: '#B3261E', fontSize: 18 }}>
                  {t.tipo === 'anulacion_total' ? 'ORDEN COMPLETA ANULADA' : 'ANULADO'}
                </p>
                {juntar(t.anulaciones).map(([nombre, cantidad]) => (
                  <p key={nombre} style={s.linea}>
                    <b>{cantidad}×</b> {nombre}
                  </p>
                ))}
                <button style={s.enterado} onClick={() => resolver(t, 'visto')}>
                  Enterado
                </button>
              </div>
            )
          }

          const borde =
            min >= ajustes.alerta_roja_min ? '#B3261E' : min >= ajustes.alerta_amarilla_min ? '#F2A900' : '#e2dce8'
          return (
            <div key={t.id} className="aparece" style={{ ...s.ticket, borderColor: borde, ...estiloSalida }}>
              <div style={s.titulo}>
                <b>
                  {mesa} ·{' '}
                  <span style={llevar ? s.badgeLlevar : s.badgeServir}>{llevar ? 'Para llevar' : 'Servir'}</span>
                </b>
                <span style={{ color: min >= ajustes.alerta_roja_min ? '#B3261E' : '#6f6477' }}>{min} min</span>
              </div>
              <small style={{ color: '#6f6477', fontSize: 15 }}>
                Pedido {numero}
                {t.tipo === 'adicion' ? ' · adición' : ''}
              </small>
              {juntar(t.items_pedido).map(([nombre, cantidad]) => (
                <p key={nombre} style={s.linea}>
                  <b>{cantidad}×</b> {nombre}
                </p>
              ))}
              <button style={s.listo} onClick={() => resolver(t, 'listo')}>
                Listo
              </button>
            </div>
          )
        })}
      </div>

      <p style={s.nota}>
        Los pedidos llegan solos. Borde amarillo: más de {ajustes.alerta_amarilla_min} min. Rojo: más de{' '}
        {ajustes.alerta_roja_min} min.
      </p>
    </div>
  )
}

const s = {
  cabecera: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 },
  activar: { padding: '12px 16px', borderRadius: 12, border: 'none', background: '#F2A900', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 },
  ticket: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: 'white',
    border: '3px solid',
    borderRadius: 14,
    padding: 14,
    transition: 'opacity 200ms var(--ease), transform 200ms var(--ease)',
  },
  ticketSaliendo: { opacity: 0, transform: 'scale(0.92)', pointerEvents: 'none' },
  titulo: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 20, paddingBottom: 8, borderBottom: '1px solid #e2dce8' },
  badgeServir: { color: '#4B1E4D' },
  badgeLlevar: { color: 'white', background: '#4B1E4D', padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap' },
  linea: { margin: 0, fontSize: 19 },
  listo: { marginTop: 'auto', padding: 14, borderRadius: 12, border: 'none', background: '#F2A900', fontSize: 17, fontWeight: 800, cursor: 'pointer' },
  enterado: { marginTop: 'auto', padding: 14, borderRadius: 12, border: 'none', background: '#efe9f3', fontSize: 17, fontWeight: 800, cursor: 'pointer' },
  nota: { background: '#efe9f3', borderRadius: 10, padding: 10, fontSize: 13, color: '#5b4d63', marginTop: 16 },
}
