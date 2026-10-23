import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Admin from './Admin'
import Anclar from './Anclar'

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
    .replace(/[\u0300-\u036f]/g, '')
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
  const [lista, setLista] = useState([])
  const [form, setForm] = useState(FORM_INICIAL)
  const [slugManual, setSlugManual] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [abierto, setAbierto] = useState(null)
  const [borrando, setBorrando] = useState(null) // id del restaurante que se está confirmando borrar
  const [claveBorrar, setClaveBorrar] = useState('')
  const [nombreBorrar, setNombreBorrar] = useState('')
  const [errorBorrar, setErrorBorrar] = useState('')
  const [eliminando, setEliminando] = useState(false)

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
    setError('')
    setAviso('')
    if (!form.nombre.trim() || !form.slug.trim() || !form.codigo.trim() || !form.simbolo.trim()) {
      setError('Completa el nombre, el código, la moneda y el símbolo.')
      return
    }
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
    setAviso('Restaurante creado.')
    setForm(FORM_INICIAL)
    setSlugManual(false)
    cargar()
  }

  async function alternar(r) {
    const { error } = await supabase.from('restaurantes').update({ activo: !r.activo }).eq('id', r.id)
    if (error) setError(error.message)
    else cargar()
  }

  async function cambiarZona(r, zona) {
    setError('')
    const { error } = await supabase.from('restaurantes').update({ zona_horaria: zona }).eq('id', r.id)
    if (error) setError(error.message)
    else cargar()
  }

  function pedirBorrar(r) {
    setAbierto(null) // si estaba abierto "Administrar", se cierra para dejar ver la confirmación
    setBorrando(r.id)
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
    setAviso(`Restaurante "${r.nombre}" eliminado junto con todos sus datos.`)
    cargar()
  }

  const ejemplo = `${form.simbolo} ${(12.5).toFixed(Number(form.decimales) || 0)}`

  return (
    <div style={s.pagina}>
      <h2>Crear restaurante</h2>
      <form onSubmit={crear} style={s.form}>
        <label style={s.label}>
          Nombre del restaurante
          <input style={s.input} value={form.nombre} onChange={(e) => cambiarNombre(e.target.value)} />
        </label>
        <label style={s.label}>
          Código para el login del personal
          <input
            style={s.input}
            value={form.slug}
            onChange={(e) => {
              setSlugManual(true)
              setForm((f) => ({ ...f, slug: crearSlug(e.target.value) }))
            }}
          />
        </label>
        <label style={s.label}>
          Moneda sugerida
          <select style={s.input} value={form.codigo} onChange={(e) => elegirMoneda(e.target.value)}>
            {MONEDAS.map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.nombre} ({m.codigo})
              </option>
            ))}
            {!MONEDAS.some((m) => m.codigo === form.codigo) && (
              <option value={form.codigo}>Otra ({form.codigo})</option>
            )}
          </select>
        </label>
        <div style={s.fila}>
          <label style={s.label}>
            Código
            <input
              style={s.input}
              value={form.codigo}
              onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
            />
          </label>
          <label style={s.label}>
            Símbolo
            <input
              style={s.input}
              value={form.simbolo}
              onChange={(e) => setForm((f) => ({ ...f, simbolo: e.target.value }))}
            />
          </label>
          <label style={s.label}>
            Decimales
            <select
              style={s.input}
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
        <label style={s.label}>
          Zona horaria (define cuándo empieza cada día)
          <select style={s.input} value={form.zona} onChange={(e) => setForm((f) => ({ ...f, zona: e.target.value }))}>
            {ZONAS.map(([zona, nombre]) => (
              <option key={zona} value={zona}>
                {nombre} ({zona})
              </option>
            ))}
          </select>
        </label>
        <small>Así se verán los precios: {ejemplo}</small>
        {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        {aviso && <p style={{ color: 'green', margin: 0 }}>{aviso}</p>}
        <button style={s.boton} disabled={guardando}>
          {guardando ? 'Creando...' : 'Crear restaurante'}
        </button>
      </form>

      <h2>Restaurantes ({lista.length})</h2>
      {lista.map((r) => (
        <div key={r.id}>
          <div style={s.tarjeta}>
          <div>
            <b>{r.nombre}</b>
            <br />
            <small>
              Código: {r.slug} · Moneda: {r.moneda_codigo} ({r.moneda_simbolo}), {r.moneda_decimales} decimales
            </small>
            <br />
            <small>
              Zona horaria:{' '}
              <select
                value={r.zona_horaria ?? 'America/Santiago'}
                onChange={(e) => cambiarZona(r, e.target.value)}
                style={{ fontSize: 13 }}
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
            </small>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.botonSec} onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
              {abierto === r.id ? 'Cerrar' : 'Administrar'}
            </button>
            <button style={r.activo ? s.botonSec : s.boton} onClick={() => alternar(r)}>
              {r.activo ? 'Desactivar' : 'Activar'}
            </button>
            <button style={s.botonPeligro} onClick={() => pedirBorrar(r)}>
              Eliminar
            </button>
          </div>
          </div>
          {abierto === r.id && (
            <div style={s.panelAdmin}>
              <Anclar block="start" />
              <b style={s.panelAdminTitulo}>Administrando: {r.nombre}</b>
              <Admin restaurante={r} />
            </div>
          )}

          {borrando === r.id && (
            <div style={s.confirmar}>
              <Anclar block="center" />
              <p style={{ margin: 0, fontWeight: 700, color: '#B3261E' }}>
                Vas a eliminar "{r.nombre}" para siempre
              </p>
              <small>
                Se borran también su menú, mesas, personal (sus credenciales siguen sirviendo para otros
                restaurantes), pedidos y reportes. No se puede deshacer.
              </small>
              <label style={s.label}>
                Para confirmar, escribe el nombre exacto del restaurante: <b>{r.nombre}</b>
                <input style={s.input} value={nombreBorrar} onChange={(e) => setNombreBorrar(e.target.value)} />
              </label>
              <label style={s.label}>
                Tu contraseña de superadmin
                <input
                  type="password"
                  style={s.input}
                  value={claveBorrar}
                  onChange={(e) => setClaveBorrar(e.target.value)}
                />
              </label>
              {errorBorrar && <p style={{ color: 'crimson', margin: 0 }}>{errorBorrar}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={s.botonSec} onClick={cancelarBorrar} disabled={eliminando}>
                  Cancelar
                </button>
                <button style={s.botonPeligro} onClick={() => confirmarBorrar(r)} disabled={eliminando}>
                  {eliminando ? 'Eliminando...' : 'Eliminar definitivamente'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const s = {
  pagina: { display: 'grid', gap: 8 },
  form: { display: 'grid', gap: 12, background: '#f4f0f6', padding: 16, borderRadius: 12 },
  label: { display: 'grid', gap: 4, fontSize: 14, fontWeight: 600, flex: 1 },
  fila: { display: 'flex', gap: 10 },
  input: { padding: 10, fontSize: 16, borderRadius: 8, border: '1px solid #bbb', width: '100%', boxSizing: 'border-box' },
  boton: { padding: 12, fontSize: 15, fontWeight: 700, borderRadius: 8, border: 'none', background: '#F2A900', cursor: 'pointer' },
  botonSec: { padding: 12, fontSize: 15, fontWeight: 600, borderRadius: 8, border: '1px solid #bbb', background: 'white', cursor: 'pointer' },
  botonPeligro: { padding: 12, fontSize: 15, fontWeight: 700, borderRadius: 8, border: '1px solid #B3261E', background: '#B3261E', color: 'white', cursor: 'pointer' },
  tarjeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, border: '1px solid #ddd', borderRadius: 12, padding: 14 },
  confirmar: { display: 'grid', gap: 10, border: '2px solid #B3261E', borderRadius: 12, padding: 14, marginTop: -1, background: '#fff5f4' },
  panelAdmin: { display: 'grid', gap: 12, marginTop: 14, padding: 16, borderRadius: 14, background: '#f4f0f6', border: '1px solid #d9cfe0' },
  panelAdminTitulo: { fontSize: 14, color: '#4B1E4D' },
}
