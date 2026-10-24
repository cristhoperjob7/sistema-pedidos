import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Admin from './Admin'
import Anclar from './Anclar'
import { Cargando, Desplegable, Mensaje } from './ui'
import { avisar, celebrar, sentir, sonar, vibrar } from './feedback'

// Monedas sugeridas. Los campos siguen siendo editables para usar cualquier otra.
const MONEDAS = [
  { codigo: 'CLP', simbolo: '$', decimales: 0, nombre: 'Peso chileno' },
  { codigo: 'PEN', simbolo: 'S/', decimales: 2, nombre: 'Sol peruano' },
  { codigo: 'USD', simbolo: 'US$', decimales: 2, nombre: 'Dólar estadounidense' },
  { codigo: 'ARS', simbolo: '$', decimales: 2, nombre: 'Peso argentino' },
  { codigo: 'COP', simbolo: '$', decimales: 0, nombre: 'Peso colombiano' },
  { codigo: 'MXN', simbolo: '$', decimales: 2, nombre: 'Peso mexicano' },
  { codigo: 'BRL', simbolo: 'R$', decimales: 2, nombre: 'Real brasileño' },
  { codigo: 'EUR', simbolo: '€', decimales: 2, nombre: 'Euro' },
]

function crearSlug(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Zona horaria: define cuándo empieza cada día (el número de pedido vuelve a 1).
const ZONAS = [
  ['America/Santiago', 'Chile'],
  ['America/Lima', 'Perú'],
  ['America/Bogota', 'Colombia'],
  ['America/Argentina/Buenos_Aires', 'Argentina'],
  ['America/Mexico_City', 'México (centro)'],
  ['America/Sao_Paulo', 'Brasil (Brasilia)'],
  ['America/New_York', 'EE. UU. (este)'],
  ['Europe/Madrid', 'España'],
]

const FORM_INICIAL = { nombre: '', slug: '', codigo: 'CLP', simbolo: '$', decimales: 0, zona: 'America/Santiago' }

export default function Superadmin() {
  const [lista, setLista] = useState(null)
  const [form, setForm] = useState(FORM_INICIAL)
  const [slugManual, setSlugManual] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [abierto, setAbierto] = useState(null)
  const [borrando, setBorrando] = useState(null) // id del restaurante que se está confirmando borrar
  const [claveBorrar, setClaveBorrar] = useState('')
  const [nombreBorrar, setNombreBorrar] = useState('')
  const [errorBorrar, setErrorBorrar] = useState('')
  const [eliminando, setEliminando] = useState(false)
  const [mostrarCrear, setMostrarCrear] = useState(false)

  async function cargar() {
    const { data, error } = await supabase.from('restaurantes').select('*').order('creado_en')
    if (error) setError(error.message)
    else setLista(data)
  }

  useEffect(() => {
    cargar()
  }, [])

  function cambiarNombre(nombre) {
    setForm((f) => ({ ...f, nombre, slug: slugManual ? f.slug : crearSlug(nombre) }))
  }

  function elegirMoneda(codigo) {
    const m = MONEDAS.find((x) => x.codigo === codigo)
    if (m) setForm((f) => ({ ...f, codigo: m.codigo, simbolo: m.simbolo, decimales: m.decimales }))
  }

  async function crear(e) {
    e.preventDefault()
    const boton = e.nativeEvent?.submitter
    setError('')
    if (!form.nombre.trim() || !form.slug.trim() || !form.codigo.trim() || !form.simbolo.trim()) {
      setError('Completa el nombre, el código, la moneda y el símbolo.')
      return
    }
    sentir('toque')
    setGuardando(true)
    const { error } = await supabase.from('restaurantes').insert({
      nombre: form.nombre.trim(),
      slug: form.slug.trim(),
      moneda_codigo: form.codigo.trim().toUpperCase(),
      moneda_simbolo: form.simbolo.trim(),
      moneda_decimales: Number(form.decimales),
      zona_horaria: form.zona,
    })
    setGuardando(false)
    if (error) {
      setError(error.code === '23505' ? 'Ese código de restaurante ya existe, usa otro.' : error.message)
      return
    }
    celebrar(boton)
    vibrar('exito')
    sonar('exito')
    avisar(`Restaurante "${form.nombre.trim()}" creado`)
    setForm(FORM_INICIAL)
    setSlugManual(false)
    setMostrarCrear(false)
    cargar()
  }

  async function alternar(r) {
    sentir('toque', 'tic')
    const { error } = await supabase.from('restaurantes').update({ activo: !r.activo }).eq('id', r.id)
    if (error) setError(error.message)
    else {
      avisar(r.activo ? `${r.nombre} desactivado` : `${r.nombre} activado`, r.activo ? 'info' : 'ok')
      cargar()
    }
  }

  async function cambiarZona(r, zona) {
    setError('')
    const { error } = await supabase.from('restaurantes').update({ zona_horaria: zona }).eq('id', r.id)
    if (error) setError(error.message)
    else {
      sentir('toque', 'tic')
      avisar('Zona horaria guardada')
      cargar()
    }
  }

  function alternarAdmin(r) {
    sentir('toque')
    setBorrando(null)
    setAbierto(abierto === r.id ? null : r.id)
  }

  function pedirBorrar(r) {
    sentir('aviso')
    setAbierto(null) // si estaba abierto "Administrar", se cierra para dejar ver la confirmación
    setBorrando(borrando === r.id ? null : r.id)
    setClaveBorrar('')
    setNombreBorrar('')
    setErrorBorrar('')
  }

  function cancelarBorrar() {
    setBorrando(null)
    setClaveBorrar('')
    setNombreBorrar('')
    setErrorBorrar('')
  }

  async function confirmarBorrar(r) {
    setErrorBorrar('')
    if (nombreBorrar.trim() !== r.nombre.trim()) {
      setErrorBorrar('El nombre no coincide. Escríbelo exactamente igual para confirmar.')
      return
    }
    if (!claveBorrar) {
      setErrorBorrar('Ingresa tu contraseña de superadmin para confirmar.')
      return
    }
    sentir('aviso')
    setEliminando(true)
    // Vuelve a validar tu propia clave antes de borrar nada (paso de seguridad).
    const { data: quien } = await supabase.auth.getUser()
    const correo = quien?.user?.email
    const { error: errorClave } = await supabase.auth.signInWithPassword({ email: correo, password: claveBorrar })
    if (errorClave) {
      setEliminando(false)
      setErrorBorrar('Contraseña incorrecta.')
      return
    }
    const { error } = await supabase.from('restaurantes').delete().eq('id', r.id)
    setEliminando(false)
    if (error) {
      setErrorBorrar(error.message)
      return
    }
    cancelarBorrar()
    sonar('baja')
    avisar(`"${r.nombre}" eliminado con todos sus datos`, 'borrar')
    cargar()
  }

  const ejemplo = `${form.simbolo} ${(12.5).toFixed(Number(form.decimales) || 0)}`
  // Mientras se administra o se confirma borrar un restaurante, "Crear restaurante" se esconde
  // (encogiéndose, no de golpe) para no competir visualmente con esa tarea.
  const hayPanelAbierto = abierto !== null || borrando !== null

  if (!lista) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={2} alto={110} />

  return (
    <div style={s.pagina}>
      <h2 style={{ margin: '0 0 4px' }}>
        Restaurantes{' '}
        <small className="suave" style={{ fontWeight: 700 }}>
          · <span key={lista.length} className="contador-pop">{lista.length}</span>
        </small>
      </h2>
      <Mensaje tipo="error">{error}</Mensaje>

      {lista.length === 0 && (
        <div className="vacio">
          <span className="vacio-icono">🏪</span>
          <b>Todavía no hay restaurantes</b>
          <span>Crea el primero con el botón de abajo.</span>
        </div>
      )}

      {lista.map((r, i) => {
        const enFoco = abierto === r.id || borrando === r.id
        return (
          <div key={r.id} className="entra" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
            <div
              className="tarjeta"
              style={{
                ...s.tarjeta,
                opacity: r.activo ? 1 : 0.6,
                borderColor: enFoco ? 'var(--lavanda-2)' : 'var(--linea)',
                boxShadow: enFoco ? 'var(--sombra-alta)' : undefined,
              }}
            >
              <div style={s.info}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 18 }}>{r.nombre}</b>
                  <span
                    key={String(r.activo)}
                    className="contador-pop"
                    style={{
                      ...s.estado,
                      background: r.activo ? 'var(--menta)' : 'var(--lavanda)',
                      color: r.activo ? 'var(--menta-tinta)' : 'var(--suave)',
                    }}
                  >
                    {r.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <small className="suave">
                  Código <b style={{ color: 'var(--tinta)' }}>{r.slug}</b> · {r.moneda_codigo} ({r.moneda_simbolo}),{' '}
                  {r.moneda_decimales} decimales
                </small>
                <label style={s.zona}>
                  <small className="suave">Zona horaria</small>
                  <select
                    className="campo-chico"
                    value={r.zona_horaria ?? 'America/Santiago'}
                    onChange={(e) => cambiarZona(r, e.target.value)}
                  >
                    {ZONAS.map(([zona, nombre]) => (
                      <option key={zona} value={zona}>
                        {nombre}
                      </option>
                    ))}
                    {!ZONAS.some(([zona]) => zona === r.zona_horaria) && r.zona_horaria && (
                      <option value={r.zona_horaria}>{r.zona_horaria}</option>
                    )}
                  </select>
                </label>
              </div>
              <div style={s.acciones}>
                <button
                  className={`btn ${abierto === r.id ? 'btn-morado' : 'btn-sec'}`}
                  style={s.accion}
                  aria-expanded={abierto === r.id}
                  onClick={() => alternarAdmin(r)}
                >
                  {abierto === r.id ? 'Cerrar' : 'Administrar'}
                </button>
                <button className={`btn ${r.activo ? 'btn-sec' : 'btn-principal'}`} style={s.accion} onClick={() => alternar(r)}>
                  {r.activo ? 'Desactivar' : 'Activar'}
                </button>
                <button
                  className="btn btn-peligro-suave"
                  style={s.accion}
                  aria-expanded={borrando === r.id}
                  onClick={() => pedirBorrar(r)}
                >
                  Eliminar
                </button>
              </div>
            </div>

            <Desplegable abierto={abierto === r.id}>
              <div style={s.panelAdmin}>
                <Anclar block="start" />
                <b style={s.panelAdminTitulo}>Administrando: {r.nombre}</b>
                <Admin restaurante={r} />
              </div>
            </Desplegable>

            <Desplegable abierto={borrando === r.id}>
              <div style={s.confirmar}>
                <Anclar block="center" />
                <p style={{ margin: 0, fontWeight: 800, color: '#B3261E' }}>Vas a eliminar "{r.nombre}" para siempre</p>
                <small>
                  Se borran también su menú, mesas, personal (sus credenciales siguen sirviendo para otros
                  restaurantes), pedidos y reportes. No se puede deshacer.
                </small>
                <label className="etiqueta">
                  <span>
                    Para confirmar, escribe el nombre exacto: <b>{r.nombre}</b>
                  </span>
                  <input className="campo" value={nombreBorrar} onChange={(e) => setNombreBorrar(e.target.value)} />
                </label>
                <label className="etiqueta">
                  Tu contraseña de superadmin
                  <input
                    type="password"
                    className="campo"
                    value={claveBorrar}
                    onChange={(e) => setClaveBorrar(e.target.value)}
                  />
                </label>
                <Mensaje tipo="error">{errorBorrar}</Mensaje>
                <div style={s.botonesFila}>
                  <button className="btn btn-sec" style={{ flex: 1 }} onClick={cancelarBorrar} disabled={eliminando}>
                    Cancelar
                  </button>
                  <button className="btn btn-peligro" style={{ flex: 2 }} onClick={() => confirmarBorrar(r)} disabled={eliminando}>
                    {eliminando ? <span className="puntos">Eliminando</span> : 'Eliminar definitivamente'}
                  </button>
                </div>
              </div>
            </Desplegable>
          </div>
        )
      })}

      <Desplegable abierto={!hayPanelAbierto && !mostrarCrear}>
        <button
          className="btn btn-principal btn-grande btn-bloque"
          onClick={() => {
            sentir('toque')
            setMostrarCrear(true)
          }}
        >
          + Crear restaurante
        </button>
      </Desplegable>

      <Desplegable abierto={!hayPanelAbierto && mostrarCrear}>
        <form onSubmit={crear} style={s.form}>
          <Anclar block="nearest" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 17 }}>Crear restaurante</b>
            <button type="button" className="btn btn-chico btn-sec" onClick={() => setMostrarCrear(false)}>
              Cancelar
            </button>
          </div>
          <label className="etiqueta">
            Nombre del restaurante
            <input className="campo" value={form.nombre} onChange={(e) => cambiarNombre(e.target.value)} />
          </label>
          <label className="etiqueta">
            Código para el login del personal
            <input
              className="campo"
              value={form.slug}
              autoCapitalize="none"
              onChange={(e) => {
                setSlugManual(true)
                setForm((f) => ({ ...f, slug: crearSlug(e.target.value) }))
              }}
            />
          </label>
          <label className="etiqueta">
            Moneda sugerida
            <select className="campo" value={form.codigo} onChange={(e) => elegirMoneda(e.target.value)}>
              {MONEDAS.map((m) => (
                <option key={m.codigo} value={m.codigo}>
                  {m.nombre} ({m.codigo})
                </option>
              ))}
              {!MONEDAS.some((m) => m.codigo === form.codigo) && <option value={form.codigo}>Otra ({form.codigo})</option>}
            </select>
          </label>
          <div style={s.tresColumnas}>
            <label className="etiqueta">
              Código
              <input
                className="campo"
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
              />
            </label>
            <label className="etiqueta">
              Símbolo
              <input className="campo" value={form.simbolo} onChange={(e) => setForm((f) => ({ ...f, simbolo: e.target.value }))} />
            </label>
            <label className="etiqueta">
              Decimales
              <select
                className="campo"
                value={form.decimales}
                onChange={(e) => setForm((f) => ({ ...f, decimales: e.target.value }))}
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="etiqueta">
            Zona horaria (define cuándo empieza cada día)
            <select className="campo" value={form.zona} onChange={(e) => setForm((f) => ({ ...f, zona: e.target.value }))}>
              {ZONAS.map(([zona, nombre]) => (
                <option key={zona} value={zona}>
                  {nombre} ({zona})
                </option>
              ))}
            </select>
          </label>
          <small className="suave">
            Así se verán los precios: <b key={ejemplo} className="contador-pop" style={{ color: 'var(--tinta)' }}>{ejemplo}</b>
          </small>
          <button className="btn btn-principal btn-grande" disabled={guardando}>
            {guardando ? <span className="puntos">Creando</span> : 'Crear restaurante'}
          </button>
        </form>
      </Desplegable>
    </div>
  )
}

