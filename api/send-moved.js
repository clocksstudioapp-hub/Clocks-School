import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function fechaLegible(fecha) {
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${DIAS[dt.getUTCDay()]}, ${d} de ${MESES[m - 1]} de ${y}`
}

export default async function handler(req, res) {
  // CORS: el panel admin vive en otro dominio de Vercel. Restringido al origen
  // del panel (ADMIN_ORIGIN); ya no se refleja "*".
  const adminOrigin = process.env.ADMIN_ORIGIN || ''
  const origin = req.headers.origin || ''
  if (adminOrigin && origin === adminOrigin) {
    res.setHeader('Access-Control-Allow-Origin', adminOrigin)
  }
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // ── Auth gate: solo personal (admin/barber) puede mover citas y notificar.
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const { data: authData, error: authErr } = await supabase.auth.getUser(token)
  const caller = authData?.user
  if (authErr || !caller) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const { data: callerProf } = await supabase
    .from('profiles').select('role').eq('id', caller.id).single()
  if (!callerProf || !['admin', 'barber'].includes(callerProf.role)) {
    return res.status(403).json({ ok: false, error: 'forbidden' })
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
    if (!appt.user_id) {
      return res.status(200).json({ ok: true, skipped: 'cita telefónica sin email' })
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

    const { data: cfgRows } = await supabase
      .from('salon_config')
      .select('key,value')
    const cfg = Object.fromEntries((cfgRows || []).map(r => [r.key, r.value]))
    const salonName = cfg.salon_name || 'Clocks School'
    const direccion = cfg.address || ''

    const nombre = profile?.full_name || 'cliente'
    const servicio = appt.services?.name || 'Servicio'
    const profesional = appt.stylists?.name || 'nuestro equipo'
    const fecha = fechaLegible(appt.appointment_date)
    const hora = String(appt.appointment_time).slice(0, 5)

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
        <h1 style="font-size:22px;margin:0 0 4px">📅 Tu cita ha cambiado</h1>
        <p style="font-size:14px;color:#555;margin:0 0 20px">Hola ${nombre}, hemos movido tu cita. Estos son los nuevos datos:</p>
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:8px 0;color:#888">Servicio</td><td style="padding:8px 0;text-align:right;font-weight:600">${servicio}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Profesional</td><td style="padding:8px 0;text-align:right;font-weight:600">${profesional}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Nueva fecha</td><td style="padding:8px 0;text-align:right;font-weight:600">${fecha}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Nueva hora</td><td style="padding:8px 0;text-align:right;font-weight:600">${hora}h</td></tr>
        </table>
        <p style="font-size:13px;color:#999;margin-top:24px;line-height:1.6">
          Si el nuevo horario no te viene bien, contáctanos o cancela desde la app.<br/>
          <strong style="color:#1a1a1a">${salonName}</strong>${direccion ? `<br/>${direccion}` : ''}
        </p>
      </div>`

    await transporter.sendMail({
      from: `${salonName} <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Tu cita ha cambiado — ${fecha} a las ${hora}h`,
      html,
    })

    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Error interno' })
  }
}
