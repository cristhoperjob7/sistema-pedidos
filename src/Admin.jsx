import { useState } from 'react'
import Personal from './Personal'
import Menu from './Menu'
import Local from './Local'
import Mesera from './Mesera'
import Cocina from './Cocina'
import Reporte from './Reporte'
import ReporteMensual from './ReporteMensual'
import Anclar from './Anclar'

const PESTANAS = [
  ['menu', 'Menú'],
  ['local', 'Mesas y ajustes'],
  ['personal', 'Personal'],
]

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
    setTab(id)
    setMasAbierto(false)
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {scrollAlAbrir && <Anclar block="start" />}
      <div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {principales.map(([id, nombre]) => (
            <button key={id} style={tab === id ? s.on : s.off} onClick={() => elegir(id)}>
              {nombre}
            </button>
          ))}
          {secundarias.length > 0 && (
            <button
              style={tabEnSecundarias ? s.on : s.off}
              onClick={() => setMasAbierto((v) => !v)}
              aria-expanded={masAbierto}
            >
              {nombreActivo ?? 'Más'} {masAbierto ? '▴' : '▾'}
            </button>
          )}
        </div>
        {masAbierto && (
          <div className="aparece" style={s.menu}>
            {secundarias.map(([id, nombre]) => (
              <button key={id} style={tab === id ? s.itemOn : s.item} onClick={() => elegir(id)}>
                {nombre}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Pedidos y Cocina quedan siempre montadas (solo se esconden con CSS) para que su
          conexión en vivo y el estado del sonido no se reinicien cada vez que el admin
          cambia de pestaña y vuelve. */}
      {conPedidos && (
        <div style={{ display: tab === 'pedidos' ? 'block' : 'none' }}>
          <Mesera restaurante={restaurante} />
        </div>
      )}
      {conPedidos && (
        <div style={{ display: tab === 'cocina' ? 'block' : 'none' }}>
          <Cocina restaurante={restaurante} />
        </div>
      )}
      {tab === 'reporte' && conPedidos && <Reporte restaurante={restaurante} />}
      {tab === 'reporte_mes' && conPedidos && <ReporteMensual restaurante={restaurante} />}
      {tab === 'menu' && <Menu restaurante={restaurante} />}
      {tab === 'local' && <Local restaurante={restaurante} />}
      {tab === 'personal' && <Personal restaurante={restaurante} />}
    </div>
  )
}

const s = {
  off: { padding: '10px 14px', fontSize: 15, borderRadius: 8, border: '1px solid #bbb', background: 'white', cursor: 'pointer' },
  on: { padding: '10px 14px', fontSize: 15, fontWeight: 700, borderRadius: 8, border: '1px solid #4B1E4D', background: '#4B1E4D', color: 'white', cursor: 'pointer' },
  menu: {
    display: 'grid',
    gap: 4,
    marginTop: 8,
    padding: 8,
    borderRadius: 12,
    background: '#f4f0f6',
    border: '1px solid #e2dce8',
  },
  item: { textAlign: 'left', padding: '12px 14px', fontSize: 15, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer' },
  itemOn: { textAlign: 'left', padding: '12px 14px', fontSize: 15, fontWeight: 700, borderRadius: 8, border: 'none', background: 'white', color: '#4B1E4D', cursor: 'pointer' },
}
