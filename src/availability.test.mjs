import test from 'node:test'
import assert from 'node:assert/strict'
import { getSlotsForDay } from './availability.js'

// 2026-07-13 es lunes (dow=1)
const monday = new Date(2026, 6, 13)
const salon = [{ day_of_week: 1, active: true, open_time: '09:00', close_time: '13:00', break_start: null, break_end: null }]

// ── Caracterización (comportamiento base) ──────────────────────
test('slots básicos de un lunes 09:00-13:00, servicio 30min', () => {
  const slots = getSlotsForDay(monday, 1, [], [], [], 30, salon, 30)
  assert.deepEqual(slots, ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30'])
})

test('una cita ocupa su franja', () => {
  const appts = [{ appointment_date: '2026-07-13', stylist_id: 1, appointment_time: '10:00', end_time: '10:30' }]
  const slots = getSlotsForDay(monday, 1, [], appts, [], 30, salon, 30)
  assert.ok(!slots.includes('10:00'))
  assert.ok(slots.includes('09:30'))
})

test('un bloqueo ocupa su franja', () => {
  const blk = [{ blocked_date: '2026-07-13', stylist_id: 1, start_time: '11:00', end_time: '12:00' }]
  const slots = getSlotsForDay(monday, 1, [], [], blk, 30, salon, 30)
  assert.ok(!slots.includes('11:00'))
  assert.ok(!slots.includes('11:30'))
})

test('salón cerrado ese día => sin slots', () => {
  const closedSalon = [{ day_of_week: 1, active: false, open_time: '09:00', close_time: '13:00' }]
  assert.deepEqual(getSlotsForDay(monday, 1, [], [], [], 30, closedSalon, 30), [])
})

test('break del salón excluye su franja', () => {
  const s2 = [{ day_of_week: 1, active: true, open_time: '09:00', close_time: '13:00', break_start: '10:00', break_end: '11:00' }]
  const slots = getSlotsForDay(monday, 1, [], [], [], 30, s2, 30)
  assert.ok(!slots.includes('10:00'))
  assert.ok(!slots.includes('10:30'))
  assert.ok(slots.includes('09:30'))
  assert.ok(slots.includes('11:00'))
})

// ── C: break del barbero ───────────────────────────────────────
test('break individual del barbero excluye su franja de comida', () => {
  const schedBarber = [{ stylist_id: 1, day_of_week: 1, active: true, start_time: '09:00', end_time: '13:00', break_start: '11:00', break_end: '12:00' }]
  const slots = getSlotsForDay(monday, 1, schedBarber, [], [], 30, salon, 30)
  assert.ok(!slots.includes('11:00'), 'la comida del barbero no debe ofrecerse')
  assert.ok(!slots.includes('11:30'))
  assert.ok(slots.includes('10:30'))
})

// ── B: cierres del salón ───────────────────────────────────────
test('un cierre del salón que cubre la fecha => sin slots', () => {
  const closures = [{ start_date: '2026-07-13', end_date: '2026-07-13', reason: 'Festivo' }]
  const slots = getSlotsForDay(monday, 1, [], [], [], 30, salon, 30, [], closures)
  assert.deepEqual(slots, [])
})

test('un cierre en rango que NO cubre la fecha => slots normales', () => {
  const closures = [{ start_date: '2026-07-20', end_date: '2026-07-25', reason: 'Vacaciones locales' }]
  const slots = getSlotsForDay(monday, 1, [], [], [], 30, salon, 30, [], closures)
  assert.ok(slots.length > 0)
})

// ── A: ausencias del barbero ───────────────────────────────────
test('ausencia de todo el día del barbero => sin slots', () => {
  const timeOff = [{ stylist_id: 1, start_date: '2026-07-10', end_date: '2026-07-17', all_day: true, start_time: null, end_time: null }]
  const slots = getSlotsForDay(monday, 1, [], [], [], 30, salon, 30, timeOff, [])
  assert.deepEqual(slots, [])
})

test('ausencia por franja del barbero excluye solo esa franja', () => {
  const timeOff = [{ stylist_id: 1, start_date: '2026-07-13', end_date: '2026-07-13', all_day: false, start_time: '10:00', end_time: '11:00' }]
  const slots = getSlotsForDay(monday, 1, [], [], [], 30, salon, 30, timeOff, [])
  assert.ok(!slots.includes('10:00'))
  assert.ok(!slots.includes('10:30'))
  assert.ok(slots.includes('09:30'))
  assert.ok(slots.includes('11:00'))
})

test('ausencia de OTRO barbero no afecta a este', () => {
  const timeOff = [{ stylist_id: 2, start_date: '2026-07-13', end_date: '2026-07-13', all_day: true, start_time: null, end_time: null }]
  const slots = getSlotsForDay(monday, 1, [], [], [], 30, salon, 30, timeOff, [])
  assert.ok(slots.length > 0)
})

// ── Excepciones de turno por fecha (schedule_overrides) ────────
test('override ACTIVA un día que el recurrente tenía inactivo (solo esa fecha)', () => {
  const recurring = [{ stylist_id: 1, day_of_week: 1, active: false, start_time: '09:00', end_time: '13:00' }]
  const overrides = [{ stylist_id: 1, override_date: '2026-07-13', active: true, start_time: '09:00', end_time: '11:00', break_start: null, break_end: null }]
  const slots = getSlotsForDay(monday, 1, recurring, [], [], 30, salon, 30, [], [], overrides)
  assert.ok(slots.length > 0, 'con override activo debe haber huecos')
  assert.ok(slots.includes('09:00'))
})

test('override DESACTIVA un día que el recurrente tenía activo (solo esa fecha)', () => {
  const recurring = [{ stylist_id: 1, day_of_week: 1, active: true, start_time: '09:00', end_time: '13:00' }]
  const overrides = [{ stylist_id: 1, override_date: '2026-07-13', active: false, start_time: '09:00', end_time: '13:00' }]
  assert.deepEqual(getSlotsForDay(monday, 1, recurring, [], [], 30, salon, 30, [], [], overrides), [])
})

test('override de OTRA fecha no afecta a este día', () => {
  const recurring = [{ stylist_id: 1, day_of_week: 1, active: true, start_time: '09:00', end_time: '13:00' }]
  const overrides = [{ stylist_id: 1, override_date: '2026-07-20', active: false, start_time: '09:00', end_time: '13:00' }]
  assert.ok(getSlotsForDay(monday, 1, recurring, [], [], 30, salon, 30, [], [], overrides).length > 0)
})
