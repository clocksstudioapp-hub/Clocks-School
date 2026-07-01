-- ============================================================================
-- Clocks School — Security Remediation: RLS + hardening
-- Project (prod): hbequopeyzlypmksggdw
-- Date: 2026-07-01
--
-- Context: Before this migration, RLS was effectively disabled on every table
-- and anon/authenticated held full read/write/TRUNCATE grants, exposing all
-- customer PII and business data and allowing anyone to escalate to admin.
--
-- Model: both apps talk to PostgREST as `anon` (logged out) or `authenticated`
-- (logged in). "Staff" = profiles.role in ('admin','barber'). Admin operations
-- run as the admin's `authenticated` JWT, NOT service_role — so policies must
-- grant admin power to authenticated users whose profile.role = 'admin'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper functions (SECURITY DEFINER so they bypass RLS on profiles and do
--    NOT cause recursive policy evaluation). search_path pinned to '' + fully
--    qualified names to prevent search_path hijacking.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin','barber')
  );
$$;

create or replace function public.my_stylist_id()
returns integer language sql stable security definer set search_path = '' as $$
  select stylist_id from public.profiles where id = (select auth.uid());
$$;

revoke all on function public.is_admin()      from public;
revoke all on function public.is_staff()      from public;
revoke all on function public.my_stylist_id() from public;
grant execute on function public.is_admin()      to anon, authenticated;
grant execute on function public.is_staff()      to anon, authenticated;
grant execute on function public.my_stylist_id() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Harden existing SECURITY DEFINER trigger fn (M3: mutable search_path)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone, role, created_at, updated_at)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    'client',                       -- role is server-assigned; never client-supplied
    now(),
    now()
  );
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. PII-free availability. A SECURITY DEFINER function (linter-preferred over a
--    SECURITY DEFINER view) that returns ONLY busy time-blocks (no user_id /
--    name / phone / notes). The booking calendar is login-gated, so only
--    `authenticated` needs it. The client calls it via rpc('get_busy_slots').
-- ----------------------------------------------------------------------------
create or replace function public.get_busy_slots(p_from date, p_to date)
returns table(appointment_date date, appointment_time time without time zone,
              end_time time without time zone, stylist_id integer)
language sql stable security definer set search_path = '' as $$
  select a.appointment_date, a.appointment_time, a.end_time, a.stylist_id
  from public.appointments a
  where a.status = 'confirmed'
    and a.appointment_date >= p_from
    and a.appointment_date <= p_to;
$$;
revoke all on function public.get_busy_slots(date, date) from public;
grant execute on function public.get_busy_slots(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Privilege-escalation guard: non-admins cannot change their own role or
--    stylist_id. Legit self-updates (favorite_stylist_id, email_reminders)
--    still work; protected columns are silently reverted for non-admins.
-- ----------------------------------------------------------------------------
create or replace function public.prevent_privilege_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    new.role       := old.role;
    new.stylist_id := old.stylist_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_privilege_change on public.profiles;
create trigger trg_prevent_privilege_change
  before update on public.profiles
  for each row execute function public.prevent_privilege_change();

-- ----------------------------------------------------------------------------
-- 5. Double-booking guard (H1): reject a confirmed appointment that overlaps an
--    existing confirmed one for the same stylist. Trigger-based (not a
--    constraint) so it enforces new rows only and grandfathers the 1 existing
--    overlap in current data.
-- ----------------------------------------------------------------------------
create or replace function public.check_appt_overlap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmed' then
    if exists (
      select 1 from public.appointments a
      where a.stylist_id = new.stylist_id
        and a.appointment_date = new.appointment_date
        and a.status = 'confirmed'
        and a.id is distinct from new.id
        and a.appointment_time < new.end_time
        and new.appointment_time < a.end_time
    ) then
      raise exception 'SLOT_TAKEN'
        using message = 'Ese horario ya no está disponible';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_appt_overlap on public.appointments;
create trigger trg_check_appt_overlap
  before insert or update on public.appointments
  for each row execute function public.check_appt_overlap();

-- ----------------------------------------------------------------------------
-- 6. Enable RLS + policies, table by table.
--    Public catalog tables: anon+authenticated may SELECT; only admin writes.
-- ----------------------------------------------------------------------------

-- services -------------------------------------------------------------------
alter table public.services enable row level security;
drop policy if exists services_select      on public.services;
drop policy if exists services_admin_write on public.services;
create policy services_select      on public.services for select to anon, authenticated using (true);
create policy services_admin_write on public.services for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- stylists (drop pre-existing dormant policies, recreate cleanly) ------------
alter table public.stylists enable row level security;
drop policy if exists admin_delete_stylists on public.stylists;
drop policy if exists admin_insert_stylists on public.stylists;
drop policy if exists admin_update_stylists on public.stylists;
drop policy if exists stylists_select       on public.stylists;
drop policy if exists stylists_admin_write  on public.stylists;
create policy stylists_select      on public.stylists for select to anon, authenticated using (true);
create policy stylists_admin_write on public.stylists for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- stylist_services -----------------------------------------------------------
alter table public.stylist_services enable row level security;
drop policy if exists stylist_services_select      on public.stylist_services;
drop policy if exists stylist_services_admin_write on public.stylist_services;
create policy stylist_services_select      on public.stylist_services for select to anon, authenticated using (true);
create policy stylist_services_admin_write on public.stylist_services for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- salon_config ---------------------------------------------------------------
alter table public.salon_config enable row level security;
drop policy if exists salon_config_select      on public.salon_config;
drop policy if exists salon_config_admin_write on public.salon_config;
create policy salon_config_select      on public.salon_config for select to anon, authenticated using (true);
create policy salon_config_admin_write on public.salon_config for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- salon_schedule -------------------------------------------------------------
alter table public.salon_schedule enable row level security;
drop policy if exists salon_schedule_select      on public.salon_schedule;
drop policy if exists salon_schedule_admin_write on public.salon_schedule;
create policy salon_schedule_select      on public.salon_schedule for select to anon, authenticated using (true);
create policy salon_schedule_admin_write on public.salon_schedule for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- stylist_schedules (public read; admin or the barber themselves may write) --
alter table public.stylist_schedules enable row level security;
drop policy if exists stylist_schedules_select       on public.stylist_schedules;
drop policy if exists stylist_schedules_staff_write  on public.stylist_schedules;
create policy stylist_schedules_select      on public.stylist_schedules for select to anon, authenticated using (true);
create policy stylist_schedules_staff_write on public.stylist_schedules for all    to authenticated
  using (public.is_admin() or stylist_id = public.my_stylist_id())
  with check (public.is_admin() or stylist_id = public.my_stylist_id());

-- blocked_slots (public read for availability; admin or owning barber writes) -
alter table public.blocked_slots enable row level security;
drop policy if exists blocked_slots_select      on public.blocked_slots;
drop policy if exists blocked_slots_staff_write on public.blocked_slots;
create policy blocked_slots_select      on public.blocked_slots for select to anon, authenticated using (true);
create policy blocked_slots_staff_write on public.blocked_slots for all    to authenticated
  using (public.is_admin() or stylist_id = public.my_stylist_id())
  with check (public.is_admin() or stylist_id = public.my_stylist_id());

-- appointments (owner + staff read; owner or staff insert/update; staff delete)
-- Anonymous users get NO access here; availability comes from busy_slots view.
alter table public.appointments enable row level security;
drop policy if exists appts_select on public.appointments;
drop policy if exists appts_insert on public.appointments;
drop policy if exists appts_update on public.appointments;
drop policy if exists appts_delete on public.appointments;
create policy appts_select on public.appointments for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());
create policy appts_insert on public.appointments for insert to authenticated
  with check (user_id = (select auth.uid()) or public.is_staff());
