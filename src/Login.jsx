import { useEffect, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import './Login.css'
import { CORREO_CONTACTO, Marca, correoSolicitud } from './marca'
import { sentir, sonar, vibrar } from './feedback'

export { MARCA } from './marca'

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

const PASOS = [
  ['01', 'El cliente escanea el QR', 'Ve la carta con fotos en su celular, sin descargar nada.'],
  ['02', 'La mesera autoriza', 'Tú decides qué mesa puede pedir. Nada llega a cocina sin pasar por el local.'],
  ['03', 'La cocina lo recibe al instante', 'Con las notas de cada plato, en orden de llegada y sin papeles.'],
]
const FUNCIONES = [
  ['mesas', 'Mesas', 'Estado de cada mesa de un vistazo: libre, ocupada, lista o por cobrar.'],
  ['cubiertos', 'Cocina', 'Pedidos en pantalla con su tiempo de espera y aviso cuando están listos.'],
  ['caja', 'Caja y cobro', 'Efectivo, tarjeta o transferencia, propina, descuentos y cuentas divididas.'],
  ['qr', 'Carta QR', 'Tu carta siempre al día: cambias un precio o marcas un agotado y se ve al tiro.'],
  ['tendencia', 'Reportes', 'Ventas del día y del mes, platos más vendidos y cierre de caja en PDF.'],
  ['personas', 'Personal', 'Cada persona entra con su usuario y PIN, con lo justo para su trabajo.'],
]

// Portada de ReSystem con el ingreso arriba (el personal entra rápido; quien no conoce el sistema sigue leyendo).
function Marco({ children }) {
  return (
    <div className="login">
      <header className="lg-nav">
        <Marca tam={26} />
        <nav>
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#plan">Plan</a>
          <a className="lg-nav-cta" href="#prueba">
            Prueba gratis
          </a>
        </nav>
      </header>

      <section className="lg-hero">
        <div className="lg-hero-txt">
          <p className="lg-eyebrow">Sistema para restaurantes</p>
          <h1 className="lg-titulo">Tu restaurante, en orden. De la mesa a la cocina.</h1>
          <p className="lg-bajada">Pedidos desde la mesa con QR, cocina conectada y cobro en una sola app. Funciona en el celular, la tablet o el computador.</p>
          <div className="lg-acciones">
            <a className="lg-btn lg-btn-negro" href="#prueba">
              Prueba 14 días gratis
            </a>
            <a className="lg-btn lg-btn-borde" href="#como-funciona">
              Ver cómo funciona
            </a>
          </div>
        </div>
        <div className="login-tarjeta" id="ingresar">
          {children}
        </div>
      </section>

      <section className="lg-seccion" id="como-funciona">
        <p className="lg-eyebrow">Cómo funciona</p>
        <h2 className="lg-h2">Tus clientes piden desde la mesa. Tú mantienes el control.</h2>
        <div className="lg-pasos">
          {PASOS.map(([n, t, d]) => (
            <div key={n} className="lg-paso">
              <span className="lg-paso-n">{n}</span>
              <b>{t}</b>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lg-seccion">
        <p className="lg-eyebrow">Todo en un solo lugar</p>
        <h2 className="lg-h2">Mesas, cocina y caja conectadas en tiempo real.</h2>
        <div className="lg-funciones">
          {FUNCIONES.map(([ic, t, d]) => (
            <div key={t} className="lg-funcion">
              <Icono n={ic} tam={22} />
              <b>{t}</b>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lg-seccion" id="plan">
        <div className="lg-plan">
          <div>
            <p className="lg-eyebrow" style={{ color: '#a3a3a3' }}>Un solo plan</p>
            <h2 className="lg-h2" style={{ color: '#fff' }}>Todo incluido, sin contrato.</h2>
            <p className="lg-plan-txt">Mesas, cocina, caja, carta QR, reportes y usuarios ilimitados. Te ayudamos a cargar tu carta y a dejar todo listo.</p>
          </div>
          <div className="lg-plan-cta">
            <span className="lg-gratis">14 días gratis</span>
            <a className="lg-btn lg-btn-blanco" href="#prueba">
              Solicitar prueba gratis
            </a>
            <small>Sin tarjeta de crédito · sin contrato</small>
          </div>
        </div>
      </section>

      <section className="lg-seccion" id="prueba">
        <div className="lg-prueba">
          <div>
            <p className="lg-eyebrow">Prueba gratis</p>
            <h2 className="lg-h2">Prueba ReSystem 14 días en tu restaurante.</h2>
            <p className="lg-bajada" style={{ fontSize: 16 }}>Déjanos tus datos y te contactamos para dejar tu carta y tus mesas listas. Sin costo y sin compromiso.</p>
          </div>
          <FormPrueba />
        </div>
      </section>

      <footer className="lg-pie">
        <Marca tam={20} />
        <span>© {new Date().getFullYear()} ReSystem · Hecho en Chile</span>
      </footer>
    </div>
  )
}

// Formulario de prueba gratis: no guarda nada; arma un correo listo para que la persona solo toque «Enviar».
function FormPrueba() {
  const [d, setD] = useState({ nombre: '', restaurante: '', ciudad: '', telefono: '', correo: '', mesas: '', mensaje: '' })
  const [error, setError] = useState('')
  const [enlaces, setEnlaces] = useState(null)
  const cambiar = (k) => (e) => setD({ ...d, [k]: e.target.value })

  function enviar(e) {
    e.preventDefault()
    setError('')
    if (!d.nombre.trim() || !d.restaurante.trim() || d.telefono.replace(/\D/g, '').length < 8) {
      setError('Completa tu nombre, el nombre del restaurante y un teléfono válido.')
      return
    }
    if (!CORREO_CONTACTO) {
      setError('El formulario aún no tiene un correo configurado.')
      return
    }
    const l = correoSolicitud(d)
    setEnlaces(l)
    sentir('toque')
    window.location.href = l.mailto
  }

  return (
    <form className="lg-form" onSubmit={enviar} noValidate>
      <div className="lg-form-2">
        <div className="login-campo">
          <label htmlFor="p-nombre">Tu nombre</label>
          <input id="p-nombre" value={d.nombre} onChange={cambiar('nombre')} autoComplete="name" maxLength={80} />
        </div>
        <div className="login-campo">
          <label htmlFor="p-rest">Restaurante</label>
          <input id="p-rest" value={d.restaurante} onChange={cambiar('restaurante')} autoComplete="organization" maxLength={80} />
        </div>
        <div className="login-campo">
          <label htmlFor="p-tel">Teléfono</label>
          <input id="p-tel" type="tel" inputMode="tel" value={d.telefono} onChange={cambiar('telefono')} autoComplete="tel" placeholder="+56 9" maxLength={20} />
        </div>
        <div className="login-campo">
          <label htmlFor="p-correo">Correo <span className="lg-opc">(opcional)</span></label>
          <input id="p-correo" type="email" value={d.correo} onChange={cambiar('correo')} autoComplete="email" maxLength={80} />
        </div>
        <div className="login-campo">
          <label htmlFor="p-ciudad">Comuna o ciudad</label>
          <input id="p-ciudad" value={d.ciudad} onChange={cambiar('ciudad')} autoComplete="address-level2" maxLength={60} />
        </div>
        <div className="login-campo">
          <label htmlFor="p-mesas">¿Cuántas mesas tienen?</label>
          <select id="p-mesas" value={d.mesas} onChange={cambiar('mesas')}>
            <option value="">Elige una opción</option>
            <option>1 a 5</option>
            <option>6 a 15</option>
            <option>16 a 30</option>
            <option>Más de 30</option>
          </select>
        </div>
      </div>
      <div className="login-campo">
        <label htmlFor="p-msj">Comentario <span className="lg-opc">(opcional)</span></label>
        <textarea id="p-msj" rows={3} value={d.mensaje} onChange={cambiar('mensaje')} maxLength={500} placeholder="Ej: tenemos delivery, queremos usar la carta QR…" />
      </div>
      {error && (
        <div className="login-alerta error" role="alert">
          {error}
        </div>
      )}
      <button className="login-boton">Enviar solicitud</button>
      {enlaces ? (
        <p className="lg-form-nota">
          Se abrió tu app de correo con todo escrito: solo toca <b>Enviar</b>. ¿No se abrió?{' '}
          <a href={enlaces.gmail} target="_blank" rel="noreferrer">
            Ábrelo en Gmail
          </a>
          .
        </p>
      ) : (
        <p className="lg-form-nota">Al tocar el botón se abre tu correo con la solicitud lista para enviar.</p>
      )}
    </form>
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
        <h2 className="login-h">Recuperar contraseña</h2>
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
      <h2 className="login-h">Ingresar</h2>
      <p className="login-sub">Usa los datos que te dio tu restaurante.</p>

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
            <Icono n="check" tam={15} className="it" />
          </div>
          <h2 className="login-h">Contraseña actualizada</h2>
          <p className="login-sub">Tu nueva contraseña ya está activa.</p>
          <button className="login-boton" style={{ width: '100%' }} onClick={onListo}>
            Ir al panel
          </button>
        </div>
      ) : (
        <>
          <h2 className="login-h">Crea una nueva contraseña</h2>
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
