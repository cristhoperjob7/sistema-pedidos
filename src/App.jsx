import { BotonTema } from './tema'
import Icono from './iconos'
import Agotados from './Agotados'
import { aplicarColores, quitarColores } from './paletas'
import Bienvenida, { guiaYaVista, marcarGuiaVista } from './Bienvenida'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Superadmin from './Superadmin'
import Admin from './Admin'
import Mesera from './Mesera'
import Turno from './Turno'
import CartaPublica, { rutaCarta } from './CartaPublica'
import Cocina from './Cocina'
import Estadisticas from './Estadisticas'
import Login, { NuevaClave, MARCA } from './Login'
import { Avisos, Cargando, BannerConexion } from './ui'
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

// La carta que escanean los clientes no pide iniciar sesión: se decide antes de cargar nada del personal.
export default function App() {
  const [carta] = useState(rutaCarta)
  return carta ? <CartaPublica slug={carta.slug} token={carta.token} /> : <AppPersonal />
}

function AppPersonal() {
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
      <BannerConexion />
    </div>
  )
}

const ROL_TEXTO = { admin: 'Administración', mesera: 'Salón', cocina: 'Cocina' }

// Cada perfil tiene su propio ícono y color en la cabecera, para distinguirlos de un vistazo.
const ICONO_PERFIL = {
  superadmin: { icono: 'escudo', fondo: '#a978ff', texto: 'Superadmin' },
  admin: { icono: 'maletin', fondo: 'var(--marca)', texto: 'Administración' },
  mesera: { icono: 'campana', fondo: 'var(--menta-tinta)', texto: 'Salón' },
  cocina: { icono: 'gorro', fondo: 'var(--aviso-tinta)', texto: 'Cocina' },
}

function Panel({ sesion }) {
  const [perfil, setPerfil] = useState(null)
  const [membresias, setMembresias] = useState([])
  const [error, setError] = useState('')
  const [guia, setGuia] = useState(false)
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
        .select('*, restaurantes(id, nombre, slug, moneda_codigo, moneda_simbolo, moneda_decimales, zona_horaria, color_marca, color_fondo)')
        .eq('usuario_id', sesion.user.id)
        .eq('activo', true)
      if (m.error) setError(m.error.message)
      else setMembresias(m.data)
    }
    cargar()
  }, [sesion])

  const miembro = membresias[0]

  // Colores del restaurante (los elige el superadmin). Al salir vuelven los del sistema; el login nunca cambia.
  const rest = membresias[0]?.restaurantes
  useEffect(() => {
    aplicarColores(rest)
    return () => quitarColores()
  }, [rest?.id, rest?.color_marca, rest?.color_fondo])

  // Primera vez que entra: se muestra la guía de su perfil (una sola vez por cuenta).
  useEffect(() => {
    if (miembro && !perfil?.es_superadmin && !guiaYaVista(sesion)) setGuia(true)
  }, [miembro, perfil, sesion])
  function cerrarGuia() {
    setGuia(false)
    marcarGuiaVista(sesion)
  }
  const clavePerfil = perfil?.es_superadmin ? 'superadmin' : (ICONO_PERFIL[miembro?.rol] ? miembro.rol : 'admin')
  const subtitulo = perfil?.es_superadmin
    ? 'Superadmin'
    : miembro
      ? `${miembro.restaurantes.nombre} · ${ROL_TEXTO[miembro.rol] ?? ''}`
      : ''

  return (
    <div>
      <header style={estilos.header}>
        <div style={estilos.headerInterior}>
          <span
            style={{ ...estilos.logo, background: ICONO_PERFIL[clavePerfil].fondo }}
            title={ICONO_PERFIL[clavePerfil].texto}
            aria-hidden="true"
          >
            <Icono n={ICONO_PERFIL[clavePerfil].icono} tam={22} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={estilos.marca}>{perfil ? perfil.nombre : MARCA}</b>
            <small style={estilos.sub}>{perfil ? subtitulo || MARCA : ' '}</small>
          </div>
          {miembro && ['admin', 'mesera', 'cocina'].includes(miembro.rol) && (
            <Agotados restaurante={miembro.restaurantes} soloPlatos={miembro.rol === 'cocina'} />
          )}
          {miembro && !perfil?.es_superadmin && (
            <button className="btn btn-chico btn-sec" style={{ width: 40, padding: 0, flex: 'none' }} aria-label="Ayuda: ver la guía" title="Ayuda" onClick={() => { sentir('toque'); setGuia(true) }}>
              <Icono n="ayuda" tam={18} />
            </button>
          )}
          <BotonTema />
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
      {guia && miembro && <Bienvenida rol={miembro.rol} onCerrar={cerrarGuia} />}
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
            <span className="vacio-icono"><Icono n="llave" tam={34} ancho={1.5} /></span>
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
            {miembro.rol === 'mesera' && (
              <Turno restaurante={miembro.restaurantes}>
                <Mesera restaurante={miembro.restaurantes} />
              </Turno>
            )}
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
    background: 'color-mix(in srgb, var(--sup) 90%, transparent)',
    WebkitBackdropFilter: 'blur(14px)',
    backdropFilter: 'blur(14px)',
    color: 'var(--tinta)',
    paddingTop: 'var(--seguro-arriba)',
    borderBottom: '1px solid var(--linea)',
  },
  headerInterior: {
    maxWidth: 1360,
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
    background: 'var(--marca)',
    color: '#0b1020',
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
  salir: { background: 'var(--lavanda)', color: 'var(--tinta)', border: '1px solid var(--linea)', flex: 'none' },
  main: { maxWidth: 1360, margin: '0 auto', padding: '16px 16px 32px' },
}
