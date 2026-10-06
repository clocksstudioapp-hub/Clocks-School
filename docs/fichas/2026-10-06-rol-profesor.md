# Ficha — Rol "Profesor" (teacher)

**Por qué:** el dueño ha contratado a un profesor que le ayuda en la academia. Tiene
que gestionar la operativa desde el panel admin (citas, alumnos en su día a día, CF
Juventud, horario) **sin ver ni tocar nada de dinero** (facturación, cuotas, planes,
gastos, ingresos, gasto de clientes).

**Decidido por Josema (2026-10-06):**
- El profesor gestiona: Calendario (de todos), Bloqueos (de todos), Turnos y Ausencias de
  los alumnos, Clientes **sin importes**, CF Juventud, y Horario del salón y cierres.
- No ve: Dashboard, Facturación, Barberos (estadísticas de ingresos), Servicios (precios),
  la pestaña Equipo de Personal (fichas, plan y cuotas de los alumnos).
- El rol lo da el dueño con un botón en el admin (Clientes), no hace falta llamar a Josema.

Valor del rol en `profiles.role`: **`teacher`**. El profesor no tiene `stylist_id` (no corta).

El dinero se protege **en la base de datos (RLS)**, no solo escondiendo pantallas: aunque
alguien abra la consola del navegador con la cuenta del profesor, `expenses`,
`student_fees` y `student_config` le devuelven cero filas.

---

## FASE 1 — Base de datos + API (repo `Clocks-School/`)

### Contrato
`Clocks-School/supabase/tests/rol_profesor.test.mjs` **ya existe y está en rojo** (16 fallos).
NO se toca. Hecho = sale verde:

```
cd Clocks-School && npm i --no-save @electric-sql/pglite && node supabase/tests/rol_profesor.test.mjs
```

El test replica la RLS de producción tal como está hoy (léelo: el bloque `create policy`
es la foto de prod) y aplica la migración encima, **dos veces** (tiene que ser idempotente).

### Qué crear
Un único fichero: `Clocks-School/supabase/migrations/20261006120000_rol_profesor.sql`,
con cabecera de comentario en español como el resto de migraciones (qué y por qué).

1. `public.is_staff()` → mismo cuerpo, añadiendo `'teacher'` a la lista de roles
   (`create or replace`, misma firma, `language sql stable security definer set search_path to ''`).
2. Nueva `public.is_manager()` → `true` si el rol del usuario es `admin` o `teacher`.
   Mismo estilo que `is_admin()`. `revoke all ... from public; grant execute ... to anon, authenticated;`
3. Recrear (`drop policy if exists` + `create policy`, **mismos nombres**) estas políticas,
   cambiando `is_admin()` por `is_manager()` y dejando todo lo demás igual:
   - `blocked_slots_staff_write`, `schedule_overrides_staff_write`,
     `stylist_schedules_staff_write`, `time_off_staff_write`
     → `for all to authenticated using (public.is_manager() or stylist_id = public.my_stylist_id()) with check (lo mismo)`
   - `salon_schedule_admin_write`, `salon_closures_admin_write`, `cf_teams_admin_write`,
     `salon_config_admin_write` → `for all to authenticated using (public.is_manager()) with check (public.is_manager())`
4. Dos RPC para CF Juventud (el profesor NO puede hacer `update` directo sobre `profiles`,
   que sigue siendo solo del propio usuario o del admin):
   - `public.cf_cambiar_equipo(p_profile uuid, p_team integer) returns void`
   - `public.cf_quitar_jugador(p_profile uuid) returns void` → `role='client', team_id=null`
   Ambas `language plpgsql security definer set search_path to ''`. Lanzan excepción si
   `not public.is_manager()`, si el perfil no existe o si su rol **no es `player`**.
   `cf_cambiar_equipo` admite `p_team` nulo (sin equipo); si no es nulo, el equipo tiene que
   existir. `revoke all ... from public; grant execute ... to authenticated;`
