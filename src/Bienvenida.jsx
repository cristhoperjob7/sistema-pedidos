import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import Icono from './iconos'
import { sentir } from './feedback'

// Guía de bienvenida: pasos cortos según el perfil. Se muestra sola la primera vez que la persona
// entra y se puede volver a ver con el botón "?" de la cabecera.
// "Ya la vi" se guarda en la cuenta (user_metadata), así no vuelve a salir en otro celular.
const PASOS = {
  admin: [
    { icono: 'maletin', titulo: '¡Bienvenido/a!', texto: 'Desde aquí administras todo el restaurante. Te muestro lo principal en un minuto.' },
    { icono: 'menu', titulo: 'Menú lateral', texto: 'En el menú de la izquierda (en el celular, el botón ☰) están el Menú, Mesas, Personal, Reportes y el resto de las secciones.' },
    { icono: 'libro', titulo: 'Carta de productos', texto: 'En “Menú” creas categorías y productos. Cada cambio se aplica solo cuando tocas “Guardar”.' },
    { icono: 'orden', titulo: 'Salón y Cocina', texto: 'También puedes ver los pedidos y la cocina desde tu panel, como si estuvieras en cada puesto.' },
    { icono: 'prohibido', titulo: 'Agotados', texto: 'El ícono de “prohibido” de arriba apaga por hoy lo que se acabó. Mañana vuelve solo.' },
    { icono: 'barras', titulo: 'Reportes', texto: 'Mira lo vendido por día y por mes, y las propinas, que se muestran aparte de las ventas.' },
  ],
  mesera: [
    { icono: 'campana', titulo: '¡Bienvenido/a al Salón!', texto: 'Aquí tomas los pedidos y cobras. Te muestro cómo funciona.' },
    { icono: 'mesas', titulo: 'Las mesas', texto: 'Toca una mesa libre para abrirla. Verde = libre, naranja = ocupada, y aparece “Lista” cuando cocina terminó.' },
    { icono: 'mas', titulo: 'Agrega productos', texto: 'Elige la categoría y toca “+” en cada producto. Si hay una nota (sin cebolla, bien cocido) puedes agregarla.' },
    { icono: 'orden', titulo: 'Tu orden', texto: 'Abajo hay una barra con el papel y el lápiz: tócala para revisar la orden y enviarla a cocina.' },
    { icono: 'siguiente', titulo: 'Para llevar', texto: 'Con el botón “Pedido para llevar” no necesitas mesa. Al final te pedirá el nombre del cliente, que es obligatorio.' },
    { icono: 'campana', titulo: 'Cuando está listo', texto: 'Te avisa con sonido. Toca “Entregado” y, si es para llevar, sigue directo al cobro.' },
    { icono: 'prohibido', titulo: 'Cobrar y agotados', texto: 'Al cobrar puedes sumar la propina sugerida (10%) o el monto que el cliente quiera. El ícono de “prohibido” marca lo que se acabó.' },
  ],
  cocina: [
    { icono: 'gorro', titulo: '¡Bienvenido/a a la Cocina!', texto: 'Aquí ves los pedidos en cuanto el salón los envía.' },
    { icono: 'fuego', titulo: 'Pedidos nuevos', texto: 'Llegan con un sonido, del más antiguo al más nuevo. Se distinguen los que son para llevar.' },
    { icono: 'siguiente', titulo: 'Márcalos como listos', texto: 'Cuando termines un pedido, toca “Listo”. Al salón le llega el aviso para retirarlo.' },
    { icono: 'cerrar', titulo: 'Anulaciones', texto: 'Si el salón anula algo, te aparece un aviso para que no lo prepares.' },
    { icono: 'prohibido', titulo: 'Agotados', texto: 'Si se acabó un plato, enciéndelo en el ícono de “prohibido” de arriba y desaparece del menú del salón.' },
  ],
}

const clave = (id) => `guia-vista-${id}`

export function guiaYaVista(sesion) {
  try {
    if (sesion.user.user_metadata?.guia_vista) return true
    return localStorage.getItem(clave(sesion.user.id)) === '1'
  } catch {
    return false
  }
}

export async function marcarGuiaVista(sesion) {
  try {
    localStorage.setItem(clave(sesion.user.id), '1')
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
  await supabase.auth.updateUser({ data: { guia_vista: true } }).catch(() => {})
}

export default function Bienvenida({ rol, onCerrar }) {
  const pasos = PASOS[rol] ?? PASOS.admin
  const [i, setI] = useState(0)
  const p = pasos[i]
  const ultimo = i === pasos.length - 1

  useEffect(() => {
    const tecla = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])

  return createPortal(
    <div className="hoja-velo funde" style={{ alignItems: 'center', padding: 16 }}>
      <div className="hoja sube" role="dialog" aria-modal="true" aria-label="Guía de bienvenida" style={{ borderRadius: 26, borderBottom: '1px solid var(--linea)', maxWidth: 420 }}>
        <div style={{ display: 'grid', gap: 14, padding: '26px 22px 18px', justifyItems: 'center', textAlign: 'center' }}>
          <span style={{ width: 72, height: 72, borderRadius: 22, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--marca) 16%, transparent)', color: 'var(--marca)' }}>
            <Icono n={p.icono} tam={34} />
          </span>
          <div key={i} className="aparece" style={{ display: 'grid', gap: 8, minHeight: 120, alignContent: 'start' }}>
            <h2 style={{ margin: 0 }}>{p.titulo}</h2>
            <p className="suave" style={{ margin: 0, fontSize: 16, lineHeight: 1.45 }}>{p.texto}</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }} aria-hidden="true">
            {pasos.map((_, k) => (
              <span key={k} style={{ width: k === i ? 20 : 7, height: 7, borderRadius: 9, background: k === i ? 'var(--marca)' : 'var(--linea)', transition: 'width 200ms' }} />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '0 22px 22px' }}>
          {i === 0 ? (
            <button className="btn btn-sec" style={{ flex: 1 }} onClick={() => { sentir('toque'); onCerrar() }}>
              Saltar
            </button>
          ) : (
            <button className="btn btn-sec" style={{ flex: 1 }} onClick={() => { sentir('toque'); setI(i - 1) }}>
              Atrás
            </button>
          )}
          <button
            className="btn btn-principal"
            style={{ flex: 2 }}
            onClick={() => {
              sentir('toque', 'tic')
              if (ultimo) onCerrar()
              else setI(i + 1)
            }}
          >
            {ultimo ? '¡Empezar!' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
