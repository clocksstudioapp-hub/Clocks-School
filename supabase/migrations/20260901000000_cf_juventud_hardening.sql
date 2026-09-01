-- ============================================================================
-- CF Juventud — endurecer el guard del corte gratis mensual
--
-- Dos fallos del trigger original (20260727120000_cf_juventud.sql):
--
-- 1. Solo contaba citas con status='confirmed'. Nada en la app marca hoy una
--    cita como 'completed', así que no molestaba — pero el día que se añada un
--    botón de "marcar como completada" en el panel del barbero, la cita dejaría
--    de contar y el jugador podría pedir otro corte gratis el mismo mes. Falla
--    en silencio: ni error, ni rastro.
--
-- 2. No comprobaba que quien reserva sea jugador. La exclusión del servicio
--    vivía solo en el filtro .eq('player_only',false) del cliente, así que
--    cualquier usuario autenticado podía reservar el servicio de 0 € llamando
--    a PostgREST directamente. appts_insert solo valida user_id = auth.uid().
--
-- La comprobación de rol se hace SOLO en INSERT, a propósito: si a un jugador
-- se le retira el rol (baja del club) sus citas ya reservadas deben poder
-- seguir moviéndose o cancelándose desde el panel.
-- ============================================================================
create or replace function public.check_player_monthly_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_player_only boolean;
  v_role        text;
begin
  select player_only into v_player_only from public.services where id = new.service_id;
  if not coalesce(v_player_only, false) then
    return new;
  end if;

  -- Estados que ocupan cupo: cancelar lo libera, haberlo realizado NO.
  if new.status not in ('confirmed', 'completed') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select role into v_role from public.profiles where id = new.user_id;
    if v_role is distinct from 'player' then
      raise exception 'NOT_A_PLAYER'
        using message = 'Este servicio es solo para jugadores del C.F. Santo Domingo Juventud';
    end if;
  end if;

  if exists (
    select 1 from public.appointments a
    where a.user_id = new.user_id
      and a.service_id = new.service_id
      and a.status in ('confirmed', 'completed')
      and a.id is distinct from new.id
      and date_trunc('month', a.appointment_date) = date_trunc('month', new.appointment_date)
  ) then
    raise exception 'MONTHLY_LIMIT'
      using message = 'Ya has reservado tu corte gratis de este mes';
  end if;

  return new;
end;
$$;

-- Normaliza el rol 'user' que dejaba unlinkProfile() al desvincular un barbero.
-- Todo el flujo del jugador espera 'client' (isActivateMode en el cliente y la
-- excepción old.role in ('client','player') del guard anti-escalada), así que un
-- ex-barbero con 'user' no podría activar nunca la tarjeta del club.
update public.profiles set role = 'client' where role = 'user';
