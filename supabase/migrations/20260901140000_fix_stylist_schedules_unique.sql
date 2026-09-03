-- ============================================================================
-- stylist_schedules no tenía índice único sobre (stylist_id, day_of_week), pero
-- el panel guarda con upsert(..., onConflict:'stylist_id,day_of_week').
--
-- Sin ese índice el upsert falla con "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification", y como saveShiftRecurring
-- no miraba el error, el modal se cerraba sin guardar y sin avisar. La pestaña
-- Turnos nunca ha llegado a funcionar: la tabla está vacía.
--
-- schedule_overrides sí lo tiene sobre (stylist_id, override_date), que es por
-- lo que las excepciones por fecha sí guardaban.
-- ============================================================================
create unique index if not exists stylist_schedules_stylist_dow_key
  on public.stylist_schedules (stylist_id, day_of_week);
