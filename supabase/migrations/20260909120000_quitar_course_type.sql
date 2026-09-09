-- ============================================================================
-- stylists.course_type sobraba: el tipo de curso ya se asignaba en Facturación,
-- en student_config.plan (iniciacion / perfeccionamiento), con 26 alumnos ya
-- rellenados. Pedirlo otra vez en la ficha era duplicar el dato y arriesgarse a
-- que las dos fuentes dijeran cosas distintas.
--
-- La columna nunca llegó a usarse: estaba a nulo en las 42 filas.
-- ============================================================================
alter table public.stylists drop column if exists course_type;
