// =============================================================================================
// Excel sin librerías: lee archivos .xlsx y .csv, y genera .xlsx.
// Un .xlsx es un .zip con archivos XML adentro; aquí se abre y se arma a mano.
// Para descomprimir se usa DecompressionStream, que traen los navegadores actuales
// (Chrome/Edge, Safari 16.4+, Firefox 113+).
// =============================================================================================

// ---------------------------------------------------------------- lectura

// Devuelve { hojas: [{ nombre, filas: [[valor, ...], ...] }] }. Cada valor es número o texto.
export async function leerArchivo(archivo) {
  const nombre = (archivo.name || '').toLowerCase()
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  if (nombre.endsWith('.csv') || nombre.endsWith('.txt')) {
    return { hojas: [{ nombre: 'CSV', filas: leerCSV(new TextDecoder('utf-8').decode(bytes)) }] }
  }
  if (nombre.endsWith('.xls') && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new Error('Ese es el formato antiguo de Excel (.xls). Ábrelo en Excel y guárdalo como .xlsx (o como CSV) para poder importarlo.')
  }
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new Error('El archivo no parece un Excel (.xlsx) ni un CSV.')
  }
  return { hojas: await leerXLSX(bytes) }
}

function leerCSV(texto) {
  const t = texto.replace(/^﻿/, '')
  const primera = t.split(/\r?\n/, 1)[0] ?? ''
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : primera.includes('\t') && !primera.includes(',') ? '\t' : ','
  const filas = []
  let fila = []
  let campo = ''
  let comillas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') comillas = false
      else campo += c
    } else if (c === '"') comillas = true
    else if (c === sep) {
      fila.push(campo)
      campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ''
    } else campo += c
  }
  if (campo !== '' || fila.length) {
    fila.push(campo)
    filas.push(fila)
  }
  return filas
}

async function abrirZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let fin = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fin = i
      break
    }
  }
  if (fin < 0) throw new Error('El archivo Excel está dañado o incompleto.')
  const total = v.getUint16(fin + 10, true)
  let p = v.getUint32(fin + 16, true)
  const archivos = new Map()
  const dec = new TextDecoder('utf-8')
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const metodo = v.getUint16(p + 10, true)
    const tamComp = v.getUint32(p + 20, true)
    const largoNombre = v.getUint16(p + 28, true)
    const largoExtra = v.getUint16(p + 30, true)
    const largoComent = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const nombre = dec.decode(bytes.subarray(p + 46, p + 46 + largoNombre))
    archivos.set(nombre, { metodo, tamComp, local })
    p += 46 + largoNombre + largoExtra + largoComent
  }
  return async function leer(nombre) {
    const a = archivos.get(nombre)
    if (!a) return null
    const n = v.getUint16(a.local + 26, true)
    const e = v.getUint16(a.local + 28, true)
    const ini = a.local + 30 + n + e
    const datos = bytes.subarray(ini, ini + a.tamComp)
    if (a.metodo === 0) return dec.decode(datos)
    if (a.metodo !== 8) throw new Error('El Excel usa una compresión que no se puede leer. Guárdalo de nuevo como .xlsx.')
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador es muy antiguo para leer Excel. Usa un CSV o actualiza el navegador.')
    const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return dec.decode(await new Response(flujo).arrayBuffer())
  }
}

const xml = (texto) => new DOMParser().parseFromString(texto, 'application/xml')
const etiquetas = (nodo, nombre) => [...nodo.getElementsByTagNameNS('*', nombre)]

function columna(ref) {
  const letras = (ref.match(/^[A-Z]+/) || [''])[0]
  let n = 0
  for (const l of letras) n = n * 26 + (l.charCodeAt(0) - 64)
  return n - 1
}

async function leerXLSX(bytes) {
  const leer = await abrirZip(bytes)
  const libro = await leer('xl/workbook.xml')
  if (!libro) throw new Error('El archivo no tiene hojas de Excel.')
  const rels = xml((await leer('xl/_rels/workbook.xml.rels')) || '<Relationships/>')
  const destino = new Map(etiquetas(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]))

  const compartidos = []
  const ss = await leer('xl/sharedStrings.xml')
  if (ss) {
    for (const si of etiquetas(xml(ss), 'si')) {
      // Se juntan los trozos de texto, sin las guías fonéticas (rPh).
      compartidos.push(etiquetas(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''))
    }
  }

  const hojas = []
  for (const h of etiquetas(xml(libro), 'sheet')) {
    const id = h.getAttribute('r:id') || h.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    let ruta = destino.get(id) || ''
    ruta = ruta.startsWith('/') ? ruta.slice(1) : 'xl/' + ruta.replace(/^\.\//, '')
    const texto = await leer(ruta)
    if (!texto) continue
    const filas = []
    for (const f of etiquetas(xml(texto), 'row')) {
      const nFila = Number(f.getAttribute('r') || filas.length + 1) - 1
      const fila = []
      let sig = 0
      for (const c of etiquetas(f, 'c')) {
        const ref = c.getAttribute('r')
        const col = ref ? columna(ref) : sig
        sig = col + 1
        const t = c.getAttribute('t')
        const vNodo = etiquetas(c, 'v')[0]
        let valor = ''
        if (t === 's') valor = compartidos[Number(vNodo?.textContent)] ?? ''
        else if (t === 'inlineStr') valor = etiquetas(c, 't').map((x) => x.textContent).join('')
        else if (t === 'b') valor = vNodo?.textContent === '1' ? 'Sí' : 'No'
        else if (t === 'str' || t === 'e') valor = vNodo?.textContent ?? ''
        else if (vNodo) valor = Number(vNodo.textContent)
        fila[col] = valor
      }
      filas[nFila] = Array.from(fila, (x) => (x === undefined ? '' : x))
    }
    hojas.push({ nombre: h.getAttribute('name') || `Hoja ${hojas.length + 1}`, filas: Array.from(filas, (x) => x ?? []) })
  }
  return hojas
}

