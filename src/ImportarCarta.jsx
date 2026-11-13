import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Mensaje, Segmento } from './ui'
import { avisar, sentir, sonar, vibrar } from './feedback'
import Icono from './iconos'
import { crearXLSX, descargar, leerArchivo } from './excel'
import { hojasDeCarta, interpretarCarta, paraEnviar } from './cartaExcel'
import './orden.css'

// Baja la carta actual en Excel (si no hay carta, baja la plantilla vacía).
export function descargarCartaExcel(restaurante, cats, prods) {
  sentir('toque')
  const nombre = prods.length ? `Carta ${restaurante.nombre}.xlsx` : 'Plantilla carta.xlsx'
  descargar(crearXLSX(hojasDeCarta(cats, prods, restaurante)), nombre.replace(/[\\/:*?"<>|]/g, ''))
}

const ESTADOS = {
  nuevo: ['Nuevo', 'var(--menta-tinta)'],
  actualiza: ['Cambia', 'var(--aviso-tinta)'],
  igual: ['Sin cambios', 'var(--suave)'],
}

// Ventana para importar la carta desde un Excel: elegir archivo → vista previa → importar.
export default function ImportarCarta({ restaurante, cats, prods, onCerrar, onListo }) {
  const [hojas, setHojas] = useState(null)
  const [archivo, setArchivo] = useState('')
  const [leyendo, setLeyendo] = useState(false)
  const [reemplazar, setReemplazar] = useState(false)
  const [verIguales, setVerIguales] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState(null)
  const entrada = useRef(null)

  useEffect(() => {
    const tecla = (e) => e.key === 'Escape' && !guardando && onCerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [guardando, onCerrar])

  const r = useMemo(() => (hojas ? interpretarCarta(hojas, { cats, prods, restaurante, reemplazar }) : null), [hojas, cats, prods, restaurante, reemplazar])
  const ok = r && !r.error
  const porHacer = ok ? r.resumen.nuevos + r.resumen.actualiza + r.desactivar.length + r.categoriasNuevas.length : 0
  const visibles = ok ? r.filas.filter((x) => verIguales || x.estado !== 'igual') : []

  async function elegir(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    setHecho(null)
    setLeyendo(true)
    try {
      const l = await leerArchivo(f)
      setHojas(l.hojas)
      setArchivo(f.name)
      sentir('toque', 'tic')
    } catch (err) {
      setHojas(null)
      setError(err.message || 'No se pudo leer el archivo.')
      sentir('aviso')
    }
    setLeyendo(false)
  }

  async function importar() {
    if (!ok || !r.filas.length) return
    setGuardando(true)
    setError('')
    const { data, error } = await supabase.rpc('importar_carta', {
      p_restaurante: restaurante.id,
      p_filas: paraEnviar(r),
      p_reemplazar: reemplazar,
    })
    setGuardando(false)
    if (error) {
      sentir('aviso')
      return setError(error.message)
    }
    vibrar('exito')
    sonar('exito')
    avisar('Carta importada')
    setHecho(data)
    onListo()
  }

  const chip = (n, texto, color) => (
    <span style={{ ...s.chip, color }}>
      <b style={{ fontSize: 20 }}>{n}</b> {texto}
    </span>
  )

  return createPortal(
    <div className="hoja-velo funde" style={{ alignItems: 'center', padding: 12, zIndex: 95 }} onClick={() => !guardando && onCerrar()}>
      <div
        className="hoja sube"
        role="dialog"
        aria-modal="true"
        aria-label="Importar la carta desde Excel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, borderRadius: 24, borderBottom: '1px solid var(--linea)', overflowY: 'auto', padding: 20, display: 'grid', gap: 14, alignContent: 'start' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <b style={{ fontSize: 19, flex: 1 }}>Importar la carta desde Excel</b>
          <button className="btn btn-fantasma" aria-label="Cerrar" disabled={guardando} onClick={onCerrar}>
            <Icono n="cerrar" tam={20} />
          </button>
        </div>

        {hecho ? (
          <div className="aparece" style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0, fontWeight: 800, color: 'var(--menta-tinta)' }}>
              <Icono n="check" tam={16} className="it" /> La carta quedó importada.
            </p>
            <div style={s.chips}>
              {chip(hecho.nuevos, 'productos nuevos', 'var(--menta-tinta)')}
              {chip(hecho.actualizados, 'actualizados', 'var(--aviso-tinta)')}
              {hecho.categorias_nuevas > 0 && chip(hecho.categorias_nuevas, 'categorías nuevas', 'var(--tinta)')}
              {hecho.desactivados > 0 && chip(hecho.desactivados, 'quedaron no disponibles', 'var(--rosa-tinta)')}
            </div>
            <small className="suave">Las fotos de los platos se agregan en «Carta y QR».</small>
            <button className="btn btn-principal" onClick={onCerrar}>Listo</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 8 }}>
              <small className="suave">
                Sube un Excel (.xlsx) o un CSV con al menos las columnas <b>Categoría</b>, <b>Producto</b> y <b>Precio</b>. Lo más fácil es bajar la
                carta actual en Excel, editarla y volver a subirla. Antes de guardar verás qué va a cambiar.
              </small>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-principal" disabled={leyendo || guardando} onClick={() => entrada.current?.click()}>
                  {leyendo ? <span className="puntos">Leyendo</span> : archivo ? 'Elegir otro archivo' : 'Elegir archivo'}
                </button>
                <button className="btn btn-sec" disabled={guardando} onClick={() => descargarCartaExcel(restaurante, cats, prods)}>
                  {prods.length ? 'Descargar la carta actual' : 'Descargar plantilla'}
                </button>
              </div>
              <input
                ref={entrada}
                type="file"
                accept=".xlsx,.csv,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                style={{ display: 'none' }}
                onChange={elegir}
              />
              {archivo && <small className="suave">Archivo: <b>{archivo}</b>{ok && r.hoja !== 'CSV' ? ` · hoja «${r.hoja}»` : ''}</small>}
            </div>

            <Mensaje tipo="error">{error || (r?.error ?? '')}</Mensaje>

            {ok && (
              <div className="aparece" style={{ display: 'grid', gap: 12 }}>
                <div style={s.chips}>
                  {chip(r.resumen.nuevos, 'nuevos', 'var(--menta-tinta)')}
                  {chip(r.resumen.actualiza, 'cambian', 'var(--aviso-tinta)')}
                  {chip(r.resumen.iguales, 'sin cambios', 'var(--suave)')}
                  {r.errores.length > 0 && chip(r.errores.length, 'con errores', 'var(--rosa-tinta)')}
                </div>
                {r.categoriasNuevas.length > 0 && (
                  <small>
                    Categorías nuevas: <b>{r.categoriasNuevas.join(', ')}</b>
                  </small>
                )}

                <div style={{ display: 'grid', gap: 6 }}>
                  <b style={{ fontSize: 15 }}>¿Cómo importar?</b>
                  <Segmento
                    etiqueta="Modo de importación"
                    valor={reemplazar}
                    onChange={setReemplazar}
                    opciones={[
                      [false, 'Agregar y actualizar'],
                      [true, 'Reemplazar la carta'],
                    ]}
                  />
                  <small className="suave">
                    {reemplazar
                      ? 'Lo que no esté en el Excel queda «no disponible» (no se borra, para no perder las ventas pasadas).'
                      : 'Se agregan los productos nuevos y se actualizan los que ya existen. No se quita nada.'}
                  </small>
                  {reemplazar && r.desactivar.length > 0 && (
                    <p className="nota aparece" style={{ margin: 0 }}>
                      <Icono n="alerta" tam={15} className="it" /> Quedarán no disponibles {r.desactivar.length} producto{r.desactivar.length === 1 ? '' : 's'}:{' '}
                      {r.desactivar.slice(0, 8).map((p) => p.nombre).join(', ')}
                      {r.desactivar.length > 8 ? ` y ${r.desactivar.length - 8} más` : ''}.
                    </p>
                  )}
                </div>

                {r.errores.length > 0 && (
                  <div style={s.errores}>
                    <b style={{ color: 'var(--rosa-tinta)' }}>Estas filas no se importarán:</b>
                    {r.errores.slice(0, 30).map((x) => (
                      <small key={x.fila}>
                        Fila {x.fila} · <b>{x.producto}</b>: {x.mensaje}
                      </small>
                    ))}
                    {r.errores.length > 30 && <small>…y {r.errores.length - 30} más.</small>}
                    <small className="suave">Corrígelas en el Excel y vuelve a subirlo, o importa sin ellas.</small>
                  </div>
                )}

                {r.filas.length > 0 && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 15 }}>Vista previa</b>
                      {r.resumen.iguales > 0 && (
                        <button className="btn btn-chico btn-fantasma" onClick={() => setVerIguales((v) => !v)}>
                          {verIguales ? 'Ocultar los sin cambios' : `Ver también los ${r.resumen.iguales} sin cambios`}
                        </button>
                      )}
                    </div>
                    <div style={s.lista}>
                      {visibles.length === 0 && <small className="suave" style={{ padding: 10 }}>No hay cambios en los productos.</small>}
                      {visibles.slice(0, 300).map((x) => (
                        <div key={x.fila} style={s.fila}>
                          <span style={{ ...s.estado, color: ESTADOS[x.estado][1] }}>{ESTADOS[x.estado][0]}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <b>{x.producto}</b> <small className="suave">· {x.categoria}</small>
                            {x.cambios.length > 0 && <small className="suave" style={{ display: 'block' }}>{x.cambios.join(' · ')}</small>}
                          </span>
                          <b className="numero">{formatear(x.precio, restaurante)}</b>
                        </div>
                      ))}
                      {visibles.length > 300 && <small className="suave" style={{ padding: 10 }}>…y {visibles.length - 300} más.</small>}
                    </div>
                  </div>
                )}

                <button className="btn btn-principal btn-grande" disabled={guardando || r.filas.length === 0 || porHacer === 0} onClick={importar}>
                  {guardando ? (
                    <span className="puntos">Importando</span>
                  ) : r.filas.length === 0 ? (
                    'No hay filas válidas para importar'
                  ) : porHacer === 0 ? (
                    'La carta ya está igual que el Excel'
                  ) : reemplazar && r.desactivar.length > 0 ? (
                    `Importar y dejar ${r.desactivar.length} no disponible${r.desactivar.length === 1 ? '' : 's'}`
                  ) : (
                    `Importar ${r.resumen.nuevos + r.resumen.actualiza} producto${r.resumen.nuevos + r.resumen.actualiza === 1 ? '' : 's'}`
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

const s = {
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: { display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '8px 12px', borderRadius: 14, background: 'var(--fondo, transparent)', border: '1px solid var(--linea)', fontWeight: 700 },
  errores: { display: 'grid', gap: 4, padding: 12, borderRadius: 14, border: '1px solid var(--rosa-tinta)', maxHeight: 200, overflowY: 'auto' },
  lista: { display: 'grid', maxHeight: 320, overflowY: 'auto', border: '1px solid var(--linea)', borderRadius: 14 },
  fila: { display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 12px', borderTop: '1px solid var(--linea)' },
  estado: { flex: 'none', width: 82, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.03em' },
}
