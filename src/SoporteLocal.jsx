import { useEffect, useRef, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import Personal from './Personal'
import { Cargando, Confirmar, Mensaje, Segmento } from './ui'
import { avisar, sentir } from './feedback'
import { formatear } from './moneda'

const FALTA_SQL = /soporte_|aviso_del_local|function .* does not exist|Could not find the function/i

function haceCuanto(iso) {
  if (!iso) return 'nunca'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 2) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

const hora = (iso) => new Date(iso).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// Soporte remoto de un local (solo superadmin): no toca su carta ni su diseño, solo lo que sirve para ayudar.
export default function SoporteLocal({ restaurante }) {
  const [parte, setParte] = useState('resumen')
  const caja = useRef(null)

  function cambiar(p) {
    setParte(p)
    // La pantalla va hacia lo nuevo: si el comienzo del panel quedó arriba, fuera de la vista, se baja hasta él.
    requestAnimationFrame(() => {
      const r = caja.current?.getBoundingClientRect()
      if (r && r.top < 70) window.scrollBy({ top: r.top - 80, behavior: 'smooth' })
    })
  }

  return (
    <div ref={caja} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, minWidth: 0 }}>
      <Segmento
        etiqueta="Herramientas de soporte"
        opciones={[
          ['resumen', 'Resumen'],
          ['personal', 'Personal'],
          ['pin', 'PIN caja'],
          ['correcciones', 'Corregir'],
        ]}
        valor={parte}
        onChange={cambiar}
      />
      {parte === 'resumen' && <Resumen restaurante={restaurante} />}
      {parte === 'personal' && <Personal restaurante={restaurante} />}
      {parte === 'pin' && <PinCaja restaurante={restaurante} />}
      {parte === 'correcciones' && <Correcciones restaurante={restaurante} />}
    </div>
  )
}

function useResumen(restaurante) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  async function cargar() {
    const { data, error: e } = await supabase.rpc('soporte_resumen', { p_restaurante: restaurante.id })
    if (e) setError(FALTA_SQL.test(e.message) ? 'Falta ejecutar paso36_superadmin_soporte.sql en Supabase.' : e.message)
    else setDatos(data)
  }
  useEffect(() => {
    cargar()
  }, [restaurante.id])
  return { datos, error, cargar }
}

