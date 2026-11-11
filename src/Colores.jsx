import { useState } from 'react'
import Icono from './iconos'
import { supabase } from './supabase'
import { Mensaje } from './ui'
import { avisar, sentir } from './feedback'
import { COLOR_FONDO_BASE, COLOR_MARCA_BASE, esHex, revisar, varsVista } from './paletas'

// Panel del superadmin: dos colores por restaurante. El resto de la paleta se calcula sola.
function Vista({ marca, fondo, modo, nombre }) {
  return (
    <div style={{ ...varsVista(marca, fondo, modo), background: 'var(--fondo)', color: 'var(--tinta)', border: '1px solid var(--linea)', borderRadius: 16, overflow: 'hidden', flex: '1 1 150px', minWidth: 150 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--sup)', borderBottom: '1px solid var(--linea)' }}>
        <span style={{ width: 20, height: 20, borderRadius: 7, background: 'var(--marca)' }} />
        <b style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</b>
      </div>
      <div style={{ display: 'grid', gap: 8, padding: 10 }}>
        <small style={{ color: 'var(--suave)', fontWeight: 700 }}>{modo === 'oscuro' ? 'Modo oscuro' : 'Modo claro'}</small>
        <div style={{ background: 'var(--sup)', border: '1px solid var(--linea)', borderRadius: 12, padding: 9, display: 'grid', gap: 6 }}>
          <b style={{ fontSize: 13 }}>Mesa 3</b>
          <span style={{ fontSize: 12, color: 'var(--marca)', fontWeight: 800 }}>Pedido para llevar</span>
        </div>
        <div style={{ background: 'var(--marca)', color: 'var(--sobre-marca)', borderRadius: 10, padding: '8px 10px', textAlign: 'center', fontWeight: 800, fontSize: 13 }}>Enviar a cocina</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ background: 'var(--lavanda)', border: '1px solid var(--lavanda-2)', borderRadius: 99, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}>Platos</span>
          <span style={{ color: 'var(--menta-tinta)', fontSize: 11, fontWeight: 800, alignSelf: 'center' }}>● Libre</span>
        </div>
      </div>
    </div>
  )
}

function Selector({ etiqueta, ayuda, valor, onChange, base }) {
  const color = esHex(valor) ? valor : base
  const [texto, setTexto] = useState(valor ?? '')
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontWeight: 800 }}>{etiqueta}</span>
      <small className="suave">{ayuda}</small>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="color"
          value={color}
          onChange={(e) => {
            setTexto(e.target.value)
            onChange(e.target.value)
          }}
          style={{ width: 54, height: 42, padding: 2, border: '1px solid var(--lavanda-2)', borderRadius: 10, background: 'var(--lavanda)', cursor: 'pointer' }}
        />
        <input
          className="campo-chico"
          value={texto}
          placeholder={base}
          maxLength={7}
          onChange={(e) => {
            let v = e.target.value.trim()
            if (v && !v.startsWith('#')) v = '#' + v
            setTexto(v)
            if (esHex(v)) onChange(v.toLowerCase())
            else if (!v) onChange(null)
          }}
          style={{ width: 110, fontFamily: 'monospace' }}
          aria-label={`${etiqueta} en formato #rrggbb`}
        />
        {valor && (
          <button type="button" className="btn btn-chico btn-sec" onClick={() => { setTexto(''); onChange(null) }}>
            Por defecto
          </button>
        )}
      </span>
    </label>
  )
}

export default function Colores({ restaurante, onGuardado }) {
  const [marca, setMarca] = useState(restaurante.color_marca ?? null)
  const [fondo, setFondo] = useState(restaurante.color_fondo ?? null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [n, setN] = useState(0)
  const cambio = (marca ?? null) !== (restaurante.color_marca ?? null) || (fondo ?? null) !== (restaurante.color_fondo ?? null)
  const avisos = revisar(marca, fondo)

  async function guardar() {
    setError('')
    setGuardando(true)
    const { error } = await supabase.from('restaurantes').update({ color_marca: marca, color_fondo: fondo }).eq('id', restaurante.id)
    setGuardando(false)
    if (error) {
      setError(error.message)
      return
    }
    sentir('toque', 'exito')
    avisar('Colores guardados · se ven al volver a entrar')
    onGuardado?.()
  }

  return (
    <div style={{ display: 'grid', gap: 14, padding: 14, marginTop: 8, border: '1px solid var(--linea)', borderRadius: 16, background: 'var(--sup)' }}>
      <b>Colores de {restaurante.nombre}</b>
      <small className="suave">
        Elige dos colores y el sistema calcula el resto, para el modo oscuro y el claro. La pantalla de ingreso no cambia.
      </small>
      <Mensaje tipo="error">{error}</Mensaje>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <Selector key={`m${n}`} etiqueta="Color principal" ayuda="Botones, selecciones y detalles." valor={marca} onChange={setMarca} base={COLOR_MARCA_BASE} />
        <Selector key={`f${n}`} etiqueta="Color de fondo" ayuda="Tono de fondos y tarjetas (muy suave)." valor={fondo} onChange={setFondo} base={COLOR_FONDO_BASE} />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Vista marca={marca} fondo={fondo} modo="oscuro" nombre={restaurante.nombre} />
        <Vista marca={marca} fondo={fondo} modo="claro" nombre={restaurante.nombre} />
      </div>

      {avisos.map((a) => (
        <p key={a} role="status" style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--durazno)', border: '1px solid var(--borde-aviso)', color: 'var(--aviso-tinta)', fontSize: 14, fontWeight: 700 }}>
          <Icono n="alerta" tam={15} className="it" /> {a}
        </p>
      ))}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-principal" disabled={!cambio || guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar colores'}
        </button>
        {cambio && (
          <button className="btn btn-sec" onClick={() => { setMarca(restaurante.color_marca ?? null); setFondo(restaurante.color_fondo ?? null); setN(n + 1) }}>
            Descartar
          </button>
        )}
      </div>
    </div>
  )
}
