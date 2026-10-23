import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Campo from './Campo'

// Mesas, métodos de pago y ajustes de cocina de un restaurante.
export default function Local({ restaurante }) {
  const [mesas, setMesas] = useState([])
  const [pagos, setPagos] = useState([])
  const [aj, setAj] = useState(null)
  const [nuevoPago, setNuevoPago] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [confMesa, setConfMesa] = useState(null) // id de la mesa a eliminar, o 'todas'

  async function cargar() {
    const m = await supabase.from('mesas').select('*').eq('restaurante_id', restaurante.id).order('numero')
    const p = await supabase.from('metodos_pago').select('*').eq('restaurante_id', restaurante.id).order('orden')
    const a = await supabase.from('ajustes').select('*').eq('restaurante_id', restaurante.id).maybeSingle()
    const err = m.error || p.error || a.error
    if (err) setError(err.message)
    else {
      setMesas(m.data)
      setPagos(p.data)
      setAj(a.data)
    }
  }

  useEffect(() => {
    cargar()
  }, [restaurante.id])

  async function actualizar(tabla, filtro, campos) {
    setError('')
    setAviso('')
    const { error } = await supabase.from(tabla).update(campos).match(filtro)
    if (error) {
      setError(error.message)
      return false
    }
    cargar()
    return true
  }

  // El primer número libre: si se eliminó la mesa 3, la próxima que se agregue vuelve a ser la 3.
  const siguienteMesa = (() => {
    const usados = new Set(mesas.map((m) => m.numero))
    let n = 1
    while (usados.has(n)) n++
    return n
  })()

  async function agregarMesa() {
    setError('')
    setAviso('')
    const { error } = await supabase.from('mesas').insert({ restaurante_id: restaurante.id, numero: siguienteMesa })
    if (error) setError(error.message)
    else cargar()
  }

  async function eliminarMesas(m) {
    setError('')
    setAviso('')
    let consulta = supabase.from('mesas').delete()
    consulta = m ? consulta.eq('id', m.id) : consulta.eq('restaurante_id', restaurante.id)
    const { error } = await consulta
    setConfMesa(null)
    if (error) setError(error.message)
    else {
      setAviso(m ? `Mesa ${m.numero} eliminada.` : 'Se eliminaron todas las mesas.')
      cargar()
    }
  }

  async function agregarPago(e) {
    e.preventDefault()
    setError('')
    const nombre = nuevoPago.trim()
    if (!nombre) return setError('Escribe el nombre del método de pago.')
    const orden = pagos.reduce((mx, p) => Math.max(mx, p.orden), 0) + 1
    const { error } = await supabase.from('metodos_pago').insert({ restaurante_id: restaurante.id, nombre, orden })
    if (error) return setError(error.message)
    setNuevoPago('')
    cargar()
  }

  async function guardarNombrePago(p, texto) {
    const nombre = texto.trim()
    if (!nombre) {
      setError('El nombre no puede quedar vacío.')
      return false
    }
    return actualizar('metodos_pago', { id: p.id }, { nombre })
  }

  async function guardarMinutos(campo, texto) {
    const n = Number(texto)
    if (!Number.isInteger(n) || n < 1 || n > 240) {
      setError('Escribe un número entero de minutos, entre 1 y 240.')
      return false
    }
    const amarilla = campo === 'alerta_amarilla_min' ? n : aj.alerta_amarilla_min
    const roja = campo === 'alerta_roja_min' ? n : aj.alerta_roja_min
    if (roja <= amarilla) {
      setError('La alerta roja debe ser mayor que la amarilla.')
      return false
    }
    const ok = await actualizar('ajustes', { restaurante_id: restaurante.id }, { [campo]: n })
    if (ok) setAviso('Ajuste guardado.')
    return ok
  }

  return (
    <div style={s.pagina}>
      {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
      {aviso && <p style={{ color: 'green', margin: 0 }}>{aviso}</p>}

      <section style={s.caja}>
        <h3 style={{ margin: 0 }}>Mesas</h3>
        <small>
          El nombre es opcional (ej: “Terraza 1”). Una mesa con la cuenta abierta no se puede eliminar. Las ventas
          antiguas de una mesa eliminada se conservan en los reportes.
        </small>
        {mesas.length === 0 && <small>No hay mesas. Agrega la primera.</small>}
        {mesas.map((m) => (
          <div key={m.id} style={{ ...s.fila, opacity: m.activo ? 1 : 0.55 }}>
            <b style={{ minWidth: 70 }}>Mesa {m.numero}</b>
            <Campo
              style={{ ...s.input, flex: 1, minWidth: 140 }}
              placeholder="Nombre (opcional)"
              valor={m.nombre ?? ''}
              onGuardar={(t) => actualizar('mesas', { id: m.id }, { nombre: t.trim() || null })}
            />
            {!m.activo && (
              <button style={s.botonSec} onClick={() => actualizar('mesas', { id: m.id }, { activo: true })}>
                Activar
              </button>
            )}
            {confMesa === m.id ? (
              <>
                <button style={s.peligro} onClick={() => eliminarMesas(m)}>
                  Sí, eliminar
                </button>
                <button style={s.botonSec} onClick={() => setConfMesa(null)}>
                  No
                </button>
              </>
            ) : (
              <button style={s.botonSec} onClick={() => setConfMesa(m.id)}>
                Eliminar
              </button>
            )}
          </div>
        ))}
        <div style={s.fila}>
          <button style={{ ...s.boton, flex: 1 }} onClick={agregarMesa}>
            Agregar mesa {siguienteMesa}
          </button>
          {mesas.length > 1 &&
            (confMesa === 'todas' ? (
              <>
                <b style={{ flexBasis: '100%' }}>¿Eliminar las {mesas.length} mesas?</b>
                <button style={s.peligro} onClick={() => eliminarMesas(null)}>
                  Sí, eliminar todas
                </button>
                <button style={s.botonSec} onClick={() => setConfMesa(null)}>
                  No
                </button>
              </>
            ) : (
              <button style={s.botonSec} onClick={() => setConfMesa('todas')}>
                Eliminar todas
              </button>
            ))}
        </div>
      </section>

      <section style={s.caja}>
        <h3 style={{ margin: 0 }}>Métodos de pago</h3>
        {pagos.map((p) => (
          <div key={p.id} style={{ ...s.fila, opacity: p.activo ? 1 : 0.55 }}>
            <Campo
              style={{ ...s.input, flex: 1, minWidth: 140 }}
              valor={p.nombre}
              onGuardar={(t) => guardarNombrePago(p, t)}
            />
            <button style={s.botonSec} onClick={() => actualizar('metodos_pago', { id: p.id }, { activo: !p.activo })}>
              {p.activo ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
        <form onSubmit={agregarPago} style={s.fila}>
          <input
            style={{ ...s.input, flex: 1, minWidth: 140 }}
            placeholder="Nuevo método (ej: Transferencia)"
            value={nuevoPago}
            onChange={(e) => setNuevoPago(e.target.value)}
          />
          <button style={s.boton}>Agregar</button>
        </form>
      </section>

      {aj && (
        <section style={s.caja}>
          <h3 style={{ margin: 0 }}>Pantalla de cocina</h3>
          <label style={s.etiqueta}>
            El ticket se pone amarillo a los (minutos)
            <Campo
              style={{ ...s.input, width: 90 }}
              inputMode="numeric"
              valor={aj.alerta_amarilla_min}
              onGuardar={(t) => guardarMinutos('alerta_amarilla_min', t)}
            />
          </label>
          <label style={s.etiqueta}>
            El ticket se pone rojo a los (minutos)
            <Campo
              style={{ ...s.input, width: 90 }}
              inputMode="numeric"
              valor={aj.alerta_roja_min}
              onGuardar={(t) => guardarMinutos('alerta_roja_min', t)}
            />
          </label>
          <label style={s.check}>
            <input
              type="checkbox"
              checked={aj.sonido_activo}
              onChange={(e) =>
                actualizar('ajustes', { restaurante_id: restaurante.id }, { sonido_activo: e.target.checked })
              }
            />
            Sonido de aviso en cocina
          </label>
        </section>
      )}
    </div>
  )
}

const s = {
  pagina: { display: 'grid', gap: 10 },
  caja: { display: 'grid', gap: 8, border: '1px solid #ddd', borderRadius: 12, padding: 12 },
  fila: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  etiqueta: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 14 },
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 },
  input: { padding: 10, fontSize: 16, borderRadius: 8, border: '1px solid #bbb', boxSizing: 'border-box' },
  boton: { padding: 10, fontSize: 15, fontWeight: 700, borderRadius: 8, border: 'none', background: '#F2A900', cursor: 'pointer' },
  peligro: { padding: 8, fontSize: 14, fontWeight: 700, borderRadius: 8, border: 'none', background: '#B3261E', color: 'white', cursor: 'pointer' },
  botonSec: { padding: 8, fontSize: 14, borderRadius: 8, border: '1px solid #bbb', background: 'white', cursor: 'pointer' },
}
