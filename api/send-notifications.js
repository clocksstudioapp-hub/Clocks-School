import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  // ── Auth gate ──────────────────────────────────────────────────────────────
  // This endpoint runs with the service_role key (bypasses RLS), so it MUST NOT
  // be publicly callable. Vercel Cron automatically sends "Authorization: Bearer
  // <CRON_SECRET>". We also accept ?secret= for manual/external schedulers.
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers['authorization'] || ''
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query && req.query.secret) || ''
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000)

  const fmt = d => d.toISOString().slice(0, 10)
  const fmtH = d => d.toTimeString().slice(0, 5)

  const { data: appts } = await supabase
    .from('appointments')
    .select('id, user_id, appointment_date, appointment_time')
    .eq('status', 'confirmed')
    .in('appointment_date', [fmt(in24h), fmt(in2h)])

  let notified = 0

  for (const appt of appts || []) {
    const apptTime = appt.appointment_time.slice(0, 5)
    const is24 = appt.appointment_date === fmt(in24h) && apptTime === fmtH(in24h)
    const is2 = appt.appointment_date === fmt(in2h) && apptTime === fmtH(in2h)
    if (!is24 && !is2) continue

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', appt.user_id)

    // TODO: deliver the actual web-push here (VAPID). Currently a no-op.
    if (subs && subs.length) notified += 1
  }

  // Return only aggregate counts — never per-appointment / per-user detail.
  return res.status(200).json({ ok: true, checked: (appts || []).length, notified })
}
