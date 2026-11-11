import { supabase } from './supabase'

const BUCKET = 'carta'

const LIMITE = 1.8 * 1024 * 1024 // el almacenamiento acepta hasta 2 MB por foto

async function cargarImagen(archivo) {
  if (!archivo?.type?.startsWith('image/')) throw new Error('Elige una imagen (JPG, PNG o WebP).')
  const url = URL.createObjectURL(archivo)
  try {
    return await new Promise((ok, mal) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => mal(new Error('No se pudo leer esa imagen.'))
      i.src = url
    })
  } finally {
    // se libera después de dibujarla (la imagen ya está cargada en memoria)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

// Tamaño real de la imagen elegida (para avisar si es muy chica).
export async function medirImagen(archivo) {
  const im = await cargarImagen(archivo)
  return { ancho: im.naturalWidth, alto: im.naturalHeight }
}

// Reduce solo si hace falta (máx. `max` px por el lado más largo) y la deja en WebP.
// Si pesa demasiado, baja la calidad de a poco antes de achicar las dimensiones.
async function preparar(archivo, max, calidad) {
  const im = await cargarImagen(archivo)
  let lado = max
  for (let intento = 0; intento < 5; intento++) {
    const k = Math.min(1, lado / Math.max(im.naturalWidth, im.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(im.naturalWidth * k))
    c.height = Math.max(1, Math.round(im.naturalHeight * k))
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(im, 0, 0, c.width, c.height)
    const q = Math.max(0.7, calidad - intento * 0.06)
    let blob = await new Promise((r) => c.toBlob(r, 'image/webp', q))
    if (!blob || blob.type !== 'image/webp') {
      // Navegador sin WebP: JPEG con fondo blanco
      g.globalCompositeOperation = 'destination-over'
      g.fillStyle = '#fff'
      g.fillRect(0, 0, c.width, c.height)
      blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q))
    }
    if (!blob) throw new Error('No se pudo preparar la imagen.')
    if (blob.size <= LIMITE) return blob
    lado = Math.round(lado * 0.85)
  }
  throw new Error('La imagen pesa demasiado. Prueba con otra o más simple.')
}

// Sube una foto a la carpeta del local y devuelve su dirección pública.
export async function subirImagen(restauranteId, archivo, { max = 1200, calidad = 0.82 } = {}) {
  const blob = await preparar(archivo, max, calidad)
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
  const id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/-/g, '')
  const ruta = `${restauranteId}/${id}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) {
    throw new Error(
      /bucket|not found|policy|row-level/i.test(error.message)
        ? 'No se pudo subir la foto. ¿Ejecutaste paso24.sql en Supabase?'
        : error.message
    )
  }
  return supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl
}

// Borra una foto que ya no se usa (si falla no pasa nada: solo queda un archivo huérfano).
export async function borrarImagen(url) {
  const marca = `/${BUCKET}/`
  const i = typeof url === 'string' ? url.indexOf(marca) : -1
  if (i < 0) return
  const ruta = decodeURIComponent(url.slice(i + marca.length).split('?')[0])
  try {
    await supabase.storage.from(BUCKET).remove([ruta])
  } catch {
    /* sin problema */
  }
}

// Solo se muestran fotos con dirección https.
export const fotoOk = (u) => typeof u === 'string' && /^https:\/\//.test(u)
