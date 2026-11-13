import { cloneElement, isValidElement, useCallback, useEffect, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { formatear, leerPrecio, soloPrecio } from './moneda'
import { Cargando, Confirmar, Mensaje } from './ui'
import { avisar, sentir } from './feedback'
import AvisosQR from './AvisosQR'

const hora = (iso, zona) =>
  new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: zona })

// Puerta de la mesera: sin caja abierta no entra al salón.
// Para abrirla hace falta un admin que la autorice con su PIN y el fondo inicial en efectivo.
export default function Turno({ restaurante, children }) {
  const $ = (v) => formatear(v, restaurante)
  const [cargando, setCargando] = useState(true)
  const [turno, setTurno] = useState(null)
  const [yo, setYo] = useState(null)
  const [admins, setAdmins] = useState([])
  const [admin, setAdmin] = useState('')
  const [pin, setPin] = useState('')
  const [fondo, setFondo] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [contado, setContado] = useState('')
  const [nota, setNota] = useState('')
  const [errorCierre, setErrorCierre] = useState('')
  const [resultado, setResultado] = useState(null)
  const [otraCaja, setOtraCaja] = useState(null) // { nombre, abierto_en } si la caja la tiene otra persona
  const [sinCaja, setSinCaja] = useState(false) // entró solo a tomar pedidos

  const cargar = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser()
    const uid = u?.user?.id
    const [t, a, m, c] = await Promise.all([
      supabase.from('turnos_caja').select('*').eq('restaurante_id', restaurante.id).eq('usuario_id', uid).is('cerrado_en', null).maybeSingle(),
      supabase.rpc('admins_para_caja', { p_restaurante: restaurante.id }),
      supabase.from('miembros').select('nombre').eq('restaurante_id', restaurante.id).eq('usuario_id', uid).maybeSingle(),
      supabase.rpc('caja_abierta', { p_restaurante: restaurante.id }),
    ])
    setOtraCaja(c.data && !c.data.mia ? c.data : null)
    if (!c.data || c.data.mia) setSinCaja(false)
    setTurno(t.data ?? null)
    setAdmins(a.data ?? [])
    setYo(m.data?.nombre ?? '')
    if (a.data?.length === 1) setAdmin((x) => x || a.data[0].usuario_id)
    setCargando(false)
  }, [restaurante.id])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function abrir(e) {
    e.preventDefault()
    setError('')
    const fondoN = leerPrecio(fondo || '0', restaurante)
    if (!admin) return setError('Elige quién autoriza.')
    if (!/^\d{4}$/.test(pin)) return setError('El PIN del administrador tiene 4 dígitos.')
    if (fondoN == null) return setError('El fondo inicial no es válido.')
    setTrabajando(true)
    const { data, error } = await supabase.rpc('abrir_turno', {
      p_restaurante: restaurante.id,
      p_admin: admin,
      p_pin: pin,
      p_fondo: fondoN,
    })
    setTrabajando(false)
    setPin('')
    if (error || !data?.ok) {
      sentir('toque', 'error')
      cargar()
      return setError(error?.message ?? data?.error ?? 'No se pudo abrir la caja.')
    }
    sentir('toque', 'exito')
    setResultado(null)
    setFondo('')
    avisar('Caja abierta', 'ok')
    cargar()
  }

  async function cerrar() {
    const n = leerPrecio(contado, restaurante)
    if (contado === '' || n == null) return setErrorCierre('Escribe el efectivo que contaste (puede ser 0).')
    setTrabajando(true)
    setErrorCierre('')
    const { data, error } = await supabase.rpc('cerrar_turno', { p_turno: turno.id, p_contado: n, p_nota: nota })
    setTrabajando(false)
    if (error) return setErrorCierre(error.message)
    sentir('toque', 'exito')
    setCerrando(false)
    setContado('')
    setNota('')
    setResultado(data)
    setTurno(null)
  }

  if (cargando) return <Cargando filas={3} alto={72} />

  // ---- Con caja abierta: barra pequeña + el salón
  if (turno) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={s.barra}>
          <span style={{ minWidth: 0 }}>
            <b>Caja abierta</b>
            <small className="suave" style={{ display: 'block' }}>
              Desde {hora(turno.abierto_en, restaurante.zona_horaria)} · fondo {$(turno.fondo_inicial)}
            </small>
          </span>
          <button className="btn btn-sec btn-chico" onClick={() => { sentir('toque'); setCerrando(true) }}>
            Cerrar mi caja
          </button>
        </div>
        <AvisosQR restaurante={restaurante} />
        {children}
        <Confirmar
          abierto={cerrando}
          titulo="Cerrar mi caja"
          texto="Cuenta el efectivo que tienes y escríbelo. El sistema lo compara con lo que debería haber."
          textoConfirmar="Cerrar caja"
          peligro={false}
          trabajando={trabajando}
          error={errorCierre}
          onCancelar={() => { setCerrando(false); setErrorCierre('') }}
          onConfirmar={cerrar}
        >
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 700 }}>Efectivo contado</span>
            <input className="campo-chico" inputMode="decimal" placeholder="Todo el efectivo de tu caja" value={contado} onChange={(e) => setContado(soloPrecio(e.target.value, restaurante))} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 700 }}>Nota (opcional)</span>
            <input className="campo-chico" maxLength={500} placeholder="Ej: devolví vuelto de más" value={nota} onChange={(e) => setNota(e.target.value)} />
          </label>
        </Confirmar>
      </div>
    )
  }

  // ---- La caja la tiene otra persona y se entró solo a tomar pedidos
  if (sinCaja && otraCaja) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={s.barra}>
          <span style={{ minWidth: 0 }}>
            <b>Sin caja · solo pedidos</b>
            <small className="suave" style={{ display: 'block' }}>
              La caja la tiene {otraCaja.nombre}: cobra esa persona.
            </small>
          </span>
          <button className="btn btn-sec btn-chico" onClick={() => { sentir('toque'); setSinCaja(false); cargar() }}>
            Abrir mi caja
          </button>
        </div>
        <AvisosQR restaurante={restaurante} />
        {isValidElement(children) ? cloneElement(children, { cajaDe: otraCaja.nombre }) : children}
      </div>
    )
  }

  // ---- Sin caja: formulario de apertura
  const dif = resultado ? Number(resultado.diferencia) : null
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 420, margin: '0 auto' }}>
      {resultado && (
        <div className="tarjeta aparece" style={{ padding: 14, display: 'grid', gap: 6 }}>
          <b>Tu caja quedó cerrada <Icono n="check" tam={15} className="it" /></b>
          <div style={s.fila}><span>Debería haber</span><b>{$(resultado.esperado)}</b></div>
          <div style={s.fila}><span>Contaste</span><b>{$(resultado.contado)}</b></div>
          <p style={{ margin: 0, fontWeight: 800, color: Math.abs(dif) < 0.005 ? 'var(--menta-tinta)' : 'var(--rosa-tinta)' }}>
            {Math.abs(dif) < 0.005 ? <><Icono n="check" tam={15} className="it" /> Cuadra perfecto</> : dif > 0 ? `Sobran ${$(dif)}` : `Faltan ${$(-dif)}`}
          </p>
          <small className="suave">Entrega el efectivo según lo acordado. El cierre del día lo hace la administración.</small>
        </div>
      )}

      {otraCaja ? (
        <div className="tarjeta aparece" style={{ padding: 18, display: 'grid', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>La caja ya está abierta</h2>
            <small className="suave">
              La tiene <b>{otraCaja.nombre}</b> desde {hora(otraCaja.abierto_en, restaurante.zona_horaria)}. Solo puede haber una caja abierta a la vez:
              para abrir la tuya, primero tiene que cerrarse esa (la cierra esa persona o un administrador en Cierre de caja).
            </small>
          </div>
          <button className="btn btn-principal" onClick={() => { sentir('toque'); setSinCaja(true) }}>
            Entrar a tomar pedidos (sin cobrar)
          </button>
          <button className="btn btn-sec" onClick={() => { sentir('toque'); cargar() }}>
            Ya la cerraron · revisar de nuevo
          </button>
        </div>
      ) : (
      <form className="tarjeta" style={{ padding: 18, display: 'grid', gap: 14 }} onSubmit={abrir}>
        <div>
          <h2 style={{ margin: 0 }}>Abrir caja</h2>
          <small className="suave">Para empezar a atender, un administrador debe autorizar tu caja.</small>
        </div>

        <div style={s.fila}>
          <span className="suave">Atiende</span>
          <b>{yo || 'Tú'}</b>
        </div>

        {admins.length === 0 ? (
          <Mensaje tipo="error">
            Ningún administrador ha creado su PIN de autorización todavía. Pídele que lo cree en Cierre de caja.
          </Mensaje>
        ) : (
          <>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontWeight: 700 }}>Administrador que autoriza</span>
              <select className="campo-chico" value={admin} onChange={(e) => setAdmin(e.target.value)}>
                <option value="">Elige…</option>
                {admins.map((a) => (
                  <option key={a.usuario_id} value={a.usuario_id}>{a.nombre}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontWeight: 700 }}>PIN del administrador</span>
              <input
                className="campo-chico"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="4 dígitos"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontWeight: 700 }}>Fondo inicial en efectivo</span>
              <small className="suave">El dinero con el que parte tu caja (puede ser 0).</small>
              <input className="campo-chico" inputMode="decimal" placeholder="0" value={fondo} onChange={(e) => setFondo(soloPrecio(e.target.value, restaurante))} />
            </label>
            <Mensaje tipo="error">{error}</Mensaje>
            <button className="btn btn-principal" disabled={trabajando}>
              {trabajando ? <span className="puntos">Validando</span> : 'Abrir caja'}
            </button>
          </>
        )}
      </form>
      )}
    </div>
  )
}

