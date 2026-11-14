import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { avisar, sentir, sonar, vibrar } from './feedback'
import { Mensaje, Segmento } from './ui'
import Icono from './iconos'
import { estaAgotado, marcarPropio, useHoy } from './agotado'
import { ordenarNombre } from './orden'
import './agotados.css'

// =============================================================================================
// AGOTADOS DE HOY
// - A la vista solo están los agotados; los demás platos se buscan con la lupa.
// - Se marcan o desmarcan varios a la vez y recién al tocar «Guardar» se envía todo junto
//   (una sola llamada a la base, en vez de una por cada toque).
// - No edita el menú: el plato vuelve solo mañana.
// soloPlatos: la cocina solo controla los platos; bebidas y postres los marca el salón.
// =============================================================================================

const MAX_RESULTADOS = 25

// Carga los productos y escucha cambios de otros equipos (con una pausa para juntar varios avisos).
function useAgotados(restaurante, soloPlatos) {
  const hoy = useHoy(restaurante.zona_horaria)
  const [prods, setProds] = useState(null)
  const [cats, setCats] = useState([])
  const [error, setError] = useState('')
  const temporizador = useRef(null)

  const cargar = useCallback(async () => {
    const rid = restaurante.id
    const [c, p] = await Promise.all([
      supabase.from('categorias').select('id, nombre, orden, tipo').eq('restaurante_id', rid).eq('activo', true).order('orden'),
      supabase.from('productos').select('id, nombre, categoria_id, agotado_dia').eq('restaurante_id', rid).eq('activo', true).order('nombre'),
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
      temporizador.current = setTimeout(cargar, 600)
    }
    // Nombre único: la misma pantalla puede estar montada dos veces (Salón y Cocina del administrador).
    const canal = supabase
      .channel(`agotados-${restaurante.id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'productos', filter: `restaurante_id=eq.${restaurante.id}` }, programar)
      .subscribe()
    return () => {
      clearTimeout(temporizador.current)
      supabase.removeChannel(canal)
    }
  }, [cargar, restaurante.id])

  const catsPorId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats])
  // Solo productos de categorías activas (los demás no aparecen en el salón de todas formas).
  const lista = useMemo(() => (prods ?? []).filter((p) => catsPorId.has(p.categoria_id)), [prods, catsPorId])
  const agotados = useMemo(() => lista.filter((p) => estaAgotado(p, hoy)), [lista, hoy])

  return { hoy, prods, setProds, lista, agotados, catsPorId, error, setError, cargar }
}

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Lista con buscador y botón Guardar. La usan la hoja (salón y cocina) y la sección del administrador.
function ListaAgotados({ datos, soloPlatos, onGuardado }) {
  const { hoy, prods, setProds, lista, agotados, catsPorId, error, setError } = datos
  const [buscar, setBuscar] = useState('')
  // Cambios sin guardar: id del producto -> true (agotar) / false (volver a ofrecer).
  const [cambios, setCambios] = useState(() => new Map())
  const [guardando, setGuardando] = useState(false)

  const quiere = (p) => (cambios.has(p.id) ? cambios.get(p.id) : estaAgotado(p, hoy))

  function alternar(p) {
    sentir('toque', 'tic')
    setCambios((m) => {
      const n = new Map(m)
      const nuevo = !quiere(p)
      if (nuevo === estaAgotado(p, hoy)) n.delete(p.id)
      else n.set(p.id, nuevo)
      return n
    })
  }

  const filtro = sinTildes(buscar.trim())
  const resultados = useMemo(() => {
    if (!filtro) return []
    return lista.filter((p) => sinTildes(p.nombre).includes(filtro))
  }, [lista, filtro])

  // Sin búsqueda: los agotados de hoy más los que se acaban de elegir para agotar.
  const enVista = useMemo(() => {
    const ids = new Set(agotados.map((p) => p.id))
    for (const [id, v] of cambios) if (v) ids.add(id)
    return lista.filter((p) => ids.has(p.id))
  }, [agotados, cambios, lista])

  const nAgotar = [...cambios.values()].filter(Boolean).length
  const nVolver = cambios.size - nAgotar

  async function guardar() {
    if (!cambios.size || guardando) return
    setGuardando(true)
    setError('')
    const agotar = [...cambios].filter(([, v]) => v).map(([id]) => id)
    const reponer = [...cambios].filter(([, v]) => !v).map(([id]) => id)
    cambios.forEach((_, id) => marcarPropio(id))
    const { error } = await supabase.rpc('marcar_agotados', { p_agotar: agotar, p_reponer: reponer })
    setGuardando(false)
    if (error) {
      setError(error.message)
      sonar('error')
      return
    }
    // Se refleja al instante; el aviso en vivo de los demás equipos llega solo.
    setProds((ps) => ps.map((x) => (cambios.has(x.id) ? { ...x, agotado_dia: cambios.get(x.id) ? hoy : null } : x)))
    setCambios(new Map())
    setBuscar('')
    if (agotar.length) {
      vibrar('aviso')
      sonar('baja')
    } else sonar('pop')
    const partes = []
    if (agotar.length) partes.push(`${agotar.length} agotado${agotar.length === 1 ? '' : 's'}`)
    if (reponer.length) partes.push(`${reponer.length} disponible${reponer.length === 1 ? '' : 's'} de nuevo`)
    avisar(`Guardado · ${partes.join(' · ')}`, agotar.length ? 'agotado' : 'ok')
    onGuardado?.()
  }

  const fila = (p) => {
    const marcado = quiere(p)
    const pendiente = cambios.has(p.id)
    const cat = catsPorId.get(p.categoria_id)
    return (
      <button key={p.id} type="button" className="ago-fila" data-marcado={marcado || undefined} data-pendiente={pendiente || undefined} onClick={() => alternar(p)} aria-pressed={marcado}>
        <span className="ago-check" aria-hidden="true">{marcado && <Icono n="prohibido" tam={14} ancho={2.4} />}</span>
        <span className="ago-nombre">
          <b>{p.nombre}</b>
          {cat && <small>{cat.nombre}</small>}
        </span>
        {pendiente ? (
          <span className={`ago-chip ${marcado ? 'rojo' : 'verde'}`}>{marcado ? 'Se agotará' : 'Volverá'}</span>
        ) : marcado ? (
          <span className="ago-chip rojo">Agotado</span>
        ) : null}
      </button>
    )
  }

  return (
    <div className="ago">
      <Mensaje tipo="error">{error}</Mensaje>
      <label className="ago-buscar">
        <Icono n="buscar" tam={18} />
        <input type="search" placeholder="Buscar un plato para agotar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar producto" />
        {buscar && (
          <button type="button" className="ago-limpiar" aria-label="Borrar búsqueda" onClick={() => setBuscar('')}>
            <Icono n="cerrar" tam={16} />
          </button>
        )}
      </label>

      {!prods && <small className="suave">Cargando…</small>}
      {prods && lista.length === 0 && <small className="suave">Todavía no hay productos en el menú.</small>}

      {filtro ? (
        <div className="ago-lista">
          <small className="ago-sec">
            {resultados.length ? `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}` : 'Sin resultados'}
          </small>
          {resultados.slice(0, MAX_RESULTADOS).map(fila)}
          {resultados.length > MAX_RESULTADOS && <small className="suave">Hay más: escribe un poco más del nombre.</small>}
          {resultados.length === 0 && <small className="suave">No encontré «{buscar.trim()}» en el menú.</small>}
        </div>
      ) : (
        prods && lista.length > 0 && (
          <div className="ago-lista">
            <small className="ago-sec" style={{ color: enVista.length ? 'var(--rosa-tinta)' : undefined }}>
              {agotados.length ? `Agotados hoy · ${agotados.length}` : 'Nada agotado por ahora'}
            </small>
            {enVista.map(fila)}
            {enVista.length === 0 && (
              <small className="suave">Busca con la lupa el plato que se acabó y márcalo. Mañana vuelve solo.</small>
            )}
          </div>
        )
      )}

      {soloPlatos && <small className="suave">Las bebidas y los postres los marca el salón.</small>}

      <div className="ago-pie" data-visible={cambios.size > 0 || undefined}>
        <small>
          {nAgotar > 0 && <span style={{ color: 'var(--rosa-tinta)' }}>{nAgotar} por agotar</span>}
          {nAgotar > 0 && nVolver > 0 && ' · '}
          {nVolver > 0 && <span style={{ color: 'var(--menta-tinta)' }}>{nVolver} por reponer</span>}
        </small>
        <button type="button" className="btn btn-chico btn-sec" disabled={guardando} onClick={() => setCambios(new Map())}>
          Descartar
        </button>
        <button type="button" className="btn btn-chico btn-principal" disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : `Guardar${cambios.size > 1 ? ` (${cambios.size})` : ''}`}
        </button>
      </div>
    </div>
  )
}

// Botón «Agotados» con el número de hoy; abre la hoja. Lo usan el Salón y la Cocina.
export default function Agotados({ restaurante, soloPlatos = false }) {
  const datos = useAgotados(restaurante, soloPlatos)
  const [abierto, setAbierto] = useState(false)
  const n = datos.agotados.length

  return (
    <>
      <button
        type="button"
        className="btn btn-chico btn-sec ago-boton"
        data-hay={n > 0 || undefined}
        aria-label={`Agotados${n ? `: ${n}` : ''}`}
        onClick={() => {
          sentir('toque', 'tic')
          datos.cargar()
          setAbierto(true)
        }}
      >
        <Icono n="prohibido" tam={15} />
        Agotados
        {n > 0 && (
          <b key={n} className="contador-pop ago-num">
            {n}
          </b>
        )}
      </button>

      {abierto &&
        createPortal(
          <div className="hoja-velo funde" onClick={() => setAbierto(false)}>
            <div className="hoja sube" role="dialog" aria-modal="true" aria-label="Agotados de hoy" onClick={(e) => e.stopPropagation()}>
              <div className="hoja-asa" aria-hidden="true" />
              <div className="hoja-cab">
                <h3 style={{ margin: 0 }}>Agotados de hoy</h3>
                <button className="btn btn-chico btn-sec" style={{ width: 40, padding: 0 }} aria-label="Cerrar" onClick={() => setAbierto(false)}>
                  <Icono n="cerrar" tam={18} />
                </button>
              </div>
              <div className="hoja-cuerpo" style={{ paddingBottom: 'calc(18px + var(--seguro-abajo))' }}>
                <ListaAgotados datos={datos} soloPlatos={soloPlatos} />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

// Sección del administrador: «Agotados e inventario».
export function AgotadosInventario({ restaurante }) {
  const datos = useAgotados(restaurante, false)
  const [vista, setVista] = useState('agotados')
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0 }}>Agotados e inventario</h2>
        <small className="suave">Lo que marques aquí desaparece del salón y de la carta QR por hoy.</small>
      </div>
      <Segmento
        etiqueta="Ver"
        valor={vista}
        onChange={setVista}
        opciones={[
          ['agotados', `Agotados${datos.agotados.length ? ` · ${datos.agotados.length}` : ''}`],
          ['inventario', 'Inventario'],
        ]}
      />
      {vista === 'agotados' ? (
        <section className="tarjeta">
          <ListaAgotados datos={datos} />
        </section>
      ) : (
        <section className="tarjeta ago-pronto">
          <span className="ago-pronto-icono" aria-hidden="true">
            <Icono n="caja" tam={26} />
          </span>
          <b>Inventario · próximamente</b>
          <small className="suave">
            Aquí vas a llevar el stock de tus insumos y bebidas, y el sistema te avisará cuando algo se esté acabando.
          </small>
        </section>
      )}
    </div>
  )
}
