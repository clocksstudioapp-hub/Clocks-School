// Verifica el trigger del corte gratis contra un Postgres real (PGlite, en WASM).
//
// Requiere instalarlo una vez, sin tocar package.json:
//   npm i --no-save @electric-sql/pglite
//   node supabase/tests/cf_juventud.test.mjs
//
// Encontró dos cosas que no se veían leyendo el SQL: que RAISE con texto y
// MESSAGE a la vez es ilegal (el jugador veía un error interno de Postgres en
// vez del aviso en español) y que hacía falta contar las citas completadas.
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'fs'

const db=new PGlite()
let pass=0,fail=0
const ok=(n,c)=>{c?(pass++,console.log('  OK   '+n)):(fail++,console.log('  FALLA '+n))}
const boom=async(n,fn,frag)=>{
  try{await fn();fail++;console.log('  FALLA '+n+' (esperaba error y no lo hubo)')}
  catch(e){const m=String(e.message||e);m.includes(frag)?(pass++,console.log('  OK   '+n)):(fail++,console.log('  FALLA '+n+' -> '+m))}
}

// Esquema mínimo equivalente al de producción
await db.exec(`
create table public.services(id int primary key, name text, price numeric, duration int, active boolean default true, player_only boolean default false);
create table public.profiles(id uuid primary key, role text, team_id int);
create table public.appointments(id serial primary key, user_id uuid, service_id int, status text, appointment_date date);
create table public.salon_config(id serial primary key, key text, value text);
insert into public.services values (1,'CORTE CLOCKS',2,60,true,false),(11,'Corte CF Juventud',0,60,true,true);
insert into public.profiles values ('11111111-1111-1111-1111-111111111111','player',1),('22222222-2222-2222-2222-222222222222','client',null);
`)

// La migración: solo reemplaza la función. El trigger ya existe en prod, así
// que aquí se crea igual que está allí.
const mig=readFileSync(new URL('../migrations/20260901000000_cf_juventud_interruptores.sql',import.meta.url),'utf8')
await db.exec(mig)
await db.exec(`create trigger trg_check_player_monthly_limit before insert or update on public.appointments for each row execute function public.check_player_monthly_limit();`)

const P='11111111-1111-1111-1111-111111111111', C='22222222-2222-2222-2222-222222222222'
const book=(u,s,d,st='confirmed')=>db.query('insert into public.appointments(user_id,service_id,status,appointment_date) values ($1,$2,$3,$4) returning id',[u,s,st,d])
const setLimit=v=>db.query("update public.salon_config set value=$1 where key='cf_monthly_limit'",[String(v)])

console.log('\nSemilla de configuración')
const cfg=await db.query("select key,value from public.salon_config order by key")
ok('crea cf_monthly_limit=1 y cf_open_to_all=false', JSON.stringify(cfg.rows)==='[{"key":"cf_monthly_limit","value":"1"},{"key":"cf_open_to_all","value":"false"}]')

console.log('\nLímite por defecto (1 al mes)')
const a1=await book(P,11,'2026-09-05'); ok('primer corte gratis pasa', a1.rows.length===1)
await boom('segundo el mismo mes se bloquea',()=>book(P,11,'2026-09-20'),"Ya has")
ok('otro mes sí pasa',(await book(P,11,'2026-10-03')).rows.length===1)

console.log('\nCancelar libera el cupo')
await db.query("update public.appointments set status='cancelled' where id=$1",[a1.rows[0].id])
ok('tras cancelar vuelve a dejar reservar',(await book(P,11,'2026-09-22')).rows.length===1)

console.log('\nLas ya realizadas siguen gastando cupo (el fallo que se arregla)')
await db.query("update public.appointments set status='completed' where service_id=11 and appointment_date='2026-09-22'")
await boom('con la cita en completed no deja otra',()=>book(P,11,'2026-09-28'),"Ya has")

console.log('\nInterruptor: subir el límite')
await setLimit(2)
ok('con límite 2 entra la segunda',(await book(P,11,'2026-09-29')).rows.length===1)
await boom('pero no la tercera',()=>book(P,11,'2026-09-30'),"Ya has")
await setLimit(0)
ok('con 0 (sin límite) entra igualmente',(await book(P,11,'2026-09-30')).rows.length===1)
await setLimit(1)

console.log('\nNo toca nada que no sea el corte del club')
ok('servicio de pago sin límite (1)',(await book(P,1,'2026-09-05')).rows.length===1)
ok('servicio de pago sin límite (2)',(await book(P,1,'2026-09-06')).rows.length===1)

console.log('\nNo comprueba elegibilidad (a propósito)')
ok('un cliente que no es jugador puede reservarlo',(await book(C,11,'2026-11-04')).rows.length===1)

console.log('\nNormalización del rol')
await db.query("insert into public.profiles values ('33333333-3333-3333-3333-333333333333','user',null)")
await db.exec("update public.profiles set role='client' where role='user'")
ok("no queda ningún role='user'",(await db.query("select count(*)::int c from public.profiles where role='user'")).rows[0].c===0)

console.log('\n── '+pass+' OK, '+fail+' fallos ──')
await db.close();process.exitCode=fail?1:0
