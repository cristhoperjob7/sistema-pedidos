import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icono from './iconos'
import { supabase } from './supabase'
import SoporteLocal from './SoporteLocal'
import { Cargando, Confirmar, Interruptor, Mensaje } from './ui'
import { avisar, celebrar, sentir, sonar, vibrar } from './feedback'
import { fechaPlan } from './plan'
import './superadmin.css'

// Monedas sugeridas. Los campos siguen siendo editables para usar cualquier otra.
const MONEDAS = [
  { codigo: 'CLP', simbolo: '$', decimales: 0, nombre: 'Peso chileno' },
  { codigo: 'PEN', simbolo: 'S/', decimales: 2, nombre: 'Sol peruano' },
  { codigo: 'USD', simbolo: 'US$', decimales: 2, nombre: 'Dólar estadounidense' },
  { codigo: 'ARS', simbolo: '$', decimales: 2, nombre: 'Peso argentino' },
  { codigo: 'COP', simbolo: '$', decimales: 0, nombre: 'Peso colombiano' },
  { codigo: 'MXN', simbolo: '$', decimales: 2, nombre: 'Peso mexicano' },
  { codigo: 'BRL', simbolo: 'R$', decimales: 2, nombre: 'Real brasileño' },
  { codigo: 'EUR', simbolo: '€', decimales: 2, nombre: 'Euro' },
]

function crearSlug(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Zona horaria: define cuándo empieza cada día (el número de pedido vuelve a 1).
const ZONAS = [
  ['America/Santiago', 'Chile'],
  ['America/Lima', 'Perú'],
  ['America/Bogota', 'Colombia'],
  ['America/Argentina/Buenos_Aires', 'Argentina'],
  ['America/Mexico_City', 'México (centro)'],
  ['America/Sao_Paulo', 'Brasil (Brasilia)'],
  ['America/New_York', 'EE. UU. (este)'],
  ['Europe/Madrid', 'España'],
]

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`
const iniciales = (n) =>
  String(n ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '·'

function haceCuanto(iso) {
  if (!iso) return 'Sin pedidos'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 2) return 'Recién'
  if (min < 60) return `Hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `Hace ${h} h`
  const d = Math.round(h / 24)
  return `Hace ${d} ${d === 1 ? 'día' : 'días'}`
}

// Grupos, de lo más urgente a lo más tranquilo. Solo el punto lleva color: el panel se mantiene sobrio.
const GRUPOS = [
  ['lectura', 'Solo lectura', '#ef4444', 'Vencidos: no pueden operar'],
  ['sinpagar', 'Sin pagar', '#f97316', 'Venció la mensualidad, en días de gracia'],
  ['vence', 'Por vencer', '#eab308', 'Les quedan 7 días o menos'],
  ['prueba', 'En prueba', '#60a5fa', 'Prueba gratis de 14 días'],
  ['aldia', 'Al día', '#22c55e', 'Pagados'],
  ['piloto', 'Piloto', '#fbbf24', 'Gratis, sin vencimiento'],
  ['sincobro', 'Sin cobro', '#737373', 'El cobro está apagado'],
]
const GRUPO = Object.fromEntries(GRUPOS.map((g) => [g[0], g]))

function grupoDe(p) {
  if (!p) return 'sincobro'
  if (p.tipo === 'piloto') return 'piloto'
  if (p.estado === 'libre') return 'sincobro'
  if (p.estado === 'moroso') return 'lectura'
  if (p.estado === 'atrasado') return 'sinpagar'
  if (p.estado === 'prueba') return 'prueba'
  if (p.dias != null && p.dias <= 7) return 'vence'
  return 'aldia'
}

