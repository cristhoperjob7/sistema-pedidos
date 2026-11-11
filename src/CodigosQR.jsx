import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from './supabase'
import { Cargando, Confirmar, Interruptor, Mensaje, Segmento } from './ui'
import EditorCarta from './EditorCarta'
import PlatosCarta from './PlatosCarta'
import { avisar, sentir } from './feedback'
import { esHex } from './paletas'

// Dirección que lleva cada QR. Usa la misma página donde está instalada la app.
const urlCarta = (slug, token) =>
  `${window.location.origin}${window.location.pathname}#/carta/${encodeURIComponent(slug)}/${token}`

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Qué tan claro es un color (0 = negro, 1 = blanco): decide si el texto va blanco u oscuro.
function luminancia(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
}

// Reduce la imagen a un PNG de hasta 480 px (y más chico si aún pesa mucho).
async function reducirImagen(archivo) {
  const bmp = await new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo)
    const im = new Image()
    im.onload = () => { URL.revokeObjectURL(url); ok(im) }
    im.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer esa imagen.')) }
    im.src = url
  })
  for (const max of [480, 360, 240]) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bmp.width * k))
    c.height = Math.max(1, Math.round(bmp.height * k))
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const url = c.toDataURL('image/png')
    if (url.length <= 300000) return url
  }
  throw new Error('La imagen es demasiado pesada. Prueba con una más simple.')
}

