import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { formatear, leerPrecio, soloPrecio } from './moneda'
import Campo from './Campo'
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

  async function guardarPrecio(p, texto) {
    const precio = leerPrecio(texto, restaurante)
    if (precio === null) {
      setError('El precio no es válido.')
      return false
    }
    return actualizar('productos', p.id, { precio })
  }

  async function cambiarCocina(c, valor) {
    const ok = await actualizar('categorias', c.id, { va_a_cocina: valor })
    if (ok) avisar('Listo. Vale para los pedidos nuevos', 'info')
  }

  async function cambiarTipo(c, valor) {
    sentir('toque', 'tic')
    const ok = await actualizar('categorias', c.id, { tipo: valor })
    if (!ok) return
    // Cada venta guarda su propia copia del tipo: se corrige también en las ventas ya hechas de esta categoría,
    // para que los reportes queden bien aunque el tipo estuviera mal puesto antes.
    const { data: prods } = await supabase.from('productos').select('id').eq('categoria_id', c.id)
    if (prods?.length) {
      await supabase.from('items_pedido').update({ tipo: valor }).in('producto_id', prods.map((p) => p.id))
    }
    avisar('Tipo guardado')
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

  async function alternarActivo(tabla, item) {
    sentir('toque', 'tic')
    await actualizar(tabla, item.id, { activo: !item.activo })
  }

  const paso = restaurante.moneda_decimales > 0 ? String(1 / 10 ** restaurante.moneda_decimales) : '1'

  if (!cats) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={120} />

  return (
    <div style={s.pagina}>
      <div>
        <h3 style={{ margin: 0 }}>Menú de {restaurante.nombre}</h3>
        <small className="suave">
          Precios en {restaurante.moneda_codigo} ({restaurante.moneda_simbolo}). Toca un nombre o precio para editarlo.
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
        return (
          <section
            key={c.id}
            className="tarjeta entra"
            style={{ ...s.cat, opacity: c.activo ? 1 : 0.55, animationDelay: `${Math.min(ci, 8) * 40}ms` }}
          >
            <div style={s.cabecera}>
              <Campo
                style={{ ...s.nombreCat, flex: '1 1 180px', minWidth: 0 }}
                valor={c.nombre}
                onGuardar={(t) => guardarNombre('categorias', c.id, t)}
              />
              <select
                className="campo-chico"
                value={c.tipo ?? 'plato'}
                onChange={(e) => cambiarTipo(c, e.target.value)}
                title="Tipo (para el reporte mensual)"
                aria-label="Tipo (para el reporte mensual)"
              >
                {TIPOS.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div style={s.cabecera}>
              <Interruptor checked={c.va_a_cocina} onChange={(v) => cambiarCocina(c, v)}>
                Va a cocina
              </Interruptor>
              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                <button className="btn btn-chico btn-sec" onClick={() => alternarActivo('categorias', c)}>
                  {c.activo ? 'Desactivar' : 'Activar'}
                </button>
                <button
                  className="btn btn-chico btn-peligro-suave"
                  aria-expanded={confCat === c.id}
                  onClick={() => {
                    sentir('toque')
                    setConfCat(confCat === c.id ? null : c.id)
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>

            <Desplegable abierto={confCat === c.id}>
              <div style={s.confirmar}>
                <b style={{ color: '#B3261E' }}>
                  ¿Eliminar la categoría “{c.nombre}”?
                </b>
                <small>
                  {lista.length > 0
                    ? `Se borran también sus ${lista.length} producto${lista.length === 1 ? '' : 's'}. `
                    : ''}
                  Las ventas ya hechas se conservan, pero en el reporte mensual aparecerán como “Otros”. No se puede
                  deshacer. Si solo quieres que no se pueda pedir por ahora, usa “Desactivar”.
                </small>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            {lista.map((p) => (
              <div key={p.id} className="entra" style={{ ...s.producto, opacity: p.activo ? 1 : 0.55 }}>
                <Campo
                  className="campo-chico"
                  style={{ flex: '1 1 160px', minWidth: 0 }}
                  valor={p.nombre}
                  onGuardar={(t) => guardarNombre('productos', p.id, t)}
                />
                <div style={s.precio}>
                  <span className="suave">{restaurante.moneda_simbolo}</span>
                  <Campo
                    className="campo-chico"
                    style={{ width: 104 }}
                    inputMode={restaurante.moneda_decimales > 0 ? 'decimal' : 'numeric'}
                    filtro={(t) => soloPrecio(t, restaurante)}
                    valor={Number(p.precio).toFixed(restaurante.moneda_decimales)}
                    onGuardar={(t) => guardarPrecio(p, t)}
                    title={`Ejemplo: ${formatear(12.5, restaurante)}`}
                  />
                </div>
                <button className="btn btn-chico btn-suave" onClick={() => alternarActivo('productos', p)}>
                  {p.activo ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            ))}

            <form onSubmit={(e) => crearProducto(e, c)} style={s.nuevo}>
              <input
                className="campo-chico"
                style={{ flex: '1 1 160px', minWidth: 0 }}
                placeholder="Nuevo producto"
                value={f.nombre}
                onChange={(e) => setNuevos((n) => ({ ...n, [c.id]: { ...f, nombre: e.target.value } }))}
              />
              <div style={s.precio}>
                <span className="suave">{restaurante.moneda_simbolo}</span>
                <input
                  className="campo-chico"
                  style={{ width: 104 }}
                  inputMode={restaurante.moneda_decimales > 0 ? 'decimal' : 'numeric'}
                  placeholder={paso === '1' ? '0' : '0.00'}
                  value={f.precio}
                  onChange={(e) => setNuevos((n) => ({ ...n, [c.id]: { ...f, precio: soloPrecio(e.target.value, restaurante) } }))}
                />
              </div>
              <button className="btn btn-chico btn-principal">+ Agregar</button>
            </form>
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
  precio: { display: 'flex', alignItems: 'center', gap: 4 },
}