5. `public.prevent_privilege_change()` (trigger de `profiles`): mantener TODO lo actual y
   añadir un único caso permitido para no-admins: si `public.is_manager()` y
   `old.role = 'player'` y `new.role = 'client'`, el cambio de rol se respeta (lo necesita
   `cf_quitar_jugador`, que corre con la identidad del profesor). `stylist_id` sigue
   bloqueado para no-admins como hoy.

**No tocar:** políticas de `expenses`, `student_fees`, `student_config`, `services`,
`stylists`, `stylist_services`, `courses`, `stylist_courses`, `profiles_*`, `appointments`.
Nada destructivo: ni `drop table`, ni `delete`, ni cambios de datos.

### API (mismo repo)
`api/send-confirmation.js` y `api/send-moved.js` comprueban el rol del que llama con
`['admin','barber']`: añadir `'teacher'` (el profesor mueve citas desde el admin y el
cliente tiene que recibir su email igual).

### No hacer
No aplicar nada a producción: la migración la aplica Claude después de revisarla.

---

## FASE 2 — Panel admin (repo `clocks-admin/`, `src/App.jsx`)

Hecho = `cd clocks-admin && npm run build` limpio + lo de abajo, revisado por Claude.
Seguir el estilo del fichero (inline, compacto, comentarios en español del porqué).

1. **Acceso:** `checkRole` admite `admin`, `barber` y `teacher`.
   Definir `const isTeacher=profile?.role==='teacher'` y `const isManager=isMainAdmin||isTeacher`.
2. **Sidebar:** recibe el rol. Para `teacher`, estos elementos y en este orden:
   Calendario (`cal`), Turnos y ausencias (`personal`), Clientes (`clients`),
   CF Juventud (`cfjuventud`), Bloqueos (`blocks`), Horario salón (`schedule`).
   Subtítulo de la cabecera: `Profesor` (hoy pone `Panel PRO` / `Barbero`).
   Página inicial del profesor: `cal`.
3. **Rutas** (bloque `page===...` de `App`):
   - `cal` y `blocks`: `lockedStylistId={isManager?null:myStyId}` (el profesor ve a todos).
   - `schedule`: `isManager` → `SalonScheduleView`; si no → `MyScheduleView`.
   - `personal`: `isManager`. Con `isTeacher`, `PersonalView` recibe `soloOperativa` y
     muestra **solo** las pestañas Turnos y Ausencias (sin Equipo), arrancando en Turnos.
   - `clients`: `isManager`. Con `isTeacher`, `ClientsView` recibe `sinImportes` y no
     muestra **ningún** importe en €: ni columnas, ni totales, ni orden por gasto, ni en el
     detalle de un cliente.
   - `cfjuventud`: `isManager`.
   - `timeoff` (Mis ausencias): solo `profile.role==='barber'` (hoy es `!isMainAdmin`, que
     incluiría al profesor).
   - `dash`, `finance`, `barbers`, `services`: siguen solo `isMainAdmin`.
4. **CF Juventud:** `changeTeam` y `revokePlayer` dejan de hacer `update` sobre `profiles`
   y llaman a `supabase.rpc('cf_cambiar_equipo',{p_profile,p_team})` y
   `supabase.rpc('cf_quitar_jugador',{p_profile})`. Si devuelven error, `alert` con un
   mensaje en español (hoy fallan en silencio).
5. **Nombrar profesor (solo admin)** en `ClientsView`: en cada cliente con rol `client` o
   `user`, botón "Hacer profesor" que pide confirmación y hace
   `update profiles set role='teacher', stylist_id=null`. En los que ya son `teacher`: etiqueta
   "Profesor" y botón "Quitar profesor" (confirmación → `role='client'`). Nunca sobre
   `admin`, `barber` ni `player`. El profesor no ve estos botones. Recargar datos al terminar
   y mostrar error si falla.
6. No tocar nada más. En concreto: no cambiar el detalle de cita del calendario (el precio
   de un servicio es el de la carta pública).

Al terminar, commit en `clocks-admin` con mensaje en español. No publicar: lo publica Claude
tras revisar.
