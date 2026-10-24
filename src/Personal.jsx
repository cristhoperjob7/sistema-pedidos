import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Anclar from './Anclar'
import { Cargando, Desplegable, Mensaje } from './ui'
import { avisar, celebrar, sentir, sonar, vibrar } from './feedback'

// La clave interna sigue siendo "mesera" (así está guardado en la base de datos y en las
// reglas de seguridad); solo cambia el texto que ve la persona, para que sirva sin importar
// el género de quien atiende el salón.
const ROLES = { admin: 'Administrador', mesera: 'Salón', cocina: 'Cocina' }
const ICONO_ROL = { admin: '🗝️', mesera: '🍽️', cocina: '🍳' }
const FORM_INICIAL = { nombre: '', username: '', rol: 'mesera', pin: '' }

async function llamar(body) {
  const { data, error } = await supabase.functions.invoke('personal', { body })
  if (error) return { ok: false, error: 'No se pudo contactar la función: ' + error.message }
  return data
}

export default function Personal({ restaurante, scrollAlAbrir = false }) {
  const [lista, setLista] = useState(null)
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
    const boton = e.nativeEvent?.submitter
    sentir('toque')
    setError('')
    setAviso('')
    setTrabajando(true)
    const r = await llamar({ accion: 'crear', restaurante_id: restaurante.id, ...form })
    setTrabajando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    celebrar(boton)
    vibrar('exito')
    sonar('exito')
    // Este aviso queda fijo (no flotante): trae los datos que hay que entregarle a la persona.
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
    sentir('toque', 'tic')
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
    vibrar('exito')
    sonar('exito')
    avisar(`Ahora ${m.nombre} es ${ROLES[rol].toLowerCase()}`)
    cargar()
  }

  async function alternarActivo(m) {
    setError('')
    if (m.usuario_id === miUid) {
      setError('No puedes desactivar tu propia cuenta.')
      return
    }
    sentir('toque', 'tic')
    const { error } = await supabase.from('miembros').update({ activo: !m.activo }).eq('id', m.id)
    if (error) setError(error.message)
    else {
      avisar(m.activo ? `${m.nombre} desactivado` : `${m.nombre} activado`, m.activo ? 'info' : 'ok')
      cargar()
    }
  }

  async function guardarPin(m) {
    sentir('toque')
    setError('')
    setAviso('')
    const r = await llamar({ accion: 'cambiar_pin', miembro_id: m.id, pin: nuevoPin })
    if (!r.ok) {
      setError(r.error)
      return
    }
    vibrar('exito')
    sonar('exito')
    avisar(`Se cambió el acceso de ${m.nombre}`)
    setCambiando(null)
    setNuevoPin('')
    cargar()
  }

  const esAdmin = form.rol === 'admin'

  if (!lista) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={70} />

  return (
    <div className="tarjeta" style={s.caja}>
      {scrollAlAbrir && <Anclar block="start" />}
      <h3 style={{ margin: 0 }}>
        Personal de {restaurante.nombre}{' '}
        <small className="suave" style={{ fontWeight: 700 }}>
          · <span key={lista.length} className="contador-pop">{lista.length}</span>
        </small>
      </h3>

      <Mensaje tipo="error">{error}</Mensaje>
      <Mensaje tipo="ok">{aviso}</Mensaje>

      {lista.length === 0 && (
        <div className="vacio">
          <span className="vacio-icono">👋</span>
          <b>Todavía no hay personal</b>
          <span>Agrega a quienes atienden el salón y la cocina.</span>
        </div>
      )}
      {lista.map((m) => {
        const bloqueado = m.bloqueado_hasta && new Date(m.bloqueado_hasta) > new Date()
        const soyYo = m.usuario_id === miUid
        return (
          <div key={m.id} className="entra" style={{ ...s.fila, opacity: m.activo ? 1 : 0.55 }}>
            <span style={s.avatar} aria-hidden="true">
              {ICONO_ROL[m.rol] ?? '🙂'}
            </span>
            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
              <b>{m.nombre}</b> {soyYo && <small style={s.tu}>tú</small>}
              <br />
              <small className="suave">@{m.username}</small>
              {!m.activo && <small className="suave"> · desactivado</small>}
              {bloqueado && <small style={{ color: 'var(--rosa-tinta)' }}> · bloqueado por intentos</small>}
            </div>
            <div style={s.acciones}>
              <select
                className="campo-chico"
                value={m.rol}
                disabled={soyYo}
                title={soyYo ? 'No puedes cambiar tu propio rol' : ''}
                onChange={(e) => pedirRol(m, e.target.value)}
              >
                {Object.entries(ROLES).map(([valor, nombre]) => (
                  <option key={valor} value={valor}>
                    {nombre}
                  </option>
                ))}
              </select>
              {!soyYo && (
                <button className="btn btn-chico btn-suave" onClick={() => alternarActivo(m)}>
                  {m.activo ? 'Desactivar' : 'Activar'}
                </button>
              )}
              <button
                className={`btn btn-chico ${cambiando === m.id ? 'btn-morado' : 'btn-sec'}`}
                aria-expanded={cambiando === m.id}
                onClick={() => {
                  sentir('toque')
                  setCambiando(cambiando === m.id ? null : m.id)
                  setNuevoPin('')
                }}
              >
                {m.rol === 'admin' ? 'Contraseña' : 'PIN'}
              </button>
            </div>

            {/* Margen negativo: mientras no hay panel abierto, esta línea no agrega espacio */}
            <div style={{ flexBasis: '100%', marginTop: -10 }}>
              <Desplegable abierto={cambioRol?.m.id === m.id}>
                {cambioRol?.m.id === m.id && (
                  <div style={s.panel}>
                    <Anclar />
                    <small>
                      Para pasar a {ROLES[cambioRol.rol]}, define su nuevo{' '}
                      {cambioRol.rol === 'admin' ? 'contraseña (mínimo 8 caracteres)' : 'PIN de 4 dígitos'}:
                    </small>
                    <div style={s.filaPanel}>
                      <input
                        className="campo"
                        style={{ flex: '1 1 160px' }}
                        type={cambioRol.rol === 'admin' ? 'password' : 'text'}
                        inputMode={cambioRol.rol === 'admin' ? 'text' : 'numeric'}
                        maxLength={cambioRol.rol === 'admin' ? 72 : 4}
                        autoFocus
                        value={pinRol}
                        onChange={(e) =>
                          setPinRol(cambioRol.rol === 'admin' ? e.target.value : e.target.value.replace(/\D/g, ''))
                        }
                      />
                      <button className="btn btn-principal" onClick={() => aplicarRol(m, cambioRol.rol, pinRol)}>
                        Confirmar
                      </button>
                      <button className="btn btn-sec" onClick={() => setCambioRol(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </Desplegable>
              <Desplegable abierto={cambiando === m.id}>
                <div style={s.panel}>
                  <Anclar />
                  <div style={s.filaPanel}>
                    <input
                      className="campo"
                      style={{ flex: '1 1 160px' }}
                      type={m.rol === 'admin' ? 'password' : 'text'}
                      inputMode={m.rol === 'admin' ? 'text' : 'numeric'}
                      maxLength={m.rol === 'admin' ? 72 : 4}
                      placeholder={m.rol === 'admin' ? 'Nueva contraseña' : 'Nuevo PIN (4 dígitos)'}
                      autoFocus
                      value={cambiando === m.id ? nuevoPin : ''}
                      onChange={(e) => setNuevoPin(m.rol === 'admin' ? e.target.value : e.target.value.replace(/\D/g, ''))}
                    />
                    <button className="btn btn-principal" onClick={() => guardarPin(m)}>
                      Guardar
                    </button>
                  </div>
                </div>
              </Desplegable>
            </div>
          </div>
        )
      })}

      <Desplegable abierto={!mostrarForm}>
        <button
          className="btn btn-principal btn-grande btn-bloque"
          onClick={() => {
            sentir('toque')
            setAviso('')
            setMostrarForm(true)
          }}
        >
          + Agregar personal
        </button>
      </Desplegable>
      <Desplegable abierto={mostrarForm}>
        <form onSubmit={crear} style={s.form}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 17 }}>Agregar persona</b>
            <button type="button" className="btn btn-chico btn-sec" onClick={() => setMostrarForm(false)}>
              Cancelar
            </button>
          </div>
          <input
            className="campo"
            placeholder="Nombre (ej: Rosa Pérez)"
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
          />
          <input
            className="campo"
            placeholder="Usuario (ej: rosa)"
            autoCapitalize="none"
            autoCorrect="off"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') }))}
          />
          <select className="campo" value={form.rol} onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value, pin: '' }))}>
            {Object.entries(ROLES).map(([valor, nombre]) => (
              <option key={valor} value={valor}>
                {nombre}
              </option>
            ))}
          </select>
          <input
            className="campo"
            type={esAdmin ? 'password' : 'text'}
            inputMode={esAdmin ? 'text' : 'numeric'}
            maxLength={esAdmin ? 72 : 4}
            placeholder={esAdmin ? 'Contraseña (mínimo 8 caracteres)' : 'PIN de 4 dígitos'}
            value={form.pin}
            onChange={(e) => setForm((f) => ({ ...f, pin: esAdmin ? e.target.value : e.target.value.replace(/\D/g, '') }))}
          />
          <button className="btn btn-principal btn-grande" disabled={trabajando}>
            {trabajando ? <span className="puntos">Creando</span> : 'Crear'}
          </button>
        </form>
      </Desplegable>
    </div>
  )
}

const s = {
  caja: { display: 'grid', gap: 10, borderRadius: 18 },
  form: { display: 'grid', gap: 10, background: 'var(--lavanda)', border: '1px solid var(--lavanda-2)', padding: 14, borderRadius: 16 },
  fila: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    border: '1px solid var(--linea)',
    background: '#fcfafd',
    borderRadius: 14,
    padding: 10,
    transition: 'opacity 220ms var(--ease)',
  },
  avatar: {
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'var(--lavanda)',
    fontSize: 18,
  },
  tu: { padding: '1px 8px', borderRadius: 99, background: 'var(--durazno)', color: '#8a4b00', fontWeight: 800 },
  acciones: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  panel: { display: 'grid', gap: 8, marginTop: 14, padding: 10, borderRadius: 12, background: 'var(--lavanda)' },
  filaPanel: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
}
