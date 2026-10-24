import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Anclar from './Anclar'

// La clave interna sigue siendo "mesera" (así está guardado en la base de datos y en las
// reglas de seguridad); solo cambia el texto que ve la persona, para que sirva sin importar
// el género de quien atiende el salón.
const ROLES = { admin: 'Administrador', mesera: 'Salón', cocina: 'Cocina' }
const FORM_INICIAL = { nombre: '', username: '', rol: 'mesera', pin: '' }

async function llamar(body) {
  const { data, error } = await supabase.functions.invoke('personal', { body })
  if (error) return { ok: false, error: 'No se pudo contactar la función: ' + error.message }
  return data
}

export default function Personal({ restaurante, scrollAlAbrir = false }) {
  const [lista, setLista] = useState([])
  const [form, setForm] = useState(FORM_INICIAL)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [cambiando, setCambiando] = useState(null) // id del miembro al que se le cambia el PIN
  const [nuevoPin, setNuevoPin] = useState('')
  const [cambioRol, setCambioRol] = useState(null) // { m, rol } mientras se pide el acceso nuevo
  const [pinRol, setPinRol] = useState('')
  const [miUid, setMiUid] = useState(null) // para reconocer mi propia fila en la lista
  const [mostrarForm, setMostrarForm] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMiUid(data.user?.id ?? null))
  }, [])

  async function cargar() {
    const { data, error } = await supabase
      .from('miembros')
      .select('*')
      .eq('restaurante_id', restaurante.id)
      .order('creado_en')
    if (error) setError(error.message)
    else setLista(data)
  }

  useEffect(() => {
    cargar()
  }, [restaurante.id])

  async function crear(e) {
    e.preventDefault()
    setError('')
    setAviso('')
    setTrabajando(true)
    const r = await llamar({ accion: 'crear', restaurante_id: restaurante.id, ...form })
    setTrabajando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setAviso(`Listo. ${form.nombre} entra con el código “${restaurante.slug}” y el usuario “${form.username}”.`)
    setForm(FORM_INICIAL)
    setMostrarForm(false)
    cargar()
  }

  function pedirRol(m, rol) {
    setError('')
    setAviso('')
    setCambioRol(null)
    if (rol === m.rol) return
    const cruzaAdmin = (rol === 'admin') !== (m.rol === 'admin')
    if (cruzaAdmin) {
      setCambioRol({ m, rol })
      setPinRol('')
    } else {
      aplicarRol(m, rol, '')
    }
  }

  async function aplicarRol(m, rol, pin) {
    setError('')
    const r = await llamar({ accion: 'cambiar_rol', miembro_id: m.id, rol, pin })
    if (!r.ok) {
      setError(r.error)
      return
    }
    setCambioRol(null)
    setPinRol('')
    setAviso(`Ahora ${m.nombre} es ${ROLES[rol].toLowerCase()}.`)
    cargar()
  }

  async function alternarActivo(m) {
    setError('')
    if (m.usuario_id === miUid) {
      setError('No puedes desactivar tu propia cuenta.')
      return
    }
    const { error } = await supabase.from('miembros').update({ activo: !m.activo }).eq('id', m.id)
    if (error) setError(error.message)
    else cargar()
  }

  async function guardarPin(m) {
    setError('')
    setAviso('')
    const r = await llamar({ accion: 'cambiar_pin', miembro_id: m.id, pin: nuevoPin })
    if (!r.ok) {
      setError(r.error)
      return
    }
    setAviso(`Se cambió el acceso de ${m.nombre}.`)
    setCambiando(null)
    setNuevoPin('')
    cargar()
  }

  const esAdmin = form.rol === 'admin'

  return (
    <div style={s.caja}>
      {scrollAlAbrir && <Anclar block="start" />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0 }}>
          Personal de {restaurante.nombre} <small style={{ fontWeight: 400, color: '#6f6477' }}>· {lista.length}</small>
        </h3>
      </div>

      {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
      {aviso && <p style={{ color: 'green', margin: 0 }}>{aviso}</p>}

      {lista.length === 0 && <p style={{ margin: 0 }}>Todavía no hay personal.</p>}
      {lista.map((m) => {
        const bloqueado = m.bloqueado_hasta && new Date(m.bloqueado_hasta) > new Date()
        return (
          <div key={m.id} style={{ ...s.fila, opacity: m.activo ? 1 : 0.55 }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <b>{m.nombre}</b> <small>@{m.username}</small>
              {!m.activo && <small> · desactivado</small>}
              {bloqueado && <small style={{ color: 'crimson' }}> · bloqueado por intentos</small>}
            </div>
            <select
              style={s.chico}
              value={m.rol}
              disabled={m.usuario_id === miUid}
              title={m.usuario_id === miUid ? 'No puedes cambiar tu propio rol' : ''}
              onChange={(e) => pedirRol(m, e.target.value)}
            >
              {Object.entries(ROLES).map(([valor, nombre]) => (
                <option key={valor} value={valor}>
                  {nombre}
                </option>
              ))}
            </select>
            {m.usuario_id === miUid ? (
              <small style={{ color: '#6f6477' }}>(tú)</small>
            ) : (
              <button style={s.botonSec} onClick={() => alternarActivo(m)}>
                {m.activo ? 'Desactivar' : 'Activar'}
              </button>
            )}
            <button
              style={s.botonSec}
              onClick={() => {
                setCambiando(cambiando === m.id ? null : m.id)
                setNuevoPin('')
              }}
            >
              {m.rol === 'admin' ? 'Cambiar contraseña' : 'Cambiar PIN'}
            </button>
            {cambioRol?.m.id === m.id && (
              <div style={{ display: 'grid', gap: 8, flexBasis: '100%' }}>
                <Anclar />
                <small>
                  Para pasar a {ROLES[cambioRol.rol]}, define su nuevo{' '}
                  {cambioRol.rol === 'admin' ? 'contraseña (mínimo 8 caracteres)' : 'PIN de 4 dígitos'}:
                </small>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={s.input}
                    type={cambioRol.rol === 'admin' ? 'password' : 'text'}
                    inputMode={cambioRol.rol === 'admin' ? 'text' : 'numeric'}
                    maxLength={cambioRol.rol === 'admin' ? 72 : 4}
                    autoFocus
                    value={pinRol}
                    onChange={(e) =>
                      setPinRol(cambioRol.rol === 'admin' ? e.target.value : e.target.value.replace(/\D/g, ''))
                    }
                  />
                  <button style={s.boton} onClick={() => aplicarRol(m, cambioRol.rol, pinRol)}>
                    Confirmar
                  </button>
                  <button style={s.botonSec} onClick={() => setCambioRol(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {cambiando === m.id && (
              <div style={{ display: 'flex', gap: 8, flexBasis: '100%' }}>
                <Anclar />
                <input
                  style={s.input}
                  type={m.rol === 'admin' ? 'password' : 'text'}
                  inputMode={m.rol === 'admin' ? 'text' : 'numeric'}
                  maxLength={m.rol === 'admin' ? 72 : 4}
                  placeholder={m.rol === 'admin' ? 'Nueva contraseña' : 'Nuevo PIN (4 dígitos)'}
                  autoFocus
                  value={nuevoPin}
                  onChange={(e) => setNuevoPin(m.rol === 'admin' ? e.target.value : e.target.value.replace(/\D/g, ''))}
                />
                <button style={s.boton} onClick={() => guardarPin(m)}>
                  Guardar
                </button>
              </div>
            )}
          </div>
        )
      })}

      {mostrarForm ? (
        <form onSubmit={crear} className="aparece" style={s.form}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>Agregar persona</b>
            <button type="button" style={s.botonSec} onClick={() => setMostrarForm(false)}>
              Cancelar
            </button>
          </div>
          <input
            style={s.input}
            placeholder="Nombre (ej: Rosa Pérez)"
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
          />
          <input
            style={s.input}
            placeholder="Usuario (ej: rosa)"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') }))}
          />
          <select style={s.input} value={form.rol} onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value, pin: '' }))}>
            {Object.entries(ROLES).map(([valor, nombre]) => (
              <option key={valor} value={valor}>
                {nombre}
              </option>
            ))}
          </select>
          <input
            style={s.input}
            type={esAdmin ? 'password' : 'text'}
            inputMode={esAdmin ? 'text' : 'numeric'}
            maxLength={esAdmin ? 72 : 4}
            placeholder={esAdmin ? 'Contraseña (mínimo 8 caracteres)' : 'PIN de 4 dígitos'}
            value={form.pin}
            onChange={(e) => setForm((f) => ({ ...f, pin: esAdmin ? e.target.value : e.target.value.replace(/\D/g, '') }))}
          />
          <button style={s.boton} disabled={trabajando}>
            {trabajando ? 'Creando...' : 'Crear'}
          </button>
        </form>
      ) : (
        <button style={{ ...s.boton, width: '100%' }} onClick={() => setMostrarForm(true)}>
          + Agregar personal
        </button>
      )}
    </div>
  )
}

const s = {
  caja: { display: 'grid', gap: 10, border: '1px solid #ddd', borderRadius: 12, padding: 14, marginTop: 8 },
  form: { display: 'grid', gap: 8, background: '#f4f0f6', padding: 12, borderRadius: 12 },
  fila: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', border: '1px solid #e5e5e5', borderRadius: 10, padding: 10 },
  input: { padding: 10, fontSize: 16, borderRadius: 8, border: '1px solid #bbb', width: '100%', boxSizing: 'border-box' },
  chico: { padding: 8, fontSize: 14, borderRadius: 8, border: '1px solid #bbb' },
  boton: { padding: 10, fontSize: 15, fontWeight: 700, borderRadius: 8, border: 'none', background: '#F2A900', cursor: 'pointer' },
  botonSec: { padding: 8, fontSize: 14, borderRadius: 8, border: '1px solid #bbb', background: 'white', cursor: 'pointer' },
}
