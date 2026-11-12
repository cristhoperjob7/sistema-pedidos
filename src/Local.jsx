import { useEffect, useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import Campo from './Campo'
import { Cargando, Desplegable, Interruptor, Mensaje, Confirmar, Vacio } from './ui'
import { avisar, sentir, sonar, vibrar } from './feedback'

// Mesas, métodos de pago y ajustes de cocina de un restaurante.
export default function Local({ restaurante }) {
  const [mesas, setMesas] = useState(null)
  const [pagos, setPagos] = useState([])
  const [aj, setAj] = useState(null)
  const [nuevoPago, setNuevoPago] = useState('')
  const [error, setError] = useState('')
  const [confMesa, setConfMesa] = useState(null) // id de la mesa a eliminar, o 'todas'
  const [agregando, setAgregando] = useState(false)

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
    const usados = new Set((mesas ?? []).map((m) => m.numero))
    let n = 1
    while (usados.has(n)) n++
    return n
  })()

  async function agregarMesa() {
    setError('')
    sentir('toque', 'pop')
    setAgregando(true)
    const numero = siguienteMesa
    const { error } = await supabase.from('mesas').insert({ restaurante_id: restaurante.id, numero })
    setAgregando(false)
    if (error) setError(error.message)
    else {
      vibrar('exito')
      avisar(`Mesa ${numero} agregada`)
      cargar()
    }
  }

  async function eliminarMesas(m) {
    setError('')
    sentir('aviso')
    let consulta = supabase.from('mesas').delete()
    consulta = m ? consulta.eq('id', m.id) : consulta.eq('restaurante_id', restaurante.id)
    const { error } = await consulta
    setConfMesa(null)
    if (error) setError(error.message)
    else {
      sonar('baja')
      avisar(m ? `Mesa ${m.numero} eliminada` : 'Se eliminaron todas las mesas', 'borrar')
      cargar()
    }
  }

  async function agregarPago(e) {
    e.preventDefault()
    setError('')
    const nombre = nuevoPago.trim()
    if (!nombre) return setError('Escribe el nombre del método de pago.')
    sentir('toque', 'pop')
    const orden = pagos.reduce((mx, p) => Math.max(mx, p.orden), 0) + 1
    const { error } = await supabase.from('metodos_pago').insert({ restaurante_id: restaurante.id, nombre, orden })
    if (error) return setError(error.message)
    vibrar('exito')
    avisar(`"${nombre}" agregado`)
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
    if (ok) avisar('Ajuste guardado')
    return ok
  }

  function pedirConfirmacion(id) {
    sentir('toque')
    setConfMesa(id)
  }

  if (!mesas) return error ? <Mensaje tipo="error">{error}</Mensaje> : <Cargando filas={3} alto={110} />

  return (
    <div style={s.pagina}>
      <Mensaje tipo="error">{error}</Mensaje>

      <section className="tarjeta" style={s.caja}>
        <div>
          <h3 style={{ margin: 0 }}>
            Mesas{' '}
            <small className="suave" style={{ fontWeight: 700 }}>
              · <span key={mesas.length} className="contador-pop">{mesas.length}</span>
            </small>
          </h3>
          <small className="suave">
            El nombre es opcional (ej: “Terraza 1”). Una mesa con la cuenta abierta no se puede eliminar. Las ventas
            antiguas de una mesa eliminada se conservan en los reportes.
          </small>
        </div>
        {mesas.length === 0 && (
          <Vacio icono="silla" titulo="No hay mesas" texto={<>Agrega la primera con el botón de abajo.</>} accion={{ texto: 'Agregar una mesa', foco: '[placeholder="Nombre (opcional)"]' }} />
        )}
        {mesas.map((m) => (
          <div key={m.id} className="entra" style={{ ...s.fila, opacity: m.activo ? 1 : 0.55 }}>
            <span style={s.numeroMesa}>{m.numero}</span>
            <Campo
              className="campo-chico"
              style={{ flex: '1 1 140px', minWidth: 0 }}
              placeholder="Nombre (opcional)"
              valor={m.nombre ?? ''}
              onGuardar={(t) => actualizar('mesas', { id: m.id }, { nombre: t.trim() || null })}
            />
            {!m.activo && (
              <button
                className="btn btn-chico btn-sec"
                onClick={() => {
                  sentir('toque', 'tic')
                  actualizar('mesas', { id: m.id }, { activo: true })
                }}
              >
                Activar
              </button>
            )}
            <button className="btn btn-chico btn-peligro-suave" onClick={() => pedirConfirmacion(m.id)}>
              Eliminar
            </button>
          </div>
        ))}
        <div style={s.fila}>
          <button className="btn btn-principal" style={{ flex: '1 1 180px' }} disabled={agregando} onClick={agregarMesa}>
            {agregando ? <span className="puntos">Agregando</span> : `+ Agregar mesa ${siguienteMesa}`}
          </button>
          {mesas.length > 1 && (
            <button className="btn btn-peligro-suave" onClick={() => pedirConfirmacion('todas')}>
              Eliminar todas
            </button>
          )}
        </div>
        <Confirmar
          abierto={confMesa === 'todas' && mesas.length > 1}
          titulo={`¿Eliminar las ${mesas.length} mesas?`}
          texto="Las ventas ya hechas se conservan. No se pueden eliminar mesas que tengan una cuenta abierta."
          textoConfirmar="Sí, eliminar todas"
          onCancelar={() => setConfMesa(null)}
          onConfirmar={() => eliminarMesas(null)}
        />
        <Confirmar
          abierto={!!confMesa && confMesa !== 'todas' && mesas.some((x) => x.id === confMesa)}
          titulo={`¿Eliminar la mesa ${mesas.find((x) => x.id === confMesa)?.numero ?? ''}?`}
          texto="Las ventas ya hechas con esta mesa se conservan."
          onCancelar={() => setConfMesa(null)}
          onConfirmar={() => eliminarMesas(mesas.find((x) => x.id === confMesa))}
        />
      </section>

      <section className="tarjeta" style={s.caja}>
        <h3 style={{ margin: 0 }}>Métodos de pago</h3>
        {pagos.map((p) => (
          <div key={p.id} style={{ display: 'grid', gap: 6 }}>
          <div className="entra" style={{ ...s.fila, opacity: p.activo ? 1 : 0.55 }}>
            <Campo
              className="campo-chico"
              style={{ flex: '1 1 140px', minWidth: 0 }}
              valor={p.nombre}
              onGuardar={(t) => guardarNombrePago(p, t)}
            />
            <button
              className="btn btn-chico btn-suave"
              onClick={() => {
                sentir('toque', 'tic')
                actualizar('metodos_pago', { id: p.id }, { activo: !p.activo })
              }}
            >
              {p.activo ? 'Desactivar' : 'Activar'}
            </button>
          </div>
          {/transfer/i.test(p.nombre) && (
            <DatosTransferencia metodo={p} onGuardar={(datos) => actualizar('metodos_pago', { id: p.id }, { datos })} />
          )}
          </div>
        ))}
        <form onSubmit={agregarPago} style={s.nuevo}>
          <input
            className="campo-chico"
            style={{ flex: '1 1 160px', minWidth: 0 }}
            placeholder="Nuevo método (ej: Transferencia)"
            value={nuevoPago}
            onChange={(e) => setNuevoPago(e.target.value)}
          />
          <button className="btn btn-chico btn-principal">+ Agregar</button>
        </form>
      </section>

      {aj && (
        <section className="tarjeta" style={s.caja}>
          <h3 style={{ margin: 0 }}>Pantalla de cocina</h3>
          <label style={s.etiqueta}>
            <span style={{ flex: '1 1 200px' }}>
              <span style={{ ...s.puntoColor, background: 'var(--aviso-tinta)' }} /> El ticket se pone amarillo a los (minutos)
            </span>
            <Campo
              className="campo-chico"
              style={{ width: 90 }}
              inputMode="numeric"
              valor={aj.alerta_amarilla_min}
              onGuardar={(t) => guardarMinutos('alerta_amarilla_min', t)}
            />
          </label>
          <label style={s.etiqueta}>
            <span style={{ flex: '1 1 200px' }}>
              <span style={{ ...s.puntoColor, background: 'var(--rosa-tinta)' }} /> El ticket se pone rojo a los (minutos)
            </span>
            <Campo
              className="campo-chico"
              style={{ width: 90 }}
              inputMode="numeric"
              valor={aj.alerta_roja_min}
              onGuardar={(t) => guardarMinutos('alerta_roja_min', t)}
            />
          </label>
          <Interruptor
            checked={aj.sonido_activo}
            onChange={async (v) => {
              const ok = await actualizar('ajustes', { restaurante_id: restaurante.id }, { sonido_activo: v })
              if (ok) avisar(v ? 'Sonido de cocina activado' : 'Sonido de cocina desactivado', 'info')
            }}
          >
            Sonido de aviso en cocina
          </Interruptor>
        </section>
      )}
    </div>
  )
}