// ---------- Resumen: actividad del local + aviso ----------
function Resumen({ restaurante }) {
  const { datos, error, cargar } = useResumen(restaurante)
  const [texto, setTexto] = useState('')
  const [horas, setHoras] = useState('24')
  const [guardando, setGuardando] = useState(false)
  const [errAviso, setErrAviso] = useState('')

  if (error) return <Mensaje tipo="error">{error}</Mensaje>
  if (!datos) return <Cargando filas={2} alto={60} />

  const inactivo = !datos.ultimo_pedido || Date.now() - new Date(datos.ultimo_pedido).getTime() > 3 * 86400000
  const kpis = [
    ['Último pedido', haceCuanto(datos.ultimo_pedido)],
    ['Pedidos hoy', datos.pedidos_hoy],
    ['Pedidos 7 días', datos.pedidos_7d],
    ['Ventas 7 días', formatear(datos.ventas_7d, restaurante)],
    ['Cuentas abiertas', datos.abiertos],
    ['Pedidos QR 7 días', datos.qr_7d],
    ['Personal activo', datos.personal],
    ['Mesas · productos', `${datos.mesas} · ${datos.productos}`],
  ]

  async function guardarAviso(t) {
    setErrAviso('')
    setGuardando(true)
    const { error: e } = await supabase.rpc('soporte_aviso', { p_restaurante: restaurante.id, p_texto: t, p_horas: Number(horas) || 24 })
    setGuardando(false)
    if (e) return setErrAviso(e.message)
    sentir('ok')
    avisar(t ? 'Aviso publicado' : 'Aviso quitado')
    setTexto('')
    cargar()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
      <section className="tarjeta" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ flex: 1 }}>Actividad</b>
          <span className={`msj ${inactivo ? 'msj-error' : 'msj-ok'}`} style={{ margin: 0, padding: '3px 10px', fontSize: 12, fontWeight: 700, borderRadius: 999 }}>
            {inactivo ? 'Sin uso en los últimos 3 días' : 'En uso'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))', gap: 10 }}>
          {kpis.map(([t, v]) => (
            <div key={t} style={{ padding: 12, borderRadius: 10, background: 'var(--lavanda)', border: '1px solid var(--linea)' }}>
              <small className="suave">{t}</small>
              <div style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>
        {inactivo && <small className="suave">Si el local no usa el sistema, escríbeles: puede que tengan una duda o un problema.</small>}
      </section>

      <section className="tarjeta" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
        <b>Aviso al local</b>
        <small className="suave">Un mensaje tuyo que todo su personal ve arriba de la pantalla. Ej: «Esta noche a las 23:00 habrá una actualización de 5 minutos».</small>
        {datos.aviso && (
          <div className="msj" style={{ margin: 0, background: 'var(--durazno)', color: 'var(--aviso-tinta)', border: '1px solid var(--borde-aviso)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ flex: 1 }}>
              <b>Publicado:</b> {datos.aviso}
              <br />
              <small>Visible hasta {hora(datos.aviso_hasta)}</small>
            </span>
            <button className="btn btn-chico btn-sec" disabled={guardando} onClick={() => guardarAviso('')}>Quitar</button>
          </div>
        )}
        <textarea className="campo" rows={2} maxLength={240} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe el aviso…" style={{ width: '100%', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="suave" style={{ fontSize: 14 }}>
            Visible por{' '}
            <select className="campo-chico" value={horas} onChange={(e) => setHoras(e.target.value)}>
              <option value="2">2 horas</option>
              <option value="12">12 horas</option>
              <option value="24">1 día</option>
              <option value="72">3 días</option>
              <option value="168">1 semana</option>
            </select>
          </label>
          <button className="btn btn-principal btn-chico" disabled={guardando || !texto.trim()} onClick={() => guardarAviso(texto)}>
            Publicar aviso
          </button>
        </div>
        <Mensaje tipo="error">{errAviso}</Mensaje>
      </section>
    </div>
  )
}

// ---------- PIN de caja de los administradores ----------
function PinCaja({ restaurante }) {
  const { datos, error, cargar } = useResumen(restaurante)
  const [pines, setPines] = useState({})
  const [ocupado, setOcupado] = useState('')
  const [err, setErr] = useState('')

  if (error) return <Mensaje tipo="error">{error}</Mensaje>
  if (!datos) return <Cargando filas={2} alto={60} />

  async function guardar(a) {
    setErr('')
    setOcupado(a.usuario_id)
    const { error: e } = await supabase.rpc('soporte_fijar_pin_caja', { p_restaurante: restaurante.id, p_usuario: a.usuario_id, p_pin: pines[a.usuario_id] ?? '' })
    setOcupado('')
    if (e) return setErr(e.message)
    sentir('ok')
    avisar(`PIN de ${a.nombre} actualizado`)
    setPines({ ...pines, [a.usuario_id]: '' })
    cargar()
  }

  return (
    <section className="tarjeta" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <b>PIN de caja</b>
      <small className="suave">Con este PIN cada administrador autoriza la apertura de caja y los descuentos. Si lo olvidó, ponle uno nuevo y díselo.</small>
      {datos.admins.length === 0 && <small className="suave">Este local no tiene administradores activos.</small>}
      {datos.admins.map((a) => (
        <div key={a.usuario_id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--linea)' }}>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <b>{a.nombre}</b>
            <div>
              <small className={a.tiene_pin ? 'suave' : ''} style={a.tiene_pin ? undefined : { color: 'var(--aviso-tinta)', fontWeight: 600 }}>
                {a.tiene_pin ? 'Tiene PIN' : 'Sin PIN todavía'}
              </small>
            </div>
          </div>
          <input
            className="campo-chico"
            inputMode="numeric"
            maxLength={4}
            placeholder="Nuevo PIN"
            aria-label={`Nuevo PIN de caja de ${a.nombre}`}
            value={pines[a.usuario_id] ?? ''}
            onChange={(e) => setPines({ ...pines, [a.usuario_id]: e.target.value.replace(/\D/g, '') })}
            style={{ width: 120 }}
          />
          <button className="btn btn-principal btn-chico" disabled={ocupado === a.usuario_id || (pines[a.usuario_id] ?? '').length !== 4} onClick={() => guardar(a)}>
            Guardar
          </button>
        </div>
      ))}
      <Mensaje tipo="error">{err}</Mensaje>
    </section>
  )
}

// ---------- Correcciones: eliminar pedidos malos y borrar los datos de prueba ----------
function Correcciones({ restaurante }) {
  const [dias, setDias] = useState(3)
  const [lista, setLista] = useState(null)
  const [error, setError] = useState('')
  const [borrar, setBorrar] = useState(null) // pedido a eliminar
  const [trabajando, setTrabajando] = useState(false)
  const [errConf, setErrConf] = useState('')
  const [pruebas, setPruebas] = useState(false)
  const [codigo, setCodigo] = useState('')

  async function cargar() {
    const { data, error: e } = await supabase.rpc('soporte_pedidos', { p_restaurante: restaurante.id, p_dias: dias })
    if (e) setError(FALTA_SQL.test(e.message) ? 'Falta ejecutar paso36_superadmin_soporte.sql en Supabase.' : e.message)
    else setLista(data ?? [])
  }
  useEffect(() => {
    cargar()
  }, [restaurante.id, dias])

  async function eliminar() {
    setErrConf('')
    setTrabajando(true)
    const { error: e } = await supabase.rpc('soporte_eliminar_pedido', { p_pedido: borrar.id })
    setTrabajando(false)
    if (e) return setErrConf(e.message)
    sentir('ok')
    avisar(`Pedido #${borrar.numero} eliminado`)
    setBorrar(null)
    cargar()
  }

  async function borrarPruebas() {
    setErrConf('')
    setTrabajando(true)
    const { data, error: e } = await supabase.rpc('soporte_borrar_pruebas', { p_restaurante: restaurante.id, p_confirmacion: codigo })
    setTrabajando(false)
    if (e) return setErrConf(e.message)
    sentir('ok')
    avisar(`Datos de prueba borrados (${data?.pedidos ?? 0} pedidos)`)
    setPruebas(false)
    setCodigo('')
    cargar()
  }

  const ESTADO = { abierto: ['Abierto', 'var(--aviso-tinta)'], pagado: ['Pagado', 'var(--menta-tinta)'], anulado: ['Anulado', 'var(--suave)'] }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
      <section className="tarjeta" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ flex: 1 }}>Pedidos recientes</b>
          <select className="campo-chico" value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
            <option value={1}>Último día</option>
            <option value={3}>Últimos 3 días</option>
            <option value={7}>Últimos 7 días</option>
            <option value={31}>Último mes</option>
          </select>
        </div>
        <small className="suave">Eliminar un pedido lo borra por completo, también sus pagos: deja de contar en la caja y en los reportes. Úsalo para pedidos hechos por error.</small>
        <Mensaje tipo="error">{error}</Mensaje>
        {!lista && !error && <Cargando filas={3} alto={52} />}
        {lista?.length === 0 && <small className="suave">No hay pedidos en este período.</small>}
        {lista?.map((p) => {
          const [et, col] = ESTADO[p.estado] ?? [p.estado, 'var(--suave)']
          return (
            <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--linea)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <b>#{p.numero}</b>
                  <span>{p.mesa ? `Mesa ${p.mesa}` : 'Para llevar'}</span>
                  <small style={{ color: col, fontWeight: 700 }}>{et}</small>
                  <small className="suave">{hora(p.creado_en)}</small>
                </div>
                <small className="suave" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.items || 'Sin productos'} · {formatear(p.total, restaurante)}
                </small>
              </div>
              <button className="btn btn-chico btn-peligro-suave" onClick={() => { setErrConf(''); setBorrar(p) }}>
                Eliminar
              </button>
            </div>
          )
        })}
      </section>

      <section className="tarjeta" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
        <b>Borrar datos de prueba</b>
        <small className="suave">
          Borra todos los pedidos, pagos, cajas y pedidos QR de este local, para que empiece a operar desde cero. El menú, las mesas, la carta y el personal no se tocan.
        </small>
        <button className="btn btn-peligro-suave" style={{ justifySelf: 'start' }} onClick={() => { setErrConf(''); setPruebas(true) }}>
          <Icono n="basura" tam={16} className="it" /> Borrar datos de prueba
        </button>
      </section>

      <Confirmar
        abierto={!!borrar}
        titulo={borrar ? `¿Eliminar el pedido #${borrar.numero}?` : ''}
        texto="Se borra por completo, con sus productos y pagos. No se puede deshacer."
        textoConfirmar="Eliminar pedido"
        trabajando={trabajando}
        error={errConf}
        onCancelar={() => setBorrar(null)}
        onConfirmar={eliminar}
      />
      <Confirmar
        abierto={pruebas}
        titulo={`¿Borrar todas las ventas de ${restaurante.nombre}?`}
        texto={`Para confirmar, escribe el código del local: ${restaurante.slug}`}
        textoConfirmar="Borrar todo"
        trabajando={trabajando}
        bloqueado={codigo.trim().toLowerCase() !== String(restaurante.slug).toLowerCase()}
        error={errConf}
        onCancelar={() => { setPruebas(false); setCodigo('') }}
        onConfirmar={borrarPruebas}
      >
        <input className="campo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder={restaurante.slug} autoCapitalize="none" autoCorrect="off" style={{ width: '100%', boxSizing: 'border-box' }} />
      </Confirmar>
    </div>
  )
}
