// Rol "teacher" (profesor): gestiona la operativa de la academia desde el admin
// pero NO ve ni toca el dinero. Verifica la RLS contra un Postgres real (PGlite).
//
//   npm i --no-save @electric-sql/pglite
//   node supabase/tests/rol_profesor.test.mjs
//
// El esquema de abajo replica la RLS de producción tal y como estaba el
// 2026-10-06 (pg_policies). La migración se aplica encima y tiene que dejarlo así:
//   - is_staff() incluye teacher; is_manager() = admin|teacher.
//   - Operativa (bloqueos, turnos, ausencias, horario, cierres, CF) -> is_manager().
//   - Dinero (expenses, student_fees, student_config) y catálogo/equipo
//     (services, stylists, courses...) siguen siendo solo de admin.
//   - CF Juventud: el profesor cambia de equipo o quita jugadores SOLO por RPC
//     (cf_cambiar_equipo / cf_quitar_jugador), y solo sobre perfiles 'player'.
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'fs'

const db=new PGlite()
let pass=0,fail=0
const ok=(n,c)=>{c?(pass++,console.log('  OK    '+n)):(fail++,console.log('  FALLA '+n))}
const boom=async(n,fn)=>{
  try{await fn();fail++;console.log('  FALLA '+n+' (esperaba error y no lo hubo)')}
  catch(e){pass++;console.log('  OK    '+n)}
}

const ADMIN='aaaaaaaa-0000-0000-0000-000000000001'
const PROFE='aaaaaaaa-0000-0000-0000-000000000002'
const BARBER='aaaaaaaa-0000-0000-0000-000000000003' // alumno con stylist_id=1
const CLIENT='aaaaaaaa-0000-0000-0000-000000000004'
const PLAYER='aaaaaaaa-0000-0000-0000-000000000005'

// ── Esquema mínimo equivalente al de producción ────────────────────────────
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.cf_teams(id serial primary key, name text, active boolean default true, display_order int);
create table public.profiles(id uuid primary key, role text, stylist_id int, team_id int references public.cf_teams(id), full_name text, phone text);
create table public.stylists(id serial primary key, name text, active boolean default true, shift text default 'ambos');
create table public.services(id serial primary key, name text, price numeric, duration int);
create table public.appointments(id serial primary key, user_id uuid, stylist_id int, service_id int, appointment_date date, appointment_time time, end_time time, status text default 'confirmed');
create table public.expenses(id serial primary key, amount numeric, created_by uuid);
create table public.student_fees(id serial primary key, stylist_id int, year int, month int, amount_paid numeric, amount_due numeric);
create table public.student_config(stylist_id int primary key, plan text, monthly_fee numeric);
create table public.courses(id serial primary key, name text, is_current boolean default false);
create table public.stylist_courses(stylist_id int, course_id int, primary key(stylist_id,course_id));
create table public.blocked_slots(id serial primary key, stylist_id int, blocked_date date, start_time time, end_time time, created_by uuid);
create table public.schedule_overrides(id serial primary key, stylist_id int, override_date date, active boolean, start_time time, end_time time);
create table public.stylist_schedules(id serial primary key, stylist_id int, day_of_week int, active boolean, start_time time, end_time time, unique(stylist_id,day_of_week));
create table public.time_off(id serial primary key, stylist_id int, start_date date, end_date date, all_day boolean default true, approved boolean default false, created_by uuid);
create table public.salon_schedule(id serial primary key, day_of_week int unique, active boolean, open_time time, close_time time);
create table public.salon_closures(id serial primary key, start_date date, end_date date, reason text);
create table public.salon_config(id serial primary key, key text unique, value text);

grant usage on schema public, auth to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;

create function public.is_admin() returns boolean language sql stable security definer set search_path to '' as
  $$ select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'admin') $$;
create function public.is_staff() returns boolean language sql stable security definer set search_path to '' as
  $$ select exists(select 1 from public.profiles where id = (select auth.uid()) and role in ('admin','barber')) $$;
