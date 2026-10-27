import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { avisar, sentir, sonar, vibrar } from './feedback'
import { Desplegable, Interruptor, Mensaje } from './ui'
import { estaAgotado, marcarPropio, useHoy } from './agotado'

// Botón "Agotados" + panel para marcar qué se acabó hoy. Lo usan el Salón y la Cocina.
// No edita el menú: solo apaga un plato por hoy (mañana vuelve solo).
// soloPlatos: la cocina solo controla los platos; bebidas y postres los marca el salón.
export default function Agotados({ restaurante, soloPlatos = false }) {
  const hoy = useHoy(restaurante.zona_horaria)
  const [abierto, setAbierto] = useState(false)
  const [prods, setProds] = useState(null)
  const [cats, setCats] = useState([])
  const [buscar, setBuscar] = useState('')
  const [error, setError] = useState('')
  const [ocupados, setOcupados] = useState(() => new Set())
  const temporizador = useRef(null)

  const cargar = useCallback(async () => {
    const rid = restaurante.id
    const [c, p] = await Promise.all([
      supabase.from('categorias').select('id, nombre, orden, tipo').eq('restaurante_id', rid).eq('activo', true).order('orden'),
      supabase
        .from('productos')
        .select('id, nombre, categoria_id, agotado_dia')
        .eq('restaurante_id', rid)
        .eq('activo', true)
        .order('nombre'),
    ])
    const fallo = c.error || p.error
    if (fallo) {
      setError(fallo.message)
      return
    }
    setError('')
    setCats(soloPlatos ? c.data.filter((x) => (x.tipo ?? 'plato') === 'plato') : c.data)
    setProds(p.data)
  }, [restaurante.id, soloPlatos])

  useEffect(() => {
    cargar()
    const programar = () => {
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(cargar, 250)
    }
    // Nombre único: la misma pantalla puede estar montada dos veces (Salón y Cocina del administrador).
    const canal = supabase
      .channel(`agotados-${restaurante.id}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'productos', filter: `restaurante_id=eq.${restaurante.id}` },
        programar
      )
      .subscribe()
    return () => {
      clearTimeout(temporizador.current)
      supabase.removeChannel(canal)
    }
  }, [cargar, restaurante.id])

  const catsPorId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats])
  // Solo productos de categorías activas (los demás no aparecen en el salón de todas formas).
  const lista = useMemo(() => (prods ?? []).filter((p) => catsPorId.has(p.categoria_id)), [prods, catsPorId])
  const agotados = lista.filter((p) => estaAgotado(p, hoy))

  const filtro = buscar.trim().toLowerCase()
  const visibles = filtro ? lista.filter((p) => p.nombre.toLowerCase().includes(filtro)) : lista
  const visiblesAgotados = visibles.filter((p) => estaAgotado(p, hoy))
  const secciones = cats
    .map((c) => ({ cat: c, items: visibles.filter((p) => p.categoria_id === c.id && !estaAgotado(p, hoy)) }))
    .filter((x) => x.items.length > 0)

  async function cambiar(p, valor) {
    setError('')
    marcarPropio(p.id)
    setOcupados((o) => new Set(o).add(p.id))
    // Se refleja al instante; si algo falla, se vuelve a cargar la verdad.
    setProds((ps) => ps.map((x) => (x.id === p.id ? { ...x, agotado_dia: valor ? hoy : null } : x)))
    const { error } = await supabase.rpc('marcar_agotado', { p_producto: p.id, p_agotado: valor })
    setOcupados((o) => {
      const n = new Set(o)
      n.delete(p.id)
      return n
    })
    if (error) {
      setError(error.message)
      sonar('error')
      cargar()
      return
    }
    if (valor) {
      vibrar('aviso')
      sonar('baja')
      avisar(`${p.nombre} · agotado por hoy`, 'agotado')
    } else {
      sonar('pop')
      avisar(`${p.nombre} · disponible de nuevo`, 'ok')
    }
  }

  const fila = (p) => {
    const agot = estaAgotado(p, hoy)
    return (
      <div key={p.id} className="entra" style={{ ...s.fila, ...(agot ? s.filaAgotada : null) }}>
        <Interruptor alerta checked={agot} disabled={ocupados.has(p.id)} onChange={(v) => cambiar(p, v)}>
          <span style={{ fontWeight: agot ? 800 : 600, color: agot ? '#B3261E' : 'inherit' }}>{p.nombre}</span>
        </Interruptor>
      </div>
    )
  }

  return (
    <div style={s.contenedor}>
      <button
        className="btn btn-chico btn-suave"
        aria-expanded={abierto}
        onClick={() => {
          sentir('toque', 'tic')
          if (!abierto) cargar()
          setAbierto((a) => !a)
        }}
      >
        🚫 Agotados
        {agotados.length > 0 && (
          <span style={s.contador}>
            <b key={agotados.length} className="contador-pop">
              {agotados.length}
            </b>
          </span>
        )}
        <span aria-hidden="true" style={{ ...s.flecha, transform: abierto ? 'rotate(180deg)' : 'none' }}>
          ▾
        </span>
      </button>

      <Desplegable abierto={abierto}>
        <div className="tarjeta" style={s.panel}>
          <b>¿Se acabó algo hoy?</b>
          <small className="suave">
            Enciende el plato y desaparece del menú del salón. Mañana vuelve solo.
            {soloPlatos ? ' Las bebidas y los postres los marca el salón.' : ''}
          </small>

          <Mensaje tipo="error">{error}</Mensaje>

          {!prods && <small className="suave">Cargando…</small>}
          {prods && lista.length === 0 && <small className="suave">Todavía no hay platos en el menú.</small>}

          {lista.length > 8 && (
            <input
              className="campo-chico"
              type="search"
              placeholder="Buscar plato…"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
          )}

          <div style={s.lista}>
            {visiblesAgotados.length > 0 && (
              <>
                <small style={{ ...s.seccion, color: '#B3261E' }}>Agotados hoy</small>
                {visiblesAgotados.map(fila)}
              </>
            )}
            {secciones.map(({ cat, items }) => (
              <div key={cat.id} style={{ display: 'grid', gap: 2 }}>
                <small style={s.seccion}>{cat.nombre}</small>
                {items.map(fila)}
              </div>
            ))}
            {filtro && visibles.length === 0 && <small className="suave">No encontré ese plato.</small>}
          </div>
        </div>
      </Desplegable>
    </div>
  )
}

const s = {
  contenedor: { display: 'grid', gap: 8, marginBottom: 12, justifyItems: 'start' },
  contador: {
    marginLeft: 6,
    minWidth: 20,
    padding: '0 6px',
    borderRadius: 99,
    background: 'var(--rosa)',
    color: '#B3261E',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: '20px',
  },
  flecha: { marginLeft: 6, fontSize: 11, transition: 'transform 260ms var(--ease)', display: 'inline-block' },
  panel: { display: 'grid', gap: 8, padding: 14, width: '100%', boxSizing: 'border-box' },
  lista: { display: 'grid', gap: 10, maxHeight: 'min(52vh, 420px)', overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 2 },
  seccion: { fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 12, color: 'var(--suave)', padding: '4px 2px' },
  fila: { padding: '0 10px', borderRadius: 12 },
  filaAgotada: { background: 'var(--rosa)' },
}
