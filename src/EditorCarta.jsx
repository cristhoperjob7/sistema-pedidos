import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Cargando, Confirmar, Interruptor, Mensaje } from './ui'
import { avisar, sentir } from './feedback'
import { borrarImagen, fotoOk, medirImagen, subirImagen } from './imagenes'

const VACIO = {
  eslogan: '',
  portada: null,
  portada_modo: 'rellenar', // 'rellenar' (recorta) o 'completa' (se ve entera sobre fondo difuminado)
  portada_x: 50,
  portada_y: 50,
  portada_vel: 30, // oscurecimiento de la foto, en %
  sobre: { activo: false, titulo: 'Sobre nosotros', texto: '', foto: null },
  galeria: { activo: false, titulo: 'Galería', fotos: [] },
  bloques: [],
  info: { activo: false, horario: '', direccion: '', telefono: '', whatsapp: '', instagram: '', wifi_red: '', wifi_clave: '' },
}

// Mezcla lo guardado con los valores por defecto (por si faltan campos).
const normalizar = (l) => ({
  ...VACIO,
  ...(l ?? {}),
  sobre: { ...VACIO.sobre, ...(l?.sobre ?? {}) },
  galeria: { ...VACIO.galeria, ...(l?.galeria ?? {}), fotos: l?.galeria?.fotos ?? [] },
  bloques: l?.bloques ?? [],
  info: { ...VACIO.info, ...(l?.info ?? {}) },
})

const nuevoId = () => Math.random().toString(36).slice(2, 10)

