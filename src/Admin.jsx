import { useState } from 'react'
import Personal from './Personal'
import Menu from './Menu'
import Local from './Local'
import Mesera from './Mesera'
import Cocina from './Cocina'
import Reporte from './Reporte'
import ReporteMensual from './ReporteMensual'
import Anclar from './Anclar'
import { Desplegable } from './ui'
import { sentir } from './feedback'

const PESTANAS = [
  ['menu', 'Menú'],
  ['local', 'Mesas y ajustes'],
  ['personal', 'Personal'],
]

const ANGOSTO = { maxWidth: 860, margin: '0 auto', width: '100%' }

// Panel de administración de un restaurante. Lo usan su administrador y el superadmin.
// conPedidos: el administrador del restaurante también puede tomar pedidos (el superadmin no).
export default function Admin({ restaurante, scrollAlAbrir = false, conPedidos = false }) {
  const [tab, setTab] = useState(conPedidos ? 'pedidos' : 'menu')
  const [masAbierto, setMasAbierto] = useState(false)
  const pestanas = conPedidos
    ? [['pedidos', 'Pedidos'], ['cocina', 'Cocina'], ['reporte', 'Reporte'], ['reporte_mes', 'Reporte mensual'], ...PESTANAS]
    : PESTANAS

  // Las 2 primeras quedan siempre a la vista (lo que se usa todo el día); el resto
  // se esconde detrás de "Más" para que la barra no se desborde en el celular.
  const principales = pestanas.slice(0, 2)
  const secundarias = pestanas.slice(2)
  const tabEnSecundarias = secundarias.some(([id]) => id === tab)
  const nombreActivo = secundarias.find(([id]) => id === tab)?.[1]

  function elegir(id) {
    if (id !== tab) sentir('toque')
    setTab(id)
    setMasAbierto(false)
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {scrollAlAbrir && <Anclar block="start" />}
      <div style={ANGOSTO}>
        <div style={s.barra}>
          {principales.map(([id, nombre]) => (
            <button
              key={id}
              className="btn"
              style={tab === id ? s.on : s.off}
              aria-pressed={tab === id}
              onClick={() => elegir(id)}
            >
              {nombre}
            </button>
          ))}
          {secundarias.length > 0 && (
            <button
              className="btn"
              style={tabEnSecundarias ? s.on : s.off}
              onClick={() => {
                sentir('toque')
                setMasAbierto((v) => !v)
              }}
              aria-expanded={masAbierto}
            >
              <span style={s.textoMas}>{nombreActivo ?? 'Más'}</span>
              <span style={{ ...s.flecha, transform: masAbierto ? 'rotate(180deg)' : 'none' }} aria-hidden="true">
                ▾
              </span>
            </button>
          )}
        </div>
        <Desplegable abierto={masAbierto}>
          <div style={s.menu}>
            {secundarias.map(([id, nombre], i) => (
              <button
                key={id}
                className="aparece"
                style={{ ...(tab === id ? s.itemOn : s.item), animationDelay: `${i * 30}ms` }}
                onClick={() => elegir(id)}
              >
                {nombre}
                {tab === id && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </Desplegable>
      </div>

      {/* Pedidos y Cocina quedan siempre montadas (solo se esconden) para que su conexión en vivo
          y el estado del sonido no se reinicien cada vez que se cambia de pestaña. Al volver a
          mostrarse, el fundido se repite solo (sin mover nada: la barra fija de Pedidos no salta). */}
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
          {tab === 'reporte' && conPedidos && <Reporte restaurante={restaurante} />}
          {tab === 'reporte_mes' && conPedidos && <ReporteMensual restaurante={restaurante} />}
          {tab === 'menu' && <Menu restaurante={restaurante} />}
          {tab === 'local' && <Local restaurante={restaurante} />}
          {tab === 'personal' && <Personal restaurante={restaurante} />}
        </div>
      )}
    </div>
  )
}

const base = { flex: '1 1 0', minWidth: 0, borderRadius: 12, whiteSpace: 'normal', lineHeight: 1.15 }
const s = {
  barra: {
    display: 'flex',
    gap: 6,
    padding: 5,
    borderRadius: 16,
    background: 'rgba(255,255,255,.7)',
    border: '1px solid var(--linea)',
    boxShadow: 'var(--sombra)',
  },
  off: { ...base, background: 'transparent', color: 'var(--suave)' },
  on: {
    ...base,
    background: 'linear-gradient(180deg, #5c2a5f 0%, #4B1E4D 100%)',
    color: 'white',
    boxShadow: '0 6px 14px -8px rgba(75,30,77,.8)',
  },
  textoMas: { minWidth: 0, overflowWrap: 'anywhere' },
  flecha: { display: 'inline-block', transition: 'transform 320ms var(--resorte)' },
  menu: {
    display: 'grid',
    gap: 4,
    marginTop: 8,
    padding: 6,
    borderRadius: 16,
    background: 'white',
    border: '1px solid var(--linea)',
    boxShadow: 'var(--sombra-alta)',
  },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    textAlign: 'left',
    minHeight: 48,
    padding: '12px 14px',
    fontSize: 16,
    fontWeight: 700,
    borderRadius: 12,
    border: 'none',
    background: 'transparent',
    color: 'var(--tinta)',
  },
  itemOn: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    textAlign: 'left',
    minHeight: 48,
    padding: '12px 14px',
    fontSize: 16,
    fontWeight: 800,
    borderRadius: 12,
    border: 'none',
    background: 'var(--lavanda)',
    color: 'var(--morado)',
  },
}
