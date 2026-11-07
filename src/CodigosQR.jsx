import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from './supabase'
import { Cargando, Confirmar, Interruptor, Mensaje } from './ui'
import { avisar, sentir } from './feedback'

// Dirección que lleva cada QR. Usa la misma página donde está instalada la app.
const urlCarta = (slug, token) =>
  `${window.location.origin}${window.location.pathname}#/carta/${encodeURIComponent(slug)}/${token}`

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Pantalla del admin: un QR por mesa (más uno para pedidos para llevar) listo para imprimir.
export default function CodigosQR({ restaurante }) {
  const [mesas, setMesas] = useState(null)
  const [rest, setRest] = useState(null)
  const [imgs, setImgs] = useState({}) // id -> data URL
  const [error, setError] = useState('')
  const [regenerar, setRegenerar] = useState(null) // { id|null, texto }
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    const [m, r] = await Promise.all([
      supabase.from('mesas').select('id, numero, nombre, qr_token').eq('restaurante_id', restaurante.id).eq('activo', true).order('numero'),
      supabase.from('restaurantes').select('slug, nombre, qr_pedidos, qr_token_llevar').eq('id', restaurante.id).single(),
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
    const tarjetas = [
      ...(mesas ?? []).filter((m) => ids.includes(m.id)).map((m) => ({
        titulo: `Mesa ${m.numero}`,
        sub: m.nombre,
        img: imgs[m.id],
        texto: rest.qr_pedidos ? 'Escanea para ver la carta y pedir' : 'Escanea para ver la carta',
      })),
      ...(ids.includes('llevar')
        ? [{ titulo: 'Pedidos para llevar', sub: '', img: imgs.llevar, texto: 'Escanea, elige y te avisamos cuando esté listo' }]
        : []),
    ]
    const w = window.open('', '_blank')
    if (!w) return setError('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.')
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Códigos QR</title>
<style>
  @page { size: A4; margin: 10mm }
  * { box-sizing: border-box } body { margin: 0; font-family: system-ui, sans-serif; color: #111 }
  .rejilla { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm }
  .t { border: 2px dashed #999; border-radius: 6mm; padding: 8mm 6mm; text-align: center; break-inside: avoid; height: 128mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3mm }
  .t h1 { margin: 0; font-size: 20pt } .t h2 { margin: 0; font-size: 28pt } .t p { margin: 0; font-size: 12pt; color: #333 } .t small { color: #555; font-size: 11pt }
  .t img { width: 70mm; height: 70mm }
</style></head><body><div class="rejilla">${tarjetas
      .map(
        (t) => `<div class="t"><h1>${esc(rest.nombre)}</h1><h2>${esc(t.titulo)}</h2>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}<img src="${t.img}" alt=""><p>${esc(t.texto)}</p></div>`
      )
      .join('')}</div><script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`)
    w.document.close()
  }

  if (!mesas || !rest) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={72} />

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0 }}>Códigos QR</h2>
        <small className="suave">Pega un QR en cada mesa. El cliente escanea, ve la carta, llama a la mesera y puede pedir.</small>
      </div>
      <Mensaje tipo="error">{error}</Mensaje>

      <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <Interruptor checked={rest.qr_pedidos} onChange={cambiarPedidos}>
          <b>Permitir pedir desde el celular</b>
          <small className="suave" style={{ display: 'block' }}>
            {rest.qr_pedidos
              ? 'Los pedidos llegan al salón como “por confirmar” y una persona del local los aprueba.'
              : 'Apagado: la carta es solo para mirar y llamar a la mesera.'}
          </small>
        </Interruptor>
        <button className="btn btn-principal btn-chico" style={{ justifySelf: 'start' }} onClick={() => imprimir([...mesas.map((m) => m.id), 'llevar'])}>
          🖨 Imprimir todos
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
            onImprimir={() => imprimir([m.id])}
            onRegenerar={() => setRegenerar({ id: m.id, texto: `Mesa ${m.numero}` })}
          />
        ))}
        <Tarjeta
          titulo="🥡 Para llevar"
          sub="QR general del local"
          img={imgs.llevar}
          url={urlCarta(rest.slug, rest.qr_token_llevar)}
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

function Tarjeta({ titulo, sub, img, url, onImprimir, onRegenerar }) {
  return (
    <div className="tarjeta" style={{ padding: 12, display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' }}>
      <b>{titulo}</b>
      {sub ? <small className="suave">{sub}</small> : null}
      {img ? <img src={img} alt={`QR de ${titulo}`} style={{ width: 150, height: 150, background: '#fff', borderRadius: 8 }} /> : <div style={{ width: 150, height: 150 }} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a className="btn btn-chico btn-sec" href={url} target="_blank" rel="noreferrer">Probar</a>
        <button className="btn btn-chico btn-sec" onClick={onImprimir}>Imprimir</button>
        <button className="btn btn-chico btn-sec" onClick={onRegenerar}>Renovar</button>
      </div>
    </div>
  )
}