// Editor de la página que ven los clientes al escanear el QR. Todo es opcional y se puede borrar.
export default function EditorCarta({ restaurante, urlPrueba }) {
  const [l, setL] = useState(null)
  const [inicial, setInicial] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState('')
  const [quitarBloque, setQuitarBloque] = useState(null)
  const [avisoPortada, setAvisoPortada] = useState('')
  const porBorrar = useRef([]) // fotos reemplazadas o quitadas: se borran del almacenamiento al guardar

  useEffect(() => {
    supabase
      .from('restaurantes')
      .select('landing')
      .eq('id', restaurante.id)
      .single()
      .then(({ data, error }) => {
        if (error) return setError(error.message.includes('landing') ? 'Falta ejecutar paso24.sql en Supabase.' : error.message)
        const n = normalizar(data.landing)
        setL(n)
        setInicial(JSON.stringify(n))
      })
  }, [restaurante.id])

  if (!l) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={72} />

  const sucio = JSON.stringify(l) !== inicial
  const cambiar = (parche) => setL((x) => ({ ...x, ...parche }))
  const cambiarEn = (clave, parche) => setL((x) => ({ ...x, [clave]: { ...x[clave], ...parche } }))

  // Sube una foto y devuelve su dirección; la anterior queda marcada para borrarse al guardar.
  async function subir(clave, archivo, anterior, opciones) {
    if (!archivo) return null
    setError('')
    setSubiendo(clave)
    try {
      const url = await subirImagen(restaurante.id, archivo, opciones)
      if (anterior) porBorrar.current.push(anterior)
      return url
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setSubiendo('')
    }
  }
  const quitar = (url) => url && porBorrar.current.push(url)

  async function guardar() {
    setGuardando(true)
    setError('')
    const { error } = await supabase.rpc('guardar_landing', { p_restaurante: restaurante.id, p_landing: l })
    setGuardando(false)
    if (error) return setError(error.message.includes('guardar_landing') ? 'Falta ejecutar paso24.sql en Supabase.' : error.message)
    porBorrar.current.forEach(borrarImagen)
    porBorrar.current = []
    setInicial(JSON.stringify(l))
    sentir('toque', 'exito')
    avisar('Página guardada. Los clientes ya la ven así.', 'ok')
  }

  const agregarBloque = () =>
    cambiar({ bloques: [...l.bloques, { id: nuevoId(), titulo: '', texto: '', foto: null }] })
  const editarBloque = (id, parche) => cambiar({ bloques: l.bloques.map((b) => (b.id === id ? { ...b, ...parche } : b)) })

  return (
    <div style={{ display: 'grid', gap: 14, paddingBottom: 80 }}>
      <Mensaje tipo="error">{error}</Mensaje>

      {/* PORTADA */}
      <Bloque titulo="Portada" ayuda="Lo primero que ve el cliente: una foto grande, tu logo y una frase.">
        <FotoCampo
          url={l.portada}
          etiqueta="Foto de portada"
          alto={0}
          ocupado={subiendo === 'portada'}
          onSubir={async (f) => {
            setAvisoPortada('')
            if (f) {
              try {
                const { ancho } = await medirImagen(f)
                if (ancho < 1200) setAvisoPortada(`Esta foto es chica (${ancho} px de ancho) y puede verse borrosa en pantallas grandes. Lo ideal son 1920 px o más.`)
              } catch {
                /* el error de lectura lo muestra la subida */
              }
            }
            const u = await subir('portada', f, l.portada, { max: 2400, calidad: 0.9 })
            if (u) cambiar({ portada: u })
          }}
          onQuitar={() => { quitar(l.portada); cambiar({ portada: null }); setAvisoPortada('') }}
        />
        {avisoPortada && <Mensaje tipo="error">{avisoPortada}</Mensaje>}
        <small className="suave">
          Lo mejor es una foto horizontal de 1920 × 1080 px o más. Si es cuadrada o vertical, usa “Mostrar completa”.
        </small>

        {fotoOk(l.portada) && (
          <>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Cómo se ajusta</span>
              <div style={s.opciones}>
                {[['rellenar', 'Rellenar (recorta)'], ['completa', 'Mostrar completa']].map(([v, t]) => (
                  <button
                    key={v}
                    className={`btn btn-chico ${l.portada_modo === v ? 'btn-principal' : 'btn-sec'}`}
                    aria-pressed={l.portada_modo === v}
                    onClick={() => cambiar({ portada_modo: v })}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <small className="suave">
                {l.portada_modo === 'completa'
                  ? 'La foto se ve entera, sin recortes, con un fondo difuminado del mismo color.'
                  : 'La foto llena toda la portada y se recortan los bordes. Mueve el encuadre abajo.'}
              </small>
            </div>

            {l.portada_modo !== 'completa' && (
              <>
                <Rango etiqueta="Mover a los lados" izq="Izquierda" der="Derecha" valor={l.portada_x ?? 50} onCambio={(v) => cambiar({ portada_x: v })} />
                <Rango etiqueta="Mover arriba o abajo" izq="Arriba" der="Abajo" valor={l.portada_y ?? 50} onCambio={(v) => cambiar({ portada_y: v })} />
                <Rango etiqueta="Oscurecer la foto" izq="Nada" der="Mucho" max={70} valor={l.portada_vel ?? 30} onCambio={(v) => cambiar({ portada_vel: v })} />
              </>
            )}

            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Así se verá</span>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <VistaPortada l={l} ancho={230} razon="16 / 9" titulo="En computador" />
                <VistaPortada l={l} ancho={108} razon="9 / 16" titulo="En celular" />
              </div>
            </div>
          </>
        )}
        <Campo etiqueta="Frase bajo el nombre" max={120} valor={l.eslogan} onCambio={(v) => cambiar({ eslogan: v })} placeholder="Ej: Cocina peruana hecha con cariño" />
        <small className="suave">El logo se sube en la sección “Códigos QR”.</small>
      </Bloque>

      {/* NOVEDADES */}
      <Bloque titulo="Novedades y promociones" ayuda="Tarjetas que aparecen arriba de la carta: promos, plato del día, eventos… Puedes tener hasta 8.">
        {l.bloques.length === 0 && <small className="suave">Todavía no hay ninguna.</small>}
        {l.bloques.map((b, i) => (
          <div key={b.id} style={s.sub}>
            <div style={s.fila}>
              <b>Novedad {i + 1}</b>
              <button className="btn btn-chico btn-sec" onClick={() => setQuitarBloque(b)}>Eliminar</button>
            </div>
            <Campo etiqueta="Título" max={60} valor={b.titulo} onCambio={(v) => editarBloque(b.id, { titulo: v })} placeholder="Ej: Menú del día" />
            <Campo etiqueta="Texto" max={400} largo valor={b.texto} onCambio={(v) => editarBloque(b.id, { texto: v })} placeholder="Ej: Entrada + plato + postre por $9.990, de lunes a viernes." />
            <FotoCampo
              url={b.foto}
              etiqueta="Foto (opcional)"
              alto={100}
              ocupado={subiendo === b.id}
              onSubir={async (f) => {
                const u = await subir(b.id, f, b.foto)
                if (u) editarBloque(b.id, { foto: u })
              }}
              onQuitar={() => { quitar(b.foto); editarBloque(b.id, { foto: null }) }}
            />
          </div>
        ))}
        {l.bloques.length < 8 && (
          <button className="btn btn-sec btn-chico" style={{ justifySelf: 'start' }} onClick={agregarBloque}>＋ Agregar novedad</button>
        )}
      </Bloque>

      {/* SOBRE NOSOTROS */}
      <Bloque
        titulo="Sobre nosotros"
        ayuda="Tu historia en pocas líneas, con una foto."
        activo={l.sobre.activo}
        onActivo={(v) => cambiarEn('sobre', { activo: v })}
      >
        {l.sobre.activo && (
          <>
            <Campo etiqueta="Título" max={60} valor={l.sobre.titulo} onCambio={(v) => cambiarEn('sobre', { titulo: v })} />
            <Campo etiqueta="Texto" max={600} largo valor={l.sobre.texto} onCambio={(v) => cambiarEn('sobre', { texto: v })} placeholder="Cuenta quiénes son, desde cuándo y qué los hace especiales." />
            <FotoCampo
              url={l.sobre.foto}
              etiqueta="Foto"
              alto={110}
              ocupado={subiendo === 'sobre'}
              onSubir={async (f) => {
                const u = await subir('sobre', f, l.sobre.foto)
                if (u) cambiarEn('sobre', { foto: u })
              }}
              onQuitar={() => { quitar(l.sobre.foto); cambiarEn('sobre', { foto: null }) }}
            />
          </>
        )}
      </Bloque>

      {/* GALERÍA */}
      <Bloque
        titulo="Galería de fotos"
        ayuda="Fotos del local, de tus platos o del ambiente. Hasta 16."
        activo={l.galeria.activo}
        onActivo={(v) => cambiarEn('galeria', { activo: v })}
      >
        {l.galeria.activo && (
          <>
            <Campo etiqueta="Título" max={60} valor={l.galeria.titulo} onCambio={(v) => cambiarEn('galeria', { titulo: v })} />
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
              {l.galeria.fotos.map((u, i) => (
                <div key={u} style={{ position: 'relative' }}>
                  {fotoOk(u) && <img src={u} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, display: 'block' }} />}
                  <button
                    className="btn btn-chico btn-sec"
                    aria-label={`Quitar foto ${i + 1}`}
                    style={{ position: 'absolute', top: 4, right: 4, width: 28, height: 28, padding: 0 }}
                    onClick={() => { quitar(u); cambiarEn('galeria', { fotos: l.galeria.fotos.filter((x) => x !== u) }) }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {l.galeria.fotos.length < 16 && (
              <label className="btn btn-sec btn-chico" style={{ cursor: 'pointer', justifySelf: 'start' }}>
                {subiendo === 'galeria' ? 'Subiendo…' : '＋ Agregar fotos'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  disabled={!!subiendo}
                  onChange={async (e) => {
                    const archivos = [...(e.target.files ?? [])].slice(0, 16 - l.galeria.fotos.length)
                    e.target.value = ''
                    const nuevas = []
                    for (const f of archivos) {
                      const u = await subir('galeria', f, null)
                      if (u) nuevas.push(u)
                    }
                    if (nuevas.length) setL((x) => ({ ...x, galeria: { ...x.galeria, fotos: [...x.galeria.fotos, ...nuevas] } }))
                  }}
                />
              </label>
            )}
          </>
        )}
      </Bloque>

      {/* CONTACTO */}
      <Bloque
        titulo="Horario y contacto"
        ayuda="Para que el cliente te encuentre. Cada dato es opcional: lo que dejes vacío no se muestra."
        activo={l.info.activo}
        onActivo={(v) => cambiarEn('info', { activo: v })}
      >
        {l.info.activo && (
          <>
            <Campo etiqueta="Horario" max={300} largo valor={l.info.horario} onCambio={(v) => cambiarEn('info', { horario: v })} placeholder={'Lun a Vie: 12:00 – 22:00\nSáb y Dom: 12:00 – 23:00'} />
            <Campo etiqueta="Dirección" max={150} valor={l.info.direccion} onCambio={(v) => cambiarEn('info', { direccion: v })} placeholder="Calle y número, ciudad" />
            <div style={s.dos}>
              <Campo etiqueta="Teléfono" max={20} valor={l.info.telefono} onCambio={(v) => cambiarEn('info', { telefono: v })} placeholder="+56 9 1234 5678" />
              <Campo etiqueta="WhatsApp" max={20} valor={l.info.whatsapp} onCambio={(v) => cambiarEn('info', { whatsapp: v })} placeholder="+56 9 1234 5678" />
            </div>
            <Campo etiqueta="Instagram" max={40} valor={l.info.instagram} onCambio={(v) => cambiarEn('info', { instagram: v })} placeholder="@tulocal" />
            <div style={s.dos}>
              <Campo etiqueta="Wi‑Fi (nombre)" max={40} valor={l.info.wifi_red} onCambio={(v) => cambiarEn('info', { wifi_red: v })} />
              <Campo etiqueta="Wi‑Fi (clave)" max={40} valor={l.info.wifi_clave} onCambio={(v) => cambiarEn('info', { wifi_clave: v })} />
            </div>
            <small className="suave">Ojo: la clave del Wi‑Fi queda visible para cualquiera que abra la carta.</small>
          </>
        )}
      </Bloque>

      <div className="tarjeta" style={{ padding: 12, display: 'grid', gap: 6 }}>
        <small className="suave">
          Los platos, precios, fotos y descripciones se editan en la pestaña “Platos y fotos”. Las categorías se crean en Menú.
        </small>
        {urlPrueba && (
          <a className="btn btn-sec btn-chico" style={{ justifySelf: 'start' }} href={urlPrueba} target="_blank" rel="noreferrer">
            Ver cómo la ve el cliente
          </a>
        )}
      </div>

      <div style={s.barra}>
        <span className="suave" style={{ fontSize: 13 }}>{sucio ? 'Tienes cambios sin guardar' : 'Todo guardado'}</span>
        <button className="btn btn-principal" disabled={!sucio || guardando || !!subiendo} onClick={guardar}>
          {guardando ? <span className="puntos">Guardando</span> : 'Guardar página'}
        </button>
      </div>

      <Confirmar
        abierto={!!quitarBloque}
        titulo="¿Eliminar esta novedad?"
        texto={quitarBloque?.titulo ? `Se quita “${quitarBloque.titulo}” de la carta cuando guardes.` : 'Se quita de la carta cuando guardes.'}
        onCancelar={() => setQuitarBloque(null)}
        onConfirmar={() => {
          quitar(quitarBloque.foto)
          cambiar({ bloques: l.bloques.filter((b) => b.id !== quitarBloque.id) })
          setQuitarBloque(null)
        }}
      />
    </div>
  )
}

// Vista previa de cómo queda recortada la portada en una pantalla de esa proporción.
function VistaPortada({ l, ancho, razon, titulo }) {
  const completa = l.portada_modo === 'completa'
  const vel = (l.portada_vel ?? 30) / 100
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 4, width: ancho }}>
      <div style={{ position: 'relative', width: ancho, aspectRatio: razon, borderRadius: 10, overflow: 'hidden', background: '#111' }}>
        {completa ? (
          <>
            <img src={l.portada} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(10px) brightness(.55)', transform: 'scale(1.2)' }} />
            <img src={l.portada} alt="" style={{ position: 'absolute', inset: '10% 8% 38%', width: '84%', height: '52%', objectFit: 'contain', borderRadius: 6 }} />
          </>
        ) : (
          <>
            <img src={l.portada} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${l.portada_x ?? 50}% ${l.portada_y ?? 50}%` }} />
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 45%, var(--fondo) 100%), rgba(0,0,0,${vel})` }} />
          </>
        )}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 6, textAlign: 'center', color: '#fff', fontWeight: 800, fontSize: 9, textShadow: '0 1px 4px rgba(0,0,0,.7)' }}>Tu local</div>
      </div>
      <figcaption className="suave" style={{ fontSize: 12 }}>{titulo}</figcaption>
    </figure>
  )
}

