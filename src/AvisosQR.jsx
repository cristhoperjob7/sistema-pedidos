import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { formatear } from './moneda'
import { Confirmar, Interruptor, Mensaje } from './ui'
import { avisar, sentir } from './feedback'

const MIN_VENCE = 45 // minutos que un pedido por confirmar sigue vigente

const hace = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'recién' : m === 1 ? 'hace 1 min' : `hace ${m} min`
}

// Lo que mandan los clientes desde el celular: pedidos por confirmar y llamados a la mesera.
// Se muestra arriba del salón (y del panel del admin) y avisa con sonido cuando llega algo nuevo.
export default function AvisosQR({ restaurante }) {
  const $ = (v) => formatear(v, restaurante)
  const [pedidos, setPedidos] = useState([])
  const [llamados, setLlamados] = useState([])
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(null) // id que se está resolviendo
  const [rechazando, setRechazando] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [bloquear, setBloquear] = useState(false)
  const [, reloj] = useState(0)
  const vistos = useRef(null) // ids ya conocidos; null en la primera carga para no avisar de golpe
  const temporizador = useRef(null)

  const cargar = useCallback(async () => {
    const rid = restaurante.id
    const desde = new Date(Date.now() - MIN_VENCE * 60000).toISOString()
    const [p, l] = await Promise.all([
      supabase
        .from('pedidos_qr')
        .select('*, mesas(numero, nombre)')
        .eq('restaurante_id', rid)
        .eq('estado', 'pendiente')
        .gt('creado_en', desde)
        .order('creado_en'),
      supabase
        .from('llamados_mesa')
        .select('*, mesas(numero, nombre)')
        .eq('restaurante_id', rid)
        .is('atendido_en', null)
        .gt('creado_en', new Date(Date.now() - 2 * 3600000).toISOString())
        .order('creado_en'),
    ])
    if (p.error || l.error) return // tablas aún sin crear (paso22): no se muestra nada
    const ids = new Set([...(p.data ?? []).map((x) => x.id), ...(l.data ?? []).map((x) => x.id)])
    if (vistos.current) {
      const nuevo = [...ids].some((id) => !vistos.current.has(id))
      if (nuevo) {
        sentir('aviso', 'listo')
        avisar('Llegó un aviso de un cliente', 'info')
      }
    }
    vistos.current = ids
    setPedidos(p.data ?? [])
    setLlamados(l.data ?? [])
  }, [restaurante.id])

  useEffect(() => {
    cargar()
    const programar = () => {
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(cargar, 250)
    }
    const filtro = `restaurante_id=eq.${restaurante.id}`
    const canal = supabase
      .channel(`qr-${restaurante.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_qr', filter: filtro }, programar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'llamados_mesa', filter: filtro }, programar)
      .subscribe()
    const minuto = setInterval(() => {
      reloj((n) => n + 1) // actualiza los "hace X min"
      cargar() // y descarta lo vencido
    }, 60000)
    return () => {
      clearTimeout(temporizador.current)
      clearInterval(minuto)
      supabase.removeChannel(canal)
    }
  }, [cargar, restaurante.id])

  async function aprobar(p) {
    setOcupado(p.id)
    setError('')
    const { error } = await supabase.rpc('aprobar_pedido_qr', { p_id: p.id })
    setOcupado(null)
    if (error) {
      setError(error.message)
      cargar()
      return
    }
    sentir('toque', 'exito')
    avisar('Pedido aprobado y enviado a cocina', 'ok')
    cargar()
  }

  async function rechazar() {
    const p = rechazando
    setOcupado(p.id)
    const { data, error } = await supabase.rpc('rechazar_pedido_qr', { p_id: p.id, p_motivo: motivo, p_bloquear: bloquear })
    setOcupado(null)
    if (error) {
      setError(error.message)
      return
    }
    setRechazando(null)
    setMotivo('')
    setBloquear(false)
    if (data?.bloqueado) {
      avisar(
        data.automatico
          ? 'Hubo 3 rechazos seguidos: se pausaron los pedidos de esa mesa por 30 min. El admin puede desbloquearla.'
          : 'Pedidos pausados en esa mesa por 30 min. El admin puede desbloquearla.',
        'info'
      )
    }
    cargar()
  }

  async function atender(l) {
    setOcupado(l.id)
    const { error } = await supabase.rpc('atender_llamado', { p_id: l.id })
    setOcupado(null)
    if (error) return setError(error.message)
    sentir('toque')
    cargar()
  }

  if (pedidos.length === 0 && llamados.length === 0 && !error) return null

  const nombreMesa = (x) =>
    x.mesa_id ? `Mesa ${x.mesas?.numero ?? '?'}${x.mesas?.nombre ? ` · ${x.mesas.nombre}` : ''}` : `🥡 Para llevar · ${x.cliente ?? ''}`

  return (
    <div className="aparece" style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
      <Mensaje tipo="error">{error}</Mensaje>

      {llamados.map((l) => (
        <div key={l.id} style={s.llamado}>
          <span style={{ minWidth: 0 }}>
            <b>{l.tipo === 'cuenta' ? '🧾 Pide la cuenta' : '🔔 Te llaman'}</b>
            <small style={{ display: 'block' }}>
              {nombreMesa(l)} · {hace(l.creado_en)}
            </small>
          </span>
          <button className="btn btn-chico btn-sec" disabled={ocupado === l.id} onClick={() => atender(l)}>
            Atendido
          </button>
        </div>
      ))}

      {pedidos.map((p) => (
        <div key={p.id} className="tarjeta" style={{ padding: 12, display: 'grid', gap: 8, borderColor: 'var(--borde-aviso)' }}>
          <div style={s.fila}>
            <b>📲 Pedido por confirmar · {nombreMesa(p)}</b>
            <small className="suave">{hace(p.creado_en)}</small>
          </div>
          <div style={{ display: 'grid', gap: 2 }}>
            {p.items.map((i, k) => (
              <div key={k} style={s.fila}>
                <span>
                  <b>{i.cantidad}×</b> {i.nombre}
                  {i.nota ? <small className="suave" style={{ display: 'block' }}>“{i.nota}”</small> : null}
                </span>
                <small className="suave">{$(i.cantidad * i.precio)}</small>
              </div>
            ))}
          </div>
          <div style={s.fila}>
            <b>Total {$(p.total)}</b>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-chico btn-sec" disabled={ocupado === p.id} onClick={() => { sentir('toque'); setRechazando(p) }}>
                Rechazar
              </button>
              <button className="btn btn-chico btn-principal" disabled={ocupado === p.id} onClick={() => aprobar(p)}>
                {ocupado === p.id ? <span className="puntos">Enviando</span> : 'Aprobar y enviar'}
              </button>
            </span>
          </div>
        </div>
      ))}

      <Confirmar
        abierto={!!rechazando}
        titulo="¿Rechazar este pedido?"
        texto="El cliente verá que no se pudo tomar. Puedes dejarle un motivo (opcional)."
        textoConfirmar={bloquear ? 'Rechazar y bloquear' : 'Sí, rechazar'}
        trabajando={!!rechazando && ocupado === rechazando.id}
        onCancelar={() => { setRechazando(null); setMotivo(''); setBloquear(false) }}
        onConfirmar={rechazar}
      >
        <input className="campo-chico" maxLength={200} placeholder="Ej: se acabó la salsa, ¿lo cambiamos?" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <Interruptor checked={bloquear} onChange={setBloquear}>
          <b>Es una broma: bloquear {rechazando?.mesa_id ? 'esta mesa' : 'los pedidos para llevar'} 30 min</b>
          <small className="suave" style={{ display: 'block' }}>
            Nadie podrá pedir desde el celular ahí por un rato. El administrador puede desbloquear cuando quiera.
          </small>
        </Interruptor>
      </Confirmar>
    </div>
  )
}

const s = {
  llamado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: 'var(--durazno)', border: '1px solid var(--borde-aviso)', color: 'var(--aviso-tinta)' },
  fila: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
}