// El admin define (o cambia) su PIN de autorización. No es su clave de ingreso.
export function PinCaja({ restaurante }) {
  const [tiene, setTiene] = useState(null)
  const [editando, setEditando] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => {
    supabase.rpc('tengo_pin_caja', { p_restaurante: restaurante.id }).then(({ data }) => setTiene(!!data))
  }, [restaurante.id])

  async function guardar() {
    if (!/^\d{4}$/.test(pin)) return setError('Son exactamente 4 dígitos.')
    setTrabajando(true)
    setError('')
    const { error } = await supabase.rpc('fijar_pin_caja', { p_restaurante: restaurante.id, p_pin: pin })
    setTrabajando(false)
    if (error) return setError(error.message)
    sentir('toque', 'exito')
    avisar('PIN de autorización guardado', 'ok')
    setTiene(true)
    setEditando(false)
    setPin('')
  }

  if (tiene == null) return null
  return (
    <div className="tarjeta" style={{ padding: 14, display: 'grid', gap: 8 }}>
      <b>Mi PIN para autorizar cajas</b>
      <small className="suave">
        Las meseras piden tu PIN para abrir su caja. {tiene ? 'Ya tienes uno definido.' : 'Aún no defines el tuyo: sin él no puedes autorizar.'}
      </small>
      {editando ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="campo-chico"
            style={{ maxWidth: 140 }}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4 dígitos"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <button className="btn btn-principal btn-chico" disabled={trabajando} onClick={guardar}>Guardar</button>
          <button className="btn btn-sec btn-chico" onClick={() => { setEditando(false); setPin(''); setError('') }}>Cancelar</button>
        </div>
      ) : (
        <button className="btn btn-sec btn-chico" style={{ justifySelf: 'start' }} onClick={() => setEditando(true)}>
          {tiene ? 'Cambiar PIN' : 'Crear PIN'}
        </button>
      )}
      <Mensaje tipo="error">{error}</Mensaje>
    </div>
  )
}

const s = {
  barra: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: 'var(--sup)', border: '1px solid var(--linea)' },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
}
