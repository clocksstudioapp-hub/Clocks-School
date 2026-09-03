-- ============================================================================
-- Turno de cada profesional: mañana (TM), tarde (TT) o ambos.
--
-- Con 23 profesionales activos, la agenda mostraba las 23 columnas siempre y
-- había que ir deseleccionando a mano dos veces al día. Con el turno guardado,
-- la agenda arranca sola con los que trabajan en la franja actual.
--
-- Por defecto 'ambos': al aplicar esto no cambia nada hasta que se asignen
-- turnos desde Personal.
-- ============================================================================
alter table public.stylists
  add column if not exists shift text not null default 'ambos';

alter table public.stylists
  drop constraint if exists stylists_shift_chk;

alter table public.stylists
  add constraint stylists_shift_chk check (shift in ('TM', 'TT', 'ambos'));
