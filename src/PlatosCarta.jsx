import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { formatear, leerPrecio, soloPrecio } from './moneda'
import { Cargando, Confirmar, Interruptor, Mensaje } from './ui'
import { avisar, sentir } from './feedback'
import Icono from './iconos'
import { borrarImagen, fotoOk, subirImagen } from './imagenes'
import { ordenarNombre } from './orden'

// Platos de la carta: foto, descripción, destacado, mostrar u ocultar, agregar y eliminar.
export default function PlatosCarta({ restaurante }) {
  const $ = (v) => formatear(v, restaurante)
  const [cats, setCats] = useState(null)
  const [prods, setProds] = useState([])
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null)
  const [nuevos, setNuevos] = useState({}) // categoria_id -> { nombre, precio }
  const [buscar, setBuscar] = useState('')

  const cargar = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from('categorias').select('id, nombre, orden').eq('restaurante_id', restaurante.id).eq('activo', true).order('orden'),
      supabase.from('productos').select('*').eq('restaurante_id', restaurante.id).eq('activo', true).order('nombre'),
    ])
    const fallo = c.error || p.error
    if (fallo) return setError(fallo.message)
    setError('')
    setCats(c.data)
    setProds(ordenarNombre(p.data))
  }, [restaurante.id])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function agregar(cat) {
    const n = nuevos[cat.id] ?? {}
    const nombre = (n.nombre ?? '').trim()
    const precio = leerPrecio(n.precio ?? '', restaurante)
    if (!nombre) return setError('Escribe el nombre del plato.')
    if (precio == null) return setError('Escribe un precio válido.')
    setError('')
    const { error } = await supabase.from('productos').insert({ restaurante_id: restaurante.id, categoria_id: cat.id, nombre, precio })
    if (error) return setError(error.message)
    sentir('toque', 'pop')
    avisar(`${nombre} agregado a ${cat.nombre}`)
    setNuevos((x) => ({ ...x, [cat.id]: { nombre: '', precio: '' } }))
    cargar()
  }

  if (!cats) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={4} alto={64} />

  const q = buscar.trim().toLowerCase()
  const visibles = (c) => prods.filter((p) => p.categoria_id === c.id && (!q || p.nombre.toLowerCase().includes(q)))

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h3 style={{ margin: 0 }}>Platos de la carta</h3>
        <small className="suave">
          Ponles foto y descripción, márcalos como destacados, ocúltalos de la carta o elimínalos. Los cambios se ven al tiro.
          Las categorías se crean y ordenan en Menú.
        </small>
      </div>
      <Mensaje tipo="error">{error}</Mensaje>
      {prods.length > 8 && (
        <input className="campo-chico" type="search" placeholder="Buscar plato…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      )}
      {cats.length === 0 && <small className="suave">Primero crea una categoría en Menú.</small>}

      {cats.map((c) => (
        <div key={c.id} className="tarjeta" style={{ padding: 12, display: 'grid', gap: 4 }}>
          <b style={{ marginBottom: 2 }}>{c.nombre}</b>
          {visibles(c).length === 0 && <small className="suave">{q ? 'Sin resultados.' : 'Aún no hay platos.'}</small>}
          {visibles(c).map((p) => (
            <button key={p.id} style={s.fila} onClick={() => { sentir('toque'); setEditando(p) }} aria-label={`Editar ${p.nombre}`}>
              {fotoOk(p.foto) ? (
                <img src={p.foto} alt="" style={s.mini} />
              ) : (
                <span style={{ ...s.mini, display: 'grid', placeItems: 'center', background: 'var(--lavanda)', color: 'var(--suave)', fontSize: 11 }}>sin foto</span>
              )}
              <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                <b style={{ display: 'block', overflowWrap: 'anywhere' }}>{p.nombre}</b>
                <small className="suave">{$(p.precio)}{p.descripcion ? ' · con descripción' : ''}</small>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  {p.destacado && <span style={s.chip}><Icono n="estrella" tam={15} className="it" /> Destacado</span>}
                  {p.en_carta === false && <span style={{ ...s.chip, background: 'var(--rosa)', color: 'var(--rosa-tinta)' }}>Oculto en la carta</span>}
                </span>
              </span>
              <span className="suave" aria-hidden="true">›</span>
            </button>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <input
              className="campo-chico"
              style={{ flex: '2 1 140px', minWidth: 0 }}
              placeholder="Nuevo plato"
              maxLength={80}
              value={nuevos[c.id]?.nombre ?? ''}
              onChange={(e) => setNuevos((x) => ({ ...x, [c.id]: { ...x[c.id], nombre: e.target.value } }))}
              onKeyDown={(e) => e.key === 'Enter' && agregar(c)}
            />
            <input
              className="campo-chico"
              style={{ flex: '1 1 90px', minWidth: 0 }}
              inputMode="decimal"
              placeholder="Precio"
              value={nuevos[c.id]?.precio ?? ''}
              onChange={(e) => setNuevos((x) => ({ ...x, [c.id]: { ...x[c.id], precio: soloPrecio(e.target.value, restaurante) } }))}
              onKeyDown={(e) => e.key === 'Enter' && agregar(c)}
            />
            <button className="btn btn-chico btn-principal" onClick={() => agregar(c)}>＋ Agregar</button>
          </div>
        </div>
      ))}

      {editando && (
        <HojaPlato
          restaurante={restaurante}
          plato={editando}
          onCerrar={() => setEditando(null)}
          onCambio={() => { setEditando(null); cargar() }}
        />
      )}
    </div>
  )
}

function HojaPlato({ restaurante, plato, onCerrar, onCambio }) {
  const [nombre, setNombre] = useState(plato.nombre)
  const [precio, setPrecio] = useState(String(plato.precio ?? '').replace(/\.0+$/, ''))
  const [descripcion, setDescripcion] = useState(plato.descripcion ?? '')
  const [foto, setFoto] = useState(plato.foto ?? null)
  const [destacado, setDestacado] = useState(!!plato.destacado)
  const [enCarta, setEnCarta] = useState(plato.en_carta !== false)
  const [error, setError] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [eliminar, setEliminar] = useState(false)
  const subidas = useRef([]) // fotos subidas en esta ventana (si se cancela, se borran)

  async function elegirFoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setSubiendo(true)
    setError('')
    try {
      const url = await subirImagen(restaurante.id, f, { max: 1000, calidad: 0.82 })
      subidas.current.push(url)
      setFoto(url)
    } catch (err) {
      setError(err.message)
    }
    setSubiendo(false)
  }

  function cerrar() {
    subidas.current.forEach(borrarImagen)
    onCerrar()
  }

  async function guardar() {
    const n = nombre.trim()
    const p = leerPrecio(precio, restaurante)
    if (!n) return setError('El plato necesita un nombre.')
    if (p == null) return setError('El precio no es válido.')
    setGuardando(true)
    setError('')
    const { error } = await supabase
      .from('productos')
      .update({ nombre: n, precio: p, descripcion: descripcion.trim() || null, foto, destacado, en_carta: enCarta })
      .eq('id', plato.id)
    setGuardando(false)
    if (error) return setError(error.message.includes('column') ? 'Falta ejecutar paso24.sql en Supabase.' : error.message)
    // Borra las fotos que ya no se usan: la anterior (si cambió) y las que se subieron y se descartaron.
    if (plato.foto && plato.foto !== foto) borrarImagen(plato.foto)
    subidas.current.filter((u) => u !== foto).forEach(borrarImagen)
    sentir('toque', 'exito')
    avisar('Plato guardado')
    onCambio()
  }

  async function borrar() {
    setGuardando(true)
    const { error } = await supabase.from('productos').delete().eq('id', plato.id)
    setGuardando(false)
    if (error) {
      setEliminar(false)
      return setError(`No se pudo eliminar: ${error.message}. Si ya tiene ventas, mejor ocúltalo de la carta.`)
    }
    if (plato.foto) borrarImagen(plato.foto)
    subidas.current.forEach(borrarImagen)
    avisar(`“${plato.nombre}” eliminado`, 'borrar')
    onCambio()
  }

  return (
    <>
      {createPortal(
    <div className="hoja-velo funde" onClick={() => !guardando && cerrar()}>
      <div className="hoja sube" role="dialog" aria-modal="true" aria-label={`Editar ${plato.nombre}`} onClick={(e) => e.stopPropagation()}>
        <div className="hoja-asa" aria-hidden="true" />
        <div className="hoja-cab">
          <h3 style={{ margin: 0 }}>Editar plato</h3>
          <button className="btn btn-chico btn-sec" style={{ width: 40, padding: 0 }} aria-label="Cerrar" onClick={cerrar}>
            <Icono n="cerrar" tam={18} />
          </button>
        </div>
        <div className="hoja-cuerpo" style={{ paddingBottom: 'calc(18px + var(--seguro-abajo, 0px))' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Foto del plato</span>
            {fotoOk(foto) && <img src={foto} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 12 }} />}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="btn btn-sec btn-chico" style={{ cursor: 'pointer' }}>
                {subiendo ? 'Subiendo…' : foto ? 'Cambiar foto' : 'Subir foto'}
                <input type="file" accept="image/*" hidden disabled={subiendo} onChange={elegirFoto} />
              </label>
              {foto && <button className="btn btn-sec btn-chico" onClick={() => setFoto(null)}>Quitar foto</button>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 4, flex: '2 1 160px' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Nombre</span>
              <input className="campo-chico" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 4, flex: '1 1 100px' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Precio</span>
              <input className="campo-chico" inputMode="decimal" value={precio} onChange={(e) => setPrecio(soloPrecio(e.target.value, restaurante))} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Descripción (opcional)</span>
            <textarea
              className="campo-chico"
              style={{ minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
              maxLength={220}
              placeholder="Ej: Lomo de res salteado con cebolla, tomate y papas fritas."
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
            <small className="suave">{descripcion.length}/220</small>
          </label>

          <Interruptor checked={destacado} onChange={setDestacado}>
            <b><Icono n="estrella" tam={15} className="it" /> Destacado</b>
            <small className="suave" style={{ display: 'block' }}>Sale primero en su categoría y con una etiqueta.</small>
          </Interruptor>
          <Interruptor checked={enCarta} onChange={setEnCarta}>
            <b>Mostrar en la carta del QR</b>
            <small className="suave" style={{ display: 'block' }}>Apágalo para esconderlo sin borrarlo. En el salón sigue disponible.</small>
          </Interruptor>

          <Mensaje tipo="error">{error}</Mensaje>
          <button className="btn btn-principal" disabled={guardando || subiendo} onClick={guardar}>
            {guardando ? <span className="puntos">Guardando</span> : 'Guardar plato'}
          </button>
          <button className="btn btn-sec" disabled={guardando} onClick={() => setEliminar(true)} style={{ color: 'var(--rosa-tinta)' }}>
            Eliminar plato
          </button>
        </div>
      </div>
    </div>,
    document.body
      )}
      <Confirmar
        abierto={eliminar}
        titulo={`¿Eliminar “${plato.nombre}”?`}
        texto="Se borra del menú y de la carta para siempre. Si solo quieres que no se vea en el QR, mejor ocúltalo."
        trabajando={guardando}
        onCancelar={() => setEliminar(false)}
        onConfirmar={borrar}
      />
    </>
  )
}

const s = {
  fila: { all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--linea)', cursor: 'pointer' },
  mini: { width: 52, height: 52, borderRadius: 10, objectFit: 'cover', flex: 'none' },
  chip: { fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: 'var(--durazno)', color: 'var(--aviso-tinta)' },
}
