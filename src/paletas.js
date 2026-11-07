// Colores por restaurante: el superadmin elige DOS colores (principal y de fondo) y el resto se calcula
// aquí, para los dos modos (oscuro y claro) y cuidando que el texto siempre se lea.
const ID_ESTILO = 'tema-restaurante'
export const COLOR_MARCA_BASE = '#4d8dff'
export const COLOR_FONDO_BASE = '#0d131f'

export const esHex = (h) => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h)

function aRgb(h) {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
}
function deRgb([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}
function aHsl(h) {
  const [r, g, b] = aRgb(h).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  let hh
  if (max === r) hh = ((g - b) / d) % 6
  else if (max === g) hh = (b - r) / d + 2
  else hh = (r - g) / d + 4
  return [(hh * 60 + 360) % 360, s * 100, l * 100]
}
function deHsl(h, s, l) {
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return deRgb([(r + m) * 255, (g + m) * 255, (b + m) * 255])
}
function luz(h) {
  const f = (v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = aRgb(h)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export function contraste(a, b) {
  const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// Mueve la luminosidad del color hasta que se lea sobre "contra" (aclarando u oscureciendo).
function ajustar(hex, contra, minimo, aclarar) {
  const [h, s, l0] = aHsl(hex)
  let l = l0
  for (let i = 0; i < 60 && contraste(deHsl(h, s, l), contra) < minimo; i++) l += aclarar ? 1.5 : -1.5
  return deHsl(h, s, Math.max(4, Math.min(96, l)))
}

// Paleta completa de un modo ('oscuro' | 'claro') a partir de los dos colores base.
export function paleta(marcaBase, fondoBase, modo) {
  const marcaOk = esHex(marcaBase) ? marcaBase : null
  const fondoOk = esHex(fondoBase) ? fondoBase : null
  const oscuro = modo === 'oscuro'
  const v = {}
  if (fondoOk) {
    const [h, s0] = aHsl(fondoOk)
    const s = Math.min(s0, oscuro ? 45 : 40)
    if (oscuro) {
      v['--fondo'] = deHsl(h, s, 7)
      v['--sup'] = deHsl(h, s, 11)
      v['--lavanda'] = deHsl(h, s, 15)
      v['--lavanda-2'] = deHsl(h, s, 24)
      v['--linea'] = deHsl(h, s, 19)
    } else {
      v['--fondo'] = deHsl(h, s, 96)
      v['--sup'] = '#ffffff'
      v['--lavanda'] = deHsl(h, s, 93)
      v['--lavanda-2'] = deHsl(h, s, 85)
      v['--linea'] = deHsl(h, s, 89)
    }
  }
  if (marcaOk) {
    const sup = v['--sup'] ?? (oscuro ? '#141c2b' : '#ffffff')
    const marca = oscuro ? ajustar(marcaOk, sup, 4.5, true) : ajustar(marcaOk, '#ffffff', 4.5, false)
    v['--marca'] = marca
    v['--sobre-marca'] = contraste(marca, '#ffffff') >= contraste(marca, '#0b1020') ? '#ffffff' : '#0b1020'
  }
  return v
}

const texto = (obj) => Object.entries(obj).map(([k, x]) => `${k}:${x};`).join('')

export function aplicarColores(r) {
  const marca = r?.color_marca
  const fondo = r?.color_fondo
  quitarColores()
  if (!esHex(marca) && !esHex(fondo)) return
  const st = document.createElement('style')
  st.id = ID_ESTILO
  st.textContent = `:root{${texto(paleta(marca, fondo, 'oscuro'))}}:root[data-tema='claro']{${texto(paleta(marca, fondo, 'claro'))}}`
  document.head.appendChild(st)
  actualizarBarra()
}

export function quitarColores() {
  document.getElementById(ID_ESTILO)?.remove()
  actualizarBarra()
}

// El color de la barra del navegador en el celular sigue al fondo.
export function actualizarBarra() {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const f = getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim()
  if (f) meta.setAttribute('content', f)
}

// Avisos para el superadmin sobre lo que elegió.
export function revisar(marca, fondo) {
  const av = []
  if (esHex(marca)) {
    const sup = paleta(marca, fondo, 'oscuro')['--sup'] ?? '#141c2b'
    if (contraste(marca, sup) < 3) av.push('El color principal es muy oscuro para el modo oscuro: se aclarará automáticamente para que se lea.')
    if (contraste(marca, '#ffffff') < 3) av.push('El color principal es muy claro para el modo claro: se oscurecerá automáticamente para que se lea.')
    const [, s] = aHsl(marca)
    if (s < 15) av.push('El color principal es casi gris: los botones y selecciones se verán poco marcados.')
  }
  if (esHex(fondo)) {
    const [, , l] = aHsl(fondo)
    if (l > 85) av.push('El color de fondo es muy claro: en modo oscuro solo se usará su tono, no su claridad.')
  }
  return av
}

// Valores por defecto del sistema (los mismos de index.css), para las vistas previas.
const BASE = {
  oscuro: { '--marca': '#4d8dff', '--sobre-marca': '#06142e', '--fondo': '#0d131f', '--sup': '#141c2b', '--lavanda': '#1b2536', '--lavanda-2': '#2c3a55', '--linea': '#26324a', '--tinta': '#eaf0fb', '--suave': '#8fa0bd', '--menta-tinta': '#3dd9a0', '--aviso-tinta': '#ffb547' },
  claro: { '--marca': '#2f6fe0', '--sobre-marca': '#ffffff', '--fondo': '#f3f6fb', '--sup': '#ffffff', '--lavanda': '#eaf0f8', '--lavanda-2': '#cdd8e8', '--linea': '#d8e1ee', '--tinta': '#101828', '--suave': '#5b6b84', '--menta-tinta': '#12805a', '--aviso-tinta': '#a85a00' },
}
export const varsVista = (marca, fondo, modo) => ({ ...BASE[modo], ...paleta(marca, fondo, modo) })