function Rango({ etiqueta, izq, der, valor, onCambio, max = 100 }) {
  return (
    <label style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{etiqueta}</span>
      <input type="range" min={0} max={max} step={1} value={valor} onChange={(e) => onCambio(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--marca)' }} />
      <span className="suave" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span>{izq}</span>
        <span>{der}</span>
      </span>
    </label>
  )
}

function Bloque({ titulo, ayuda, activo, onActivo, children }) {
  const conInterruptor = typeof onActivo === 'function'
  return (
    <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <div>
        {conInterruptor ? (
          <Interruptor checked={!!activo} onChange={onActivo}>
            <b>{titulo}</b>
          </Interruptor>
        ) : (
          <b>{titulo}</b>
        )}
        <small className="suave" style={{ display: 'block' }}>{ayuda}</small>
      </div>
      {children}
    </div>
  )
}

function Campo({ etiqueta, valor, onCambio, max, largo = false, placeholder }) {
  const Etiqueta = largo ? 'textarea' : 'input'
  return (
    <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{etiqueta}</span>
      <Etiqueta
        className="campo-chico"
        style={largo ? { minHeight: 76, resize: 'vertical', fontFamily: 'inherit' } : undefined}
        maxLength={max}
        placeholder={placeholder}
        value={valor ?? ''}
        onChange={(e) => onCambio(e.target.value)}
      />
    </label>
  )
}

function FotoCampo({ url, etiqueta, alto, onSubir, onQuitar, ocupado }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{etiqueta}</span>
      {fotoOk(url) && (
        <img src={url} alt="" style={alto ? { width: '100%', maxHeight: alto * 1.6, height: alto, objectFit: 'cover', borderRadius: 12 } : { maxWidth: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 12, justifySelf: 'start' }} />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="btn btn-sec btn-chico" style={{ cursor: 'pointer' }}>
          {ocupado ? 'Subiendo…' : url ? 'Cambiar foto' : 'Subir foto'}
          <input type="file" accept="image/*" hidden disabled={ocupado} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onSubir(f) }} />
        </label>
        {url && <button className="btn btn-sec btn-chico" onClick={onQuitar}>Quitar</button>}
      </div>
    </div>
  )
}

const s = {
  opciones: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  sub: { display: 'grid', gap: 8, padding: 12, borderRadius: 14, background: 'var(--sup)', border: '1px solid var(--linea)' },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  dos: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  barra: { position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px calc(10px + var(--seguro-abajo, 0px))', background: 'var(--fondo)', borderTop: '1px solid var(--linea)', zIndex: 10 },
}