const s = {
  pagina: { display: 'grid', gap: 10, maxWidth: 860, margin: '0 auto' },
  form: { display: 'grid', gap: 14, background: 'var(--lavanda)', border: '1px solid var(--lavanda-2)', padding: 16, borderRadius: 18 },
  tresColumnas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 10 },
  tarjeta: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    transition: 'opacity 220ms var(--ease), box-shadow 220ms var(--ease), border-color 220ms var(--ease)',
  },
  info: { display: 'grid', gap: 6, flex: '1 1 240px', minWidth: 0 },
  estado: { padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 800 },
  zona: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  acciones: { display: 'flex', flexWrap: 'wrap', gap: 8, flex: '1 1 300px', justifyContent: 'flex-end' },
  accion: { flex: '1 1 0', minWidth: 96 },
  botonesFila: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  confirmar: { display: 'grid', gap: 12, border: '1.5px solid #f0a9a3', borderRadius: 18, padding: 16, marginTop: 10, background: '#fff6f5' },
  panelAdmin: { display: 'grid', gap: 12, marginTop: 10, padding: 14, borderRadius: 18, background: 'var(--lavanda)', border: '1px solid var(--lavanda-2)' },
  panelAdminTitulo: { fontSize: 14, color: '#4B1E4D' },
}
