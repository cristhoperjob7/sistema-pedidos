// Orden alfabético "de persona": ignora mayúsculas y tildes (Ají junto a Arroz, no al final),
// y entiende los números (Combo 2 va antes que Combo 10).
const comparar = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

export const porNombre = (a, b) => comparar.compare(a?.nombre ?? '', b?.nombre ?? '')

// Devuelve una copia ordenada por nombre; no modifica la lista original.
export const ordenarNombre = (lista) => [...(lista ?? [])].sort(porNombre)
