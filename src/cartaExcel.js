// =============================================================================================
// La carta en Excel: qué columnas lleva, cómo se exporta y cómo se interpreta al importar.
// No guarda nada: solo prepara los datos (la importación real la hace la función importar_carta).
// =============================================================================================
import { formatear, leerPrecio } from './moneda'

export const TIPOS_CAT = [
  ['plato', 'Plato'],
  ['postre', 'Postre'],
  ['bebida', 'Bebida'],
  ['otro', 'Otro'],
]

// [clave, encabezado en el Excel, ancho, nombres que también se aceptan (sin tildes ni símbolos)]
export const COLUMNAS = [
  ['categoria', 'Categoría *', 22, ['categoria', 'categorias', 'seccion', 'grupo']],
  ['producto', 'Producto *', 34, ['producto', 'productos', 'nombre', 'plato', 'item', 'articulo', 'nombredelproducto']],
  ['precio', 'Precio *', 12, ['precio', 'valor', 'preciounitario', 'precioclp']],
  ['descripcion', 'Descripción', 46, ['descripcion', 'detalle']],
  ['disponible', 'Disponible (Sí/No)', 18, ['disponible', 'activo', 'disponibleparavender']],
  ['en_carta', 'Mostrar en carta QR (Sí/No)', 24, ['mostrarencartaqr', 'mostrarenlacartaqr', 'mostrarenlacarta', 'mostrarencarta', 'encarta', 'cartaqr', 'visibleencarta']],
  ['destacado', 'Destacado (Sí/No)', 17, ['destacado', 'recomendado']],
  ['tipo', 'Tipo de categoría', 18, ['tipodecategoria', 'tipo']],
  ['cocina', 'Categoría va a cocina (Sí/No)', 26, ['categoriavaacocina', 'vaacocina', 'cocina']],
]

const normal = (t) =>
  String(t ?? '')
    .replace(/\(.*?\)/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')

const clave = (t) => String(t ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const siNo = (b) => (b ? 'Sí' : 'No')

// ---------------------------------------------------------------- exportar

export function hojasDeCarta(cats, prods, restaurante) {
  const orden = [...cats].sort((a, b) => a.orden - b.orden)
  const filas = [COLUMNAS.map((c) => c[1])]
  for (const c of orden) {
    const lista = prods.filter((p) => p.categoria_id === c.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    for (const p of lista) {
      filas.push([
        c.nombre,
        p.nombre,
        Number(p.precio),
        p.descripcion ?? '',
        siNo(p.activo),
        siNo(p.en_carta ?? true),
        siNo(p.destacado ?? false),
        TIPOS_CAT.find(([v]) => v === (c.tipo ?? 'plato'))?.[1] ?? 'Plato',
        siNo(c.va_a_cocina),
      ])
    }
  }
  const listas = [
    { col: 4, valores: ['Sí', 'No'] },
    { col: 5, valores: ['Sí', 'No'] },
    { col: 6, valores: ['Sí', 'No'] },
    { col: 7, valores: TIPOS_CAT.map(([, t]) => t) },
    { col: 8, valores: ['Sí', 'No'] },
  ]
  const ejemplo = [
    COLUMNAS.map((c) => c[1]),
    ['Platos de fondo', 'Lomo saltado', 9500, 'Con papas fritas y arroz', 'Sí', 'Sí', 'Sí', 'Plato', 'Sí'],
    ['Platos de fondo', 'Ají de gallina', 8500, '', 'Sí', 'Sí', 'No', 'Plato', 'Sí'],
    ['Bebidas', 'Coca-Cola lata', 2000, '', 'Sí', 'Sí', 'No', 'Bebida', 'No'],
    ['Postres', 'Flan', 2500, 'Casero', 'Sí', 'Sí', 'No', 'Postre', 'Sí'],
  ]
  const ayuda = [
    ['Cómo usar este Excel'],
    [''],
    ['1. Escribe la carta en la hoja «Carta»: una fila por producto. La primera fila (los títulos) no se cambia.'],
    ['2. Lo obligatorio es Categoría, Producto y Precio. Lo demás se puede dejar en blanco.'],
    [`3. Precio: solo el número, sin signo (ej: 9500). Moneda del local: ${restaurante.moneda_codigo ?? ''} (${restaurante.moneda_simbolo ?? ''}).`],
    ['4. Las columnas «Sí/No» aceptan Sí o No. En blanco: si el producto es nuevo, queda Disponible = Sí, Mostrar en carta = Sí y Destacado = No; si ya existe, no se cambia.'],
    ['5. «Tipo de categoría» (Plato, Postre, Bebida u Otro) y «Categoría va a cocina» se toman de la primera fila de cada categoría.'],
    ['6. Los productos se reconocen por su nombre dentro de la categoría: si ya existe, se actualiza; si no, se crea.'],
    ['7. La descripción puede tener hasta 220 letras. Las fotos se suben desde el sistema, no desde el Excel.'],
    ['8. Guarda el archivo como .xlsx (o CSV) y súbelo en Menú → Importar desde Excel. Antes de guardar, el sistema muestra una vista previa.'],
    [''],
    ['La hoja «Ejemplo» muestra cómo se ve una carta llena. No se importa.'],
  ]
  return [
    { nombre: 'Carta', filas, anchos: COLUMNAS.map((c) => c[2]), listas, encabezado: true },
    { nombre: 'Instrucciones', filas: ayuda, anchos: [120] },
    { nombre: 'Ejemplo', filas: ejemplo, anchos: COLUMNAS.map((c) => c[2]), encabezado: true },
  ]
}

// ---------------------------------------------------------------- importar

function leerSiNo(v) {
  const t = normal(v)
  if (t === '') return null
  if (['si', 's', 'yes', 'y', 'x', 'verdadero', 'true'].includes(t) || v === 1) return true
  if (['no', 'n', 'falso', 'false'].includes(t) || v === 0) return false
  return undefined
}

function leerTipo(v) {
  const t = normal(v)
  if (t === '') return null
  if (t.startsWith('plato') || t === 'comida' || t === 'fondo') return 'plato'
  if (t.startsWith('postre')) return 'postre'
  if (t.startsWith('bebida') || t === 'bebestible' || t === 'bebestibles') return 'bebida'
  if (t.startsWith('otro')) return 'otro'
  return undefined
}

function leerMonto(v, restaurante) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || v > 9999999) return null
    const f = 10 ** (restaurante.moneda_decimales ?? 2)
    return Math.round(v * f) / f
  }
  const t = String(v ?? '').replace(/[^\d.,]/g, '')
  if (!t) return null
  // "9.500,00" o "9,500.00": la última coma/punto con 1-2 cifras son decimales
  const m = t.match(/^(.*?)[.,](\d{1,2})$/)
  if (m) {
    const entero = m[1].replace(/[.,]/g, '')
    if (!/^\d+$/.test(entero)) return null
    return leerMonto(Number(`${entero}.${m[2]}`), restaurante)
  }
  return leerPrecio(t, restaurante)
}

