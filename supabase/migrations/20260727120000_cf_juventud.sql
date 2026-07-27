-- ============================================================================
-- Clocks School — CF Juventud: rol jugador, equipos, servicio gratis mensual
-- Requiere: is_admin(), is_staff() (20260701000000_security_rls.sql)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Equipos del club (30, sembrados con placeholders)
-- ----------------------------------------------------------------------------
create table if not exists public.cf_teams (
  id serial primary key,
  name text not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.cf_teams enable row level security;
drop policy if exists cf_teams_select      on public.cf_teams;
drop policy if exists cf_teams_admin_write on public.cf_teams;
create policy cf_teams_select      on public.cf_teams for select to anon, authenticated using (true);
create policy cf_teams_admin_write on public.cf_teams for all    to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.cf_teams (name, active, display_order)
select 'Equipo ' || gs, true, gs
from generate_series(1,30) as gs
where not exists (select 1 from public.cf_teams);

-- ----------------------------------------------------------------------------
-- 2. profiles.team_id — a qué equipo pertenece un jugador
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists team_id integer references public.cf_teams(id);

-- ----------------------------------------------------------------------------
-- 3. services.player_only — oculta el servicio del catálogo público
-- ----------------------------------------------------------------------------
alter table public.services
  add column if not exists player_only boolean not null default false;

-- Bug preexistente (no relacionado con esta feature): la secuencia de id de
-- services estaba desincronizada (apuntaba a 1 con max(id)=10), lo que rompía
-- CUALQUIER alta de servicio nueva desde los paneles admin. Se corrige aquí.
select setval('public.services_id_seq', (select max(id) from public.services));

insert into public.services (name, description, duration, price, category, active, player_only, display_order)
select 'Corte CF Juventud',
       'Corte gratuito mensual para jugadores de C.F. Santo Domingo Juventud',
       60, 0.00, 'other', true, true,
       coalesce((select max(display_order) from public.services), 0) + 1
where not exists (select 1 from public.services where player_only);

-- ----------------------------------------------------------------------------
-- 4. claim_player_role — única vía para pasar a role='player'.
--    trg_prevent_privilege_change bloquea que un usuario no-admin cambie su
--    propio role; esta función SECURITY DEFINER hace esa única transición
--    controlada (client/player -> player), nunca desde admin/barber.
-- ----------------------------------------------------------------------------
create or replace function public.claim_player_role(p_team_id integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.cf_teams where id = p_team_id and active) then
    raise exception 'Equipo no válido';
  end if;
  update public.profiles
    set role = 'player', team_id = p_team_id
    where id = (select auth.uid())
      and role in ('client','player');
end;
$$;
revoke all on function public.claim_player_role(integer) from public, anon;
grant execute on function public.claim_player_role(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Límite de 1 corte gratis al mes — mismo patrón que check_appt_overlap()
-- ----------------------------------------------------------------------------
create or replace function public.check_player_monthly_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_player_only boolean;
begin
  select player_only into v_player_only from public.services where id = new.service_id;
  if v_player_only and new.status = 'confirmed' then
    if exists (
      select 1 from public.appointments a
      where a.user_id = new.user_id
        and a.service_id = new.service_id
        and a.status = 'confirmed'
        and a.id is distinct from new.id
        and date_trunc('month', a.appointment_date) = date_trunc('month', new.appointment_date)
    ) then
      raise exception 'MONTHLY_LIMIT'
        using message = 'Ya has reservado tu corte gratis de este mes';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_player_monthly_limit on public.appointments;
create trigger trg_check_player_monthly_limit
  before insert or update on public.appointments
  for each row execute function public.check_player_monthly_limit();

revoke all on function public.check_player_monthly_limit() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Grants (espejo de la sección 7 de la migración de seguridad original)
-- ----------------------------------------------------------------------------
revoke truncate, references, trigger on public.cf_teams from anon, authenticated;
revoke insert, update, delete on public.cf_teams from anon;