const s = {
  pagina: { display: 'grid', gap: 12 },
  caja: { display: 'grid', gap: 10, borderRadius: 18 },
  fila: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', transition: 'opacity 220ms var(--ease)' },
  numeroMesa: {
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
    width: 40,
    height: 40,
    borderRadius: 12,
    background: 'var(--lavanda)',
    color: 'var(--morado)',
    fontWeight: 900,
  },
  nuevo: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 8, borderRadius: 14, border: '1.5px dashed var(--lavanda-2)' },
  confirmar: { display: 'grid', gap: 10, padding: 12, borderRadius: 14, background: 'var(--rosa)', border: '1px solid var(--borde-rosa)' },
  etiqueta: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 15 },
  puntoColor: { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 4 },
}

// Datos de la cuenta a la que transfieren los clientes. Se muestran al cobrar con "Transferencia".
const CAMPOS_TRANSF = [
  ['titular', 'Titular', 'Ej: Jiovanna Pérez'],
  ['rut', 'RUT', 'Ej: 12.345.678-9'],
  ['banco', 'Banco', 'Ej: BancoEstado'],
  ['tipo_cuenta', 'Tipo de cuenta', 'Ej: Cuenta RUT / Corriente / Vista'],
  ['numero', 'N° de cuenta', 'Ej: 12345678'],
  ['correo', 'Correo para el comprobante', 'Ej: pagos@milocal.cl'],
]

