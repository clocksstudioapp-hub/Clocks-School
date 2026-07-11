-- ============================================================================
-- Clocks School — Personal: ausencias largas, cierres del centro, excepciones
-- de turno y breaks por profesional. (2026-07-11)
-- Requiere: is_admin(), is_staff(), my_stylist_id() (20260701000000_security_rls.sql)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Breaks por profesional en el horario semanal recurrente
-- ----------------------------------------------------------------------------
alter table public.stylist_schedules
  add column if not exists break_start time,
  add column if not exists break_end   time;

-- ----------------------------------------------------------------------------
-- 2. Ausencias largas (vacaciones/bajas) con aprobación
-- ----------------------------------------------------------------------------
create table if not exists public.time_off (
  id          serial primary key,
  stylist_id  integer not null references public.stylists(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  all_day     boolean not null default true,
  start_time  time,
  end_time    time,
  type        text not null default 'vacation'
              check (type in ('vacation','sick','personal','other')),
  reason      text,
  approved    boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  constraint time_off_date_order check (end_date >= start_date),
  constraint time_off_partial_times check (
    all_day or (start_time is not null and end_time is not null and end_time > start_time)
  )
);
create index if not exists idx_time_off_stylist on public.time_off(stylist_id);
create index if not exists idx_time_off_dates   on public.time_off(start_date, end_date);

alter table public.time_off enable row level security;
drop policy if exists time_off_staff_select on public.time_off;
drop policy if exists time_off_staff_write  on public.time_off;
create policy time_off_staff_select on public.time_off for select to authenticated
  using (public.is_staff());
create policy time_off_staff_write  on public.time_off for all to authenticated
  using (public.is_admin() or stylist_id = public.my_stylist_id())
  with check (public.is_admin() or stylist_id = public.my_stylist_id());

-- Vista pública para el cliente: sin 'reason'/'type', solo aprobadas.
-- Deliberadamente NO security_invoker: el owner salta el RLS de time_off,
-- y eso es lo que queremos (columnas no sensibles de filas aprobadas).
create or replace view public.time_off_public as
  select stylist_id, start_date, end_date, all_day, start_time, end_time
  from public.time_off
  where approved;
grant select on public.time_off_public to anon, authenticated;

-- Endurecimiento: un no-admin solo crea/edita ausencias PROPIAS y NO aprobadas
create or replace function public.enforce_time_off_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then return new; end if;
  if new.approved then
    raise exception 'Solo el administrador puede aprobar ausencias';
  end if;
  if new.stylist_id is distinct from public.my_stylist_id() then
    raise exception 'Solo puedes crear ausencias para ti';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_time_off_rules on public.time_off;
create trigger trg_time_off_rules
  before insert or update on public.time_off
  for each row execute function public.enforce_time_off_rules();

-- ----------------------------------------------------------------------------
-- 3. Cierres del centro por fecha (festivos)
-- ----------------------------------------------------------------------------
create table if not exists public.salon_closures (
  id          serial primary key,
  start_date  date not null,
  end_date    date not null,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint salon_closures_date_order check (end_date >= start_date)
);
create index if not exists idx_salon_closures_dates on public.salon_closures(start_date, end_date);

alter table public.salon_closures enable row level security;
drop policy if exists salon_closures_select      on public.salon_closures;
drop policy if exists salon_closures_admin_write on public.salon_closures;
create policy salon_closures_select      on public.salon_closures for select to anon, authenticated using (true);
create policy salon_closures_admin_write on public.salon_closures for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. Excepciones de turno por fecha
-- ----------------------------------------------------------------------------
create table if not exists public.schedule_overrides (
  id            serial primary key,
  stylist_id    integer not null references public.stylists(id) on delete cascade,
  override_date date not null,
  active        boolean not null default true,
  start_time    time not null default '09:00',
  end_time      time not null default '20:00',
  break_start   time,
  break_end     time,
  created_at    timestamptz not null default now(),
  unique(stylist_id, override_date)
);
create index if not exists idx_schedule_overrides on public.schedule_overrides(stylist_id, override_date);

alter table public.schedule_overrides enable row level security;
drop policy if exists schedule_overrides_select      on public.schedule_overrides;
drop policy if exists schedule_overrides_staff_write on public.schedule_overrides;
create policy schedule_overrides_select on public.schedule_overrides for select to anon, authenticated using (true);
create policy schedule_overrides_staff_write on public.schedule_overrides for all to authenticated
  using (public.is_admin() or stylist_id = public.my_stylist_id())
  with check (public.is_admin() or stylist_id = public.my_stylist_id());

-- ----------------------------------------------------------------------------
-- 5. Fila de DOMINGO cerrada en salon_schedule (imprescindible ANTES de quitar
--    el hardcode dow===0 del cliente: sin fila, el motor abriría 09:00-20:00)
--    La tabla nació con CHECK day_of_week 1..6; se relaja a 0..6 (convención JS
--    getDay(), domingo=0, que es la que usan las dos apps).
-- ----------------------------------------------------------------------------
alter table public.salon_schedule
  drop constraint if exists salon_schedule_day_of_week_check;
alter table public.salon_schedule
  add constraint salon_schedule_day_of_week_check check (day_of_week >= 0 and day_of_week <= 6);

insert into public.salon_schedule (day_of_week, active, open_time, close_time)
select 0, false, '09:00', '20:00'
where not exists (select 1 from public.salon_schedule where day_of_week = 0);

-- ----------------------------------------------------------------------------
-- 6. Grants (espejo de la sección 7 de la migración de seguridad; las revocas
--    de aquella migración no cubren tablas creadas después)
-- ----------------------------------------------------------------------------
revoke truncate, references, trigger on public.time_off, public.salon_closures, public.schedule_overrides from anon, authenticated;
revoke insert, update, delete on public.time_off, public.salon_closures, public.schedule_overrides from anon;
revoke select on public.time_off from anon;
revoke all on function public.enforce_time_off_rules() from public, anon, authenticated;
