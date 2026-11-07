import { useEffect, useState } from 'react'
import Personal from './Personal'
import Menu from './Menu'
import Local from './Local'
import Mesera from './Mesera'
import Cocina from './Cocina'
import Reporte from './Reporte'
import Caja from './Caja'
import Historial from './Historial'
import ReporteMensual from './ReporteMensual'
import Anclar from './Anclar'
import Icono from './iconos'
import { SelectorTema } from './tema'
import { sentir } from './feedback'
import './panel.css'

const ANGOSTO = { maxWidth: 860, margin: '0 auto', width: '100%' }

// Secciones del menú lateral. "Operación" y "Análisis" solo existen cuando el administrador
// también atiende el local (el superadmin que entra a un restaurante solo ve "Negocio").
function secciones(conPedidos) {
  return [
    conPedidos && {
      titulo: 'Operación',
      items: [
        ['pedidos', 'Pedidos', 'orden'],
        ['cocina', 'Cocina', 'fuego'],
        ['historial', 'Historial', 'recibo'],
      ],
    },
    {
      titulo: 'Negocio',
      items: [
        ['menu', 'Menú', 'libro'],
        ['local', 'Mesas y ajustes', 'mesas'],
        ['personal', 'Personal', 'personas'],
      ],
    },
    conPedidos && {
      titulo: 'Análisis',
      items: [
        ['caja', 'Cierre de caja', 'caja'],
        ['reporte', 'Reporte diario', 'barras'],
        ['reporte_mes', 'Reporte mensual', 'barras'],
        ['estadisticas', 'Estadísticas', 'tendencia', true],
      ],
    },
  ].filter(Boolean)
}

function abrirEstadisticas() {
  const url = `${window.location.pathname}${window.location.search}#/estadisticas`
  const nueva = window.open(url, '_blank')
  if (!nueva) window.location.hash = '#/estadisticas'
}

// Panel de administración de un restaurante. Lo usan su administrador y el superadmin.
// conPedidos: el administrador del restaurante también puede tomar pedidos (el superadmin no).
export default function Admin({ restaurante, scrollAlAbrir = false, conPedidos = false }) {
  const [tab, setTab] = useState(conPedidos ? 'pedidos' : 'menu')
  const [abierto, setAbierto] = useState(false) // cajón del celular
  const grupos = secciones(conPedidos)
  const nombreActivo = grupos.flatMap((g) => g.items).find(([id]) => id === tab)?.[1]

  useEffect(() => {
    if (!abierto) return
    const alTeclear = (e) => e.key === 'Escape' && setAbierto(false)
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [abierto])

  function elegir(id) {
    sentir('toque')
    setAbierto(false)
    if (id === 'estadisticas') return abrirEstadisticas()
    setTab(id)
  }

  return (
    <div>
      {scrollAlAbrir && <Anclar block="start" />}
      <div className="panel">
        <button
          className="barra-movil"
          aria-expanded={abierto}
          aria-controls="menu-lateral"
          onClick={() => {
            sentir('toque')
            setAbierto(true)
          }}
        >
          <Icono n="menu" tam={22} />
          {nombreActivo}
          <small>Menú</small>
        </button>
        <div className={`velo${abierto ? ' abierto' : ''}`} onClick={() => setAbierto(false)} aria-hidden="true" />

        <nav id="menu-lateral" className={`lateral${abierto ? ' abierto' : ''}`} aria-label="Secciones del panel">
          {grupos.map((g) => (
            <div key={g.titulo} style={{ display: 'grid', gap: 2 }}>
              <div className="lateral-sec">{g.titulo}</div>
              {g.items.map(([id, nombre, ic, externo]) => (
                <button
                  key={id}
                  className="nav-item"
                  aria-current={tab === id ? 'page' : undefined}
                  onClick={() => elegir(id)}
                >
                  <Icono n={ic} tam={19} />
                  {nombre}
                  {externo && <Icono n="externo" tam={14} style={{}} />}
                </button>
              ))}
            </div>
          ))}
          <div className="lateral-pie">
            <SelectorTema />
          </div>
        </nav>

        <div style={{ minWidth: 0, display: 'grid', gap: 12 }}>
          {/* Pedidos y Cocina quedan siempre montadas (solo se esconden) para que su conexión en vivo
              y el estado del sonido no se reinicien cada vez que se cambia de sección. */}
          {conPedidos && (
            <div className="funde" style={{ display: tab === 'pedidos' ? 'block' : 'none' }}>
              <Mesera restaurante={restaurante} rol="admin" />
            </div>
          )}
          {conPedidos && (
            <div className="funde" style={{ display: tab === 'cocina' ? 'block' : 'none' }}>
              <Cocina restaurante={restaurante} />
            </div>
          )}
          {!['pedidos', 'cocina'].includes(tab) && (
            <div key={tab} className="aparece" style={ANGOSTO}>
              {tab === 'historial' && conPedidos && <Historial restaurante={restaurante} />}
              {tab === 'caja' && <Caja restaurante={restaurante} />}
              {tab === 'reporte' && conPedidos && <Reporte restaurante={restaurante} />}
              {tab === 'reporte_mes' && conPedidos && <ReporteMensual restaurante={restaurante} />}
              {tab === 'menu' && <Menu restaurante={restaurante} />}
              {tab === 'local' && <Local restaurante={restaurante} />}
              {tab === 'personal' && <Personal restaurante={restaurante} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
