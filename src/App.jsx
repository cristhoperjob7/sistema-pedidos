import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Superadmin from './Superadmin'
import Admin from './Admin'
import Mesera from './Mesera'
import Cocina from './Cocina'
import Login, { NuevaClave, MARCA } from './Login'

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

  if (cargando) return <p style={estilos.caja}>Cargando...</p>
  if (recuperando && sesion) {
    return (
      <NuevaClave
        onListo={() => {
          limpiarDireccion()
          setRecuperando(false)
        }}
      />
    )
  }
  if (!sesion) return <Login avisoInicial={enlace.error} />
  return <Panel sesion={sesion} />
}

function Panel({ sesion }) {
  const [perfil, setPerfil] = useState(null)
  const [membresias, setMembresias] = useState([])
  const [error, setError] = useState('')

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

  return (
    <div>
      <header style={estilos.header}>
        <div>
          <b>{MARCA}</b> · {perfil ? perfil.nombre : '...'}
          {perfil?.es_superadmin ? ' (Superadmin)' : ''}
          {miembro ? ` · ${miembro.restaurantes.nombre}` : ''}
        </div>
        <button style={estilos.botonSec} onClick={() => supabase.auth.signOut()}>
          Cerrar sesión
        </button>
      </header>
      <main style={estilos.main}>
        {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}

        {perfil?.es_superadmin && <Superadmin />}

        {perfil && !perfil.es_superadmin && !miembro && (
          <p>Tu usuario no tiene un restaurante activo asignado.</p>
        )}

        {miembro && miembro.rol === 'admin' && <Admin restaurante={miembro.restaurantes} conPedidos />}

        {miembro && miembro.rol === 'mesera' && <Mesera restaurante={miembro.restaurantes} />}

        {miembro && miembro.rol === 'cocina' && <Cocina restaurante={miembro.restaurantes} />}
      </main>
    </div>
  )
}

const estilos = {
  caja: { maxWidth: 420, margin: '40px auto', padding: 20, display: 'grid', gap: 12 },
  botonSec: {
    padding: '8px 12px',
    fontSize: 14,
    borderRadius: 8,
    border: 'none',
    background: 'rgba(255,255,255,.2)',
    color: 'white',
    cursor: 'pointer',
  },
  header: {
    background: '#4B1E4D',
    color: 'white',
    padding: '14px 18px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  main: { maxWidth: 720, margin: '0 auto', padding: 16 },
}