// Busca la hoja y la fila de títulos. Devuelve { hoja, fila, mapa: { clave: índiceColumna } } o null.
function encontrarTitulos(hojas) {
  const candidatas = [...hojas].sort((a, b) => (normal(b.nombre) === 'carta') - (normal(a.nombre) === 'carta')).filter((h) => normal(h.nombre) !== 'ejemplo' && normal(h.nombre) !== 'instrucciones')
  for (const h of candidatas) {
    for (let r = 0; r < Math.min(h.filas.length, 10); r++) {
      const mapa = {}
      ;(h.filas[r] || []).forEach((v, i) => {
        const n = normal(v)
        const col = COLUMNAS.find(([k, , , alias]) => alias.includes(n) && mapa[k] === undefined)
        if (col) mapa[col[0]] = i
      })
      if (mapa.categoria !== undefined && mapa.producto !== undefined && mapa.precio !== undefined) return { hoja: h, fila: r, mapa }
    }
  }
  return null
}

// Interpreta el Excel y lo compara con la carta actual. No toca la base de datos.
export function interpretarCarta(hojas, { cats, prods, restaurante, reemplazar }) {
  const t = encontrarTitulos(hojas)
  if (!t) {
    return {
      error: 'No encontré las columnas Categoría, Producto y Precio. Usa la plantilla (botón «Descargar Excel») o revisa que la primera fila tenga esos títulos.',
    }
  }
  const { hoja, fila: filaTitulos, mapa } = t
  const errores = []
  const filas = []
  const vistos = new Map()
  const catInfo = new Map() // clave categoría -> { tipo, cocina } (primera fila que lo diga)

  for (let r = filaTitulos + 1; r < hoja.filas.length; r++) {
    const f = hoja.filas[r] || []
    const val = (k) => (mapa[k] === undefined ? '' : f[mapa[k]] ?? '')
    const texto = (k) => String(val(k)).trim().replace(/\s+/g, ' ')
    if (COLUMNAS.every(([k]) => texto(k) === '')) continue // fila vacía
    const n = r + 1 // número de fila como lo ve la persona en Excel
    const problemas = []
    const categoria = texto('categoria')
    const producto = texto('producto')
    if (!categoria) problemas.push('falta la categoría')
    if (!producto) problemas.push('falta el nombre del producto')
    if (categoria.length > 60) problemas.push('el nombre de la categoría es muy largo (máx. 60)')
    if (producto.length > 120) problemas.push('el nombre del producto es muy largo (máx. 120)')
    const precio = leerMonto(val('precio'), restaurante)
    if (precio == null) problemas.push(String(val('precio')).trim() === '' ? 'falta el precio' : `el precio «${val('precio')}» no es válido`)
    const descripcion = texto('descripcion')
    if (descripcion.length > 220) problemas.push(`la descripción tiene ${descripcion.length} letras (máx. 220)`)
    const disponible = leerSiNo(val('disponible'))
    const en_carta = leerSiNo(val('en_carta'))
    const destacado = leerSiNo(val('destacado'))
    const cocina = leerSiNo(val('cocina'))
    const tipo = leerTipo(val('tipo'))
    if (disponible === undefined) problemas.push('«Disponible» debe ser Sí o No')
    if (en_carta === undefined) problemas.push('«Mostrar en carta QR» debe ser Sí o No')
    if (destacado === undefined) problemas.push('«Destacado» debe ser Sí o No')
    if (cocina === undefined) problemas.push('«Va a cocina» debe ser Sí o No')
    if (tipo === undefined) problemas.push('«Tipo de categoría» debe ser Plato, Postre, Bebida u Otro')
    const k = `${clave(categoria)}|${clave(producto)}`
    if (categoria && producto && vistos.has(k)) problemas.push(`está repetido (también en la fila ${vistos.get(k)})`)
    if (problemas.length) {
      errores.push({ fila: n, producto: producto || '(sin nombre)', mensaje: problemas.join(' · ') })
      continue
    }
    vistos.set(k, n)
    const ci = catInfo.get(clave(categoria)) ?? { nombre: categoria, tipo: null, cocina: null }
    if (ci.tipo == null && tipo != null) ci.tipo = tipo
    if (ci.cocina == null && cocina != null) ci.cocina = cocina
    catInfo.set(clave(categoria), ci)
    filas.push({ fila: n, categoria, producto, precio, descripcion: descripcion || null, disponible, en_carta, destacado })
  }

  // ---- Comparación con la carta actual (solo para la vista previa)
  const catPorClave = new Map(cats.map((c) => [clave(c.nombre), c]))
  const nombreCat = new Map(cats.map((c) => [c.id, c.nombre]))
  const porCatNombre = new Map(prods.map((p) => [`${clave(nombreCat.get(p.categoria_id))}|${clave(p.nombre)}`, p]))
  const porNombre = new Map()
  for (const p of prods) porNombre.set(clave(p.nombre), [...(porNombre.get(clave(p.nombre)) ?? []), p])

  const usados = new Set()
  const vista = filas.map((x) => {
    let p = porCatNombre.get(`${clave(x.categoria)}|${clave(x.producto)}`)
    let mueve = false
    if (!p) {
      const mismos = (porNombre.get(clave(x.producto)) ?? []).filter((q) => !usados.has(q.id))
      if (mismos.length === 1) {
        p = mismos[0]
        mueve = true
      }
    }
    if (!p) return { ...x, estado: 'nuevo', cambios: [] }
    usados.add(p.id)
    const cambios = []
    if (mueve) cambios.push(`pasa de «${nombreCat.get(p.categoria_id)}» a «${x.categoria}»`)
    if (p.nombre !== x.producto) cambios.push(`nombre «${p.nombre}» → «${x.producto}»`)
    if (Number(p.precio) !== x.precio) cambios.push(`precio ${formatear(p.precio, restaurante)} → ${formatear(x.precio, restaurante)}`)
    if (x.descripcion != null && (p.descripcion ?? '') !== x.descripcion) cambios.push('descripción')
    if (x.disponible != null && p.activo !== x.disponible) cambios.push(x.disponible ? 'vuelve a estar disponible' : 'queda no disponible')
    if (x.en_carta != null && (p.en_carta ?? true) !== x.en_carta) cambios.push(x.en_carta ? 'se muestra en la carta' : 'se oculta de la carta')
    if (x.destacado != null && (p.destacado ?? false) !== x.destacado) cambios.push(x.destacado ? 'destacado' : 'deja de ser destacado')
    return { ...x, estado: cambios.length ? 'actualiza' : 'igual', cambios }
  })

  const categoriasNuevas = [...catInfo.values()].filter((c) => !catPorClave.has(clave(c.nombre))).map((c) => c.nombre)
  const desactivar = reemplazar ? prods.filter((p) => !usados.has(p.id) && p.activo) : []

  return {
    hoja: hoja.nombre,
    filas: vista,
    errores,
    categorias: [...catInfo.values()],
    categoriasNuevas,
    desactivar,
    resumen: {
      nuevos: vista.filter((x) => x.estado === 'nuevo').length,
      actualiza: vista.filter((x) => x.estado === 'actualiza').length,
      iguales: vista.filter((x) => x.estado === 'igual').length,
    },
  }
}

// Lo que se envía a la base de datos.
export function paraEnviar(r) {
  const info = new Map(r.categorias.map((c) => [clave(c.nombre), c]))
  return r.filas.map((x) => {
    const c = info.get(clave(x.categoria))
    return {
      categoria: x.categoria,
      producto: x.producto,
      precio: x.precio,
      descripcion: x.descripcion,
      disponible: x.disponible,
      en_carta: x.en_carta,
      destacado: x.destacado,
      tipo: c?.tipo ?? null,
      cocina: c?.cocina ?? null,
    }
  })
}
