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
  const n = Number(String(texto).trim().replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 9999999) return null
  const f = 10 ** (restaurante.moneda_decimales ?? 2)
  return Math.round(n * f) / f
}