function detallePlan(p) {
  if (!p) return ''
  const d = p.dias
  const en = (n) => (n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`)
  switch (grupoDe(p)) {
    case 'lectura':
      return `Venció el ${fechaPlan(p.vence)}`
    case 'sinpagar':
      return `Se bloquea el ${fechaPlan(p.bloqueo)}`
    case 'vence':
      return `Vence ${en(d)}`
    case 'prueba':
      return `Termina ${en(d)}`
    case 'aldia':
      return `Pagado hasta ${fechaPlan(p.vence)}`
    case 'piloto':
      return 'Gratis'
    default:
      return 'Sin cobro'
  }
}

// Ventana para editar (en el celular sube desde abajo).
function Ventana({ abierta, titulo, sub, ini, ancha = false, onCerrar, children }) {
  useEffect(() => {
    if (!abierta) return
    const t = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', t)
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', t)
      document.body.style.overflow = previo
    }
  }, [abierta])
  if (!abierta) return null
  return createPortal(
    <div className="sa-velo" onClick={onCerrar}>
      <div className={`sa-ventana${ancha ? ' ancha' : ''}`} role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="sa-ventana-cab">
          {ini && <span className="sa-ini">{ini}</span>}
          <div>
            <b>{titulo}</b>
            {sub && <small>{sub}</small>}
          </div>
          <button className="sa-icono" onClick={onCerrar} aria-label="Cerrar">
            <Icono n="cerrar" tam={16} />
          </button>
        </div>
        <div className="sa-ventana-cuerpo">{children}</div>
      </div>
    </div>,
    document.body
  )
}

export default function Superadmin() {
  const [vista, setVista] = useState('locales')
  const [lista, setLista] = useState(null)
  const [cobro, setCobro] = useState(null) // cobro_panel (paso35)
  const [act, setAct] = useState(null) // superadmin_listado (paso37)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [buscar, setBuscar] = useState('')
  const [ventana, setVentana] = useState(null) // { tipo: 'soporte'|'plan'|'local'|'crear', r }

  async function cargar() {
    const [r, c, a] = await Promise.all([
      supabase.from('restaurantes').select('*').order('creado_en'),
      supabase.rpc('cobro_panel'),
      supabase.rpc('superadmin_listado'),
    ])
    if (r.error) return setError(r.error.message)
    setLista(r.data)
    setCobro(c.error ? null : c.data)
    setAct(a.error ? null : a.data)
    // Fotos de comprobantes revisados hace más de 60 días: se borran del depósito y se olvida su ruta.
    const viejas = c.data?.fotos_viejas ?? []
    if (viejas.length) {
      const { error: e2 } = await supabase.storage.from('comprobantes').remove(viejas.map((v) => v.foto))
      if (!e2) await supabase.rpc('olvidar_fotos_plan', { p_ids: viejas.map((v) => v.id) })
    }
  }
  useEffect(() => {
    cargar()
  }, [])

  if (!lista) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={80} />

  const planes = Object.fromEntries((cobro?.restaurantes ?? []).map((p) => [p.id, p]))
  const actividad = Object.fromEntries((act?.locales ?? []).map((x) => [x.id, x]))
  const pendientes = cobro?.pendientes ?? []
  const filas = lista.map((r) => ({ r, p: planes[r.id], a: actividad[r.id], g: grupoDe(planes[r.id]) }))
  const conteo = Object.fromEntries(GRUPOS.map(([g]) => [g, filas.filter((f) => f.g === g).length]))
  const sinUso = filas.filter((f) => f.r.activo && (!f.a?.ultimo_pedido || Date.now() - new Date(f.a.ultimo_pedido).getTime() > 3 * 86400000))
  const q = buscar.trim().toLowerCase()
  const visibles = filas.filter((f) => (filtro === 'todos' || f.g === filtro) && (!q || f.r.nombre.toLowerCase().includes(q) || f.r.slug.includes(q)))

  const abrir = (tipo, r = null) => {
    sentir('toque')
    setVentana({ tipo, r })
  }
  const cerrar = () => setVentana(null)
  const rActual = ventana?.r ? lista.find((x) => x.id === ventana.r.id) ?? ventana.r : null

  const NAV = [
    ['locales', 'Restaurantes', 'tienda'],
    ['cobros', 'Cobros', 'dinero', pendientes.length],
    ['ajustes', 'Ajustes de cobro', 'llave'],
  ]

  return (
    <div className="sa">
      <nav className="sa-nav" aria-label="Secciones">
        {NAV.map(([id, t, ic, n]) => (
          <button key={id} aria-current={vista === id ? 'page' : undefined} onClick={() => { sentir('toque'); setVista(id) }}>
            <Icono n={ic} tam={17} /> {t}
            {n ? <span className="sa-badge">{n}</span> : null}
          </button>
        ))}
      </nav>

      <div className="sa-main">
        <Mensaje tipo="error">{error}</Mensaje>

        {vista === 'locales' && (
          <>
            <div className="sa-cab">
              <h2>Restaurantes</h2>
              <input className="campo" style={{ width: 'min(260px, 100%)' }} placeholder="Buscar restaurante…" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar restaurante" />
              <button className="btn btn-principal" onClick={() => abrir('crear')}>+ Crear restaurante</button>
            </div>

            <div className="sa-kpis">
              <div className="sa-kpi">
                <small>Cobrado este mes</small>
                <b className="oro-texto">{pesos(act?.cobrado_mes)}</b>
                <i>{act ? `${act.pagando_mes} ${act.pagando_mes === 1 ? 'local pagó' : 'locales pagaron'}` : 'Ejecuta paso37'}</i>
              </div>
              <div className="sa-kpi">
                <small>Locales activos</small>
                <b>{lista.filter((r) => r.activo).length}</b>
                <i>{conteo.piloto} piloto · {conteo.prueba} en prueba</i>
              </div>
              <button className={`sa-kpi${pendientes.length ? ' oro' : ''}`} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer' }} onClick={() => setVista('cobros')}>
                <div className="sa-kpi" style={pendientes.length ? { borderColor: '#4a3a12' } : undefined}>
                  <small style={pendientes.length ? { color: '#fbbf24' } : undefined}>Pagos por revisar</small>
                  <b>{pendientes.length}</b>
                  <i>{pendientes[0] ? `${pendientes[0].nombre} · ${pesos(pendientes[0].monto)}` : 'Todo al día'}</i>
                </div>
              </button>
              <div className="sa-kpi">
                <small>Sin uso 3 días o más</small>
                <b style={sinUso.length ? { color: 'var(--rosa-tinta)' } : undefined}>{sinUso.length}</b>
                <i>{sinUso.length ? sinUso.slice(0, 2).map((f) => f.r.nombre).join(', ') : 'Todos lo están usando'}</i>
              </div>
            </div>

            <div className="sa-filtros" role="group" aria-label="Filtrar por estado">
              <button aria-pressed={filtro === 'todos'} onClick={() => setFiltro('todos')}>
                Todos <span>{filas.length}</span>
              </button>
              {GRUPOS.filter(([g]) => conteo[g] > 0).map(([g, t, c]) => (
                <button key={g} aria-pressed={filtro === g} onClick={() => setFiltro(filtro === g ? 'todos' : g)}>
                  <i className="sa-punto" style={{ background: c }} /> {t} <span>{conteo[g]}</span>
                </button>
              ))}
            </div>

            <div className="sa-tabla">
              <div className="sa-fila sa-encabezado">
                <span>Restaurante</span>
                <span>Plan</span>
                <span>Último pedido</span>
                <span className="sa-col-7d">Pedidos 7 d</span>
                <span className="sa-col-ventas">Ventas 7 d</span>
                <span style={{ textAlign: 'right' }}>Acciones</span>
              </div>
              {visibles.length === 0 && <div className="sa-vacio">No hay restaurantes con este filtro.</div>}
              {GRUPOS.map(([g, t, c, desc]) => {
                const delGrupo = visibles.filter((f) => f.g === g)
                if (!delGrupo.length) return null
                return (
                  <div key={g}>
                    <div className="sa-grupo">
                      <i className="sa-punto" style={{ background: c }} />
                      <b>{t}</b> · {delGrupo.length} <span style={{ fontWeight: 500 }}>— {desc}</span>
                    </div>
                    {delGrupo.map(({ r, p, a }) => (
                      <div key={r.id} className="sa-fila" style={r.activo ? undefined : { opacity: 0.55 }}>
                        <div className="sa-local">
                          <span className="sa-ini">{iniciales(r.nombre)}</span>
                          <div style={{ minWidth: 0 }}>
                            <b>
                              {r.nombre}
                              {!r.activo && <span className="sa-inactivo">Desactivado</span>}
                            </b>
                            <small>{r.slug}</small>
                          </div>
                        </div>
                        <div className="sa-plan">
                          <i className="sa-punto" style={{ background: c }} />
                          <div>
                            <b style={g === 'piloto' ? undefined : { fontWeight: 500 }}>{g === 'piloto' ? <span className="oro-texto">Piloto</span> : t}</b>
                            <small>{detallePlan(p)}</small>
                          </div>
                        </div>
                        <span className="sa-tenue">{a ? haceCuanto(a.ultimo_pedido) : '—'}</span>
                        <span className="sa-num sa-col-7d">{a ? a.pedidos_7d : '—'}</span>
                        <span className="sa-num sa-col-ventas">{a ? pesos(a.ventas_7d) : '—'}</span>
                        <div className="sa-acciones">
                          <button className="sa-icono" onClick={() => abrir('soporte', r)} title="Soporte" aria-label={`Soporte de ${r.nombre}`}>
                            <Icono n="ayuda" tam={16} />
                            <span>Soporte</span>
                          </button>
                          <button className="sa-icono" onClick={() => abrir('plan', r)} title="Plan y pagos" aria-label={`Plan y pagos de ${r.nombre}`}>
                            <Icono n="dinero" tam={16} />
                          </button>
                          <button className="sa-icono" onClick={() => abrir('local', r)} title="Ajustes del local" aria-label={`Ajustes de ${r.nombre}`}>
                            <Icono n="lapiz" tam={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
            {!cobro && <small className="suave">Para ver los planes, ejecuta paso35 en Supabase. Para la actividad de cada local, paso37.</small>}
          </>
        )}

        {vista === 'cobros' && <Cobros cobro={cobro} recargar={cargar} />}
        {vista === 'ajustes' && <AjustesCobro cobro={cobro} recargar={cargar} />}
      </div>

      <Ventana abierta={ventana?.tipo === 'soporte'} ancha titulo={`Soporte · ${rActual?.nombre ?? ''}`} sub="Personal, PIN de caja, correcciones y avisos" ini={iniciales(rActual?.nombre)} onCerrar={cerrar}>
        {rActual && <SoporteLocal restaurante={rActual} />}
      </Ventana>
      <Ventana abierta={ventana?.tipo === 'plan'} titulo="Plan y pagos" sub={rActual?.nombre} ini={iniciales(rActual?.nombre)} onCerrar={cerrar}>
        {rActual && <PlanLocal r={rActual} p={planes[rActual.id]} precio={cobro?.config?.precio} recargar={cargar} />}
      </Ventana>
      <Ventana abierta={ventana?.tipo === 'local'} titulo="Ajustes del local" sub={rActual?.nombre} ini={iniciales(rActual?.nombre)} onCerrar={cerrar}>
        {rActual && <AjustesLocal r={rActual} recargar={cargar} onEliminado={cerrar} />}
      </Ventana>
      <Ventana abierta={ventana?.tipo === 'crear'} titulo="Crear restaurante" sub="Luego agregas su personal desde Soporte" onCerrar={cerrar}>
        <CrearLocal onCreado={() => { cerrar(); cargar() }} />
      </Ventana>
    </div>
  )
}

// ---------- Plan y pagos de un local ----------
function PlanLocal({ r, p, precio, recargar }) {
  const [meses, setMeses] = useState('1')
  const [monto, setMonto] = useState(String(Math.round(precio ?? 0)))
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [error, setError] = useState('')
  if (!p) return <small className="suave">Ejecuta paso35_cobro_restaurantes.sql para manejar los planes.</small>
  const g = grupoDe(p)
  const [, t, c] = GRUPO[g]
  const piloto = p.tipo === 'piloto'

  async function correr(clave, fn, ok) {
    setError('')
    setOcupado(clave)
    const { data, error: e } = await fn()
    setOcupado('')
    if (e) return setError(e.message)
    sentir('ok')
    avisar(typeof ok === 'function' ? ok(data) : ok)
    recargar()
  }

  return (
    <>
      <div className="sa-kpi" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <i className="sa-punto" style={{ background: c, width: 10, height: 10 }} />
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 18 }}>{piloto ? <span className="oro-texto">Piloto</span> : t}</b>
          <div className="suave" style={{ fontSize: 13.5 }}>{detallePlan(p)}{p.pendiente ? ' · tiene un pago por revisar' : ''}</div>
        </div>
      </div>

      {!piloto && (
        <div style={{ display: 'grid', gap: 10 }}>
          <b>Registrar un pago</b>
          <small className="suave">Para un pago que te llegó sin que lo informaran (efectivo, transferencia directa…).</small>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <label className="etiqueta">Meses
              <input className="campo" inputMode="numeric" value={meses} onChange={(e) => setMeses(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="etiqueta">Monto
              <input className="campo" inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          <label className="etiqueta">Nota (opcional)
            <input className="campo" maxLength={40} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: efectivo" />
          </label>
          <button className="btn btn-principal" disabled={ocupado === 'pago'} onClick={() => correr('pago', () => supabase.rpc('registrar_pago_plan', { p_rid: r.id, p_meses: Number(meses) || 1, p_monto: Number(monto) || 0, p_nota: nota }), (d) => `${r.nombre} queda pagado hasta el ${fechaPlan(d?.hasta)}`)}>
            Registrar pago
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, paddingTop: 6, borderTop: '1px solid var(--linea)' }}>
        <b style={{ marginTop: 8 }}>Otras acciones</b>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!piloto && (
            <button className="btn btn-sec" disabled={ocupado === 'dias'} onClick={() => correr('dias', () => supabase.rpc('cambiar_plan', { p_rid: r.id, p_dias_prueba: 7 }), '7 días más de prueba')}>
              +7 días de prueba
            </button>
          )}
          <button className="btn btn-sec" disabled={ocupado === 'tipo'} onClick={() => correr('tipo', () => supabase.rpc('cambiar_plan', { p_rid: r.id, p_tipo: piloto ? 'normal' : 'piloto' }), piloto ? `${r.nombre} ahora paga normal` : `${r.nombre} queda como piloto (gratis)`)}>
            {piloto ? 'Pasar a plan normal' : 'Marcar como piloto (gratis)'}
          </button>
        </div>
        {piloto && <small className="suave">Al pasar a plan normal, si nunca ha pagado, parte con su prueba gratis desde hoy.</small>}
      </div>
      <Mensaje tipo="error">{error}</Mensaje>
    </>
  )
}

// ---------- Ajustes del local: zona horaria, activar/desactivar y eliminar ----------
function AjustesLocal({ r, recargar, onEliminado }) {
  const [error, setError] = useState('')
  const [borrando, setBorrando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [clave, setClave] = useState('')
  const [eliminando, setEliminando] = useState(false)

  async function cambiarZona(zona) {
    setError('')
    const { error: e } = await supabase.from('restaurantes').update({ zona_horaria: zona }).eq('id', r.id)
    if (e) return setError(e.message)
    sentir('toque', 'tic')
    avisar('Zona horaria guardada')
    recargar()
  }
  async function alternar(activo) {
    setError('')
    const { error: e } = await supabase.from('restaurantes').update({ activo }).eq('id', r.id)
    if (e) return setError(e.message)
    avisar(activo ? `${r.nombre} activado` : `${r.nombre} desactivado`, activo ? 'ok' : 'info')
    recargar()
  }
  async function eliminar() {
    setError('')
    if (nombre.trim() !== r.nombre.trim()) return setError('El nombre no coincide. Escríbelo exactamente igual.')
    if (!clave) return setError('Ingresa tu contraseña de superadmin.')
    setEliminando(true)
    const { data: quien } = await supabase.auth.getUser()
    const { error: eClave } = await supabase.auth.signInWithPassword({ email: quien?.user?.email, password: clave })
    if (eClave) {
      setEliminando(false)
      return setError('Contraseña incorrecta.')
    }
    const { error: e } = await supabase.from('restaurantes').delete().eq('id', r.id)
    setEliminando(false)
    if (e) return setError(e.message)
    sonar('baja')
    avisar(`"${r.nombre}" eliminado con todos sus datos`, 'borrar')
    setBorrando(false)
    onEliminado()
    recargar()
  }

  return (
    <>
      <div className="suave" style={{ fontSize: 14 }}>
        Código <b style={{ color: 'var(--tinta)' }}>{r.slug}</b> · {r.moneda_codigo} ({r.moneda_simbolo}), {r.moneda_decimales} decimales
      </div>
      <label className="etiqueta">
        Zona horaria (define cuándo empieza cada día)
        <select className="campo" value={r.zona_horaria ?? 'America/Santiago'} onChange={(e) => cambiarZona(e.target.value)}>
          {ZONAS.map(([z, n]) => (
            <option key={z} value={z}>{n} ({z})</option>
          ))}
        </select>
      </label>
      <Interruptor checked={!!r.activo} onChange={alternar}>
        Local activo (si lo desactivas, su personal no puede entrar)
      </Interruptor>
      <div style={{ paddingTop: 14, borderTop: '1px solid var(--linea)', display: 'grid', gap: 8 }}>
        <b>Zona de peligro</b>
        <small className="suave">Elimina el local con su menú, mesas, personal, pedidos y reportes. No se puede deshacer.</small>
        <button className="btn btn-peligro-suave" style={{ justifySelf: 'start' }} onClick={() => { setError(''); setBorrando(true) }}>
          Eliminar restaurante
        </button>
      </div>
      <Mensaje tipo="error">{!borrando && error}</Mensaje>
      <Confirmar
        abierto={borrando}
        titulo={`Vas a eliminar "${r.nombre}" para siempre`}
        texto="Se borran también su menú, mesas, personal, pedidos y reportes. No se puede deshacer."
        textoConfirmar="Eliminar definitivamente"
        trabajando={eliminando}
        error={borrando ? error : ''}
        onCancelar={() => { setBorrando(false); setNombre(''); setClave(''); setError('') }}
        onConfirmar={eliminar}
      >
        <label className="etiqueta">
          <span>Escribe el nombre exacto: <b>{r.nombre}</b></span>
          <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label className="etiqueta">
          Tu contraseña de superadmin
          <input type="password" className="campo" value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
      </Confirmar>
    </>
  )
}

// ---------- Crear restaurante ----------
const FORM_INICIAL = { nombre: '', slug: '', codigo: 'CLP', simbolo: '$', decimales: 0, zona: 'America/Santiago' }
function CrearLocal({ onCreado }) {
  const [form, setForm] = useState(FORM_INICIAL)
  const [slugManual, setSlugManual] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  function elegirMoneda(codigo) {
    const m = MONEDAS.find((x) => x.codigo === codigo)
    if (m) setForm((f) => ({ ...f, codigo: m.codigo, simbolo: m.simbolo, decimales: m.decimales }))
  }
  async function crear(e) {
    e.preventDefault()
    const boton = e.nativeEvent?.submitter
    setError('')
    if (!form.nombre.trim() || !form.slug.trim() || !form.codigo.trim() || !form.simbolo.trim()) {
      return setError('Completa el nombre, el código, la moneda y el símbolo.')
    }
    setGuardando(true)
    const { error: err } = await supabase.from('restaurantes').insert({
      nombre: form.nombre.trim(),
      slug: form.slug.trim(),
      moneda_codigo: form.codigo.trim().toUpperCase(),
      moneda_simbolo: form.simbolo.trim(),
      moneda_decimales: Number(form.decimales),
      zona_horaria: form.zona,
    })
    setGuardando(false)
    if (err) return setError(err.code === '23505' ? 'Ese código de restaurante ya existe, usa otro.' : err.message)
    celebrar(boton)
    vibrar('exito')
    sonar('exito')
    avisar(`Restaurante "${form.nombre.trim()}" creado`)
    onCreado()
  }
  const ejemplo = `${form.simbolo} ${(12.5).toFixed(Number(form.decimales) || 0)}`

  return (
    <form onSubmit={crear} style={{ display: 'grid', gap: 14 }}>
      <label className="etiqueta">
        Nombre del restaurante
        <input className="campo" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value, slug: slugManual ? f.slug : crearSlug(e.target.value) }))} autoFocus />
      </label>
      <label className="etiqueta">
        Código para el ingreso del personal
        <input className="campo" value={form.slug} autoCapitalize="none" onChange={(e) => { setSlugManual(true); setForm((f) => ({ ...f, slug: crearSlug(e.target.value) })) }} />
      </label>
      <label className="etiqueta">
        Moneda
        <select className="campo" value={form.codigo} onChange={(e) => elegirMoneda(e.target.value)}>
          {MONEDAS.map((m) => (
            <option key={m.codigo} value={m.codigo}>{m.nombre} ({m.codigo})</option>
          ))}
        </select>
      </label>
      <label className="etiqueta">
        Zona horaria
        <select className="campo" value={form.zona} onChange={(e) => setForm((f) => ({ ...f, zona: e.target.value }))}>
          {ZONAS.map(([z, n]) => (
            <option key={z} value={z}>{n} ({z})</option>
          ))}
        </select>
      </label>
      <small className="suave">Así se verán los precios: <b style={{ color: 'var(--tinta)' }}>{ejemplo}</b></small>
      <Mensaje tipo="error">{error}</Mensaje>
      <button className="btn btn-principal btn-grande" disabled={guardando}>
        {guardando ? <span className="puntos">Creando</span> : 'Crear restaurante'}
      </button>
    </form>
  )
}

// ---------- Cobros: pagos por revisar y últimos revisados ----------
function Cobros({ cobro, recargar }) {
  const [ocupado, setOcupado] = useState('')
  const [error, setError] = useState('')
  const [foto, setFoto] = useState(null)
  if (!cobro) return <Mensaje tipo="error">Ejecuta paso35_cobro_restaurantes.sql en Supabase para usar los cobros.</Mensaje>
  const pendientes = cobro.pendientes ?? []

  async function resolver(p, aprobar) {
    setError('')
    setOcupado(p.id)
    const { data, error: e } = await supabase.rpc('resolver_pago_plan', { p_id: p.id, p_aprobar: aprobar, p_motivo: null, p_meses: 1 })
    setOcupado('')
    if (e) return setError(e.message)
    if (data?.foto) supabase.storage.from('comprobantes').remove([data.foto]).catch(() => {})
    sentir('ok')
    avisar(aprobar ? `Aprobado: ${p.nombre} queda pagado hasta el ${fechaPlan(data?.hasta)}` : 'Pago rechazado')
    recargar()
  }
  async function mirar(p) {
    const { data, error: e } = await supabase.storage.from('comprobantes').createSignedUrl(p.foto, 300)
    if (e) return setError(e.message)
    setFoto(data.signedUrl)
  }

  return (
    <>
      <div className="sa-cab">
        <h2>Cobros</h2>
        {!cobro.config?.activo && <span className="suave" style={{ fontSize: 13.5 }}>El cobro está apagado (Ajustes de cobro)</span>}
      </div>
      <b>Pagos por revisar</b>
      {pendientes.length === 0 && <div className="sa-kpi suave">No hay pagos esperando revisión.</div>}
      {pendientes.map((p) => (
        <div key={p.id} className="sa-pago">
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <b style={{ fontSize: 15.5 }}>{p.nombre} informó un pago de {pesos(p.monto)}</b>
            <div className="suave" style={{ fontSize: 13.5 }}>Operación {p.operacion} · {fechaPlan(p.creado_en)} · búscala en tu cartola antes de aprobar</div>
          </div>
          {p.foto && <button className="btn btn-sec btn-chico" onClick={() => mirar(p)}>Ver comprobante</button>}
          <button className="btn btn-sec btn-chico" disabled={ocupado === p.id} onClick={() => resolver(p, false)}>Rechazar</button>
          <button className="btn btn-principal btn-chico" disabled={ocupado === p.id} onClick={() => resolver(p, true)}>Aprobar (1 mes)</button>
        </div>
      ))}
      <Mensaje tipo="error">{error}</Mensaje>
      {(cobro.recientes ?? []).length > 0 && (
        <>
          <b style={{ marginTop: 8 }}>Últimos pagos revisados</b>
          <div className="sa-tabla">
            {cobro.recientes.map((p, i) => (
              <div key={p.id} className="sa-fila" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto', gridTemplateAreas: 'none', ...(i === 0 ? { borderTop: 0 } : null) }}>
                <span>{p.nombre} · <b>{pesos(p.monto)}</b></span>
                <span className="sa-tenue">{fechaPlan(p.resuelto_en)}</span>
                <span className="sa-plan"><i className="sa-punto" style={{ background: p.estado === 'aprobado' ? '#22c55e' : '#ef4444' }} />{p.estado === 'aprobado' ? (p.manual ? 'Registrado a mano' : 'Aprobado') : 'Rechazado'}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {foto && createPortal(
        <div className="sa-velo" onClick={() => setFoto(null)}>
          <img src={foto} alt="Comprobante" style={{ maxWidth: '100%', maxHeight: '86vh', borderRadius: 12, background: '#fff' }} />
        </div>,
        document.body
      )}
    </>
  )
}

// ---------- Ajustes de cobro ----------
function AjustesCobro({ cobro, recargar }) {
  const [cfg, setCfg] = useState(cobro?.config ? { ...cobro.config } : null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  if (!cobro || !cfg) return <Mensaje tipo="error">Ejecuta paso35_cobro_restaurantes.sql en Supabase para usar los cobros.</Mensaje>

  async function guardar(activo = cfg.activo) {
    setError('')
    setOcupado(true)
    const { error: e } = await supabase.rpc('guardar_config_cobro', {
      p_activo: activo,
      p_precio: Number(cfg.precio) || 0,
      p_dias_prueba: Number(cfg.dias_prueba) || 0,
      p_dias_gracia: Number(cfg.dias_gracia) || 0,
      p_datos: cfg.datos_pago ?? '',
    })
    setOcupado(false)
    if (e) return setError(e.message)
    sentir('ok')
    avisar('Ajustes de cobro guardados')
    recargar()
  }

  return (
    <>
      <div className="sa-cab">
        <h2>Ajustes de cobro</h2>
      </div>
      <div className="sa-kpi" style={{ gap: 14 }}>
        <Interruptor checked={!!cfg.activo} disabled={ocupado} onChange={(v) => { setCfg((c) => ({ ...c, activo: v })); guardar(v) }}>
          Cobrar a los restaurantes
        </Interruptor>
        <small className="suave">
          {cfg.activo
            ? 'Los locales normales ven «Mi plan» y los avisos de vencimiento. Los piloto no ven nada.'
            : 'Apagado: ningún local ve nada del cobro. Al encenderlo, los locales que nunca han pagado reciben su prueba gratis desde ese día.'}
        </small>
      </div>
      <div className="sa-kpi" style={{ gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          <label className="etiqueta">Precio mensual
            <input className="campo" inputMode="numeric" value={cfg.precio ?? ''} onChange={(e) => setCfg({ ...cfg, precio: e.target.value.replace(/\D/g, '') })} />
          </label>
          <label className="etiqueta">Días de prueba
            <input className="campo" inputMode="numeric" value={cfg.dias_prueba ?? ''} onChange={(e) => setCfg({ ...cfg, dias_prueba: e.target.value.replace(/\D/g, '') })} />
          </label>
          <label className="etiqueta">Días de gracia
            <input className="campo" inputMode="numeric" value={cfg.dias_gracia ?? ''} onChange={(e) => setCfg({ ...cfg, dias_gracia: e.target.value.replace(/\D/g, '') })} />
          </label>
        </div>
        <label className="etiqueta">
          Datos para transferir: uno por línea, como «Titular: Tu nombre»
          <textarea className="campo" rows={6} maxLength={600} value={cfg.datos_pago ?? ''} onChange={(e) => setCfg({ ...cfg, datos_pago: e.target.value })} placeholder={'Titular: Tu nombre\nRUT: 12.345.678-9\nBanco: BancoEstado\nTipo de cuenta: Cuenta RUT\nN° de cuenta: 12345678\nCorreo: resystemapp@gmail.com'} style={{ width: '100%', boxSizing: 'border-box' }} />
        </label>
        <button className="btn btn-principal" style={{ justifySelf: 'start' }} disabled={ocupado} onClick={() => guardar()}>
          Guardar
        </button>
        <Mensaje tipo="error">{error}</Mensaje>
      </div>
    </>
  )
}
