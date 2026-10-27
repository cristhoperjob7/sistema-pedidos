// Sensaciones de la interfaz: vibración corta (háptica), sonidos suaves, avisos flotantes y confeti.
// Todo es "de mejor esfuerzo": si el equipo no soporta algo, simplemente no pasa nada.

// ---------------------------------------------------------------------------------------------
// Los sonidos de la interfaz siempre están activos (ya no hay botón para silenciarlos).
// El aviso de la cocina se controla aparte, en "Mesas y ajustes".
// Se borra la preferencia que pudo quedar guardada de la versión anterior.
try {
  localStorage.removeItem('sonidos-interfaz')
} catch {
  // sin almacenamiento: no pasa nada
}

const reducido = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const movimientoReducido = reducido

// ---------------------------------------------------------------------------------------------
// Audio: un solo contexto para toda la app (el navegador lo desbloquea con el primer toque).
let ctx = null

export function audioCtx() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    ctx = ctx || new Ctx()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch {
    return null
  }
}

const oyentesAudio = new Set()

export function audioDesbloqueado() {
  return !!ctx && ctx.state === 'running'
}

// Avisa cuando el audio pasa a estar listo (o se vuelve a bloquear).
export function escucharAudio(fn) {
  oyentesAudio.add(fn)
  return () => oyentesAudio.delete(fn)
}

if (typeof document !== 'undefined') {
  // El navegador solo deja sonar después de un toque de la persona. Cualquier toque en la app
  // (por ejemplo, el del login) alcanza: se mantiene escuchando hasta que el audio quede activo.
  const eventos = ['pointerdown', 'touchend', 'click', 'keydown']
  const desbloquear = () => {
    try {
      // iPhone/iPad (Safari 17+): que suene aunque el equipo esté en modo silencio.
      if (navigator.audioSession) navigator.audioSession.type = 'playback'
    } catch {
      // no soportado
    }
    const c = audioCtx()
    if (!c) return
    c.resume?.().then?.(() => {
      if (c.state === 'running') {
        eventos.forEach((e) => document.removeEventListener(e, desbloquear, true))
        oyentesAudio.forEach((fn) => fn(true))
      }
    })
  }
  eventos.forEach((e) => document.addEventListener(e, desbloquear, true))
  // Si la pestaña estuvo en segundo plano, el navegador puede volver a suspender el audio.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') ctx.resume?.()
  })
}

// Una nota corta con envolvente suave. `hasta` permite que el tono "caiga", como una burbuja.
function nota(c, { f, hasta, inicio = 0, dur = 0.12, vol = 0.08, tipo = 'sine' }) {
  const t = c.currentTime + inicio
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = tipo
  osc.frequency.setValueAtTime(f, t)
  if (hasta) osc.frequency.exponentialRampToValueAtTime(hasta, t + dur * 0.8)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g)
  g.connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

// Pequeña variación de tono para que los toques repetidos no suenen robóticos.
const vario = (f) => f * (0.97 + Math.random() * 0.06)

const SONIDOS = {
  // burbuja: agregar un producto
  pop: (c) => nota(c, { f: vario(720), hasta: 360, dur: 0.09, vol: 0.09 }),
  // burbuja más grave: quitar un producto
  popBajo: (c) => nota(c, { f: vario(480), hasta: 260, dur: 0.08, vol: 0.07 }),
  // clic de interruptor
  tic: (c) => nota(c, { f: vario(1600), dur: 0.03, vol: 0.035, tipo: 'triangle' }),
  // dos notas que suben: algo salió bien (enviado, guardado)
  exito: (c) => {
    nota(c, { f: 784, dur: 0.18, vol: 0.07 })
    nota(c, { f: 1175, inicio: 0.09, dur: 0.28, vol: 0.06 })
  },
  // arpegio alegre: cuenta cobrada
  cobro: (c) => {
    nota(c, { f: 659, dur: 0.16, vol: 0.06 })
    nota(c, { f: 830, inicio: 0.08, dur: 0.18, vol: 0.06 })
    nota(c, { f: 988, inicio: 0.16, dur: 0.32, vol: 0.07 })
  },
  // campanita de tres notas que suben: cocina dejó un pedido listo para retirar
  listo: (c) => {
    nota(c, { f: 880, dur: 0.3, vol: 0.1 })
    nota(c, { f: 1109, inicio: 0.14, dur: 0.3, vol: 0.1 })
    nota(c, { f: 1319, inicio: 0.28, dur: 0.6, vol: 0.1 })
  },
  // tono que baja, sin alarma: anular / eliminar
  baja: (c) => nota(c, { f: 440, hasta: 220, dur: 0.18, vol: 0.06 }),
  // dos golpes graves y suaves: algo no se pudo
  error: (c) => {
    nota(c, { f: 220, dur: 0.1, vol: 0.06, tipo: 'triangle' })
    nota(c, { f: 196, inicio: 0.12, dur: 0.14, vol: 0.06, tipo: 'triangle' })
  },
}

