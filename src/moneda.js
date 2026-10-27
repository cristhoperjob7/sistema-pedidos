// Formatea un precio con la moneda del restaurante (símbolo y decimales).
export function formatear(valor, restaurante) {
  const d = restaurante.moneda_decimales ?? 2
  const n = Number(valor ?? 0).toLocaleString('es-CL', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
  return `${restaurante.moneda_simbolo} ${n}`
}

// Convierte lo que escribe la persona ("12,5", "12.50") en un número válido, o null.
export function leerPrecio(texto, restaurante) {
  const t = String(texto).trim()
  // Sin decimales (ej. peso chileno) el punto es separador de miles: "8.000" = 8000.
  const miles = /^\d{1,3}([.,]\d{3})+$/.test(t) // "3.555" o "1,250,000" son miles, no decimales
  const n =
    (restaurante.moneda_decimales ?? 2) === 0 || miles ? Number(t.replace(/\D/g, '') || NaN) : Number(t.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 9999999) return null
  const f = 10 ** (restaurante.moneda_decimales ?? 2)
  return Math.round(n * f) / f
}

// Limpia lo que se escribe en un campo de precio: sin decimales, solo dígitos;
// con decimales, dígitos y un único separador (coma o punto) con los decimales permitidos.
export function soloPrecio(texto, restaurante) {
  const d = restaurante.moneda_decimales ?? 2
  const t = String(texto)
  if (d === 0) return t.replace(/\D/g, '').slice(0, 7)
  const limpio = t.replace(/[^\d.,]/g, '')
  const i = limpio.search(/[.,]/)
  if (i === -1) return limpio.slice(0, 7)
  return limpio.slice(0, i).slice(0, 7) + limpio[i] + limpio.slice(i + 1).replace(/[.,]/g, '').slice(0, d)
}
