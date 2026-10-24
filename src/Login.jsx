import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import './Login.css'
import { sentir, sonar, vibrar } from './feedback'

// Cambia aquí el nombre que se muestra en el sistema.
export const MARCA = 'Sistema de Pedidos'

const CLAVE_CODIGO = 'ultimo-codigo-restaurante'

function leerCodigoGuardado() {
  try {
    return localStorage.getItem(CLAVE_CODIGO) ?? ''
  } catch {
    return ''
  }
}

function guardarCodigo(codigo) {
  try {
    localStorage.setItem(CLAVE_CODIGO, codigo)
  } catch {
    // sin almacenamiento disponible: no pasa nada
  }
}

// Estructura común: foto a la izquierda, tarjeta a la derecha.
function Marco({ children }) {
  return (
    <div className="login">
      <aside className="login-foto">
        <div className="login-marca">
          <span className="login-logo" aria-hidden="true">
            🍽️
          </span>
          {MARCA}
        </div>
        <div className="login-mensaje">
          <h2>Tu restaurante, en orden.</h2>
          <p>Pedidos, cocina y caja conectados en tiempo real, desde cualquier dispositivo.</p>
          <ul className="login-puntos">
            <li>Pedidos que llegan a cocina al instante</li>
            <li>Cuentas por mesa, sin papel</li>
            <li>Reporte de ventas al cierre del día</li>
          </ul>
        </div>
        <small className="login-credito">
          Foto:{' '}
          <a href="https://www.vecteezy.com" target="_blank" rel="noreferrer">
            Vecteezy
          </a>
        </small>
      </aside>
      <main className="login-panel">
        <div className="login-tarjeta">{children}</div>
      </main>
    </div>
  )
}

