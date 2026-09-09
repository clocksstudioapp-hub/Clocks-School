-- ============================================================================
-- Ediciones de curso y matriculación de alumnos.
--
-- En Personal > Equipo estaban mezclados los alumnos de todas las ediciones sin
-- forma de distinguirlos. Ahora cada edición ("Septiembre 2026") se marca a mano
-- como en curso, y un alumno puede estar en varias si renueva. Exalumno pasa a
-- ser algo que se deduce: tiene matrículas, pero ninguna en una edición en curso.
--
-- El tipo de curso va en el alumno, no en la edición: en una misma convocatoria
-- puede haber especialidades distintas.
-- ============================================================================

create table if not exists public.courses (
  id          serial primary key,
  name        text not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.stylist_courses (
  stylist_id integer not null references public.stylists(id) on delete cascade,
  course_id  integer not null references public.courses(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (stylist_id, course_id)
);

alter table public.stylists
  add column if not exists course_type text;

-- ----------------------------------------------------------------------------
-- RLS: mismo criterio que el resto del panel. Lectura pública (el listado de
-- profesionales ya lo es) y escritura solo para administradores.
-- ----------------------------------------------------------------------------
alter table public.courses         enable row level security;
alter table public.stylist_courses enable row level security;

drop policy if exists courses_select      on public.courses;
drop policy if exists courses_admin_write on public.courses;
create policy courses_select      on public.courses for select to anon, authenticated using (true);
create policy courses_admin_write on public.courses for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists stylist_courses_select      on public.stylist_courses;
drop policy if exists stylist_courses_admin_write on public.stylist_courses;
create policy stylist_courses_select      on public.stylist_courses for select to anon, authenticated using (true);
create policy stylist_courses_admin_write on public.stylist_courses for all    to authenticated using (public.is_admin()) with check (public.is_admin());

revoke insert, update, delete on public.courses         from anon;
revoke insert, update, delete on public.stylist_courses from anon;

-- ============================================================================
-- Método de pago de las cuotas.
--
-- Al marcar una cuota como pagada solo se guardaba el importe y la fecha, sin
-- decir si entró en efectivo o por tarjeta. Se pide para cuadrar caja y para
-- que salga en la exportación a Excel.
--
-- Nulo = pagos antiguos, de antes de registrar esto.
-- ============================================================================
alter table public.student_fees
  add column if not exists payment_method text;

alter table public.student_fees
  drop constraint if exists student_fees_payment_method_chk;

alter table public.student_fees
  add constraint student_fees_payment_method_chk
  check (payment_method is null or payment_method in ('efectivo', 'tarjeta'));
