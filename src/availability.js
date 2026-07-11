import { toK, aM, gS } from './timeUtils.js'

// Dado un barbero y una fecha, calcula sus slots libres teniendo en cuenta:
// - cierres del salón (festivos) que cubran la fecha
// - horario del salón por día de semana (salon_schedule)
// - horario semanal fijo del barbero (stylist_schedules) con su break
// - break del salón
// - citas y bloqueos puntuales
// - ausencias del barbero (time_off): todo el día o por franja
export const getSlotsForDay = (date, stylistId, schedules, appointments, blockedSlots, svcDuration, salonSchedule=[], slotMinutes=30, timeOff=[], closures=[], overrides=[]) => {
  const dow = date.getDay()
  const dk = toK(date)

  // Cierre del salón (festivo) que cubre esta fecha => cerrado para todos
  if(closures.some(c => c.start_date <= dk && dk <= c.end_date)) return []

  const salSched = salonSchedule.find(s => s.day_of_week === dow)
  if(salSched && !salSched.active) return [] // Salón cerrado este día de semana

  // Horario fijo del barbero para este día de semana
  // Excepción de turno por fecha (schedule_overrides) manda sobre el recurrente
  const override = overrides.find(o => o.stylist_id === stylistId && o.override_date === dk)
  const sched = override || schedules.find(s => s.stylist_id === stylistId && s.day_of_week === dow)
  if(sched && !sched.active) return []

  // Horario efectivo: barbero > salón > fallback
  const dayOpen = sched ? sched.start_time.slice(0,5) : (salSched ? salSched.open_time.slice(0,5) : '09:00')
  const dayClose = sched ? sched.end_time.slice(0,5) : (salSched ? salSched.close_time.slice(0,5) : (dow === 6 ? '14:00' : '20:00'))

  // Breaks: del salón + del barbero (ambos excluyen slots que los solapen)
  const breaks = []
  if(salSched?.break_start && salSched?.break_end) breaks.push([salSched.break_start.slice(0,5), salSched.break_end.slice(0,5)])
  if(sched?.break_start && sched?.break_end) breaks.push([sched.break_start.slice(0,5), sched.break_end.slice(0,5)])

  const allSlots = gS(dayOpen, dayClose, slotMinutes)
  const taken = new Set()

  appointments
    .filter(a => a.appointment_date === dk && a.stylist_id === stylistId)
    .forEach(a => { let c = a.appointment_time.slice(0,5); const e = a.end_time.slice(0,5); while(c<e){taken.add(c);c=aM(c,slotMinutes)} })

  blockedSlots
    .filter(b => b.blocked_date === dk && b.stylist_id === stylistId)
    .forEach(b => { let c = b.start_time.slice(0,5); const e = b.end_time.slice(0,5); while(c<e){taken.add(c);c=aM(c,slotMinutes)} })

  // Ausencias del barbero que cubren esta fecha
  const dayOff = timeOff.filter(t => t.stylist_id === stylistId && t.start_date <= dk && dk <= t.end_date)
  if(dayOff.some(t => t.all_day)) return []
  dayOff.forEach(t => {
    if(t.all_day || !t.start_time || !t.end_time) return
    let c = t.start_time.slice(0,5); const e = t.end_time.slice(0,5)
    while(c < e){ taken.add(c); c = aM(c,slotMinutes) }
  })

  return allSlots.filter(s => {
    const end = aM(s, svcDuration)
    if(end > dayClose) return false
    // Excluir slots que solapen con algún break
    if(breaks.some(([bs,be]) => s < be && end > bs)) return false
    let c = s
    while(c < end){ if(taken.has(c)) return false; c = aM(c,slotMinutes) }
    return true
  })
}
