-- ============================================================================
-- Clocks School — Endurecimiento pre-lanzamiento: integridad de reservas
-- Fecha: 2026-07-12   Requiere: is_staff() (20260701000000_security_rls.sql)
--
-- Cierra SEC-005 / BUG-006: la reserva se inserta desde el cliente con
-- appointment_time/end_time arbitrarios y RLS solo comprueba la propiedad.
-- Este trigger valida en SERVIDOR lo mínimo imprescindible sin replicar el
-- motor de huecos:
--   1. end_time > appointment_time         (mata la cita de longitud 0 que
--      evadía parcialmente el trigger de overlap)
--   2. duración razonable (<= 8h)          (evita bloqueos gigantes)
--   3. clientes (no staff) no crean citas en el pasado
--   4. límite de citas futuras activas por cliente (anti-spam de calendario)
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================================

-- Nº máximo de citas futuras confirmadas por cliente (no aplica a staff),
-- ajustable en la constante v_max_active de la función. Anti-spam de calendario.

create or replace function public.check_appt_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  v_active int;
  v_max_active constant int := 5;
begin
  -- 1 + 2: coherencia de horas
  if new.end_time is null or new.appointment_time is null then
    raise exception 'INVALID_TIME' using message = 'Faltan las horas de la cita';
  end if;
  if new.end_time <= new.appointment_time then
    raise exception 'INVALID_TIME' using message = 'La hora de fin debe ser posterior a la de inicio';
  end if;
  if (extract(epoch from (new.end_time - new.appointment_time)) / 3600.0) > 8 then
    raise exception 'INVALID_TIME' using message = 'Duración de cita no válida';
  end if;

  -- A partir de aquí, solo restricciones para clientes; el staff (admin/barber)
  -- puede registrar citas retroactivas o gestionar sin límite.
  if public.is_staff() then
    return new;
  end if;

  -- 3: sin citas en el pasado para clientes
  if new.appointment_date < v_today then
    raise exception 'PAST_DATE' using message = 'No se puede reservar en una fecha pasada';
  end if;

  -- 4: límite de citas futuras activas por cliente (solo en INSERT o al
  --    reconfirmar). Cuenta las confirmadas de hoy en adelante, excluyendo la fila.
  if new.status = 'confirmed' and new.user_id is not null then
    select count(*) into v_active
    from public.appointments a
    where a.user_id = new.user_id
      and a.status = 'confirmed'
      and a.appointment_date >= v_today
      and a.id is distinct from new.id;
    if v_active >= v_max_active then
      raise exception 'TOO_MANY_ACTIVE'
        using message = 'Has alcanzado el máximo de citas activas. Cancela alguna para reservar otra.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appt_integrity on public.appointments;
create trigger trg_appt_integrity
  before insert or update on public.appointments
  for each row execute function public.check_appt_integrity();

revoke all on function public.check_appt_integrity() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Constraints de integridad de datos (FASE 7). NOT VALID para no fallar sobre
-- datos existentes; aplican a toda escritura futura. Valídalas después con
-- `alter table ... validate constraint ...` si los datos actuales cumplen.
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'services_price_nonneg') then
    alter table public.services add constraint services_price_nonneg check (price >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_duration_pos') then
    alter table public.services add constraint services_duration_pos check (duration > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_status_valid') then
    alter table public.appointments add constraint appointments_status_valid
      check (status in ('confirmed','cancelled','completed','no_show')) not valid;
  end if;
end $$;