export function sonar(nombre) {
  const c = audioCtx()
  if (!c || !SONIDOS[nombre]) return
  try {
    SONIDOS[nombre](c)
  } catch {
    // sin audio: la app sigue funcionando
  }
}

// ---------------------------------------------------------------------------------------------
// Háptica. Android: navigator.vibrate. iPhone (iOS 18 o más nuevo): Safari no tiene vibrate,
// pero un interruptor nativo de iOS da un "tic" háptico al tocarlo; se usa uno invisible.
// En iPhone solo funciona dentro del toque (no después de esperar al servidor).
const PATRONES = {
  toque: 8,
  exito: [12, 70, 18],
  aviso: [18, 50, 18],
  listo: [14, 70, 14, 70, 32],
  error: [28, 60, 28, 60, 28],
}

let interruptorIOS = null

function ticIOS() {
  try {
    if (!interruptorIOS) {
      const label = document.createElement('label')
      label.setAttribute('aria-hidden', 'true')
      label.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;left:-9px;top:-9px'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      input.tabIndex = -1
      label.appendChild(input)
      document.body.appendChild(label)
      interruptorIOS = label
    }
    interruptorIOS.click()
  } catch {
    // no disponible
  }
}

export function vibrar(tipo = 'toque') {
  const patron = PATRONES[tipo] ?? PATRONES.toque
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(patron)
      return
    }
  } catch {
    // seguimos con el plan B
  }
  ticIOS()
  if (Array.isArray(patron)) setTimeout(ticIOS, 90)
}

// Atajo para lo más común: vibración + sonido opcional en una sola llamada.
export function sentir(tipo = 'toque', sonido) {
  vibrar(tipo)
  if (sonido) sonar(sonido)
}

// ---------------------------------------------------------------------------------------------
// Avisos flotantes (aparecen arriba, como una píldora, y se van solos).
const oyentes = new Set()
let siguienteId = 1

export function avisar(texto, tipo = 'ok') {
  const aviso = { id: siguienteId++, texto, tipo }
  oyentes.forEach((fn) => fn(aviso))
}

export function escucharAvisos(fn) {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

// ---------------------------------------------------------------------------------------------
// Confeti en tonos pastel, desde un punto de la pantalla (o desde el centro).
const COLORES = ['#FFC23D', '#F6B4AF', '#A8DDBC', '#CDB8E6', '#A9D3F5', '#FFE08A']

export function celebrar(origen) {
  if (reducido() || typeof document === 'undefined') return
  let x = window.innerWidth / 2
  let y = window.innerHeight / 2
  const el = origen?.currentTarget ?? origen?.target ?? origen
  if (el?.getBoundingClientRect) {
    const r = el.getBoundingClientRect()
    x = r.left + r.width / 2
    y = r.top + r.height / 2
  } else if (origen && typeof origen.x === 'number') {
    x = origen.x
    y = origen.y
  }
  const capa = document.createElement('div')
  capa.className = 'confeti-capa'
  capa.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 22; i++) {
    const p = document.createElement('i')
    const ang = Math.random() * Math.PI * 2
    const dist = 60 + Math.random() * 110
    p.style.left = `${x}px`
    p.style.top = `${y}px`
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`)
    p.style.setProperty('--dy', `${Math.sin(ang) * dist - 40}px`)
    p.style.setProperty('--giro', `${Math.random() * 540 - 270}deg`)
    p.style.background = COLORES[i % COLORES.length]
    if (i % 3 === 0) p.style.borderRadius = '50%'
    p.style.animationDelay = `${Math.random() * 60}ms`
    capa.appendChild(p)
  }
  document.body.appendChild(capa)
  setTimeout(() => capa.remove(), 1100)
}