function DatosTransferencia({ metodo, onGuardar }) {
  const [abierto, setAbierto] = useState(false)
  const [v, setV] = useState({})
  const [guardando, setGuardando] = useState(false)
  const tiene = CAMPOS_TRANSF.some(([k]) => String(metodo.datos?.[k] ?? '').trim())

  function abrir() {
    sentir('toque')
    setV(Object.fromEntries(CAMPOS_TRANSF.map(([k]) => [k, metodo.datos?.[k] ?? ''])))
    setAbierto(true)
  }

  async function guardar(e) {
    e.preventDefault()
    setGuardando(true)
    const limpio = Object.fromEntries(CAMPOS_TRANSF.map(([k]) => [k, String(v[k] ?? '').trim().slice(0, 120)]).filter(([, x]) => x))
    const ok = await onGuardar(Object.keys(limpio).length ? limpio : null)
    setGuardando(false)
    if (ok) {
      vibrar('exito')
      avisar('Datos de transferencia guardados')
      setAbierto(false)
    }
  }

  if (!abierto) {
    return (
      <button className="btn btn-chico btn-suave" style={{ justifySelf: 'start' }} onClick={abrir}>
        {tiene ? 'Editar datos para transferir' : '+ Agregar datos para transferir'}
      </button>
    )
  }
  return (
    <form onSubmit={guardar} className="aparece" style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 14, border: '1px solid var(--linea)' }}>
      <small className="suave">Se muestran a la mesera al cobrar con transferencia, para dárselos al cliente.</small>
      {CAMPOS_TRANSF.map(([k, t, ph]) => (
        <label key={k} style={{ display: 'grid', gap: 3 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{t}</span>
          <input className="campo-chico" maxLength={120} placeholder={ph} value={v[k] ?? ''} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
        </label>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-chico btn-sec" onClick={() => setAbierto(false)}>Cancelar</button>
        <button className="btn btn-chico btn-principal" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar datos'}</button>
      </div>
    </form>
  )
}
