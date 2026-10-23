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
  const pestanas = conPedidos
    ? [['pedidos', 'Pedidos'], ['cocina', 'Cocina'], ['reporte', 'Reporte'], ['reporte_mes', 'Reporte mensual'], ...PESTANAS]
    : PESTANAS

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {scrollAlAbrir && <Anclar block="start" />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {pestanas.map(([id, nombre]) => (
          <button key={id} style={tab === id ? s.on : s.off} onClick={() => setTab(id)}>
            {nombre}
          </button>
        ))}
      </div>
      {tab === 'pedidos' && conPedidos && <Mesera restaurante={restaurante} />}
      {tab === 'cocina' && conPedidos && <Cocina restaurante={restaurante} />}
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
}