create function public.my_stylist_id() returns integer language sql stable security definer set search_path to '' as
  $$ select stylist_id from public.profiles where id = (select auth.uid()) $$;

create function public.prevent_privilege_change() returns trigger language plpgsql security definer set search_path to '' as $f$
declare v_player_claim boolean;
begin
  if not public.is_admin() then
    v_player_claim := old.role in ('client','player') and new.role = 'player' and new.team_id is not null
      and exists (select 1 from public.cf_teams where id = new.team_id and active);
    if not v_player_claim then new.role := old.role; end if;
    new.stylist_id := old.stylist_id;
  end if;
  return new;
end $f$;
create trigger trg_prevent_privilege_change before update on public.profiles for each row execute function public.prevent_privilege_change();

do $$ declare t text; begin
  foreach t in array array['profiles','stylists','services','appointments','expenses','student_fees','student_config','courses','stylist_courses','blocked_slots','schedule_overrides','stylist_schedules','time_off','salon_schedule','salon_closures','salon_config','cf_teams'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop; end $$;

create policy appts_select on public.appointments for select to authenticated using ((user_id = (select auth.uid())) or public.is_staff());
create policy appts_insert on public.appointments for insert to authenticated with check ((user_id = (select auth.uid())) or public.is_staff());
create policy appts_update on public.appointments for update to authenticated using ((user_id = (select auth.uid())) or public.is_staff()) with check ((user_id = (select auth.uid())) or public.is_staff());
create policy appts_delete on public.appointments for delete to authenticated using (public.is_staff());

create policy profiles_select on public.profiles for select to authenticated using ((id = (select auth.uid())) or public.is_staff());
create policy profiles_update on public.profiles for update to authenticated using ((id = (select auth.uid())) or public.is_admin()) with check ((id = (select auth.uid())) or public.is_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated using (public.is_admin());

create policy expenses_admin_all on public.expenses for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy student_fees_select on public.student_fees for select to authenticated using (public.is_admin() or stylist_id = public.my_stylist_id());
create policy student_fees_admin_write on public.student_fees for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy student_config_select on public.student_config for select to authenticated using (public.is_admin() or stylist_id = public.my_stylist_id());
create policy student_config_admin_write on public.student_config for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy stylists_select on public.stylists for select to anon, authenticated using (true);
create policy stylists_admin_write on public.stylists for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy services_select on public.services for select to anon, authenticated using (true);
create policy services_admin_write on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy courses_select on public.courses for select to anon, authenticated using (true);
create policy courses_admin_write on public.courses for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy stylist_courses_select on public.stylist_courses for select to anon, authenticated using (true);
create policy stylist_courses_admin_write on public.stylist_courses for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy blocked_slots_select on public.blocked_slots for select to anon, authenticated using (true);
create policy blocked_slots_staff_write on public.blocked_slots for all to authenticated using (public.is_admin() or stylist_id = public.my_stylist_id()) with check (public.is_admin() or stylist_id = public.my_stylist_id());
create policy schedule_overrides_select on public.schedule_overrides for select to anon, authenticated using (true);
create policy schedule_overrides_staff_write on public.schedule_overrides for all to authenticated using (public.is_admin() or stylist_id = public.my_stylist_id()) with check (public.is_admin() or stylist_id = public.my_stylist_id());
create policy stylist_schedules_select on public.stylist_schedules for select to anon, authenticated using (true);
create policy stylist_schedules_staff_write on public.stylist_schedules for all to authenticated using (public.is_admin() or stylist_id = public.my_stylist_id()) with check (public.is_admin() or stylist_id = public.my_stylist_id());
create policy time_off_staff_select on public.time_off for select to authenticated using (public.is_staff());
create policy time_off_staff_write on public.time_off for all to authenticated using (public.is_admin() or stylist_id = public.my_stylist_id()) with check (public.is_admin() or stylist_id = public.my_stylist_id());

create policy salon_schedule_select on public.salon_schedule for select to anon, authenticated using (true);
create policy salon_schedule_admin_write on public.salon_schedule for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy salon_closures_select on public.salon_closures for select to anon, authenticated using (true);
create policy salon_closures_admin_write on public.salon_closures for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy salon_config_select on public.salon_config for select to anon, authenticated using (true);
create policy salon_config_admin_write on public.salon_config for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cf_teams_select on public.cf_teams for select to anon, authenticated using (true);
create policy cf_teams_admin_write on public.cf_teams for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.cf_teams(name) values ('Alevín'),('Infantil');
insert into public.stylists(name) values ('Alumno A'),('Alumno B');
insert into public.services(name,price,duration) values ('CORTE',2,60);
insert into public.profiles(id,role,stylist_id,team_id) values
  ('${ADMIN}','admin',null,null),('${PROFE}','teacher',null,null),('${BARBER}','barber',1,null),
  ('${CLIENT}','client',null,null),('${PLAYER}','player',null,1);
insert into public.appointments(user_id,stylist_id,service_id,appointment_date,appointment_time,end_time) values
  ('${CLIENT}',1,1,'2026-10-08','16:00','17:00'),('${PLAYER}',2,1,'2026-10-08','17:00','18:00');
insert into public.expenses(amount) values (300);
insert into public.student_fees(stylist_id,year,month,amount_paid,amount_due) values (1,2026,10,150,150),(2,2026,10,0,150);
insert into public.student_config(stylist_id,plan,monthly_fee) values (1,'iniciacion',150),(2,'perfeccionamiento',200);
insert into public.time_off(stylist_id,start_date,end_date) values (2,'2026-10-15','2026-10-15');
insert into public.salon_schedule(day_of_week,active,open_time,close_time) values (4,true,'10:00','20:00');
insert into public.salon_config(key,value) values ('cf_open_to_all','false');
`)

// ── La migración bajo prueba ────────────────────────────────────────────────
let mig
try{ mig=readFileSync(new URL('../migrations/20261006120000_rol_profesor.sql',import.meta.url),'utf8') }
catch(e){ console.log('  FALLA no existe supabase/migrations/20261006120000_rol_profesor.sql'); process.exit(1) }
await db.exec(mig)
// Aplicarla dos veces no puede romper nada (prod puede recibirla de nuevo).
await db.exec(mig)

// Ejecuta fn como el usuario uid (rol authenticated), y vuelve a superusuario.
const as=async(uid,fn)=>{
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`)
  try{ return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`) }
}
// Reseteos del propio test: sin trigger (si no, prevent_privilege_change los revierte).
const raw=sql=>db.exec(`set session_replication_role=replica; ${sql}; set session_replication_role=origin;`)
const n=async sql=>{try{return (await db.query(sql)).rows.length}catch(e){return -1}}
const one=async sql=>(await db.query(sql)).rows[0]
// can: la operación tiene que afectar al menos a una fila sin error.
const can=async(name,sql)=>{try{ok(name,(await db.query(sql)).rows.length>0)}catch(e){fail++;console.log('  FALLA '+name+' -> '+e.message)}}
// cannot: error de RLS o 0 filas afectadas cuentan como "no puede".
const cannot=async(name,sql)=>{try{const r=await db.query(sql);ok(name,r.rows.length===0)}catch(e){ok(name,true)}}
// rpcOk / rpcNo: una RPC que debe funcionar / que debe lanzar error.
const rpcOk=async(name,sql)=>{try{await db.query(sql);return true}catch(e){fail++;console.log('  FALLA '+name+' -> '+e.message);return false}}
const rpcNo=async(name,sql)=>{try{await db.query(sql);fail++;console.log('  FALLA '+name+' (esperaba error)')}catch(e){ok(name,true)}}

console.log('\nProfesor: operativa sí')
await as(PROFE,async()=>{
  ok('ve todas las citas', await n('select * from public.appointments')===2)
  ok('ve todos los perfiles (clientes y jugadores)', await n('select * from public.profiles')===5)
  await can('crea cita para un cliente con cualquier alumno', `insert into public.appointments(user_id,stylist_id,service_id,appointment_date,appointment_time,end_time) values ('${CLIENT}',2,1,'2026-10-09','10:00','11:00') returning id`)
  await can('mueve una cita', `update public.appointments set appointment_time='18:00', end_time='19:00' where stylist_id=1 returning id`)
  await can('cancela/borra una cita', `delete from public.appointments where appointment_date='2026-10-09' returning id`)
  await can('bloquea hueco de cualquier alumno', `insert into public.blocked_slots(stylist_id,blocked_date,start_time,end_time) values (2,'2026-10-08','10:00','11:00') returning id`)
  await can('pone excepción de turno a cualquier alumno', `insert into public.schedule_overrides(stylist_id,override_date,active,start_time,end_time) values (2,'2026-10-08',true,'16:00','20:00') returning id`)
  await can('pone horario recurrente a cualquier alumno', `insert into public.stylist_schedules(stylist_id,day_of_week,active,start_time,end_time) values (1,4,true,'10:00','14:00') returning id`)
  ok('ve ausencias', await n('select * from public.time_off')===1)
  await can('aprueba una ausencia', `update public.time_off set approved=true where stylist_id=2 returning id`)
  await can('cambia el horario del salón', `update public.salon_schedule set close_time='19:00' where day_of_week=4 returning id`)
  await can('añade un cierre', `insert into public.salon_closures(start_date,end_date,reason) values ('2026-12-24','2026-12-26','Navidad') returning id`)
  await can('gestiona equipos CF', `insert into public.cf_teams(name) values ('Cadete') returning id`)
  await can('toca los interruptores CF', `update public.salon_config set value='true' where key='cf_open_to_all' returning id`)
})

console.log('\nProfesor: dinero no')
await as(PROFE,async()=>{
  ok('NO ve gastos', await n('select * from public.expenses')===0)
  ok('NO ve cuotas', await n('select * from public.student_fees')===0)
  ok('NO ve planes/precio de alumnos', await n('select * from public.student_config')===0)
  await cannot('NO crea gastos', `insert into public.expenses(amount) values (1) returning id`)
  await cannot('NO marca cuotas', `insert into public.student_fees(stylist_id,year,month,amount_paid,amount_due) values (1,2026,11,150,150) returning id`)
  await cannot('NO modifica cuotas', `update public.student_fees set amount_paid=0 returning id`)
  await cannot('NO cambia planes', `update public.student_config set monthly_fee=0 returning stylist_id`)
  await cannot('NO cambia precios de servicios', `update public.services set price=0 returning id`)
})
ok('el precio del servicio sigue intacto', Number((await one('select price from public.services where id=1')).price)===2)

console.log('\nProfesor: equipo y permisos no')
await as(PROFE,async()=>{
  await cannot('NO da de alta alumnos', `insert into public.stylists(name) values ('X') returning id`)
  await cannot('NO desactiva alumnos', `update public.stylists set active=false returning id`)
  await cannot('NO toca ediciones', `insert into public.courses(name) values ('X') returning id`)
  await cannot('NO matricula', `insert into public.stylist_courses(stylist_id,course_id) values (1,1) returning stylist_id`)
  try{await db.query(`update public.profiles set role='admin' where id='${PROFE}'`)}catch(e){}
  await cannot('NO edita perfiles ajenos', `update public.profiles set full_name='x' where id='${CLIENT}' returning id`)
  await cannot('NO borra perfiles', `delete from public.profiles where id='${CLIENT}' returning id`)
})
ok('NO se hace admin a sí mismo', (await one(`select role from public.profiles where id='${PROFE}'`)).role==='teacher')

console.log('\nProfesor: CF Juventud por RPC')
await as(PROFE,async()=>{
  if(await rpcOk('cambia de equipo a un jugador (rpc)', `select public.cf_cambiar_equipo('${PLAYER}'::uuid, 2)`))
    ok('cambia de equipo a un jugador', (await one(`select team_id from public.profiles where id='${PLAYER}'`)).team_id===2)
  await rpcNo('NO usa cf_cambiar_equipo sobre un no-jugador', `select public.cf_cambiar_equipo('${CLIENT}'::uuid, 1)`)
  await rpcNo('NO usa cf_quitar_jugador sobre el admin', `select public.cf_quitar_jugador('${ADMIN}'::uuid)`)
  if(await rpcOk('quita a un jugador (rpc)', `select public.cf_quitar_jugador('${PLAYER}'::uuid)`)){
    const p=await one(`select role,team_id from public.profiles where id='${PLAYER}'`)
    ok('quita a un jugador (pasa a client, sin equipo)', p.role==='client'&&p.team_id===null)
  }
})
ok('el admin sigue siendo admin', (await one(`select role from public.profiles where id='${ADMIN}'`)).role==='admin')
ok('el cliente sigue siendo cliente', (await one(`select role from public.profiles where id='${CLIENT}'`)).role==='client')
await raw(`update public.profiles set role='player', team_id=1 where id='${PLAYER}'`)
await as(BARBER,async()=>{ await rpcNo('un barbero NO puede usar las RPC de CF', `select public.cf_quitar_jugador('${PLAYER}'::uuid)`) })
await as(CLIENT,async()=>{ await rpcNo('un cliente NO puede usar las RPC de CF', `select public.cf_cambiar_equipo('${PLAYER}'::uuid, 2)`) })
ok('el jugador sigue intacto tras los intentos', (await one(`select role from public.profiles where id='${PLAYER}'`)).role==='player')

console.log('\nAdmin: nombra profesor')
await as(ADMIN,async()=>{
  await can('el admin convierte un cliente en profesor', `update public.profiles set role='teacher', stylist_id=null where id='${CLIENT}' returning id`)
  ok('el admin sigue viendo el dinero', await n('select * from public.student_fees')===2 && await n('select * from public.expenses')===1)
})
ok('el cliente es ahora profesor', (await one(`select role from public.profiles where id='${CLIENT}'`)).role==='teacher')
await raw(`update public.profiles set role='client' where id='${CLIENT}'`)
await as(PROFE,async()=>{ try{await db.query(`update public.profiles set role='teacher' where id='${CLIENT}'`)}catch(e){} })
ok('el profesor NO nombra profesores', (await one(`select role from public.profiles where id='${CLIENT}'`)).role==='client')

console.log('\nRegresión: barbero y cliente como antes')
await as(BARBER,async()=>{
  ok('el barbero ve solo SU cuota', await n('select * from public.student_fees')===1)
  ok('el barbero sigue viendo citas (staff)', await n('select * from public.appointments')>=2)
  await can('el barbero bloquea SU hueco', `insert into public.blocked_slots(stylist_id,blocked_date,start_time,end_time) values (1,'2026-10-08','12:00','13:00') returning id`)
  await cannot('el barbero NO bloquea a otro alumno', `insert into public.blocked_slots(stylist_id,blocked_date,start_time,end_time) values (2,'2026-10-08','12:00','13:00') returning id`)
  await cannot('el barbero NO cambia el horario del salón', `update public.salon_schedule set close_time='18:00' returning id`)
  await cannot('el barbero NO toca equipos CF', `insert into public.cf_teams(name) values ('Y') returning id`)
})
await as(CLIENT,async()=>{
  ok('el cliente ve solo sus citas', await n('select * from public.appointments')===1)
  ok('el cliente NO ve ausencias', await n('select * from public.time_off')===0)
  await cannot('el cliente NO crea bloqueos', `insert into public.blocked_slots(stylist_id,blocked_date,start_time,end_time) values (1,'2026-10-08','12:00','13:00') returning id`)
  await cannot('el cliente NO crea cierres', `insert into public.salon_closures(start_date,end_date) values ('2026-12-31','2026-12-31') returning id`)
})

console.log(`\n${pass} OK, ${fail} FALLA`)
process.exit(fail?1:0)
