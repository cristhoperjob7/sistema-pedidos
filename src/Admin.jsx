import { useEffect, useState } from 'react'
import Personal from './Personal'
import Menu from './Menu'
import Local from './Local'
import Mesera from './Mesera'
import Cocina from './Cocina'
import Reporte from './Reporte'
import Caja from './Caja'
import CodigosQR from './CodigosQR'
import AvisosQR from './AvisosQR'
import Historial from './Historial'
import Inicio from './Inicio'
import ReporteMensual from './ReporteMensual'
import Estadisticas from './Estadisticas'
import Anclar from './Anclar'
import Icono from './iconos'
import { SelectorTema } from './tema'
import { sentir } from './feedback'
import './panel.css'

const ANGOSTO = { maxWidth: 860, margin: '0 auto', width: '100%' }
const ANCHO = { maxWidth: 1080, margin: '0 auto', width: '100%' }

// Secciones del menú lateral. "Operación" (Pedidos y Cocina) solo aparece cuando el administrador
// entra a operar el local: así, si solo quiere revisar números, no recibe sonidos de pedidos ni de cocina.
// El superadmin que entra a un restaurante solo ve "Negocio".
function secciones(conPedidos, operando) {
  return [
    { titulo: 'General', items: [['inicio', 'Inicio', 'inicio']] },
    conPedidos && operando && {
      titulo: 'Operación',
      items: [
        ['pedidos', 'Pedidos', 'orden'],
        ['cocina', 'Cocina', 'fuego'],
      ],
    },
    {
      titulo: 'Negocio',
      items: [
        ['menu', 'Menú', 'libro'],
        ['local', 'Mesas y ajustes', 'mesas'],
        ['qr', 'Carta y QR', 'qr'],
        ['personal', 'Personal', 'personas'],
      ],
    },
    conPedidos && {
      titulo: 'Análisis',
      items: [
        ['historial', 'Historial', 'recibo'],
        ['caja', 'Cierre de caja', 'caja'],
        ['reporte', 'Reporte diario', 'barras'],
        ['reporte_mes', 'Reporte mensual', 'barras'],
        ['estadisticas', 'Estadísticas', 'tendencia'],
      ],
    },
  ].filter(Boolean)
}

// Panel de administración de un restaurante. Lo usan su administrador y el superadmin.
// conPedidos: el administrador del restaurante también puede tomar pedidos (el superadmin no).
export default function Admin({ restaurante, scrollAlAbrir = false, conPedidos = false }) {
  const [tab, setTab] = useState('inicio')
  const [abierto, setAbierto] = useState(false) // cajón del celular
  const [operando, setOperando] = useState(false) // Pedidos y Cocina montados (con su sonido)
  const grupos = secciones(conPedidos, operando)
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
    if (id === 'pedidos' || id === 'cocina') setOperando(true)
    setTab(id)
    window.scrollTo({ top: 0 })
  }

  function entrarOperacion() {
    sentir('toque')
    setAbierto(false)
    setOperando(true)
    setTab('pedidos')
  }

  function salirOperacion() {
    sentir('toque')
    setAbierto(false)
    setOperando(false)
    setTab((t) => (t === 'pedidos' || t === 'cocina' ? 'inicio' : t))
  }

  // Otros botones del panel (por ejemplo, en los reportes) pueden pedir ir a una sección.
  useEffect(() => {
    const ir = (e) => typeof e.detail === 'string' && elegir(e.detail)
    window.addEventListener('panel-ir', ir)
    return () => window.removeEventListener('panel-ir', ir)
  })

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
          {conPedidos &&
            (operando ? (
              <div style={{ display: 'grid', gap: 6, padding: '4px 4px 8px' }}>
                <button className="btn btn-sec btn-bloque" onClick={salirOperacion}>
                  <Icono n="silencio" tam={17} className="it" /> Salir de la operación
                </button>
                <small className="suave" style={{ fontSize: 12, lineHeight: 1.3 }}>Recibes pedidos y sonidos de cocina.</small>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6, padding: '4px 4px 8px' }}>
                <button className="btn btn-principal btn-bloque" onClick={entrarOperacion}>
                  <Icono n="orden" tam={17} className="it" /> Entrar a la operación
                </button>
                <small className="suave" style={{ fontSize: 12, lineHeight: 1.3 }}>Tomar pedidos y ver la cocina. Fuera de ella no suena nada.</small>
              </div>
            ))}
          {grupos.map((g) => (
            <div key={g.titulo} style={{ display: 'grid', gap: 2 }}>
              <div className="lateral-sec">{g.titulo}</div>
              {g.items.map(([id, nombre, ic]) => (
                <button
                  key={id}
                  className="nav-item"
                  aria-current={tab === id ? 'page' : undefined}
                  onClick={() => elegir(id)}
                >
                  <Icono n={ic} tam={19} />
                  {nombre}
                </button>
              ))}
            </div>
          ))}
          <div className="lateral-pie">
            <SelectorTema />
          </div>
        </nav>

        <div style={{ minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          {/* Pedidos y Cocina quedan siempre montadas (solo se esconden) para que su conexión en vivo
              y el estado del sonido no se reinicien cada vez que se cambia de sección. */}
          {conPedidos && operando && (
            <div className="funde" style={{ display: tab === 'pedidos' ? 'block' : 'none' }}>
              <AvisosQR restaurante={restaurante} />
              <Mesera restaurante={restaurante} rol="admin" />
            </div>
          )}
          {conPedidos && operando && (
            <div className="funde" style={{ display: tab === 'cocina' ? 'block' : 'none' }}>
              <Cocina restaurante={restaurante} />
            </div>
          )}
          {!['pedidos', 'cocina'].includes(tab) && (
            <div key={tab} className="aparece" style={tab === 'inicio' ? ANCHO : ANGOSTO}>
              {tab === 'inicio' && <Inicio restaurante={restaurante} conPedidos={conPedidos} ir={elegir} />}
              {tab === 'historial' && conPedidos && <Historial restaurante={restaurante} />}
              {tab === 'caja' && <Caja restaurante={restaurante} />}
              {tab === 'reporte' && conPedidos && <Reporte restaurante={restaurante} />}
              {tab === 'reporte_mes' && conPedidos && <ReporteMensual restaurante={restaurante} />}
              {tab === 'estadisticas' && conPedidos && <Estadisticas restaurante={restaurante} onVolver={() => elegir('inicio')} />}
              {tab === 'menu' && <Menu restaurante={restaurante} />}
              {tab === 'local' && <Local restaurante={restaurante} />}
              {tab === 'qr' && <CodigosQR restaurante={restaurante} />}
              {tab === 'personal' && <Personal restaurante={restaurante} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
