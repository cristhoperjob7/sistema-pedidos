// Marca ReSystem: nombre, logo y contacto comercial. Cambiar aquí cambia todo el sistema.
export const MARCA = 'ReSystem'

// Correo donde llegan las solicitudes de prueba gratis (formulario de la portada).
// ⚠️ Escribe aquí el correo de ReSystem entre las comillas, por ejemplo: 'resystem.contacto@gmail.com'
export const CORREO_CONTACTO = ''

// Arma el correo con lo que llenó la persona: «mailto» abre su app de correo; el enlace de Gmail sirve en el computador.
export function correoSolicitud(d) {
  const asunto = `Prueba gratis ReSystem · ${d.restaurante}`
  const cuerpo = [
    'Hola, quiero probar ReSystem 14 días gratis.',
    '',
    `Nombre: ${d.nombre}`,
    `Restaurante: ${d.restaurante}`,
    `Comuna o ciudad: ${d.ciudad || '-'}`,
    `Teléfono: ${d.telefono}`,
    `Correo: ${d.correo || '-'}`,
    `Mesas aproximadas: ${d.mesas || '-'}`,
    '',
    d.mensaje ? `Comentario: ${d.mensaje}` : '',
  ].join('\n')
  return {
    mailto: `mailto:${CORREO_CONTACTO}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(CORREO_CONTACTO)}&su=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`,
  }
}

// Las esquinas de un código QR y, en la cuarta, un plato. «tinta» = color del plato (negro sobre claro).
export function Logo({ tam = 28, verde = '#16a34a', tinta = '#0a0a0a', titulo }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 100 100" role={titulo ? 'img' : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}>
      <g fill="none" stroke={verde} strokeWidth="9">
        <rect x="6" y="6" width="34" height="34" rx="9" />
        <rect x="60" y="6" width="34" height="34" rx="9" />
        <rect x="6" y="60" width="34" height="34" rx="9" />
      </g>
      <g fill={verde}>
        <rect x="17" y="17" width="12" height="12" rx="3" />
        <rect x="71" y="17" width="12" height="12" rx="3" />
        <rect x="17" y="71" width="12" height="12" rx="3" />
      </g>
      <circle cx="77" cy="77" r="17" fill="none" stroke={tinta} strokeWidth="7" />
      <circle cx="77" cy="77" r="7" fill={tinta} />
    </svg>
  )
}

export function Marca({ tam = 26, className = '' }) {
  return (
    <span className={`marca-resystem ${className}`}>
      <Logo tam={tam} />
      <span>
        Re<span style={{ color: '#16a34a' }}>System</span>
      </span>
    </span>
  )
}
