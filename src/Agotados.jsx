import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { avisar, sentir, sonar, vibrar } from './feedback'
import { Desplegable, Interruptor, Mensaje } from './ui'
import Icono from './iconos'
import { estaAgotado, marcarPropio, useHoy } from './agotado'
import { ordenarNombre } from './orden'

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
    setProds(ordenarNombre(p.data))
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
      <div key={p.id} style={{ ...s.fila, ...(agot ? s.filaAgotada : null) }}>
        <Interruptor alerta checked={agot} disabled={ocupados.has(p.id)} onChange={(v) => cambiar(p, v)}>
          <span style={{ fontWeight: agot ? 800 : 600, color: agot ? 'var(--rosa-tinta)' : 'inherit' }}>{p.nombre}</span>
        </Interruptor>
      </div>
    )
  }

  // Un grupo por tipo de producto (entrada, plato, bebida…): cada uno se abre aparte.
  const grupos = useMemo(() => {
    const g = new Map()
    for (const c of cats) {
      const tipo = c.tipo ?? 'plato'
      const items = lista.filter((p) => p.categoria_id === c.id)
      if (!items.length) continue
      const x = g.get(tipo) ?? { tipo, items: [] }
      x.items.push(...items)
      g.set(tipo, x)
    }
    return [...g.values()]
  }, [cats, lista])

  const [grupoAbierto, setGrupoAbierto] = useState(null)

  return (
    <>
      <button
        className="btn btn-chico btn-sec"
        style={{ position: 'relative', width: 40, padding: 0, flex: 'none' }}
        aria-label={`Agotados${agotados.length ? `: ${agotados.length}` : ''}`}
        title="Agotados"
        onClick={() => {
          sentir('toque', 'tic')
          cargar()
          setAbierto(true)
        }}
      >
        <Icono n="prohibido" tam={18} />
        {agotados.length > 0 && (
          <b key={agotados.length} className="contador-pop" style={s.globito}>
            {agotados.length}
          </b>
        )}
      </button>

      {abierto && createPortal(
        <div className="hoja-velo funde" onClick={() => setAbierto(false)}>
          <div className="hoja sube" role="dialog" aria-modal="true" aria-label="Agotados de hoy" onClick={(e) => e.stopPropagation()}>
            <div className="hoja-asa" aria-hidden="true" />
            <div className="hoja-cab">
              <h3 style={{ margin: 0 }}>¿Se acabó algo hoy?</h3>
              <button className="btn btn-chico btn-sec" style={{ width: 40, padding: 0 }} aria-label="Cerrar" onClick={() => setAbierto(false)}>
                <Icono n="cerrar" tam={18} />
              </button>
            </div>
            <div className="hoja-cuerpo" style={{ paddingBottom: 'calc(18px + var(--seguro-abajo))' }}>
              <small className="suave">
                Enciende lo que se acabó y desaparece del menú del salón. Mañana vuelve solo.
                {soloPlatos ? ' Las bebidas y los postres los marca el salón.' : ''}
              </small>
              <Mensaje tipo="error">{error}</Mensaje>
              {!prods && <small className="suave">Cargando…</small>}
              {prods && lista.length === 0 && <small className="suave">Todavía no hay productos en el menú.</small>}

              {lista.length > 0 && (
                <input
                  className="campo-chico"
                  type="search"
                  placeholder="Buscar producto…"
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                />
              )}

              {filtro ? (
                <div style={{ display: 'grid', gap: 2 }}>
                  {visibles.map(fila)}
                  {visibles.length === 0 && <small className="suave">No encontré ese producto.</small>}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {agotados.length > 0 && (
                    <div style={{ display: 'grid', gap: 2 }}>
                      <small style={{ ...s.seccion, color: 'var(--rosa-tinta)' }}>Agotados hoy · {agotados.length}</small>
                      {agotados.map(fila)}
                    </div>
                  )}
                  {grupos.map((g) => {
                    const abierto = grupoAbierto === g.tipo
                    const n = g.items.filter((p) => estaAgotado(p, hoy)).length
                    return (
                      <div key={g.tipo} style={s.grupo}>
                        <button
                          style={s.grupoCab}
                          aria-expanded={abierto}
                          onClick={() => {
                            sentir('toque', 'tic')
                            setGrupoAbierto(abierto ? null : g.tipo)
                          }}
                        >
                          <b style={{ flex: 1, textAlign: 'left' }}>{TIPOS[g.tipo] ?? g.tipo}</b>
                          {n > 0 && <span style={s.contador}>{n} agotado{n === 1 ? '' : 's'}</span>}
                          <small className="suave">{g.items.length}</small>
                          <span aria-hidden="true" style={{ ...s.flecha, transform: abierto ? 'rotate(180deg)' : 'none' }}>▾</span>
                        </button>
                        <Desplegable abierto={abierto}>
                          <div style={{ display: 'grid', gap: 2, padding: '0 8px 8px' }}>
                            {g.items.map((p) => fila(p))}
                          </div>
                        </Desplegable>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

const TIPOS = { plato: 'Platos', postre: 'Postres', bebida: 'Bebidas', otro: 'Otros' }

const s = {
  globito: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    padding: '0 5px',
    borderRadius: 99,
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 900,
    background: 'var(--rosa-tinta)',
    color: 'var(--sobre-rosa)',
    border: '2px solid var(--sup)',
  },
  contador: { padding: '2px 8px', borderRadius: 99, background: 'var(--rosa)', color: 'var(--rosa-tinta)', fontSize: 12, fontWeight: 800 },
  flecha: { fontSize: 12, transition: 'transform 260ms var(--ease)', display: 'inline-block' },
  grupo: { border: '1px solid var(--linea)', borderRadius: 16, background: 'var(--lavanda)', overflow: 'hidden' },
  grupoCab: { all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px', cursor: 'pointer', fontSize: 16 },
  seccion: { fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 12, color: 'var(--suave)', padding: '4px 2px' },
  fila: { padding: '0 10px', borderRadius: 12 },
  filaAgotada: { background: 'var(--rosa)' },
}
