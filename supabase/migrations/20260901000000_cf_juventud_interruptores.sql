-- ============================================================================
-- CF Juventud — el límite mensual pasa a ser configurable
--
-- Contexto: Clocks School es escuela. Los alumnos necesitan maniquíes, así que
-- un corte regalado no es un coste sino una práctica conseguida y el objetivo
-- es MAXIMIZAR reservas. Por eso este archivo NO añade ninguna comprobación de
-- elegibilidad: que un cliente cualquiera pueda reservar el corte gratis es una
-- puerta que interesa abierta, no un agujero.
--
-- Lo único que se hace es sacar el "1 al mes" de estar cableado en el trigger y
-- ponerlo en salon_config, para poder abrir la mano desde el panel sin
-- despliegue. El valor por defecto es 1: sin tocar nada, se comporta igual que
-- hoy.
-- ============================================================================

-- salon_config es clave/valor (id, key, value).
--
-- Antes de insertar hay que resincronizar la secuencia del id: viene sembrada
-- con ids explícitos y nunca avanzó, así que el primer insert intenta reusar un
-- id existente y revienta con duplicate key. Es el mismo problema que tenía
-- services_id_seq y que se corrigió en la migración de julio.
-- setval es STRICT: si la tabla no tuviera secuencia, pg_get_serial_sequence
-- devuelve null y esto no hace nada, en vez de fallar.
select setval(
  pg_get_serial_sequence('public.salon_config', 'id'),
  coalesce((select max(id) from public.salon_config), 0) + 1,
  false
);

insert into public.salon_config (key, value)
select 'cf_monthly_limit', '1'
where not exists (select 1 from public.salon_config where key = 'cf_monthly_limit');

insert into public.salon_config (key, value)
select 'cf_open_to_all', 'false'
where not exists (select 1 from public.salon_config where key = 'cf_open_to_all');

-- ----------------------------------------------------------------------------
-- El trigger lee el límite en vez de asumir 1. 0 (o vacío) = sin límite.
--
-- Además cuenta 'completed' y no solo 'confirmed': nada marca hoy una cita como
-- completada, pero el día que se añada ese botón el cupo dejaría de contar y el
-- límite se saltaría solo. Cancelar sigue liberando el cupo.
-- ----------------------------------------------------------------------------
create or replace function public.check_player_monthly_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_player_only boolean;
  v_limit       integer;
  v_used        integer;
begin
  select player_only into v_player_only from public.services where id = new.service_id;
  if not coalesce(v_player_only, false) then
    return new;
  end if;

  if new.status not in ('confirmed', 'completed') then
    return new;
  end if;

  select coalesce(nullif(trim(value), ''), '1')::integer
    into v_limit
    from public.salon_config
   where key = 'cf_monthly_limit';

  v_limit := coalesce(v_limit, 1);
  if v_limit <= 0 then
    return new;  -- sin límite
  end if;

  select count(*)
    into v_used
    from public.appointments a
   where a.user_id = new.user_id
     and a.service_id = new.service_id
     and a.status in ('confirmed', 'completed')
     and a.id is distinct from new.id
     and date_trunc('month', a.appointment_date) = date_trunc('month', new.appointment_date);

  if v_used >= v_limit then
    -- OJO: 'raise exception <texto> using message = ...' es ilegal en PostgreSQL
    -- (no se puede dar el texto y MESSAGE a la vez) y es lo que hay hoy en
    -- producción: el jugador ve "RAISE option already specified: MESSAGE" en vez
    -- del aviso en español, porque la app muestra error.message tal cual.
    raise exception '%', case when v_limit = 1
        then 'Ya has reservado tu corte gratis de este mes'
        else 'Ya has agotado tus ' || v_limit || ' cortes gratis de este mes' end
      using detail = 'MONTHLY_LIMIT';
  end if;

  return new;
end;
$$;

-- Normaliza el rol 'user' que dejaba unlinkProfile(). Todo el flujo del jugador
-- espera 'client', así que un ex-barbero no podría activar nunca la tarjeta.
update public.profiles set role = 'client' where role = 'user';