function CampoClave({ id, label, value, onChange, autoComplete, inputMode, autoFocus }) {
  const [ver, setVer] = useState(false)
  return (
    <div className="login-campo">
      <label htmlFor={id}>{label}</label>
      <div className="login-clave">
        <input
          id={id}
          type={ver ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          inputMode={inputMode}
          autoFocus={autoFocus}
          required
        />
        <button
          type="button"
          className="login-ver"
          onClick={() => {
            sentir('toque', 'tic')
            setVer((v) => !v)
          }}
        >
          {ver ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </div>
  )
}

export default function Login({ avisoInicial = '' }) {
  const [modo, setModo] = useState('personal') // 'personal' | 'admin' | 'recuperar'
  const [codigo, setCodigo] = useState(leerCodigoGuardado)
  const [usuario, setUsuario] = useState('')
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState(avisoInicial)
  const [ok, setOk] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [espera, setEspera] = useState(0) // segundos antes de poder pedir otro correo

  useEffect(() => {
    if (espera <= 0) return
    const t = setTimeout(() => setEspera((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [espera])

  function cambiarModo(nuevo) {
    if (nuevo !== modo) sentir('toque', 'tic')
    setModo(nuevo)
    setError('')
    setOk('')
    setClave('')
  }

  async function entrar(e) {
    e.preventDefault()
    sentir('toque')
    setError('')
    setTrabajando(true)

    if (modo === 'admin') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave })
      if (error) {
        vibrar('error')
        setError('Correo o contraseña incorrectos.')
      } else sonar('exito')
    } else {
      const { data, error } = await supabase.functions.invoke('personal', {
        body: { accion: 'login', slug: codigo.trim(), username: usuario.trim(), pin: clave },
      })
      if (error) {
        vibrar('error')
        setError('No se pudo conectar con el servidor. Revisa tu conexión a internet e intenta de nuevo.')
      } else if (!data.ok) {
        vibrar('error')
        setError(data.error)
      } else {
        sonar('exito')
        guardarCodigo(codigo.trim().toLowerCase())
        await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token })
      }
    }
    setTrabajando(false)
  }

  async function recuperar(e) {
    e.preventDefault()
    sentir('toque')
    setError('')
    setOk('')
    setTrabajando(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    setTrabajando(false)
    if (error && /rate|limit|seconds/i.test(error.message)) {
      setError('Ya se envió un correo hace poco. Espera unos minutos antes de pedir otro.')
      return
    }
    // Por seguridad no se dice si el correo existe o no.
    vibrar('exito')
    sonar('exito')
    setOk('Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña. Revisa también la carpeta de spam.')
    setEspera(60)
  }

  if (modo === 'recuperar') {
    return (
      <Marco>
        <h1>Recuperar contraseña</h1>
        <p className="login-sub">
          Escribe el correo de tu cuenta de administración y te enviaremos un enlace para crear una nueva contraseña.
        </p>
        <form className="login-form" onSubmit={recuperar}>
          <div className="login-campo">
            <label htmlFor="rec-email">Correo electrónico</label>
            <input
              id="rec-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>
          {error && (
            <div key={error} className="login-alerta error" role="alert">
              {error}
            </div>
          )}
          {ok && (
            <div className="login-alerta ok" role="status">
              {ok}
            </div>
          )}
          <button className="login-boton" disabled={trabajando || espera > 0}>
            {trabajando ? <span className="puntos">Enviando</span> : espera > 0 ? `Puedes reenviar en ${espera} s` : 'Enviar enlace'}
          </button>
        </form>
        <div className="login-volver">
          <button type="button" className="login-enlace" onClick={() => cambiarModo('admin')}>
            Volver a iniciar sesión
          </button>
        </div>
      </Marco>
    )
  }

  return (
    <Marco>
      <h1>Iniciar sesión</h1>
      <p className="login-sub">Ingresa con tus datos de acceso.</p>

      <div className="login-segmento" data-pos={modo === 'admin' ? 1 : 0} role="group" aria-label="Tipo de acceso">
        <button type="button" aria-pressed={modo === 'personal'} onClick={() => cambiarModo('personal')}>
          Personal del local
        </button>
        <button type="button" aria-pressed={modo === 'admin'} onClick={() => cambiarModo('admin')}>
          Administración
        </button>
      </div>

      <form key={modo} className="login-form login-cambia" onSubmit={entrar}>
        {modo === 'personal' ? (
          <>
            <div className="login-campo">
              <label htmlFor="codigo">Código del restaurante</label>
              <input
                id="codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="login-campo">
              <label htmlFor="usuario">Usuario</label>
              <input
                id="usuario"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                required
              />
            </div>
            <CampoClave
              id="pin"
              label="PIN o contraseña"
              value={clave}
              onChange={setClave}
              autoComplete="current-password"
            />
          </>
        ) : (
          <>
            <div className="login-campo">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <CampoClave
              id="clave"
              label="Contraseña"
              value={clave}
              onChange={setClave}
              autoComplete="current-password"
            />
            <div className="login-fila">
              <button type="button" className="login-enlace" onClick={() => cambiarModo('recuperar')}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          </>
        )}

        {error && (
          <div key={error} className="login-alerta error" role="alert">
            {error}
          </div>
        )}

        <button className="login-boton" disabled={trabajando}>
          {trabajando ? <span className="puntos">Entrando</span> : 'Entrar'}
        </button>
      </form>

      {modo === 'personal' && (
        <p className="login-nota">¿Olvidaste tu PIN? Pídele al administrador del local que te asigne uno nuevo.</p>
      )}
    </Marco>
  )
}

// Se muestra al volver desde el enlace del correo de recuperación.
export function NuevaClave({ onListo }) {
  const [clave, setClave] = useState('')
  const [repetir, setRepetir] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [listo, setListo] = useState(false)

  async function guardar(e) {
    e.preventDefault()
    setError('')
    if (clave.length < 8) {
      vibrar('error')
      return setError('La contraseña debe tener al menos 8 caracteres.')
    }
    if (clave !== repetir) {
      vibrar('error')
      return setError('Las contraseñas no coinciden.')
    }
    sentir('toque')
    setTrabajando(true)
    const { error } = await supabase.auth.updateUser({ password: clave })
    setTrabajando(false)
    if (error) {
      setError(
        /different|same/i.test(error.message)
          ? 'La nueva contraseña debe ser distinta de la anterior.'
          : 'No se pudo guardar: ' + error.message
      )
      return
    }
    vibrar('exito')
    sonar('exito')
    setListo(true)
  }

  return (
    <Marco>
      {listo ? (
        <div className="login-cambia">
          <div className="login-listo" aria-hidden="true">
            ✓
          </div>
          <h1>Contraseña actualizada</h1>
          <p className="login-sub">Tu nueva contraseña ya está activa.</p>
          <button className="login-boton" style={{ width: '100%' }} onClick={onListo}>
            Ir al panel
          </button>
        </div>
      ) : (
        <>
          <h1>Crea una nueva contraseña</h1>
          <p className="login-sub">Usa al menos 8 caracteres. Evita contraseñas que uses en otros sitios.</p>
          <form className="login-form" onSubmit={guardar}>
            <CampoClave
              id="nueva"
              label="Nueva contraseña"
              value={clave}
              onChange={setClave}
              autoComplete="new-password"
              autoFocus
            />
            <CampoClave
              id="repetir"
              label="Repite la contraseña"
              value={repetir}
              onChange={setRepetir}
              autoComplete="new-password"
            />
            {error && (
              <div key={error} className="login-alerta error" role="alert">
                {error}
              </div>
            )}
            <button className="login-boton" disabled={trabajando}>
              {trabajando ? <span className="puntos">Guardando</span> : 'Guardar contraseña'}
            </button>
          </form>
        </>
      )}
    </Marco>
  )
}
