import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { formatear, leerPrecio, soloPrecio } from './moneda'
import { Cargando, Desplegable, Interruptor, Mensaje } from './ui'
import { avisar, sentir, sonar, vibrar } from './feedback'

// Sirve solo para el reporte mensual (separar "platos más vendidos" de "postres favoritos").
const TIPOS = [
  ['plato', 'Plato'],
  ['postre', 'Postre'],
  ['bebida', 'Bebida'],
  ['otro', 'Otro'],
]

export default function Menu({ restaurante }) {
  const [cats, setCats] = useState(null)
  const [prods, setProds] = useState([])
  const [error, setError] = useState('')
  const [nuevaCat, setNuevaCat] = useState({ nombre: '', va_a_cocina: true, tipo: 'plato' })
  const [nuevos, setNuevos] = useState({}) // { [categoriaId]: { nombre, precio } }
  const [mostrarCat, setMostrarCat] = useState(false)
  const [confCat, setConfCat] = useState(null) // id de la categoría que se está por eliminar
  const [eliminando, setEliminando] = useState(false)
  const [abierta, setAbierta] = useState(null) // categoría con la lista completa desplegada (solo una a la vez)
  const [editando, setEditando] = useState(null) // { tipo: 'prod' | 'cat', id, nombre, precio?, original? }
  const [confProd, setConfProd] = useState(null) // producto que se está por eliminar
  const [agregando, setAgregando] = useState(null) // categoría con el formulario de producto nuevo

  function desplegar(id) {
    sentir('toque')
    setAbierta(abierta === id ? null : id)
    setEditando(null)
    setConfProd(null)
    setConfCat(null)
    setAgregando(null)
  }

  async function cargar() {
    const c = await supabase.from('categorias').select('*').eq('restaurante_id', restaurante.id).order('orden')
    const p = await supabase.from('productos').select('*').eq('restaurante_id', restaurante.id).order('nombre')
    if (c.error || p.error) setError((c.error || p.error).message)
    else {
      setCats(c.data)
      setProds(p.data)
    }
  }

  useEffect(() => {
    cargar()
  }, [restaurante.id])

  async function actualizar(tabla, id, campos) {
    setError('')
    const { error } = await supabase.from(tabla).update(campos).eq('id', id)
    if (error) {
      setError(error.message)
      return false
    }
    cargar()
    return true
  }

  async function crearCategoria(e) {
    e.preventDefault()
    setError('')
    const nombre = nuevaCat.nombre.trim()
    if (!nombre) return setError('Escribe el nombre de la categoría.')
    sentir('toque')
    const orden = (cats ?? []).reduce((mx, c) => Math.max(mx, c.orden), 0) + 1
    const { error } = await supabase
      .from('categorias')
      .insert({ restaurante_id: restaurante.id, nombre, va_a_cocina: nuevaCat.va_a_cocina, tipo: nuevaCat.tipo, orden })
    if (error) return setError(error.message)
    vibrar('exito')
    sonar('exito')
    avisar(`Categoría "${nombre}" creada`)
    setNuevaCat({ nombre: '', va_a_cocina: true, tipo: 'plato' })
    setMostrarCat(false)
    cargar()
  }

  async function crearProducto(e, cat) {
    e.preventDefault()
    setError('')
    const f = nuevos[cat.id] || { nombre: '', precio: '' }
    const nombre = (f.nombre || '').trim()
    const precio = leerPrecio(f.precio ?? '', restaurante)
    if (!nombre) return setError('Escribe el nombre del producto.')
    if (precio === null) return setError('El precio no es válido.')
    sentir('toque', 'pop')
    const { error } = await supabase
      .from('productos')
      .insert({ restaurante_id: restaurante.id, categoria_id: cat.id, nombre, precio })
    if (error) return setError(error.message)
    vibrar('exito')
    avisar(`${nombre} agregado a ${cat.nombre}`)
    setNuevos((n) => ({ ...n, [cat.id]: { nombre: '', precio: '' } }))
    cargar()
  }

  async function guardarNombre(tabla, id, texto) {
    const nombre = texto.trim()
    if (!nombre) {
      setError('El nombre no puede quedar vacío.')
      return false
    }
    return actualizar(tabla, id, { nombre })
  }

  // Guarda nombre y precio de un producto desde el editor (lápiz).
  async function guardarProducto() {
    const e = editando
    const nombre = e.nombre.trim()
    const precio = leerPrecio(e.precio, restaurante)
    if (!nombre) return setError('El nombre no puede quedar vacío.')
    if (precio === null) return setError('El precio no es válido.')
    if (await actualizar('productos', e.id, { nombre, precio, activo: e.activo })) {
      sentir('toque', 'tic')
      avisar('Producto guardado')
      setEditando(null)
    }
  }

  // Los cambios de la categoría se guardan juntos al tocar «Guardar»; «Cancelar» los descarta.
  async function guardarCategoria() {
    const e = editando
    const nombre = e.nombre.trim()
    if (!nombre) return setError('El nombre no puede quedar vacío.')
    const c = cats.find((x) => x.id === e.id)
    const cambios = {}
    if (nombre !== c.nombre) cambios.nombre = nombre
    if (e.va_a_cocina !== c.va_a_cocina) cambios.va_a_cocina = e.va_a_cocina
    if (e.activo !== c.activo) cambios.activo = e.activo
    const tipoCambia = e.tipoCat !== (c.tipo ?? 'plato')
    if (tipoCambia) cambios.tipo = e.tipoCat
    if (Object.keys(cambios).length === 0) return setEditando(null)
    if (!(await actualizar('categorias', c.id, cambios))) return
    if (tipoCambia) {
      // Cada venta guarda su propia copia del tipo: se corrige también en las ventas ya hechas de esta categoría.
      const { data: ps } = await supabase.from('productos').select('id').eq('categoria_id', c.id)
      if (ps?.length) await supabase.from('items_pedido').update({ tipo: e.tipoCat }).in('producto_id', ps.map((p) => p.id))
    }
    sentir('toque', 'tic')
    avisar('Categoría guardada')
    setEditando(null)
  }

  async function eliminarProducto(p) {
    setError('')
    sentir('aviso')
    const { error } = await supabase.from('productos').delete().eq('id', p.id)
    if (error) return setError(`No se pudo eliminar: ${error.message}. Puedes desactivarlo en su lugar.`)
    setConfProd(null)
    sonar('baja')
    avisar(`"${p.nombre}" eliminado`, 'borrar')
    cargar()
  }

  async function eliminarCategoria(c, cuantos) {
    setError('')
    sentir('aviso')
    setEliminando(true)
    // Los productos de la categoría se borran con ella (cascada en la base). Las ventas ya hechas
    // se conservan: cada una guarda su propia copia del nombre y del precio.
    const { error } = await supabase.from('categorias').delete().eq('id', c.id)
    setEliminando(false)
    if (error) return setError(error.message)
    setConfCat(null)
    sonar('baja')
    avisar(cuantos ? `"${c.nombre}" y sus ${cuantos} productos eliminados` : `"${c.nombre}" eliminada`, 'borrar')
    cargar()
  }

  const paso = restaurante.moneda_decimales > 0 ? String(1 / 10 ** restaurante.moneda_decimales) : '1'

  if (!cats) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={120} />

  return (
    <div style={s.pagina}>
      <div>
        <h3 style={{ margin: 0 }}>Menú de {restaurante.nombre}</h3>
        <small className="suave">
          Precios en {restaurante.moneda_codigo} ({restaurante.moneda_simbolo}). Usa «Editar» o el lápiz ✏️ para cambiar algo.
        </small>
      </div>

      <Mensaje tipo="error">{error}</Mensaje>

      {cats.length === 0 && (
        <div className="vacio">
          <span className="vacio-icono">📋</span>
          <b>Todavía no hay categorías</b>
          <span>Empieza por una, por ejemplo “Platos” o “Bebidas”.</span>
        </div>
      )}

      {cats.map((c, ci) => {
        const lista = prods.filter((p) => p.categoria_id === c.id)
        const f = nuevos[c.id] || { nombre: '', precio: '' }
        const abiertaEsta = abierta === c.id
        const editCat = editando?.tipo === 'cat' && editando.id === c.id
        const fila = (p) => {
          const edit = editando?.tipo === 'prod' && editando.id === p.id
          return (
            <div key={p.id} style={{ ...s.producto, opacity: p.activo ? 1 : 0.6 }}>
              {edit ? (
                <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                  <input
                    className="campo-chico"
                    aria-label="Nombre del producto"
                    value={editando.nombre}
                    onChange={(e) => setEditando((x) => ({ ...x, nombre: e.target.value }))}
                  />
                  <div style={s.fila}>
                    <span className="suave">{restaurante.moneda_simbolo}</span>
                    <input
                      className="campo-chico"
                      style={{ width: 120 }}
                      aria-label="Precio"
                      inputMode={restaurante.moneda_decimales > 0 ? 'decimal' : 'numeric'}
                      value={editando.precio}
                      onChange={(e) => setEditando((x) => ({ ...x, precio: soloPrecio(e.target.value, restaurante) }))}
                    />
                    <Interruptor checked={editando.activo} onChange={(v) => setEditando((x) => ({ ...x, activo: v }))}>
                      Disponible
                    </Interruptor>
                  </div>
                  <div style={s.fila}>
                    <button className="btn btn-chico btn-principal" onClick={guardarProducto}>
                      Guardar
                    </button>
                    <button className="btn btn-chico btn-sec" onClick={() => setEditando(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.nombreProd}>{p.nombre}</div>
                    <small className="suave">
                      {formatear(p.precio, restaurante)}
                      {!p.activo && ' · No disponible'}
                    </small>
                  </div>
                  <button
                    className="btn btn-chico btn-sec"
                    style={s.icono}
                    aria-label={`Editar ${p.nombre}`}
                    onClick={() => {
                      sentir('toque')
                      setConfProd(null)
                      setEditando({
                        tipo: 'prod',
                        id: p.id,
                        nombre: p.nombre,
                        precio: Number(p.precio).toFixed(restaurante.moneda_decimales),
                        activo: p.activo,
                      })
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-chico btn-peligro-suave"
                    style={s.icono}
                    aria-label={`Eliminar ${p.nombre}`}
                    aria-expanded={confProd === p.id}
                    onClick={() => {
                      sentir('toque')
                      setEditando(null)
                      setConfProd(confProd === p.id ? null : p.id)
                    }}
                  >
                    🗑️
                  </button>
                </>
              )}
              <Desplegable abierto={confProd === p.id}>
                <div style={{ ...s.confirmar, marginTop: 4 }}>
                  <b style={{ color: '#B3261E' }}>¿Eliminar “{p.nombre}”?</b>
                  <small>Las ventas ya hechas se conservan. Si solo quieres ocultarlo, edítalo y desmarca “Disponible”.</small>
                  <div style={s.fila}>
                    <button className="btn btn-sec" style={{ flex: 1 }} onClick={() => setConfProd(null)}>
                      No
                    </button>
                    <button className="btn btn-peligro" style={{ flex: 1 }} onClick={() => eliminarProducto(p)}>
                      Sí, eliminar
                    </button>
                  </div>
                </div>
              </Desplegable>
            </div>
          )
        }
        return (
          <section
            key={c.id}
            className="tarjeta entra"
            style={{ ...s.cat, opacity: c.activo ? 1 : 0.6, animationDelay: `${Math.min(ci, 8) * 40}ms` }}
          >
            <div style={s.cabecera}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.nombreCat}>{c.nombre}</div>
                <small className="suave">
                  {TIPOS.find(([v]) => v === (c.tipo ?? 'plato'))?.[1]} · {lista.length} producto{lista.length === 1 ? '' : 's'}
                  {c.va_a_cocina ? ' · Cocina' : ''}
                  {!c.activo ? ' · Desactivada' : ''}
                </small>
              </div>
              <button
                className="btn btn-chico btn-sec"
                aria-label={`Editar categoría ${c.nombre}`}
                aria-expanded={editCat}
                onClick={() => {
                  sentir('toque')
                  setConfCat(null)
                  setEditando(
                    editCat
                      ? null
                      : { tipo: 'cat', id: c.id, nombre: c.nombre, tipoCat: c.tipo ?? 'plato', va_a_cocina: c.va_a_cocina, activo: c.activo },
                  )
                }}
              >
                {editCat ? 'Cerrar' : 'Editar'}
              </button>
            </div>

            <Desplegable abierto={editCat}>
              <div style={s.panel}>
                <input
                  className="campo-chico"
                  aria-label="Nombre de la categoría"
                  value={editCat ? editando.nombre : ''}
                  onChange={(e) => setEditando((x) => ({ ...x, nombre: e.target.value }))}
                />
                <label className="etiqueta">
                  Tipo (para el reporte mensual)
                  <select
                    className="campo-chico"
                    value={editCat ? editando.tipoCat : c.tipo ?? 'plato'}
                    onChange={(e) => setEditando((x) => ({ ...x, tipoCat: e.target.value }))}
                  >
                    {TIPOS.map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <Interruptor checked={editCat ? editando.va_a_cocina : c.va_a_cocina} onChange={(v) => setEditando((x) => ({ ...x, va_a_cocina: v }))}>
                  Va a cocina
                </Interruptor>
                <Interruptor checked={editCat ? editando.activo : c.activo} onChange={(v) => setEditando((x) => ({ ...x, activo: v }))}>
                  Activa (se puede pedir)
                </Interruptor>
                <div style={s.fila}>
                  <button className="btn btn-chico btn-principal" onClick={guardarCategoria}>
                    Guardar
                  </button>
                  <button className="btn btn-chico btn-sec" onClick={() => setEditando(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-chico btn-peligro-suave"
                    style={{ marginLeft: 'auto' }}
                    aria-expanded={confCat === c.id}
                    onClick={() => {
                      sentir('toque')
                      setConfCat(confCat === c.id ? null : c.id)
                    }}
                  >
                    Eliminar categoría
                  </button>
                </div>
              </div>
            </Desplegable>

            <Desplegable abierto={confCat === c.id}>
              <div style={s.confirmar}>
                <b style={{ color: '#B3261E' }}>¿Eliminar la categoría “{c.nombre}”?</b>
                <small>
                  {lista.length > 0
                    ? `Se borran también sus ${lista.length} producto${lista.length === 1 ? '' : 's'}. `
                    : ''}
                  Las ventas ya hechas se conservan, pero en el reporte mensual aparecerán como “Otros”. No se puede
                  deshacer. Si solo quieres que no se pueda pedir por ahora, desmarca “Activa”.
                </small>
                <div style={s.fila}>
                  <button className="btn btn-sec" style={{ flex: 1 }} disabled={eliminando} onClick={() => setConfCat(null)}>
                    No, dejarla
                  </button>
                  <button
                    className="btn btn-peligro"
                    style={{ flex: 1 }}
                    disabled={eliminando}
                    onClick={() => eliminarCategoria(c, lista.length)}
                  >
                    {eliminando ? <span className="puntos">Eliminando</span> : 'Sí, eliminar'}
                  </button>
                </div>
              </div>
            </Desplegable>

            {lista.length === 0 && <small className="suave">Sin productos todavía.</small>}
            {lista.length > 0 && fila(lista[0])}
            <Desplegable abierto={abiertaEsta}>
              <div style={{ display: 'grid', gap: 8 }}>{lista.slice(1).map(fila)}</div>
            </Desplegable>

            <div style={s.fila}>
              {lista.length > 1 && (
                <button className="btn btn-chico btn-sec" style={{ flex: 1 }} aria-expanded={abiertaEsta} onClick={() => desplegar(c.id)}>
                  {abiertaEsta ? 'Ocultar ▴' : `Ver los demás (${lista.length - 1}) ▾`}
                </button>
              )}
              <button
                className="btn btn-chico btn-principal"
                style={{ flex: lista.length > 1 ? '0 0 auto' : 1 }}
                aria-expanded={agregando === c.id}
                onClick={() => {
                  sentir('toque')
                  setEditando(null)
                  setAgregando(agregando === c.id ? null : c.id)
                }}
              >
                {agregando === c.id ? 'Cancelar' : '+ Producto'}
              </button>
            </div>

            <Desplegable abierto={agregando === c.id}>
              <form onSubmit={(e) => crearProducto(e, c)} style={s.nuevo}>
                <input
                  className="campo-chico"
                  style={{ flex: '1 1 160px', minWidth: 0 }}
                  placeholder="Nuevo producto"
                  value={f.nombre}
                  onChange={(e) => setNuevos((n) => ({ ...n, [c.id]: { ...f, nombre: e.target.value } }))}
                />
                <div style={s.fila}>
                  <span className="suave">{restaurante.moneda_simbolo}</span>
                  <input
                    className="campo-chico"
                    style={{ width: 110 }}
                    inputMode={restaurante.moneda_decimales > 0 ? 'decimal' : 'numeric'}
                    placeholder={paso === '1' ? '0' : '0.00'}
                    value={f.precio}
                    onChange={(e) =>
                      setNuevos((n) => ({ ...n, [c.id]: { ...f, precio: soloPrecio(e.target.value, restaurante) } }))
                    }
                  />
                </div>
                <button className="btn btn-chico btn-principal">Guardar</button>
              </form>
            </Desplegable>
          </section>
        )
      })}

      <Desplegable abierto={!mostrarCat}>
        <button
          className="btn btn-principal btn-grande btn-bloque"
          onClick={() => {
            sentir('toque')
            setMostrarCat(true)
          }}
        >
          + Agregar categoría
        </button>
      </Desplegable>
      <Desplegable abierto={mostrarCat}>
        <form onSubmit={crearCategoria} style={s.form}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 17 }}>Agregar categoría</b>
            <button type="button" className="btn btn-chico btn-sec" onClick={() => setMostrarCat(false)}>
              Cancelar
            </button>
          </div>
          <input
            className="campo"
            placeholder="Nombre (ej: Entradas, Bebidas)"
            value={nuevaCat.nombre}
            onChange={(e) => setNuevaCat((n) => ({ ...n, nombre: e.target.value }))}
          />
          <Interruptor checked={nuevaCat.va_a_cocina} onChange={(v) => setNuevaCat((n) => ({ ...n, va_a_cocina: v }))}>
            Se envía a cocina
          </Interruptor>
          <label className="etiqueta">
            Tipo (para el reporte mensual)
            <select className="campo" value={nuevaCat.tipo} onChange={(e) => setNuevaCat((n) => ({ ...n, tipo: e.target.value }))}>
              {TIPOS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-principal btn-grande">Agregar categoría</button>
        </form>
      </Desplegable>
    </div>
  )
}

const s = {
  pagina: { display: 'grid', gap: 12 },
  form: { display: 'grid', gap: 12, background: 'var(--lavanda)', border: '1px solid var(--lavanda-2)', padding: 16, borderRadius: 18 },
  cat: { display: 'grid', gap: 10, borderRadius: 18, transition: 'opacity 220ms var(--ease)' },
  cabecera: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  nombreCat: { fontWeight: 800, fontSize: 17 },
  producto: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    padding: 8,
    borderRadius: 14,
    background: '#fcfafd',
    border: '1px solid var(--linea)',
    transition: 'opacity 220ms var(--ease)',
  },
  confirmar: { display: 'grid', gap: 10, padding: 12, borderRadius: 14, background: 'var(--rosa)', border: '1px solid #f3c9c5' },
  nuevo: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 8, borderRadius: 14, border: '1.5px dashed var(--lavanda-2)' },
  fila: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  nombreProd: { fontWeight: 700, overflowWrap: 'anywhere' },
  icono: { width: 42, height: 42, padding: 0, display: 'grid', placeItems: 'center', fontSize: 17, flex: 'none' },
  panel: { display: 'grid', gap: 10, padding: 12, borderRadius: 14, background: 'var(--lavanda)', border: '1px solid var(--lavanda-2)' },
}