create policy appts_update on public.appointments for update to authenticated
  using (user_id = (select auth.uid()) or public.is_staff())
  with check (user_id = (select auth.uid()) or public.is_staff());
create policy appts_delete on public.appointments for delete to authenticated
  using (public.is_staff());

-- profiles (own row + staff read; own or admin update; admin delete) ---------
-- Role/stylist_id changes by non-admins are blocked by trg_prevent_privilege_change.
alter table public.profiles enable row level security;
drop policy if exists profiles_select       on public.profiles;
drop policy if exists profiles_update        on public.profiles;
drop policy if exists profiles_admin_delete  on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_staff());
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.is_admin());
-- (no INSERT policy: rows are created by the SECURITY DEFINER handle_new_user trigger)

-- push_subscriptions (own; staff may read; service_role bypasses RLS) --------
alter table public.push_subscriptions enable row level security;
drop policy if exists push_select on public.push_subscriptions;
drop policy if exists push_insert on public.push_subscriptions;
drop policy if exists push_update on public.push_subscriptions;
drop policy if exists push_delete on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());
create policy push_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy push_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- expenses (admin only) ------------------------------------------------------
alter table public.expenses enable row level security;
drop policy if exists expenses_admin_all on public.expenses;
create policy expenses_admin_all on public.expenses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- student_config (admin manage; barber reads own) ----------------------------
alter table public.student_config enable row level security;
drop policy if exists admin_all_student_config    on public.student_config;
drop policy if exists student_config_select       on public.student_config;
drop policy if exists student_config_admin_write  on public.student_config;
create policy student_config_select      on public.student_config for select to authenticated
  using (public.is_admin() or stylist_id = public.my_stylist_id());
create policy student_config_admin_write on public.student_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- student_fees (admin manage; barber reads own) ------------------------------
alter table public.student_fees enable row level security;
drop policy if exists admin_all_student_fees   on public.student_fees;
drop policy if exists student_fees_select      on public.student_fees;
drop policy if exists student_fees_admin_write on public.student_fees;
create policy student_fees_select      on public.student_fees for select to authenticated
  using (public.is_admin() or stylist_id = public.my_stylist_id());
create policy student_fees_admin_write on public.student_fees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 7. Tighten grants (defense-in-depth on top of RLS)
--    - TRUNCATE is NOT governed by RLS, so it must be revoked explicitly.
--    - anon never writes anything in either app.
--    - anon has no business reading PII/finance tables at all.
-- ----------------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke insert, update, delete on all tables in schema public from anon;
revoke select on
  public.appointments, public.profiles, public.expenses,
  public.push_subscriptions, public.student_fees, public.student_config
  from anon;

-- ----------------------------------------------------------------------------
-- 8. Lock down function EXECUTE (advisor 0028/0029). Trigger functions must not
--    be REST-callable (triggers still fire); predicate helpers are only used by
--    authenticated-facing policies.
-- ----------------------------------------------------------------------------
revoke all on function public.handle_new_user()          from public, anon, authenticated;
revoke all on function public.check_appt_overlap()       from public, anon, authenticated;
revoke all on function public.prevent_privilege_change() from public, anon, authenticated;
revoke execute on function public.is_admin()      from anon;
revoke execute on function public.is_staff()      from anon;
revoke execute on function public.my_stylist_id() from anon;
