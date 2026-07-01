import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// 'YYYY-MM-DD' -> 'martes, 1 de julio de 2026'
function fechaLegible(fecha) {
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${DIAS[dt.getUTCDay()]}, ${d} de ${MESES[m - 1]} de ${y}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const { appointmentId } = req.body || {}
  if (!appointmentId) {
    return res.status(400).json({ ok: false, error: 'appointmentId requerido' })
  }

  try {
    const { data: appt, error: apptErr } = await supabase
      .from('appointments')
      .select('user_id,appointment_date,appointment_time,services(name),stylists(name)')
      .eq('id', appointmentId)
      .single()

    if (apptErr || !appt) {
      return res.status(404).json({ ok: false, error: 'Cita no encontrada' })
    }

    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(appt.user_id)
    const email = userData?.user?.email
    if (userErr || !email) {
      return res.status(404).json({ ok: false, error: 'Email del cliente no encontrado' })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', appt.user_id)
      .single()

    const nombre = profile?.full_name || 'cliente'
    const servicio = appt.services?.name || 'Servicio'
    const profesional = appt.stylists?.name || 'nuestro equipo'
    const fecha = fechaLegible(appt.appointment_date)
    const hora = String(appt.appointment_time).slice(0, 5)

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
        <h1 style="font-size:22px;margin:0 0 4px">¡Reserva confirmada!</h1>
        <p style="font-size:14px;color:#555;margin:0 0 20px">Hola ${nombre}, tu cita está confirmada.</p>
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:8px 0;color:#888">Servicio</td><td style="padding:8px 0;text-align:right;font-weight:600">${servicio}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Profesional</td><td style="padding:8px 0;text-align:right;font-weight:600">${profesional}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Fecha</td><td style="padding:8px 0;text-align:right;font-weight:600">${fecha}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Hora</td><td style="padding:8px 0;text-align:right;font-weight:600">${hora}h</td></tr>
        </table>
        <p style="font-size:13px;color:#999;margin-top:24px">Clocks Estudio Barbería</p>
      </div>`

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: email,
        subject: `Reserva confirmada — ${fecha}`,
        html,
      }),
    })

    if (!resp.ok) {
      const detail = await resp.text()
      return res.status(500).json({ ok: false, error: `Resend: ${resp.status} ${detail}` })
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Error interno' })
  }
}
