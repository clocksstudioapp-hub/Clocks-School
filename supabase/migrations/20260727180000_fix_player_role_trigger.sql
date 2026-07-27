-- ============================================================================
-- Fix: trg_prevent_privilege_change bloqueaba también la transición legítima
-- a role='player' hecha vía claim_player_role().
--
-- Diagnóstico: prevent_privilege_change() decide si revertir NEW.role
-- comprobando is_admin(), que lee auth.uid() de la sesión que originó la
-- petición — esto NO cambia aunque claim_player_role() sea SECURITY DEFINER,
-- porque los triggers de tabla se disparan sobre el UPDATE en sí, no sobre
-- quién es el "dueño" de la función que lo emitió. Resultado real en prod:
-- claim_player_role() devolvía éxito sin error, pero el UPDATE que hacía
-- dejaba team_id fijado y el trigger revertía role de vuelta a 'client' en
-- silencio — el jugador nunca quedaba activado.
--
-- Fix: enseñar al trigger la ÚNICA excepción legítima que un no-admin puede
-- hacer sobre su propio role — la misma validación que ya hace
-- claim_player_role (client/player -> player, con un equipo activo válido).
-- stylist_id sigue protegido siempre para no-admins.
-- ============================================================================
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
    if not v_player_claim then
      new.role := old.role;
    end if;
    new.stylist_id := old.stylist_id;
  end if;
  return new;
end;
$$;
