import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { formatear, leerPrecio } from './moneda'
import Campo from './Campo'

// Sirve solo para el reporte mensual (separar "platos más vendidos" de "postres favoritos").
const TIPOS = [
  ['plato', 'Plato'],
  ['postre', 'Postre'],
  ['bebida', 'Bebida'],
  ['otro', 'Otro'],
]

export default function Menu({ restaurante }) {
  const [cats, setCats] = useState([])
  const [prods, setProds] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [nuevaCat, setNuevaCat] = useState({ nombre: '', va_a_cocina: true, tipo: 'plato' })
  const [nuevos, setNuevos] = useState({}) // { [categoriaId]: { nombre, precio } }

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
    setAviso('')
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
    setAviso('')
    const nombre = nuevaCat.nombre.trim()
    if (!nombre) return setError('Escribe el nombre de la categoría.')
    const orden = cats.reduce((mx, c) => Math.max(mx, c.orden), 0) + 1
    const { error } = await supabase
      .from('categorias')
      .insert({ restaurante_id: restaurante.id, nombre, va_a_cocina: nuevaCat.va_a_cocina, tipo: nuevaCat.tipo, orden })
    if (error) return setError(error.message)
    setNuevaCat({ nombre: '', va_a_cocina: true, tipo: 'plato' })
    cargar()
  }

  async function crearProducto(e, cat) {
    e.preventDefault()
    setError('')
    setAviso('')
    const f = nuevos[cat.id] || { nombre: '', precio: '' }
    const nombre = (f.nombre || '').trim()
    const precio = leerPrecio(f.precio ?? '', restaurante)
    if (!nombre) return setError('Escribe el nombre del producto.')
    if (precio === null) return setError('El precio no es válido.')
    const { error } = await supabase
      .from('productos')
      .insert({ restaurante_id: restaurante.id, categoria_id: cat.id, nombre, precio })
    if (error) return setError(error.message)
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
    if (ok) setAviso('Listo. El cambio vale para los pedidos nuevos; lo que ya se pidió no cambia.')
  }

  async function cambiarTipo(c, valor) {
    await actualizar('categorias', c.id, { tipo: valor })
  }

  const paso = restaurante.moneda_decimales > 0 ? String(1 / 10 ** restaurante.moneda_decimales) : '1'

  return (
    <div style={s.pagina}>
      <h3 style={{ margin: 0 }}>Menú de {restaurante.nombre}</h3>
      <small>
        Los precios están en {restaurante.moneda_codigo} ({restaurante.moneda_simbolo}). Edita un nombre o un precio y
        se guarda al salir del campo. Los productos desactivados dejan de aparecer para pedir, pero se conserva su
        historial. El "Tipo" de cada categoría (Plato, Postre, Bebida, Otro) no afecta el pedido: solo se usa para
        armar el Reporte mensual.
      </small>

      {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
      {aviso && <p style={{ color: 'green', margin: 0 }}>{aviso}</p>}

      <form onSubmit={crearCategoria} style={s.form}>
        <b>Agregar categoría</b>
        <input
          style={s.input}
          placeholder="Nombre (ej: Entradas, Bebidas)"
          value={nuevaCat.nombre}
          onChange={(e) => setNuevaCat((n) => ({ ...n, nombre: e.target.value }))}
        />
        <label style={s.check}>
          <input
            type="checkbox"
            checked={nuevaCat.va_a_cocina}
            onChange={(e) => setNuevaCat((n) => ({ ...n, va_a_cocina: e.target.checked }))}
          />
          Se envía a cocina
        </label>
        <label style={s.label}>
          Tipo (para el reporte mensual)
          <select
            style={s.input}
            value={nuevaCat.tipo}
            onChange={(e) => setNuevaCat((n) => ({ ...n, tipo: e.target.value }))}
          >
            {TIPOS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button style={s.boton}>Agregar categoría</button>
      </form>

      {cats.length === 0 && <p style={{ margin: 0 }}>Todavía no hay categorías.</p>}

      {cats.map((c) => {
        const lista = prods.filter((p) => p.categoria_id === c.id)
        const f = nuevos[c.id] || { nombre: '', precio: '' }
        return (
          <section key={c.id} style={{ ...s.cat, opacity: c.activo ? 1 : 0.55 }}>
            <div style={s.cabecera}>
              <Campo
                style={{ ...s.input, fontWeight: 700, flex: 1, minWidth: 140 }}
                valor={c.nombre}
                onGuardar={(t) => guardarNombre('categorias', c.id, t)}
              />
              <label style={s.check}>
                <input type="checkbox" checked={c.va_a_cocina} onChange={(e) => cambiarCocina(c, e.target.checked)} />
                Va a cocina
              </label>
              <select
                style={{ ...s.input, width: 120, padding: 8 }}
                value={c.tipo ?? 'plato'}
                onChange={(e) => cambiarTipo(c, e.target.value)}
                title="Tipo (para el reporte mensual)"
              >
                {TIPOS.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
              <button style={s.botonSec} onClick={() => actualizar('categorias', c.id, { activo: !c.activo })}>
                {c.activo ? 'Desactivar' : 'Activar'}
              </button>
            </div>

            {lista.length === 0 && <small>Sin productos todavía.</small>}
            {lista.map((p) => (
              <div key={p.id} style={{ ...s.fila, opacity: p.activo ? 1 : 0.55 }}>
                <Campo
                  style={{ ...s.input, flex: 1, minWidth: 140 }}
                  valor={p.nombre}
                  onGuardar={(t) => guardarNombre('productos', p.id, t)}
                />
                <div style={s.precio}>
                  <span>{restaurante.moneda_simbolo}</span>
                  <Campo
                    style={{ ...s.input, width: 100 }}
                    inputMode="decimal"
                    valor={Number(p.precio).toFixed(restaurante.moneda_decimales)}
                    onGuardar={(t) => guardarPrecio(p, t)}
                    title={`Ejemplo: ${formatear(12.5, restaurante)}`}
                  />
                </div>
                <button style={s.botonSec} onClick={() => actualizar('productos', p.id, { activo: !p.activo })}>
                  {p.activo ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            ))}

            <form onSubmit={(e) => crearProducto(e, c)} style={s.fila}>
              <input
                style={{ ...s.input, flex: 1, minWidth: 140 }}
                placeholder="Nuevo producto"
                value={f.nombre}
                onChange={(e) => setNuevos((n) => ({ ...n, [c.id]: { ...f, nombre: e.target.value } }))}
              />
              <div style={s.precio}>
                <span>{restaurante.moneda_simbolo}</span>
                <input
                  style={{ ...s.input, width: 100 }}
                  inputMode="decimal"
                  placeholder={paso === '1' ? '0' : '0.00'}
                  value={f.precio}
                  onChange={(e) => setNuevos((n) => ({ ...n, [c.id]: { ...f, precio: e.target.value } }))}
                />
              </div>
              <button style={s.boton}>Agregar</button>
            </form>
          </section>
        )
      })}
    </div>
  )
}

const s = {
  pagina: { display: 'grid', gap: 10 },
  form: { display: 'grid', gap: 8, background: '#f4f0f6', padding: 12, borderRadius: 12 },
  cat: { display: 'grid', gap: 8, border: '1px solid #ddd', borderRadius: 12, padding: 12 },
  cabecera: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  fila: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  precio: { display: 'flex', alignItems: 'center', gap: 4 },
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 },
  input: { padding: 10, fontSize: 16, borderRadius: 8, border: '1px solid #bbb', boxSizing: 'border-box' },
  boton: { padding: 10, fontSize: 15, fontWeight: 700, borderRadius: 8, border: 'none', background: '#F2A900', cursor: 'pointer' },
  botonSec: { padding: 8, fontSize: 14, borderRadius: 8, border: '1px solid #bbb', background: 'white', cursor: 'pointer' },
}
