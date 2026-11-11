import { formatear } from './moneda'

// =============================================================================================
// PDF DEL CIERRE DE CAJA (una sola hoja A4, solo lo que el dueño necesita saber).
// Abre una ventana con el informe listo y el diálogo de impresión: ahí se elige "Guardar como PDF".
// (No usa librerías: es una página con estilos de impresión, igual que las tarjetas QR.)
//
// Orden de la hoja, de lo más a lo menos importante:
//   1. Cuánto se vendió        2. Si el efectivo cuadra       3. Cómo pagaron
//   4. Lo que hay que revisar  5. Cajas de las meseras        6. Firmas
// =============================================================================================

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const esEfectivo = (n) => /(efectivo|cash)/i.test(n ?? '')
const esHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)
const mayus = (x) => x.charAt(0).toUpperCase() + x.slice(1)

export function abrirPDFCaja({ restaurante, dia, res, turnos = [], cierre }) {
  const $ = (v) => formatear(v, restaurante)
  const zona = restaurante.zona_horaria || 'America/Santiago'
  const hora = (iso) => new Date(iso).toLocaleTimeString('es-CL', { timeStyle: 'short', timeZone: zona })
  const marca = esHex(restaurante.color_marca) ? restaurante.color_marca : '#2f6fe0'

  const metodos = res.metodos ?? []
  const ventas = metodos.reduce((n, m) => n + Number(m.ventas), 0)
  const propinas = metodos.reduce((n, m) => n + Number(m.propinas), 0)
  const cuentas = metodos.reduce((n, m) => n + Number(m.pedidos), 0)
  const ticket = cuentas ? ventas / cuentas : 0
  const efectivoCobrado = metodos.filter((m) => esEfectivo(m.nombre)).reduce((n, m) => n + Number(m.ventas) + Number(m.propinas), 0)
  const anulado = Number(res.anulado ?? 0)
  const abiertas = Number(res.abiertos ?? 0)

  const fecha = mayus(new Date(dia + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  const emitido = new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: zona })
  const cerrada = !!cierre

  // ---- Cuadre de efectivo ----
  const dif = cierre?.diferencia == null ? null : Number(cierre.diferencia)
  const cuadra = dif !== null && Math.abs(dif) < 0.005
  const textoDif = dif === null ? 'No se contó el efectivo' : cuadra ? 'Cuadra perfecto' : dif > 0 ? `Sobran ${$(dif)}` : `Faltan ${$(-dif)}`
  const claseDif = dif === null ? 'neutro' : cuadra ? 'ok' : 'mal'

  // ---- Qué hay que revisar (solo aparece lo que importa) ----
  const alertas = []
  if (!cerrada) alertas.push(['aviso', 'La caja de este día todavía no está cerrada. Las cifras pueden cambiar.'])
  if (abiertas > 0) alertas.push(['mal', `Hay ${abiertas} cuenta${abiertas === 1 ? '' : 's'} abierta${abiertas === 1 ? '' : 's'} sin cobrar.`])
  if (cerrada && dif !== null && !cuadra) alertas.push(['mal', `Diferencia en el efectivo del día: ${textoDif.toLowerCase()}.`])
  if (anulado > 0) alertas.push(['aviso', `Se anuló ${$(anulado)} en productos o cuentas durante el día.`])
  const sinCerrar = turnos.filter((t) => t.cerrado_en == null)
  if (sinCerrar.length) alertas.push(['mal', `Cajas de meseras sin cerrar: ${sinCerrar.map((t) => esc(t.nombre)).join(', ')}.`])
  turnos
    .filter((t) => t.cerrado_en != null && t.diferencia != null && Math.abs(Number(t.diferencia)) >= 0.005)
    .forEach((t) => alertas.push(['aviso', `${esc(t.nombre)}: ${Number(t.diferencia) > 0 ? 'sobran' : 'faltan'} ${$(Math.abs(Number(t.diferencia)))} en su caja.`]))
  if (cierre?.nota) alertas.push(['info', `Nota del cierre: ${esc(cierre.nota)}`])

  const filasMetodos = metodos
    .filter((m) => Number(m.ventas) > 0 || Number(m.pedidos) > 0)
    .map((m) => {
      const pct = ventas ? Math.round((Number(m.ventas) / ventas) * 100) : 0
      return `<tr><td>${esc(m.nombre)}</td><td class="num sm">${m.pedidos} cuenta${Number(m.pedidos) === 1 ? '' : 's'}</td>
        <td class="barra"><span style="width:${pct}%"></span></td><td class="num">${pct}%</td><td class="num"><b>${$(m.ventas)}</b></td></tr>`
    })
    .join('')

  const MAX = 8
  const filasTurnos = turnos
    .slice(0, MAX)
    .map((t) => {
      const cerr = t.cerrado_en != null
      const d = cerr && t.diferencia != null ? Number(t.diferencia) : null
      return `<tr><td>${esc(t.nombre)}</td>
        <td class="sm">${hora(t.abierto_en)}${cerr ? ' – ' + hora(t.cerrado_en) : ' · abierta'}</td>
        <td class="num">${$(t.fondo_inicial)}</td>
        <td class="num">${cerr ? $(t.ventas_total ?? 0) : '—'}</td>
        <td class="num">${cerr && t.efectivo_contado != null ? $(t.efectivo_contado) : '—'}</td>
        <td class="num ${d === null ? '' : Math.abs(d) < 0.005 ? 'ok' : 'mal'}"><b>${d === null ? '—' : Math.abs(d) < 0.005 ? 'Cuadra' : (d > 0 ? '+' : '−') + $(Math.abs(d))}</b></td></tr>`
    })
    .join('')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Cierre de caja ${esc(dia)} · ${esc(restaurante.nombre)}</title>
<style>
  @page { size: A4; margin: 11mm }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  body { margin: 0; font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: #14181f; font-size: 10.5pt; line-height: 1.3 }
  .barra-pantalla { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: center; padding: 10px; background: #14181f; color: #fff; font-size: 14px }
  .barra-pantalla button { border: 0; border-radius: 8px; padding: 8px 16px; font-weight: 700; font-size: 14px; background: #fff; cursor: pointer }
  @media print { .barra-pantalla { display: none } }
  .hoja { max-width: 188mm; margin: 0 auto; padding: 4mm 0 }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; padding-bottom: 10px; border-bottom: 3px solid ${marca} }
  h1 { margin: 0; font-size: 20pt; letter-spacing: -.01em }
  .rest { font-size: 11pt; color: #4b5565; font-weight: 700 }
  .estado { padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 9.5pt; white-space: nowrap }
  .estado.cerrada { background: #dcf5e9; color: #0d6b47 }
  .estado.abierta { background: #fff0d6; color: #8a4b00 }
  .fecha { margin-top: 2px; color: #4b5565 }
  h2 { margin: 12px 0 5px; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .1em; color: #5b6676 }
  .kpis { display: grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 8px; margin-top: 12px }
  .kpi { border: 1px solid #d9dfe8; border-radius: 10px; padding: 10px 12px }
  .kpi.grande { background: ${marca}; border-color: ${marca}; color: #fff }
  .kpi small { display: block; font-size: 9pt; opacity: .8 }
  .kpi b { display: block; font-size: 17pt; line-height: 1.15; font-variant-numeric: tabular-nums }
  .kpi.grande b { font-size: 24pt }
  .propina { margin-top: 6px; font-size: 9pt; color: #5b6676 }
  table { width: 100%; border-collapse: collapse }
  td, th { padding: 5px 6px; border-bottom: 1px solid #e6eaf0; text-align: left; vertical-align: middle }
  th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .06em; color: #5b6676; font-weight: 700 }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap }
  .sm { font-size: 9pt; color: #5b6676 }
  .barra { width: 28% }
  .barra span { display: block; height: 7px; border-radius: 4px; background: ${marca} }
  .cuadre { border: 1px solid #d9dfe8; border-radius: 10px; padding: 4px 12px }
  .cuadre .f { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eef1f5 }
  .cuadre .f:last-child { border-bottom: 0 }
  .cuadre .res { margin: 4px -12px -4px; padding: 10px 12px; border-radius: 0 0 9px 9px; font-weight: 800; font-size: 13pt; display: flex; justify-content: space-between }
  .res.ok { background: #dcf5e9; color: #0d6b47 } .res.mal { background: #fde3e3; color: #a61e1e } .res.neutro { background: #eef1f5; color: #4b5565 }
  td.ok, .ok b { color: #0d6b47 } td.mal, .mal b { color: #a61e1e }
  .alertas { display: grid; gap: 5px }
  .al { padding: 7px 10px; border-radius: 8px; font-size: 10pt; border-left: 4px solid }
  .al.mal { background: #fde3e3; border-color: #d33; color: #7d1414 }
  .al.aviso { background: #fff3dc; border-color: #e09100; color: #6b4300 }
  .al.info { background: #eef1f5; border-color: #8a94a6; color: #333b49 }
  .al.bien { background: #e3f7ec; border-color: #1f9d6a; color: #0d6b47 }
  .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 14px }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 26px }
  .firmas div { border-top: 1px solid #14181f; padding-top: 4px; font-size: 9pt; color: #5b6676 }
  footer { margin-top: 14px; font-size: 8.5pt; color: #8a94a6; display: flex; justify-content: space-between }
  section { break-inside: avoid }
</style></head><body>
<div class="barra-pantalla"><span>Vista previa del cierre de caja</span><button onclick="window.print()">Guardar como PDF / Imprimir</button><span style="opacity:.7">Elige “Guardar como PDF” como destino</span></div>
<div class="hoja">
  <header>
    <div>
      <div class="rest">${esc(restaurante.nombre)}</div>
      <h1>Cierre de caja</h1>
      <div class="fecha">${esc(fecha)}</div>
    </div>
    <span class="estado ${cerrada ? 'cerrada' : 'abierta'}">${cerrada ? 'Caja cerrada ' + new Date(cierre.cerrado_en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: zona }) : 'PROVISORIO · sin cerrar'}</span>
  </header>

  <section class="kpis">
    <div class="kpi grande"><small>Total vendido</small><b>${$(ventas)}</b></div>
    <div class="kpi"><small>Cuentas cobradas</small><b>${cuentas}</b></div>
    <div class="kpi"><small>Ticket promedio</small><b>${$(ticket)}</b></div>
  </section>
  <div class="propina">Salón ${$(res.ventas_salon ?? 0)} · Para llevar ${$(res.ventas_llevar ?? 0)} &nbsp;|&nbsp; Propinas aparte: <b>${$(propinas)}</b> (pertenecen al personal; no están en el total vendido)</div>

  <section>
    <h2>Efectivo en caja</h2>
    <div class="cuadre">
      ${cerrada ? `<div class="f"><span>Fondo inicial</span><b>${$(cierre.fondo_inicial)}</b></div>` : ''}
      <div class="f"><span>Cobrado en efectivo (ventas + propinas)</span><b>${$(efectivoCobrado)}</b></div>
      ${cerrada ? `<div class="f"><span>Debería haber</span><b>${$(cierre.efectivo_esperado)}</b></div>
      <div class="f"><span>Contado</span><b>${cierre.efectivo_contado == null ? '—' : $(cierre.efectivo_contado)}</b></div>` : ''}
      <div class="res ${cerrada ? claseDif : 'neutro'}"><span>${cerrada ? 'Resultado' : 'Pendiente de cierre'}</span><span>${cerrada ? esc(textoDif) : '—'}</span></div>
    </div>
  </section>

  <section>
    <h2>Cómo pagaron</h2>
    ${filasMetodos ? `<table>${filasMetodos}</table>` : '<div class="sm">No hubo ventas este día.</div>'}
  </section>

  <section>
    <h2>Para revisar</h2>
    <div class="alertas">
      ${alertas.length ? alertas.map(([t, x]) => `<div class="al ${t}">${x}</div>`).join('') : '<div class="al bien">Sin observaciones: todo cuadra y no hay nada pendiente.</div>'}
    </div>
  </section>

  ${turnos.length ? `<section>
    <h2>Cajas de las meseras</h2>
    <table><tr><th>Quién</th><th>Horario</th><th class="num">Fondo</th><th class="num">Vendió</th><th class="num">Contó</th><th class="num">Resultado</th></tr>${filasTurnos}</table>
    ${turnos.length > MAX ? `<div class="sm" style="margin-top:4px">y ${turnos.length - MAX} caja(s) más, visibles en el sistema.</div>` : ''}
  </section>` : ''}

  <div class="firmas"><div>Cerrado por</div><div>Revisado por (dueño / administrador)</div></div>
  <footer><span>Emitido el ${esc(emitido)}</span><span>${esc(restaurante.nombre)} · Sistema de Pedidos</span></footer>
</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  return true
}
