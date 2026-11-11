import { useCallback, useEffect, useMemo, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { sentir } from './feedback'
import './inicio.css'

// =============================================================================================
// ASISTENTE DE CONFIGURACIÓN: lista guiada para dejar un local listo para trabajar.
// Cada paso se marca solo cuando detecta que ya está hecho; el último ("imprimir los QR") es manual
// porque nadie puede saber desde aquí si ya se imprimió.
//
// CÓMO AGREGAR UN PASO: agrega un objeto a PASOS (id, título, texto, ir) y una línea en `hechos`.
// =============================================================================================

const PASOS = [
  { id: 'menu', ic: 'libro', titulo: 'Cargar el menú', texto: 'Crea las categorías (platos, postres, bebidas) y agrega tus productos con su precio.', ir: 'menu', boton: 'Ir al Menú' },
  { id: 'mesas', ic: 'mesas', titulo: 'Crear las mesas', texto: 'Agrega la cantidad de mesas que tiene tu local para poder abrir cuentas.', ir: 'local', boton: 'Ir a Mesas' },
  { id: 'pagos', ic: 'tarjeta', titulo: 'Elegir métodos de pago', texto: 'Efectivo, tarjeta, transferencia… los que aceptes. Así el cierre de caja cuadra.', ir: 'local', boton: 'Ir a Ajustes' },
  { id: 'personal', ic: 'personas', titulo: 'Invitar al personal', texto: 'Crea el acceso de al menos una persona de salón. La cocina es opcional.', ir: 'personal', boton: 'Ir a Personal' },
  { id: 'pin', ic: 'candado', titulo: 'Definir tu PIN de caja', texto: 'Con este PIN autorizas la apertura de caja de cada mesera.', ir: 'caja', boton: 'Ir a Caja' },
  { id: 'carta', ic: 'qr', titulo: 'Personalizar la carta QR', texto: 'Sube el logo y escribe una frase de bienvenida para que tus clientes vean tu marca.', ir: 'qr', boton: 'Ir a Carta y QR' },
  { id: 'imprimir', ic: 'impresora', titulo: 'Imprimir y pegar los QR', texto: 'Imprime las tarjetas y déjalas en cada mesa. Márcalo cuando esté listo.', ir: 'qr', boton: 'Abrir QR', manual: true },
]

const llave = (rid) => `asistente_${rid}`
function leerLocal(rid) {
  try {
    return JSON.parse(localStorage.getItem(llave(rid)) ?? '{}')
  } catch {
    return {}
  }
}
function guardarLocal(rid, v) {
  try {
    localStorage.setItem(llave(rid), JSON.stringify(v))
  } catch {
    /* sin almacenamiento: solo se pierde el recuerdo */
  }
}

async function contar(consulta) {
  const { count, error } = await consulta
  return error ? null : count ?? 0
}

export default function Asistente({ restaurante, ir }) {
  const rid = restaurante.id
  const [hechos, setHechos] = useState(null)
  const [local, setLocal] = useState(() => leerLocal(rid))

  const revisar = useCallback(async () => {
    const cabeza = { count: 'exact', head: true }
    const [cats, prods, mesas, pagos, personal, pin, rest] = await Promise.all([
      contar(supabase.from('categorias').select('id', cabeza).eq('restaurante_id', rid).eq('activo', true)),
      contar(supabase.from('productos').select('id', cabeza).eq('restaurante_id', rid).eq('activo', true)),
      contar(supabase.from('mesas').select('id', cabeza).eq('restaurante_id', rid).eq('activo', true)),
      contar(supabase.from('metodos_pago').select('id', cabeza).eq('restaurante_id', rid).eq('activo', true)),
      contar(supabase.from('miembros').select('id', cabeza).eq('restaurante_id', rid).eq('rol', 'mesera').eq('activo', true)),
      supabase.rpc('tengo_pin_caja', { p_restaurante: rid }),
      supabase.from('restaurantes').select('logo_qr, landing').eq('id', rid).maybeSingle(),
    ])
    const landing = rest.data?.landing ?? {}
    setHechos({
      menu: (cats ?? 0) > 0 && (prods ?? 0) > 0,
      mesas: (mesas ?? 0) > 0,
      pagos: (pagos ?? 0) > 0,
      personal: (personal ?? 0) > 0,
      pin: pin.data === true,
      carta: !!rest.data?.logo_qr || !!landing.eslogan || !!landing.portada,
    })
  }, [rid])

  useEffect(() => {
    revisar()
  }, [revisar])

  const estado = useMemo(() => {
    if (!hechos) return null
    const lista = PASOS.map((p) => ({ ...p, listo: p.manual ? !!local.imprimir : !!hechos[p.id] }))
    const hechosN = lista.filter((p) => p.listo).length
    const siguiente = lista.find((p) => !p.listo)
    return { lista, hechosN, siguiente, total: lista.length }
  }, [hechos, local])

  if (!estado) return null
  if (estado.hechosN === estado.total && local.oculto) return null

  const pct = Math.round((estado.hechosN / estado.total) * 100)
  const completo = estado.hechosN === estado.total

  function cambiarLocal(cambio) {
    const nuevo = { ...local, ...cambio }
    setLocal(nuevo)
    guardarLocal(rid, nuevo)
  }

  if (local.oculto && !completo) {
    return (
      <button
        className="asist-mini"
        onClick={() => {
          sentir('toque')
          cambiarLocal({ oculto: false })
        }}
      >
        <Icono n="cohete" tam={16} /> Configuración del local · {estado.hechosN} de {estado.total}
        <Icono n="siguiente" tam={16} />
      </button>
    )
  }

  return (
    <section className="asist" aria-label="Asistente de configuración">
      <header className="asist-cab">
        <div
          className="asist-anillo"
          style={{ '--pct': `${pct}%` }}
          role="img"
          aria-label={`${pct}% completado`}
        >
          <b>{pct}%</b>
        </div>
        <div className="asist-tit">
          <h3>{completo ? '¡Tu local está listo!' : 'Deja tu local listo para atender'}</h3>
          <small className="suave">
            {completo
              ? 'Completaste todos los pasos. Ya puedes recibir clientes.'
              : `${estado.hechosN} de ${estado.total} pasos hechos · te faltan ${estado.total - estado.hechosN}`}
          </small>
        </div>
        <button
          className="btn btn-chico btn-sec"
          onClick={() => {
            sentir('toque')
            cambiarLocal({ oculto: true })
          }}
        >
          {completo ? 'Cerrar' : 'Ocultar'}
        </button>
      </header>

      <ol className="asist-lista">
        {estado.lista.map((p) => {
          const actual = estado.siguiente?.id === p.id
          return (
            <li key={p.id} className={`asist-paso${p.listo ? ' listo' : ''}${actual ? ' actual' : ''}`}>
              <span className="asist-marca" aria-hidden="true">
                {p.listo ? <Icono n="check" tam={14} ancho={3} /> : <Icono n={p.ic} tam={15} />}
              </span>
              <div className="asist-texto">
                <b>{p.titulo}</b>
                {actual && <small className="suave">{p.texto}</small>}
              </div>
              {!p.listo && (
                <div className="asist-acc">
                  <button
                    className={`btn btn-chico ${actual ? 'btn-morado' : 'btn-sec'}`}
                    onClick={() => {
                      ir(p.ir)
                    }}
                  >
                    {p.boton}
                  </button>
                  {p.manual && (
                    <button
                      className="btn btn-chico btn-sec"
                      onClick={() => {
                        sentir('exito')
                        cambiarLocal({ imprimir: true })
                      }}
                    >
                      Ya lo hice
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
