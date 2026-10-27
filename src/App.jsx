import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Superadmin from './Superadmin'
import Admin from './Admin'
import Mesera from './Mesera'
import Cocina from './Cocina'
import Estadisticas from './Estadisticas'
import Login, { NuevaClave, MARCA } from './Login'
import { Avisos, Cargando } from './ui'
import { sentir } from './feedback'

// Lee lo que Supabase deja en la dirección al volver del correo de recuperación.
function leerEnlace() {
  try {
    const datos = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1))
    return {
      recuperacion: datos.get('type') === 'recovery',
      error: datos.get('error_code') || datos.get('error') ? 'El enlace expiró o ya se usó. Pide uno nuevo.' : '',
    }
  } catch {
    return { recuperacion: false, error: '' }
  }
}

function limpiarDireccion() {
  window.history.replaceState(null, '', window.location.pathname)
}

export default function App() {
  const [sesion, setSesion] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enlace] = useState(leerEnlace)
  const [recuperando, setRecuperando] = useState(enlace.recuperacion)

  useEffect(() => {
    if (enlace.error) limpiarDireccion()
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true)
      setSesion(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [enlace.error])

  let contenido
  if (cargando) {
    contenido = (
      <div style={estilos.caja}>
        <Cargando filas={3} />
      </div>
    )
  } else if (recuperando && sesion) {
    contenido = (
      <NuevaClave
        onListo={() => {
          limpiarDireccion()
          setRecuperando(false)
        }}
      />
    )
  } else if (!sesion) {
    contenido = <Login avisoInicial={enlace.error} />
  } else {
    contenido = <Panel sesion={sesion} />
  }

  return (
    <div className="app">
      {contenido}
      <Avisos />
    </div>
  )
}

const ROL_TEXTO = { admin: 'Administración', mesera: 'Salón', cocina: 'Cocina' }

function Panel({ sesion }) {
  const [perfil, setPerfil] = useState(null)
  const [membresias, setMembresias] = useState([])
  const [error, setError] = useState('')
  const [ruta, setRuta] = useState(() => window.location.hash) // "#/estadisticas" abre la página de estadísticas

  useEffect(() => {
    const alCambiar = () => setRuta(window.location.hash)
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])

  // Si la página se abrió en una pestaña aparte, se cierra; si no se puede, se vuelve al panel.
  function volverDeEstadisticas() {
    sentir('toque')
    window.close()
    setTimeout(() => {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setRuta('')
    }, 150)
  }

  useEffect(() => {
    async function cargar() {
      const p = await supabase.from('perfiles').select('*').eq('id', sesion.user.id).single()
      if (p.error) {
        setError(p.error.message)
        return
      }
      setPerfil(p.data)

      const m = await supabase
        .from('miembros')
        .select('*, restaurantes(id, nombre, slug, moneda_codigo, moneda_simbolo, moneda_decimales, zona_horaria)')
        .eq('usuario_id', sesion.user.id)
        .eq('activo', true)
      if (m.error) setError(m.error.message)
      else setMembresias(m.data)
    }
    cargar()
  }, [sesion])

  const miembro = membresias[0]
  const subtitulo = perfil?.es_superadmin
    ? 'Superadmin'
    : miembro
      ? `${miembro.restaurantes.nombre} · ${ROL_TEXTO[miembro.rol] ?? ''}`
      : ''

  return (
    <div>
      <header style={estilos.header}>
        <div style={estilos.headerInterior}>
          <span style={estilos.logo} aria-hidden="true">
            🍽️
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={estilos.marca}>{perfil ? perfil.nombre : MARCA}</b>
            <small style={estilos.sub}>{perfil ? subtitulo || MARCA : ' '}</small>
          </div>
          <button
            className="btn btn-chico"
            style={estilos.salir}
            onClick={() => {
              sentir('toque')
              supabase.auth.signOut()
            }}
          >
            Salir
          </button>
        </div>
      </header>
      <main style={estilos.main}>
        {error && <p className="msj msj-error">Error: {error}</p>}

        {!perfil && !error && <Cargando filas={4} alto={72} />}

        {perfil?.es_superadmin && (
          <div className="aparece">
            <Superadmin />
          </div>
        )}

        {perfil && !perfil.es_superadmin && !miembro && (
          <div className="vacio aparece">
            <span className="vacio-icono">🔑</span>
            <b>Tu usuario no tiene un restaurante activo asignado.</b>
            <span>Pídele al administrador que revise tu acceso.</span>
          </div>
        )}

        {miembro && miembro.rol === 'admin' && ruta === '#/estadisticas' && (
          <div className="aparece">
            <Estadisticas restaurante={miembro.restaurantes} onVolver={volverDeEstadisticas} />
          </div>
        )}

        {miembro && !(miembro.rol === 'admin' && ruta === '#/estadisticas') && (
          <div className="aparece">
            {miembro.rol === 'admin' && <Admin restaurante={miembro.restaurantes} conPedidos />}
            {miembro.rol === 'mesera' && <Mesera restaurante={miembro.restaurantes} />}
            {miembro.rol === 'cocina' && <Cocina restaurante={miembro.restaurantes} />}
          </div>
        )}
      </main>
    </div>
  )
}

const estilos = {
  caja: { maxWidth: 420, margin: '40px auto', padding: 20 },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
    background: 'linear-gradient(135deg, rgba(92,42,95,.96) 0%, rgba(75,30,77,.96) 100%)',
    WebkitBackdropFilter: 'blur(12px)',
    backdropFilter: 'blur(12px)',
    color: 'white',
    paddingTop: 'var(--seguro-arriba)',
    boxShadow: '0 6px 20px -12px rgba(43,16,45,.6)',
  },
  headerInterior: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    flex: 'none',
    display: 'grid',
    placeItems: 'center',
    width: 38,
    height: 38,
    borderRadius: 12,
    background: 'linear-gradient(180deg, #FFC23D, #F2A900)',
    fontSize: 19,
  },
  marca: {
    display: 'block',
    fontSize: 16,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  sub: {
    display: 'block',
    fontSize: 13,
    opacity: 0.8,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  salir: { background: 'rgba(255,255,255,.14)', color: 'white', flex: 'none' },
  main: { maxWidth: 1100, margin: '0 auto', padding: '16px 16px 32px' },
}
