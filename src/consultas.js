// Supabase entrega como máximo 1000 filas por consulta. Para reportes de varios días eso se queda corto:
// esta ayuda lee de a 1000 hasta traer todo. `construir` debe devolver una consulta NUEVA cada vez
// (con un .order estable, por ejemplo .order('id')), porque cada página es una consulta distinta.
export async function traerTodo(construir, tamano = 1000) {
  const filas = []
  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await construir().range(desde, desde + tamano - 1)
    if (error) return { data: null, error }
    filas.push(...(data ?? []))
    if (!data || data.length < tamano) break
  }
  return { data: filas, error: null }
}