// ---------------------------------------------------------------- escritura

const escXML = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const letra = (i) => {
  let s = ''
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

// hojas: [{ nombre, filas: [[...]], anchos?: [n...], listas?: [{ col, valores: [...] }], encabezado?: true }]
export function crearXLSX(hojas) {
  const archivos = []
  const ct = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    '</Types>',
  ].join('')
  archivos.push(['[Content_Types].xml', ct])
  archivos.push([
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  ])
  archivos.push([
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      hojas.map((h, i) => `<sheet name="${escXML(h.nombre.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  ])
  archivos.push([
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  ])
  // Estilos: 0 normal · 1 encabezado (negrita, fondo) · 2 texto con ajuste de línea
  archivos.push([
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F6F43"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  ])
  hojas.forEach((h, i) => {
    const filas = h.filas
      .map((fila, r) => {
        const celdas = fila
          .map((v, c) => {
            if (v === '' || v == null) return ''
            const ref = `${letra(c)}${r + 1}`
            const estilo = h.encabezado && r === 0 ? ' s="1"' : h.ajustar ? ' s="2"' : ''
            if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${estilo}><v>${v}</v></c>`
            return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${escXML(v)}</t></is></c>`
          })
          .join('')
        return `<row r="${r + 1}">${celdas}</row>`
      })
      .join('')
    const ultimaFila = Math.max(h.filas.length, 2)
    const vistas = h.encabezado
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    const cols = h.anchos?.length ? '<cols>' + h.anchos.map((a, c) => `<col min="${c + 1}" max="${c + 1}" width="${a}" customWidth="1"/>`).join('') + '</cols>' : ''
    const listas = h.listas?.length
      ? `<dataValidations count="${h.listas.length}">` +
        h.listas
          .map(
            (l) =>
              `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Valor no válido" error="Elige un valor de la lista." sqref="${letra(l.col)}2:${letra(l.col)}${Math.max(ultimaFila, 1000)}"><formula1>"${escXML(l.valores.join(','))}"</formula1></dataValidation>`
          )
          .join('') +
        '</dataValidations>'
      : ''
    archivos.push([
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${vistas}${cols}<sheetData>${filas}</sheetData>${listas}</worksheet>`,
    ])
  })
  return new Blob([zipSinComprimir(archivos)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zipSinComprimir(archivos) {
  const enc = new TextEncoder()
  const partes = []
  const central = []
  let offset = 0
  // Fecha fija en formato DOS (1-1-2025, 00:00)
  const fecha = ((2025 - 1980) << 9) | (1 << 5) | 1
  for (const [nombre, contenido] of archivos) {
    const n = enc.encode(nombre)
    const d = enc.encode(contenido)
    const crc = crc32(d)
    const loc = new Uint8Array(30 + n.length)
    const lv = new DataView(loc.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // nombres en UTF-8
    lv.setUint16(8, 0, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, fecha, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, d.length, true)
    lv.setUint32(22, d.length, true)
    lv.setUint16(26, n.length, true)
    loc.set(n, 30)
    const cen = new Uint8Array(46 + n.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(14, fecha, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, d.length, true)
    cv.setUint32(24, d.length, true)
    cv.setUint16(28, n.length, true)
    cv.setUint32(42, offset, true)
    cen.set(n, 46)
    partes.push(loc, d)
    central.push(cen)
    offset += loc.length + d.length
  }
  const tamCentral = central.reduce((t, c) => t + c.length, 0)
  const fin = new Uint8Array(22)
  const fv = new DataView(fin.buffer)
  fv.setUint32(0, 0x06054b50, true)
  fv.setUint16(8, archivos.length, true)
  fv.setUint16(10, archivos.length, true)
  fv.setUint32(12, tamCentral, true)
  fv.setUint32(16, offset, true)
  return new Blob([...partes, ...central, fin])
}

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