// Códigos QR: un QR por mesa (más uno para pedidos para llevar) listo para imprimir.
function SeccionQR({ restaurante }) {
  const [mesas, setMesas] = useState(null)
  const [rest, setRest] = useState(null)
  const [imgs, setImgs] = useState({}) // id -> data URL
  const [error, setError] = useState('')
  const [regenerar, setRegenerar] = useState(null) // { id|null, texto }
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    const [m, r] = await Promise.all([
      supabase.from('mesas').select('id, numero, nombre, qr_token, qr_bloqueado_hasta').eq('restaurante_id', restaurante.id).eq('activo', true).order('numero'),
      supabase.from('restaurantes').select('slug, nombre, qr_pedidos, qr_token_llevar, logo_qr, color_marca, color_fondo, qr_llevar_bloqueado_hasta').eq('id', restaurante.id).single(),
    ])
    if (m.error || r.error) {
      setError((m.error || r.error).message.includes('qr_') ? 'Falta ejecutar paso22.sql en Supabase.' : (m.error || r.error).message)
      return
    }
    setError('')
    setMesas(m.data)
    setRest(r.data)
    const lista = [
      ...m.data.map((x) => [x.id, urlCarta(r.data.slug, x.qr_token)]),
      ['llevar', urlCarta(r.data.slug, r.data.qr_token_llevar)],
    ]
    const hechos = await Promise.all(
      lista.map(async ([id, url]) => [id, await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' })])
    )
    setImgs(Object.fromEntries(hechos))
  }, [restaurante.id])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function cambiarPedidos(valor) {
    setRest((r) => ({ ...r, qr_pedidos: valor }))
    const { error } = await supabase.rpc('config_qr', { p_restaurante: restaurante.id, p_pedidos: valor })
    if (error) {
      setError(error.message)
      cargar()
      return
    }
    avisar(valor ? 'Los clientes ya pueden pedir desde el celular' : 'Ahora la carta es solo para mirar', 'info')
  }

  async function desbloquear({ mesa = null, todo = false }) {
    const { error } = await supabase.rpc('desbloquear_qr', { p_restaurante: restaurante.id, p_mesa: mesa, p_todo: todo })
    if (error) return setError(error.message.includes('desbloquear_qr') ? 'Falta ejecutar paso26.sql en Supabase.' : error.message)
    sentir('toque', 'exito')
    avisar(todo ? 'Todo desbloqueado' : 'Desbloqueado: ya pueden pedir de nuevo', 'ok')
    cargar()
  }

  async function confirmarRegenerar() {
    setTrabajando(true)
    const { error } = await supabase.rpc('regenerar_qr', { p_restaurante: restaurante.id, p_mesa: regenerar.id })
    setTrabajando(false)
    if (error) return setError(error.message)
    sentir('toque', 'exito')
    avisar('Código nuevo creado. Imprime el QR de nuevo.', 'ok')
    setRegenerar(null)
    cargar()
  }

  function imprimir(ids) {
    const fondo = esHex(rest.color_fondo) ? rest.color_fondo : '#0d131f'
    const marca = esHex(rest.color_marca) ? rest.color_marca : '#4d8dff'
    const claro = luminancia(fondo) > 0.55
    const tinta = claro ? '#14181f' : '#ffffff'
    const suave = claro ? 'rgba(20,24,31,.68)' : 'rgba(255,255,255,.72)'
    const frase = rest.qr_pedidos ? 'Escanea, mira la carta y pide' : 'Escanea y mira la carta'
    const tarjetas = [
      ...(mesas ?? []).filter((m) => ids.includes(m.id)).map((m) => ({
        etiqueta: 'Mesa', numero: String(m.numero), sub: m.nombre, img: imgs[m.id], frase,
      })),
      ...(ids.includes('llevar')
        ? [{ etiqueta: 'Pedidos', numero: 'para llevar', sub: '', img: imgs.llevar, frase: 'Escanea, elige y pide para llevar', texto: true }]
        : []),
    ]
    const hojas = []
    for (let i = 0; i < tarjetas.length; i += 4) hojas.push(tarjetas.slice(i, i + 4))
    const marcaLocal = rest.logo_qr
      ? `<img class="logo" src="${rest.logo_qr}" alt="${esc(rest.nombre)}">`
      : `<div class="nombre">${esc(rest.nombre)}</div>`

    const w = window.open('', '_blank')
    if (!w) return setError('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.')
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tarjetas QR · ${esc(rest.nombre)}</title>
<style>
  @page { size: A4; margin: 8mm }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  body { margin: 0; font-family: "Helvetica Neue", Arial, sans-serif; background: #e9ebef }
  .barra { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: center; padding: 10px; background: #14181f; color: #fff; font-size: 14px; z-index: 5 }
  .barra button { font: inherit; font-weight: 700; padding: 8px 16px; border: 0; border-radius: 8px; background: ${marca}; color: #fff; cursor: pointer }
  .hoja { width: 194mm; margin: 8mm auto; display: grid; grid-template-columns: 95mm 95mm; grid-auto-rows: 135mm; gap: 4mm; page-break-after: always; break-after: page }
  .hoja:last-child { page-break-after: auto; break-after: auto }
  .t { position: relative; width: 95mm; height: 135mm; border-radius: 6mm; background: ${fondo}; color: ${tinta}; padding: 6mm 6mm 6mm; display: flex; flex-direction: column; align-items: center; text-align: center; overflow: hidden }
  .t::before { content: ""; position: absolute; inset: 3mm; border: .5mm solid ${marca}; border-radius: 4mm; opacity: .75; pointer-events: none }
  .arriba { height: 18mm; display: flex; align-items: center; justify-content: center; width: 100% }
  .logo { max-height: 18mm; max-width: 62mm; object-fit: contain }
  .nombre { font-family: Georgia, "Times New Roman", serif; font-weight: 700; font-size: 18pt; line-height: 1.1; letter-spacing: .2px }
  .linea { width: 14mm; height: 1.1mm; border-radius: 1mm; background: ${marca}; margin: 3mm 0 2.5mm }
  .etq { font-size: 9.5pt; letter-spacing: 3.2px; text-transform: uppercase; color: ${suave}; font-weight: 700 }
  .num { font-family: Georgia, "Times New Roman", serif; font-weight: 700; line-height: 1; margin-top: 1mm; font-size: 34pt }
  .num.txt { font-size: 21pt; margin-top: 2.5mm }
  .sub { font-size: 9.5pt; color: ${suave}; margin-top: 1.5mm; min-height: 4mm }
  .qr { background: #fff; padding: 3.5mm; border-radius: 4.5mm; margin-top: 3.5mm; box-shadow: 0 0 0 1.2mm ${marca} }
  .qr img { display: block; width: 46mm; height: 46mm }
  .frase { margin-top: auto; font-weight: 800; font-size: 12.5pt; line-height: 1.2 }
  .ayuda { font-size: 8.5pt; color: ${suave}; margin-top: 1.2mm }
  @media print { body { background: none } .barra { display: none } .hoja { margin: 0 auto } }
</style></head><body>
<div class="barra"><span>Vista previa · ${tarjetas.length} tarjeta${tarjetas.length === 1 ? '' : 's'} de 9,5 × 13,5 cm (4 por hoja A4)</span><button onclick="window.print()">Imprimir</button><span style="opacity:.7">Activa “Gráficos de fondo” si se ven sin color</span></div>
${hojas
  .map(
    (h) =>
      `<div class="hoja">${h
        .map(
          (t) => `<div class="t"><div class="arriba">${marcaLocal}</div><div class="linea"></div><div class="etq">${esc(t.etiqueta)}</div><div class="num${t.texto ? ' txt' : ''}">${esc(t.numero)}</div><div class="sub">${esc(t.sub)}</div><div class="qr"><img src="${t.img}" alt=""></div><div class="frase">${esc(t.frase)}</div><div class="ayuda">Abre la cámara de tu celular y apunta al código</div></div>`
        )
        .join('')}</div>`
  )
  .join('')}
</body></html>`)
    w.document.close()
  }

  // Sube el logo: se reduce a un PNG pequeño (conserva la transparencia) y se guarda en el local.
  async function subirLogo(e) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    if (!archivo.type.startsWith('image/')) return setError('Elige una imagen (PNG o JPG).')
    setError('')
    setTrabajando(true)
    try {
      const url = await reducirImagen(archivo)
      const { error } = await supabase.rpc('guardar_logo_qr', { p_restaurante: restaurante.id, p_logo: url })
      if (error) throw new Error(error.message.includes('guardar_logo_qr') ? 'Falta ejecutar paso23.sql en Supabase.' : error.message)
      sentir('toque', 'exito')
      avisar('Logo guardado', 'ok')
      setRest((r) => ({ ...r, logo_qr: url }))
    } catch (err) {
      setError(err.message || 'No se pudo leer esa imagen.')
    }
    setTrabajando(false)
  }

  async function quitarLogo() {
    const { error } = await supabase.rpc('guardar_logo_qr', { p_restaurante: restaurante.id, p_logo: null })
    if (error) return setError(error.message)
    setRest((r) => ({ ...r, logo_qr: null }))
    avisar('Logo quitado', 'info')
  }

  const activo = (t) => (t && new Date(t) > new Date() ? t : null)
  const nBloqueos = (mesas ?? []).filter((m) => activo(m.qr_bloqueado_hasta)).length + (activo(rest?.qr_llevar_bloqueado_hasta) ? 1 : 0)
  const hayBloqueos = nBloqueos > 0

  if (!mesas || !rest) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={72} />

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <small className="suave">Pega un QR en cada mesa. El cliente escanea, ve la carta, llama a la mesera y puede pedir.</small>
      <Mensaje tipo="error">{error}</Mensaje>

      <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <b>Logo del local</b>
        <small className="suave">Aparece en las tarjetas del QR y en la carta del cliente. Mejor un PNG con fondo transparente.</small>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {rest.logo_qr ? (
            <img src={rest.logo_qr} alt="Logo" style={{ maxHeight: 56, maxWidth: 140, objectFit: 'contain', background: esHex(rest.color_fondo) ? rest.color_fondo : '#0d131f', borderRadius: 8, padding: 6 }} />
          ) : (
            <small className="suave">Aún no hay logo: se usa el nombre del local.</small>
          )}
          <label className="btn btn-sec btn-chico" style={{ cursor: 'pointer' }}>
            {trabajando ? 'Guardando…' : rest.logo_qr ? 'Cambiar logo' : 'Subir logo'}
            <input type="file" accept="image/*" hidden onChange={subirLogo} disabled={trabajando} />
          </label>
          {rest.logo_qr && <button className="btn btn-sec btn-chico" onClick={quitarLogo}>Quitar</button>}
        </div>
      </div>

      <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <Interruptor checked={rest.qr_pedidos} onChange={cambiarPedidos}>
          <b>Permitir pedir desde el celular</b>
          <small className="suave" style={{ display: 'block' }}>
            {rest.qr_pedidos
              ? 'Los pedidos llegan al salón como “por confirmar” y una persona del local los aprueba.'
              : 'Apagado: la carta es solo para mirar y llamar a la mesera.'}
          </small>
        </Interruptor>
        {hayBloqueos && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, background: 'var(--durazno)', border: '1px solid var(--borde-aviso)', color: 'var(--aviso-tinta)' }}>
            <span style={{ flex: 1, minWidth: 180 }}>🔒 Hay {nBloqueos} {nBloqueos === 1 ? 'código bloqueado' : 'códigos bloqueados'} por pedidos molestos.</span>
            <button className="btn btn-chico btn-sec" onClick={() => desbloquear({ todo: true })}>Desbloquear todos</button>
          </div>
        )}
        <button className="btn btn-principal btn-chico" style={{ justifySelf: 'start' }} onClick={() => imprimir([...mesas.map((m) => m.id), 'llevar'])}>
          🖨 Ver e imprimir todas
        </button>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
        {mesas.map((m) => (
          <Tarjeta
            key={m.id}
            titulo={`Mesa ${m.numero}`}
            sub={m.nombre}
            img={imgs[m.id]}
            url={urlCarta(rest.slug, m.qr_token)}
            bloqueoHasta={activo(m.qr_bloqueado_hasta)}
            onDesbloquear={() => desbloquear({ mesa: m.id })}
            onImprimir={() => imprimir([m.id])}
            onRegenerar={() => setRegenerar({ id: m.id, texto: `Mesa ${m.numero}` })}
          />
        ))}
        <Tarjeta
          titulo="🥡 Para llevar"
          sub="QR general del local"
          img={imgs.llevar}
          url={urlCarta(rest.slug, rest.qr_token_llevar)}
          bloqueoHasta={activo(rest.qr_llevar_bloqueado_hasta)}
          onDesbloquear={() => desbloquear({})}
          onImprimir={() => imprimir(['llevar'])}
          onRegenerar={() => setRegenerar({ id: null, texto: 'Para llevar' })}
        />
      </div>

      {mesas.length === 0 && <small className="suave">Primero crea las mesas en “Mesas y ajustes”.</small>}

      <Confirmar
        abierto={!!regenerar}
        titulo={`¿Crear un código nuevo para “${regenerar?.texto ?? ''}”?`}
        texto="El QR que ya está pegado dejará de funcionar y tendrás que imprimir y pegar el nuevo. Úsalo si alguien sacó una foto del código para abusar."
        textoConfirmar="Sí, crear código nuevo"
        trabajando={trabajando}
        onCancelar={() => setRegenerar(null)}
        onConfirmar={confirmarRegenerar}
      />
    </div>
  )
}

function Tarjeta({ titulo, sub, img, url, onImprimir, onRegenerar, bloqueoHasta, onDesbloquear }) {
  const min = bloqueoHasta ? Math.max(1, Math.ceil((new Date(bloqueoHasta) - new Date()) / 60000)) : 0
  return (
    <div className="tarjeta" style={{ padding: 12, display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' }}>
      <b>{titulo}</b>
      {sub ? <small className="suave">{sub}</small> : null}
      {bloqueoHasta && (
        <div style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
          <small style={{ fontWeight: 800, color: 'var(--rosa-tinta)' }}>🔒 Pedidos pausados · {min} min</small>
          <button className="btn btn-chico btn-principal" onClick={onDesbloquear}>Desbloquear</button>
        </div>
      )}
      {img ? <img src={img} alt={`QR de ${titulo}`} style={{ width: 150, height: 150, background: '#fff', borderRadius: 8 }} /> : <div style={{ width: 150, height: 150 }} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a className="btn btn-chico btn-sec" href={url} target="_blank" rel="noreferrer">Probar</a>
        <button className="btn btn-chico btn-sec" onClick={onImprimir}>Imprimir</button>
        <button className="btn btn-chico btn-sec" onClick={onRegenerar}>Renovar</button>
      </div>
    </div>
  )
}

// Pestaña "Carta y QR": la página que ven los clientes, sus platos con fotos y los códigos para imprimir.
// Las tres partes quedan montadas para no perder lo escrito al cambiar de una a otra.
export default function CodigosQR({ restaurante }) {
  const [parte, setParte] = useState('pagina')
  const [urlPrueba, setUrlPrueba] = useState('')

  useEffect(() => {
    supabase
      .from('restaurantes')
      .select('slug, qr_token_llevar')
      .eq('id', restaurante.id)
      .single()
      .then(({ data }) => data && setUrlPrueba(urlCarta(data.slug, data.qr_token_llevar)))
  }, [restaurante.id])

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0 }}>Carta y QR</h2>
        <small className="suave">La página que ven tus clientes al escanear el código. Todo lo editas tú, sin ayuda de nadie.</small>
      </div>
      <Segmento
        etiqueta="Sección"
        valor={parte}
        onChange={setParte}
        opciones={[['pagina', 'Mi página'], ['platos', 'Platos y fotos'], ['qr', 'Códigos QR']]}
      />
      <div style={{ display: parte === 'pagina' ? 'block' : 'none' }}><EditorCarta restaurante={restaurante} urlPrueba={urlPrueba} /></div>
      <div style={{ display: parte === 'platos' ? 'block' : 'none' }}><PlatosCarta restaurante={restaurante} /></div>
      <div style={{ display: parte === 'qr' ? 'block' : 'none' }}><SeccionQR restaurante={restaurante} /></div>
    </div>
  )
}
