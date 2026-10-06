-- ============================================================================
-- Rol Profesor: permite gestionar citas, alumnos y CF Juventud sin acceso al
-- dinero. Amplía solo las políticas de operativa; cuotas, gastos y precios
-- conservan sus permisos de administrador.
-- ============================================================================

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin','barber','teacher')
  );
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin','teacher')
  );
$$;
revoke all on function public.is_manager() from public;
grant execute on function public.is_manager() to anon, authenticated;

drop policy if exists blocked_slots_staff_write on public.blocked_slots;
create policy blocked_slots_staff_write on public.blocked_slots for all to authenticated
  using (public.is_manager() or stylist_id = public.my_stylist_id())
  with check (public.is_manager() or stylist_id = public.my_stylist_id());

drop policy if exists schedule_overrides_staff_write on public.schedule_overrides;
create policy schedule_overrides_staff_write on public.schedule_overrides for all to authenticated
  using (public.is_manager() or stylist_id = public.my_stylist_id())
  with check (public.is_manager() or stylist_id = public.my_stylist_id());

drop policy if exists stylist_schedules_staff_write on public.stylist_schedules;
create policy stylist_schedules_staff_write on public.stylist_schedules for all to authenticated
  using (public.is_manager() or stylist_id = public.my_stylist_id())
  with check (public.is_manager() or stylist_id = public.my_stylist_id());

drop policy if exists time_off_staff_write on public.time_off;
create policy time_off_staff_write on public.time_off for all to authenticated
  using (public.is_manager() or stylist_id = public.my_stylist_id())
  with check (public.is_manager() or stylist_id = public.my_stylist_id());

drop policy if exists salon_schedule_admin_write on public.salon_schedule;
create policy salon_schedule_admin_write on public.salon_schedule for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists salon_closures_admin_write on public.salon_closures;
create policy salon_closures_admin_write on public.salon_closures for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists cf_teams_admin_write on public.cf_teams;
create policy cf_teams_admin_write on public.cf_teams for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists salon_config_admin_write on public.salon_config;
create policy salon_config_admin_write on public.salon_config for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- El profesor no tiene permiso de UPDATE directo sobre perfiles ajenos: estas
-- funciones permiten solo cambiar o retirar jugadores del CF Juventud.
create or replace function public.cf_cambiar_equipo(p_profile uuid, p_team integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  if not public.is_manager() then
    raise exception 'Permiso denegado';
  end if;
  select role into v_role from public.profiles where id = p_profile for update;
  if not found then
    raise exception 'Perfil no encontrado';
  end if;
  if v_role <> 'player' then
    raise exception 'El perfil no es un jugador';
  end if;
  if p_team is not null and not exists (select 1 from public.cf_teams where id = p_team) then
    raise exception 'Equipo no encontrado';
  end if;
  update public.profiles set team_id = p_team where id = p_profile;
end;
$$;
revoke all on function public.cf_cambiar_equipo(uuid, integer) from public;
grant execute on function public.cf_cambiar_equipo(uuid, integer) to authenticated;

create or replace function public.cf_quitar_jugador(p_profile uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  if not public.is_manager() then
    raise exception 'Permiso denegado';
  end if;
  select role into v_role from public.profiles where id = p_profile for update;
  if not found then
    raise exception 'Perfil no encontrado';
  end if;
  if v_role <> 'player' then
    raise exception 'El perfil no es un jugador';
  end if;
  update public.profiles set role = 'client', team_id = null where id = p_profile;
end;
$$;
revoke all on function public.cf_quitar_jugador(uuid) from public;
grant execute on function public.cf_quitar_jugador(uuid) to authenticated;

-- Mantiene el alta de jugador y la protección de stylist_id. Solo un gestor
-- puede retirar el rol player mediante la RPC anterior.
create or replace function public.prevent_privilege_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_player_claim boolean;
begin
  if not public.is_admin() then
    v_player_claim := old.role in ('client','player')
      and new.role = 'player'
      and new.team_id is not null
      and exists (select 1 from public.cf_teams where id = new.team_id and active);
    if not v_player_claim
      and not (public.is_manager() and old.role = 'player' and new.role = 'client') then
      new.role := old.role;
    end if;
    new.stylist_id := old.stylist_id;
  end if;
  return new;
end;
$$;
