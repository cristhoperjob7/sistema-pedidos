import { formatear } from './moneda'

// =============================================================================================
// PRECUENTA: la cuenta para mostrarle al cliente ANTES de cobrar.
// Abre una ventana con un comprobante angosto (80 mm, sirve para impresora de boletas o para
// guardarlo como PDF). No cobra nada ni cambia la cuenta. No es una boleta: lo dice en el papel.
// =============================================================================================

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// lineas: [{ nombre, cantidad, total, nota? }]
// descuento: monto ya aplicado (0 si no hay). propinaPct: propina sugerida (voluntaria).
export function abrirPrecuenta({ restaurante, titulo, numero, lineas, subtotal, descuento = 0, motivoDescuento = '', propinaPct = 10 }) {
  const $ = (v) => formatear(v, restaurante)
  const decimales = restaurante.moneda_decimales ?? 0
  const redondear = (n) => Math.round(n * 10 ** decimales) / 10 ** decimales
  const zona = restaurante.zona_horaria || 'America/Santiago'
  const ahora = new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: zona })
  const origen = typeof window !== 'undefined' && window.location ? window.location.origin + window.location.pathname : '/'

  const neto = Math.max(0, subtotal - descuento)
  const propina = redondear((neto * propinaPct) / 100)

  const filas = lineas
    .map(
      (l) => `<tr>
        <td class="cant">${esc(l.cantidad)}</td>
        <td class="plato">${esc(l.nombre)}${l.nota ? `<small>${esc(l.nota)}</small>` : ''}</td>
        <td class="monto">${$(l.total)}</td>
      </tr>`
    )
    .join('')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Precuenta · ${esc(titulo)}</title>
<style>
  @page { size: 80mm 200mm; margin: 0 }
  * { box-sizing: border-box }
  body { margin: 0; background: #e9ecf1; color: #111; font: 13px/1.35 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .barra-pantalla { position: sticky; top: 0; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center; padding: 10px; background: #14181f; color: #fff; font-size: 14px }
  .barra-pantalla button { border: 0; border-radius: 8px; padding: 9px 16px; font-weight: 700; font-size: 14px; background: #fff; cursor: pointer }
  .barra-pantalla .volver { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.5) }
  .papel { width: 80mm; max-width: 100%; margin: 14px auto; padding: 4mm 3mm; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.15) }
  .centro { text-align: center }
  .rest { font-size: 16px; font-weight: 800 }
  h1 { margin: 6px 0 0; font-size: 15px; letter-spacing: .12em }
  .aviso { margin: 2px 0 8px; font-size: 10.5px; color: #555 }
  .datos { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; padding: 6px 0; border-top: 1px dashed #888; border-bottom: 1px dashed #888 }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 }
  td { padding: 3px 0; vertical-align: top }
  .cant { width: 8mm; font-weight: 700 }
  .monto { text-align: right; white-space: nowrap; padding-left: 6px }
  .plato small { display: block; color: #555; font-size: 10.5px }
  .suma { border-top: 1px dashed #888; padding-top: 6px; display: grid; gap: 3px }
  .suma div { display: flex; justify-content: space-between; gap: 8px }
  .suma .total { font-size: 17px; font-weight: 800; padding-top: 4px }
  .sug { margin-top: 8px; padding: 6px 8px; border: 1px dashed #888; border-radius: 6px; font-size: 12px; display: grid; gap: 3px }
  .sug div { display: flex; justify-content: space-between; gap: 8px }
  .sug .fuerte { font-weight: 800; font-size: 14px }
  .pie { margin-top: 10px; text-align: center; font-size: 11px; color: #555 }
  @media print {
    body { background: #fff }
    .barra-pantalla { display: none }
    html, body { width: 80mm; margin: 0 }
    .papel { width: 80mm; max-width: none; margin: 0; box-shadow: none }
    tr, .suma div, .sug { break-inside: avoid }
  }
</style></head><body>
<div class="barra-pantalla">
  <button class="volver" onclick="(function(){ if (window.opener) { window.close(); setTimeout(function(){ location.href = '${esc(origen)}' }, 300) } else { location.href = '${esc(origen)}' } })()">&larr; Volver al sistema</button>
  <button onclick="window.print()">Imprimir (papel 80 mm)</button>
  <span style="opacity:.75;font-size:12.5px">En la ventana de impresión elige la impresora de boletas. Para PDF, elige “Guardar como PDF”.</span>
</div>
<div class="papel">
  <div class="centro">
    <div class="rest">${esc(restaurante.nombre)}</div>
    <h1>PRECUENTA</h1>
    <div class="aviso">Documento informativo · no es una boleta</div>
  </div>
  <div class="datos"><span><b>${esc(titulo)}</b>${numero != null ? ` · Pedido #${esc(numero)}` : ''}</span><span>${esc(ahora)}</span></div>
  <table>${filas}</table>
  <div class="suma">
    ${descuento > 0 ? `<div><span>Subtotal</span><span>${$(subtotal)}</span></div>
    <div><span>Descuento${motivoDescuento ? ` (${esc(motivoDescuento)})` : ''}</span><span>− ${$(descuento)}</span></div>` : ''}
    <div class="total"><span>Total</span><span>${$(neto)}</span></div>
  </div>
  ${propinaPct > 0 ? `<div class="sug">
    <div><span>Propina sugerida ${esc(propinaPct)} %</span><span>${$(propina)}</span></div>
    <div class="fuerte"><span>Total con propina</span><span>${$(neto + propina)}</span></div>
    <small style="color:#555">La propina es voluntaria: el cliente decide si la deja y de cuánto.</small>
  </div>` : ''}
  <div class="pie">¡Gracias por su visita!</div>
</div>
<script>
  // El papel mide 80 mm de ancho y el largo justo de la cuenta (sin hoja en blanco al final).
  (function () {
    function ajustar() {
      var p = document.querySelector('.papel')
      var mm = Math.ceil(p.getBoundingClientRect().height * 25.4 / 96) + 2
      var st = document.getElementById('pagina') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'pagina' }))
      st.textContent = '@page { size: 80mm ' + mm + 'mm; margin: 0 }'
    }
    ajustar()
    window.addEventListener('beforeprint', ajustar)
  })()
</script>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  return true
}
