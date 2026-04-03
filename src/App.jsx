import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

// ═══ CSS ══════════════════════════════════════════════════════════════════════
const CSS = `
:root{
  --bg:#F8F5FF;--white:#FFFFFF;--border:#EDE9FE;--border2:#DDD6FE;
  --text:#1C1C1E;--text2:#4B5563;--text3:#9CA3AF;
  --purple:#7C3AED;--purple-l:#A78BFA;--purple-d:#6D28D9;
  --purple-bg:#EDE9FE;--purple-bg2:#F3F0FF;
  --green:#22C55E;--green-bg:rgba(34,197,94,0.10);
  --yellow:#F59E0B;--orange:#F97316;--orange-bg:rgba(249,115,22,0.09);
  --red:#EF4444;--red-bg:rgba(239,68,68,0.08);
  --shadow:0 2px 8px rgba(109,40,217,0.07);
  --shadow-md:0 8px 24px rgba(109,40,217,0.15)
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--purple)!important;box-shadow:0 0 0 3px rgba(124,58,237,0.12)!important}
::-webkit-scrollbar{width:4px;height:0}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes scaleIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes glow{0%,100%{opacity:1}50%{opacity:0.45}}
.anim{animation:fadeUp .42s cubic-bezier(.16,1,.3,1) both}
.d1{animation-delay:40ms}.d2{animation-delay:80ms}.d3{animation-delay:120ms}.d4{animation-delay:160ms}.d5{animation-delay:200ms}
.scale-in{animation:scaleIn .32s cubic-bezier(.16,1,.3,1) both}
textarea{font-family:inherit;resize:none}img{display:block}
select{font-family:inherit;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px!important}
`

// ═══ HELPERS ══════════════════════════════════════════════════════════════════
const dayL = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
const dayLong = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
const dayF = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
const MO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const toK = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const isT = d => toK(d) === toK(new Date())
const isP = d => { const t = new Date(); t.setHours(0,0,0,0); return d < t }
const fD = d => `${d.getDate()} de ${MO[d.getMonth()]}`
const fDF = d => `${dayF[d.getDay()]}, ${fD(d)}`
const fS = d => `${d.getDate()} ${MS[d.getMonth()]}`
const parseDate = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d) }
const aM = (t,m) => { let [h,mi]=t.split(':').map(Number); mi+=m; while(mi>=60){h++;mi-=60} return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}` }
const gS = (o='09:00',c='20:00',step=30) => { const s=[]; let [h,m]=o.split(':').map(Number); const [ch,cm]=c.split(':').map(Number); while(h<ch||(h===ch&&m<cm)){s.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);m+=step;if(m>=60){h++;m-=60}} return s }
const gMD = (y,m) => { const f=new Date(y,m,1),l=new Date(y,m+1,0); let s=f.getDay()-1; if(s<0)s=6; const d=[]; for(let i=0;i<s;i++)d.push(null); for(let i=1;i<=l.getDate();i++)d.push(new Date(y,m,i)); return d }
const svcIcon = n => { const s=(n||'').toLowerCase(); if(s.includes('barba'))return'🪒'; if(s.includes('ceja'))return'✦'; if(s.includes('color')||s.includes('mecha'))return'🎨'; return'✂️' }

// Dado un barbero y una fecha, calcula sus slots libres teniendo en cuenta
// su horario semanal fijo (stylist_schedules) + bloqueos puntuales
const getSlotsForDay = (date, stylistId, schedules, appointments, blockedSlots, svcDuration) => {
  const dow = date.getDay() // 0=Dom,1=Lun,...,6=Sáb
  if(dow === 0) return [] // Domingo siempre cerrado

  // Horario fijo del barbero para este día de semana (1=Lun...6=Sáb)
  const sched = schedules.find(s => s.stylist_id === stylistId && s.day_of_week === dow)

  // Si tiene horario configurado y está desactivado → no trabaja
  if(sched && !sched.active) return []

  // Horario efectivo: usa el del barbero si existe, si no el del salón
  const dayOpen = sched ? sched.start_time.slice(0,5) : '09:00'
  const dayClose = sched ? sched.end_time.slice(0,5) : (dow === 6 ? '14:00' : '20:00')

  const allSlots = gS(dayOpen, dayClose)
  const dk = toK(date)
  const taken = new Set()

  appointments
    .filter(a => a.appointment_date === dk && a.stylist_id === stylistId)
    .forEach(a => { let c = a.appointment_time.slice(0,5); const e = a.end_time.slice(0,5); while(c<e){taken.add(c);c=aM(c,30)} })

  blockedSlots
    .filter(b => b.blocked_date === dk && b.stylist_id === stylistId)
    .forEach(b => { let c = b.start_time.slice(0,5); const e = b.end_time.slice(0,5); while(c<e){taken.add(c);c=aM(c,30)} })

  return allSlots.filter(s => {
    const end = aM(s, svcDuration)
    if(end > dayClose) return false
    let c = s
    while(c < end){ if(taken.has(c)) return false; c = aM(c,30) }
    return true
  })
}

const HERO = ['images/hero-1.jpg','images/hero-2.jpg','images/hero-3.jpg','images/hero-4.jpg']
const GALL = ['images/work-1.jpg','images/work-2.jpg','images/work-3.jpg','images/work-4.jpg','images/work-5.jpg','images/work-6.jpg']

// ═══ ATOMS ════════════════════════════════════════════════════════════════════
const Sp = () => <div style={{display:'flex',justifyContent:'center',padding:40}}>
  <div style={{width:28,height:28,border:'3px solid var(--border)',borderTopColor:'var(--purple)',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>
</div>

const BB = ({onClick,label}) => <button onClick={onClick} style={{background:'none',border:'none',cursor:'pointer',padding:'12px 0',display:'flex',alignItems:'center',gap:6,color:'var(--text)',fontSize:14,fontWeight:500,fontFamily:'inherit'}}>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
  {label}
</button>

function Bt({children,onClick,disabled,full,variant='primary',small,style:sx,...rest}) {
  const p=variant==='primary', d=variant==='danger'
  return <button onClick={disabled?undefined:onClick} style={{
    fontFamily:'inherit',fontSize:small?13:15,fontWeight:700,
    padding:small?'9px 18px':'14px 28px',
    width:full?'100%':'auto',
    color:p?'#fff':d?'var(--red)':'var(--purple)',
    background:p?(disabled?'var(--border2)':'linear-gradient(135deg,var(--purple),var(--purple-l))'):d?'var(--red-bg)':'var(--purple-bg)',
    border:p?'none':d?'1px solid rgba(239,68,68,0.15)':'1px solid var(--border)',
    borderRadius:small?10:14,cursor:disabled?'default':'pointer',transition:'all .2s',
    display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,
    boxShadow:p&&!disabled?'0 4px 16px rgba(124,58,237,0.38)':'none',
    ...sx
  }} {...rest}>{children}</button>
}

function In({label,required,error,...props}) {
  return <div style={{marginBottom:14}}>
    {label&&<label style={{fontSize:13,fontWeight:600,marginBottom:6,display:'block',color:'var(--text)'}}>
      {label}{required&&<span style={{color:'var(--red)',marginLeft:2}}>*</span>}
    </label>}
    <input {...props} style={{width:'100%',padding:'12px 14px',fontSize:14,border:`1px solid ${error?'var(--red)':'var(--border2)'}`,borderRadius:12,background:'var(--white)',color:'var(--text)',fontFamily:'inherit',...(props.style||{})}}/>
    {error&&<p style={{fontSize:12,color:'var(--red)',marginTop:4}}>{error}</p>}
  </div>
}

function Sl({label,children,...props}) {
  return <div style={{marginBottom:14}}>
    {label&&<label style={{fontSize:13,fontWeight:600,marginBottom:6,display:'block'}}>{label}</label>}
    <select {...props} style={{width:'100%',padding:'12px 14px',fontSize:14,border:'1px solid var(--border2)',borderRadius:12,background:'var(--white)',color:'var(--text)',cursor:'pointer',fontFamily:'inherit'}}>{children}</select>
  </div>
}

const Bg = ({children,color='var(--purple)',bg='var(--purple-bg)'}) => <span style={{fontSize:11,fontWeight:700,color,background:bg,padding:'3px 10px',borderRadius:20,whiteSpace:'nowrap'}}>{children}</span>
const Em = ({icon,text}) => <div style={{textAlign:'center',padding:'48px 20px'}}><div style={{fontSize:36,marginBottom:12,opacity:0.3}}>{icon}</div><p style={{fontSize:14,color:'var(--text3)'}}>{text}</p></div>

function Modal({children}) {
  return <div style={{position:'fixed',inset:0,background:'rgba(28,28,30,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:20}}>
    <div className="scale-in" style={{background:'var(--white)',borderRadius:24,padding:24,maxWidth:440,width:'100%',boxShadow:'var(--shadow-md)',maxHeight:'92vh',overflowY:'auto',border:'1px solid var(--border)'}}>{children}</div>
  </div>
}

const ClockSVG = ({size=28,color='#fff'}) => <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
  <circle cx="15" cy="15" r="11" stroke={color} strokeWidth="1.5" strokeOpacity="0.85"/>
  <path d="M15 9v6l4 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
</svg>

// ═══ SERVICE CARD ═════════════════════════════════════════════════════════════
function SvcCard({s,sel,onClick,i,bookBtn}) {
  return <div onClick={onClick} className={`anim d${(i%5)+1}`} style={{
    display:'flex',alignItems:'center',gap:14,padding:'16px 18px',borderRadius:18,cursor:'pointer',
    background:sel?'linear-gradient(135deg,var(--purple),var(--purple-l))':'var(--white)',
    border:sel?'none':'1.5px solid var(--border)',
    boxShadow:sel?'0 12px 28px rgba(124,58,237,0.28)':'var(--shadow)',
    marginBottom:10,transition:'all .2s'
  }}>
    <div style={{width:44,height:44,borderRadius:14,flexShrink:0,background:sel?'rgba(255,255,255,0.18)':'var(--purple-bg2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>
      {svcIcon(s.name)}
    </div>
    <div style={{flex:1,minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        <span style={{fontSize:14,fontWeight:700,color:sel?'#fff':'var(--text)'}}>{s.name}</span>
        {s.category==='popular'&&<span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:6,background:sel?'rgba(255,255,255,0.22)':'var(--purple-bg)',color:sel?'#fff':'var(--purple)'}}>TOP</span>}
      </div>
      <div style={{fontSize:12,color:sel?'rgba(255,255,255,0.65)':'var(--text3)',marginTop:3}}>
        {s.duration} min{s.description?` · ${s.description}`:''}
      </div>
    </div>
    <div style={{flexShrink:0,textAlign:'right',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6}}>
      <div style={{fontSize:20,fontWeight:900,color:sel?'#fff':'var(--purple)'}}>{Number(s.price).toFixed(0)}€</div>
      {bookBtn&&!sel&&<button onClick={e=>{e.stopPropagation();onClick()}} style={{fontSize:11,color:'var(--purple)',background:'var(--purple-bg)',border:'none',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:700}}>Reservar</button>}
    </div>
  </div>
}

// ═══ LANDING ══════════════════════════════════════════════════════════════════
function Landing({svcs,stys,user,isA,onRes,onLog,onAcc,onAdm,salonConfig}) {
  const [hi,setHi]=useState(0)
  const [tab,setTab]=useState('servicios')
  useEffect(()=>{const t=setInterval(()=>setHi(i=>(i+1)%HERO.length),4500);return()=>clearInterval(t)},[])

  const now=new Date(),dow=now.getDay(),hr=now.getHours()+now.getMinutes()/60
  const isOpen=dow>=1&&dow<=5?hr>=9&&hr<20:dow===6?hr>=9&&hr<14:false
  const pop=svcs.filter(s=>s.category==='popular')
  const oth=svcs.filter(s=>s.category!=='popular')
  const addr=salonConfig?.address||'Fuentes de Ebro, Zaragoza'
  const phone=salonConfig?.phone||'—'
  const insta=salonConfig?.instagram||'@clocksschool'

  return <div style={{paddingBottom:88}}>
    <div style={{position:'relative',height:260,overflow:'hidden',background:'#DDD6FE'}}>
      {HERO.map((src,i)=><div key={i} style={{position:'absolute',inset:0,opacity:hi===i?1:0,transition:'opacity .85s'}}>
        <img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>{e.target.style.display='none';e.target.parentElement.style.background=`hsl(${260+i*15},25%,${65+i*4}%)`}}/>
      </div>)}
      <div style={{position:'absolute',inset:0,background:'linear-gradient(to bottom,rgba(109,40,217,0.08) 0%,rgba(109,40,217,0.55) 100%)'}}/>
      <div style={{position:'absolute',bottom:14,left:'50%',transform:'translateX(-50%)',display:'flex',gap:6,zIndex:3}}>
        {HERO.map((_,i)=><button key={i} onClick={()=>setHi(i)} style={{width:hi===i?20:6,height:6,borderRadius:3,border:'none',cursor:'pointer',background:'#fff',opacity:hi===i?1:0.5,transition:'all .3s'}}/>)}
      </div>
      {user&&<button onClick={onAcc} style={{position:'absolute',top:14,left:14,zIndex:3,width:36,height:36,borderRadius:18,background:'rgba(255,255,255,0.92)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.15)'}}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </button>}
      <div style={{position:'absolute',top:14,right:14,zIndex:3,display:'flex',gap:8}}>
        {isA&&<button onClick={onAdm} style={{height:36,borderRadius:18,background:'rgba(255,255,255,0.92)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',padding:'0 14px',fontSize:12,fontWeight:700,fontFamily:'inherit',color:'var(--purple)'}}>⚙ Admin</button>}
        {!user&&<button onClick={onLog} style={{height:36,borderRadius:18,background:'rgba(255,255,255,0.92)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',padding:'0 14px',fontSize:12,fontWeight:600,fontFamily:'inherit',color:'var(--text)'}}>Iniciar sesión</button>}
      </div>
    </div>

    <div style={{background:'var(--white)',padding:'20px 20px 16px',borderBottom:'1px solid var(--border)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:7}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:isOpen?'var(--green)':'var(--text3)',boxShadow:isOpen?'0 0 8px var(--green)':'none',animation:isOpen?'glow 2.2s ease-in-out infinite':'none'}}/>
            <span style={{color:'var(--text3)',fontSize:12,fontWeight:500,letterSpacing:0.3}}>{isOpen?'Abierto ahora':'Cerrado'}</span>
          </div>
          <h1 style={{fontSize:36,fontWeight:900,color:'var(--text)',letterSpacing:-2.5,lineHeight:1,marginBottom:3}}>CLOCKS</h1>
          <p style={{fontSize:11,fontWeight:700,color:'var(--purple)',letterSpacing:2.5,textTransform:'uppercase',marginBottom:4}}>School · Barbería</p>
          <p style={{fontSize:12,color:'var(--text3)'}}>Zaragoza</p>
        </div>
        <div style={{width:54,height:54,borderRadius:16,background:'linear-gradient(135deg,var(--purple),var(--purple-l))',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 6px 20px rgba(124,58,237,0.38)',flexShrink:0}}>
          <ClockSVG size={30}/>
        </div>
      </div>
    </div>

    <div style={{display:'flex',background:'var(--white)',borderBottom:'1px solid var(--border)',padding:'0 20px',overflowX:'auto'}}>
      {[['servicios','SERVICIOS'],['equipo','EQUIPO'],['portafolio','PORTAFOLIO'],['detalles','DETALLES']].map(([id,lbl])=>
        <button key={id} onClick={()=>setTab(id)} style={{padding:'14px 0',marginRight:24,fontSize:11,fontWeight:700,letterSpacing:'0.07em',color:tab===id?'var(--purple)':'var(--text3)',borderBottom:tab===id?'2.5px solid var(--purple)':'2.5px solid transparent',background:'none',border:'none',cursor:'pointer',whiteSpace:'nowrap',fontFamily:'inherit'}}>{lbl}</button>
      )}
    </div>

    {tab==='servicios'&&<div style={{padding:'16px 16px 0'}}>
      {pop.length>0&&<><p style={{fontSize:12,fontWeight:700,color:'var(--text3)',letterSpacing:0.5,textTransform:'uppercase',marginBottom:12}}>Más populares</p>{pop.map((s,i)=><SvcCard key={s.id} s={s} sel={false} onClick={()=>onRes(s)} i={i} bookBtn/>)}</>}
      {oth.length>0&&<><p style={{fontSize:12,fontWeight:700,color:'var(--text3)',letterSpacing:0.5,textTransform:'uppercase',margin:'8px 0 12px'}}>Otros servicios</p>{oth.map((s,i)=><SvcCard key={s.id} s={s} sel={false} onClick={()=>onRes(s)} i={i} bookBtn/>)}</>}
    </div>}

    {tab==='equipo'&&<div style={{padding:16}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12}}>
        {stys.map((s,i)=><div key={s.id} className={`anim d${i+1}`} style={{borderRadius:18,overflow:'hidden',background:'var(--white)',border:'1.5px solid var(--border)',boxShadow:'var(--shadow)'}}>
          <div style={{height:160,overflow:'hidden',background:'var(--purple-bg2)'}}>
            {s.photo_url?<img src={s.photo_url} alt={s.name} style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>:
              <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:42,fontWeight:900,color:'var(--purple)',opacity:0.25}}>{s.name[0]}</div>}
          </div>
          <div style={{padding:'12px 14px'}}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{s.name}</div>
            <div style={{fontSize:12,color:'var(--purple)',fontWeight:600,marginTop:2}}>{s.role_title}</div>
          </div>
        </div>)}
      </div>
    </div>}

    {tab==='portafolio'&&<div style={{padding:'16px 0 0'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:3}}>
        {GALL.map((src,i)=><div key={i} style={{aspectRatio:'1',overflow:'hidden',background:'var(--purple-bg2)'}}>
          <img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>
        </div>)}
      </div>
    </div>}

    {tab==='detalles'&&<div style={{padding:16}}>
      {[
        {i:'📍',l:'Dirección',t:addr},
        {i:'🕐',l:'Horario',t:'Lunes — Viernes: 9:00 – 20:00\nSábado: 9:00 – 14:00\nDomingo: Cerrado'},
        {i:'📞',l:'Teléfono',t:phone},
        {i:'📸',l:'Instagram',t:insta}
      ].map((d,idx)=><div key={idx} style={{display:'flex',gap:14,alignItems:'flex-start',padding:'14px 0',borderBottom:idx<3?'1px solid var(--border)':'none'}}>
        <div style={{width:40,height:40,borderRadius:12,background:'var(--purple-bg)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:18}}>{d.i}</div>
        <div><div style={{fontSize:12,color:'var(--text3)',fontWeight:500,marginBottom:3}}>{d.l}</div><div style={{fontSize:14,fontWeight:500,lineHeight:1.55,whiteSpace:'pre-line',color:'var(--text)'}}>{d.t}</div></div>
      </div>)}
    </div>}

    <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'rgba(255,255,255,0.94)',backdropFilter:'blur(14px)',borderTop:'1px solid var(--border)',padding:'12px 20px 18px',zIndex:50}}>
      <button onClick={()=>onRes(null)} style={{width:'100%',padding:15,fontSize:15,fontWeight:700,color:'#fff',background:'linear-gradient(135deg,var(--purple),var(--purple-l))',border:'none',borderRadius:14,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:8,boxShadow:'0 6px 20px rgba(124,58,237,0.42)'}}>
        Reservar cita
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
      </button>
    </div>
  </div>
}

// ═══ AUTH ═════════════════════════════════════════════════════════════════════
function Auth({onLogin,onBack}) {
  const [m,setM]=useState('login'),[em,setEm]=useState(''),[pw,setPw]=useState(''),[nm,setNm]=useState(''),[ph,setPh]=useState(''),[ld,setLd]=useState(false),[er,setEr]=useState('')
  const sub=async()=>{
    setEr('');setLd(true)
    try {
      if(m==='register'){
        if(!nm.trim()||!em.trim()||!pw.trim()){setEr('Rellena los campos obligatorios');setLd(false);return}
        if(pw.length<6){setEr('Mínimo 6 caracteres');setLd(false);return}
        const {data,error:e}=await supabase.auth.signUp({email:em.trim(),password:pw,options:{data:{full_name:nm.trim(),phone:ph.trim()}}})
        if(e)throw e; if(data.user)onLogin(data.user)
      } else {
        if(!em.trim()||!pw.trim()){setEr('Introduce email y contraseña');setLd(false);return}
        const {data,error:e}=await supabase.auth.signInWithPassword({email:em.trim(),password:pw})
        if(e)throw e; if(data.user)onLogin(data.user)
      }
    } catch(e){
      if(e.message?.includes('Invalid login'))setEr('Email o contraseña incorrectos')
      else if(e.message?.includes('already registered'))setEr('Email ya registrado')
      else setEr(e.message||'Error')
    }
    setLd(false)
  }
  return <div style={{maxWidth:480,margin:'0 auto',minHeight:'100vh',background:'var(--white)'}}>
    <div style={{padding:'12px 20px 0'}}><BB onClick={onBack} label="Volver"/></div>
    <div style={{padding:'36px 28px 24px',textAlign:'center'}}>
      <div style={{width:62,height:62,borderRadius:20,background:'linear-gradient(135deg,var(--purple),var(--purple-l))',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 18px',boxShadow:'0 6px 22px rgba(124,58,237,0.38)'}}>
        <ClockSVG size={32}/>
      </div>
      <h1 style={{fontSize:24,fontWeight:900,marginBottom:4,letterSpacing:-1,color:'var(--text)'}}>Clocks School</h1>
      <p style={{fontSize:14,color:'var(--text3)'}}>Accede para reservar tu cita</p>
    </div>
    <div style={{display:'flex',margin:'0 28px',background:'var(--purple-bg)',borderRadius:12,padding:3,marginBottom:24}}>
      {[['login','Iniciar sesión'],['register','Crear cuenta']].map(([id,l])=>
        <button key={id} onClick={()=>{setM(id);setEr('')}} style={{flex:1,padding:'11px 0',fontFamily:'inherit',fontSize:14,fontWeight:600,background:m===id?'var(--white)':'transparent',color:m===id?'var(--purple)':'var(--text3)',border:'none',borderRadius:9,cursor:'pointer',boxShadow:m===id?'var(--shadow)':'none',transition:'all .2s'}}>{l}</button>
      )}
    </div>
    <div className="anim" style={{padding:'0 28px 40px'}}>
      {m==='register'&&<>
        <In label="Nombre completo" required value={nm} onChange={e=>setNm(e.target.value)} placeholder="Tu nombre"/>
        <In label="Teléfono" value={ph} onChange={e=>setPh(e.target.value)} placeholder="612 345 678"/>
      </>}
      <In label="Email" required type="email" value={em} onChange={e=>setEm(e.target.value)} placeholder="tu@email.com"/>
      <In label="Contraseña" required type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder={m==='register'?'Mínimo 6 caracteres':'••••••••'}/>
      {er&&<div style={{padding:'11px 14px',background:'var(--red-bg)',borderRadius:10,marginBottom:14,border:'1px solid rgba(239,68,68,0.12)'}}><p style={{fontSize:13,color:'var(--red)',fontWeight:500}}>{er}</p></div>}
      <Bt full onClick={sub} disabled={ld}>{ld?'Cargando...':m==='register'?'Crear cuenta':'Entrar'}</Bt>
      <p style={{fontSize:13,color:'var(--text3)',textAlign:'center',marginTop:18}}>
        {m==='login'?'¿No tienes cuenta? ':'¿Ya tienes cuenta? '}
        <button onClick={()=>{setM(m==='login'?'register':'login');setEr('')}} style={{fontFamily:'inherit',fontSize:13,color:'var(--purple)',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>
          {m==='login'?'Regístrate':'Inicia sesión'}
        </button>
      </p>
    </div>
  </div>
}

// ═══ BOOKING ══════════════════════════════════════════════════════════════════
function Booking({user,profile,svcs,stys,pre,onDone,onBack}) {
  const [step,setStep]=useState(pre?1:0)
  const [svc,setSvc]=useState(pre),[sty,setSty]=useState(null)
  const [date,setDate]=useState(null),[time,setTime]=useState(null)
  const [note,setNote]=useState('')
  const [cM,setCM]=useState(new Date().getMonth()),[cY,setCY]=useState(new Date().getFullYear())
  const [slots,setSlots]=useState([]),[sL,setSL]=useState(false),[bk,setBk]=useState(false)
  const [monthAvail,setMonthAvail]=useState({})
  const [schedules,setSchedules]=useState([])

  // Cargar horarios fijos una vez
  useEffect(()=>{
    supabase.from('stylist_schedules').select('*').then(({data})=>setSchedules(data||[]))
  },[])

  // Disponibilidad mensual (tiene en cuenta horario fijo)
  useEffect(()=>{
    if(!sty)return
    ;(async()=>{
      const startDate=`${cY}-${String(cM+1).padStart(2,'0')}-01`
      const endDate=`${cM===11?cY+1:cY}-${String(cM===11?1:cM+2).padStart(2,'0')}-01`
      const [{data:bd},{data:bl}]=await Promise.all([
        supabase.from('appointments').select('appointment_date,appointment_time,end_time,stylist_id').eq('stylist_id',sty.id).gte('appointment_date',startDate).lt('appointment_date',endDate).eq('status','confirmed'),
        supabase.from('blocked_slots').select('blocked_date,start_time,end_time,stylist_id').eq('stylist_id',sty.id).gte('blocked_date',startDate).lt('blocked_date',endDate),
      ])
      const avail={},daysInMonth=new Date(cY,cM+1,0).getDate()
      for(let i=1;i<=daysInMonth;i++){
        const d=new Date(cY,cM,i)
        if(d.getDay()===0){avail[toK(d)]='none';continue}
        const free=getSlotsForDay(d,sty.id,schedules,
          (bd||[]).map(a=>({...a,appointment_date:a.appointment_date,appointment_time:a.appointment_time,end_time:a.end_time,stylist_id:a.stylist_id})),
          (bl||[]).map(b=>({...b,blocked_date:b.blocked_date,start_time:b.start_time,end_time:b.end_time,stylist_id:b.stylist_id})),
          svc?.duration||30
        ).length
        avail[toK(d)]=free>10?'green':free>5?'yellow':free>0?'orange':'none'
      }
      setMonthAvail(avail)
    })()
  },[cM,cY,sty,schedules,svc])

  // Barbero favorito
  useEffect(()=>{
    if(profile?.favorite_stylist_id&&stys.length){const f=stys.find(s=>s.id===profile.favorite_stylist_id);if(f)setSty(f)}
  },[profile,stys])

  // Slots del día seleccionado
  useEffect(()=>{
    if(!date||!sty){setSlots([]);return}
    ;(async()=>{
      setSL(true);const dk=toK(date)
      const [{data:bd},{data:bl}]=await Promise.all([
        supabase.from('appointments').select('appointment_time,end_time,stylist_id,appointment_date').eq('stylist_id',sty.id).eq('appointment_date',dk).eq('status','confirmed'),
        supabase.from('blocked_slots').select('start_time,end_time,stylist_id,blocked_date').eq('stylist_id',sty.id).eq('blocked_date',dk),
      ])
      setSlots(getSlotsForDay(date,sty.id,schedules,
        (bd||[]).map(a=>({...a,blocked_date:dk})),
        (bl||[]).map(b=>({...b,appointment_date:dk})),
        svc?.duration||30
      ))
      setSL(false)
    })()
  },[date,sty,svc,schedules])

  const confirm=async()=>{
    if(!svc||!sty||!date||!time)return;setBk(true)
    const {error}=await supabase.from('appointments').insert({user_id:user.id,stylist_id:sty.id,service_id:svc.id,appointment_date:toK(date),appointment_time:time,end_time:aM(time,svc.duration),notes:note||null,status:'confirmed'})
    setBk(false);if(!error)onDone({service:svc,stylist:sty,date,time})
  }

  const pop=svcs.filter(s=>s.category==='popular'),oth=svcs.filter(s=>s.category!=='popular')
  const days=gMD(cY,cM)
  const can=[!!svc,!!sty,!!(date&&time)][step]
  const navMonth=dir=>{const nm=cM+dir;if(nm<0){setCM(11);setCY(cY-1)}else if(nm>11){setCM(0);setCY(cY+1)}else setCM(nm)}

  return <div style={{paddingBottom:110}}>
    <div style={{padding:'8px 20px 0'}}><BB onClick={step>0?()=>{setStep(step-1);if(step===2)setTime(null)}:onBack}/></div>
    <div style={{display:'flex',gap:6,padding:'0 20px 18px'}}>
      {['Servicio','Profesional','Fecha y hora'].map((l,i)=><div key={i} style={{flex:1}}>
        <div style={{height:3,borderRadius:2,background:i<=step?'linear-gradient(90deg,var(--purple),var(--purple-l))':'var(--border)',transition:'all .4s',marginBottom:6}}/>
        <span style={{fontSize:10,fontWeight:i<=step?700:400,color:i<=step?'var(--purple)':'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{l}</span>
      </div>)}
    </div>

    {step===0&&<div style={{padding:'0 16px'}}>
      {pop.length>0&&<><p style={{fontSize:12,fontWeight:700,color:'var(--text3)',letterSpacing:0.5,textTransform:'uppercase',marginBottom:12}}>Populares</p>{pop.map((s,i)=><SvcCard key={s.id} s={s} sel={svc?.id===s.id} onClick={()=>setSvc(s)} i={i}/>)}</>}
      {oth.length>0&&<><p style={{fontSize:12,fontWeight:700,color:'var(--text3)',letterSpacing:0.5,textTransform:'uppercase',margin:'8px 0 12px'}}>Otros servicios</p>{oth.map((s,i)=><SvcCard key={s.id} s={s} sel={svc?.id===s.id} onClick={()=>setSvc(s)} i={i}/>)}</>}
    </div>}

    {step===1&&<div style={{background:'var(--white)',padding:20}}>
      <h2 style={{fontSize:18,fontWeight:800,marginBottom:18,color:'var(--text)'}}>Elige profesional</h2>
      <div style={{display:'flex',gap:12,overflowX:'auto',paddingBottom:6}}>
        {stys.map(s=>{const sl=sty?.id===s.id;return<button key={s.id} onClick={()=>setSty(s)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,minWidth:80,background:'none',border:'none',cursor:'pointer',padding:'8px 4px',flexShrink:0}}>
          <div style={{width:64,height:64,borderRadius:32,background:'var(--purple-bg2)',border:sl?'3px solid var(--purple)':'2px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:700,color:'var(--purple)',overflow:'hidden',transition:'all .2s',boxShadow:sl?'0 4px 16px rgba(124,58,237,0.32)':'none'}}>
            {s.photo_url?<img src={s.photo_url} alt={s.name} style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>:s.name[0]}
          </div>
          <span style={{fontSize:12,fontWeight:sl?700:500,color:sl?'var(--purple)':'var(--text2)',textAlign:'center'}}>{s.name}</span>
          {sl&&<div style={{width:6,height:6,borderRadius:3,background:'var(--purple)'}}/>}
        </button>})}
      </div>
    </div>}

    {step===2&&<div style={{padding:'0 16px'}}>
      <div style={{background:'var(--white)',borderRadius:18,border:'1.5px solid var(--border)',padding:16,marginBottom:12,boxShadow:'var(--shadow)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <span style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{MO[cM]} {cY}</span>
          <div style={{display:'flex',gap:4}}>
            {[[-1,'M15 18l-6-6 6-6'],[1,'M9 18l6-6-6-6']].map(([d,path])=><button key={d} onClick={()=>navMonth(d)} style={{width:28,height:28,borderRadius:8,border:'1.5px solid var(--border)',background:'var(--white)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2"><path d={path}/></svg>
            </button>)}
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4}}>
          {dayL.map(d=><div key={d} style={{textAlign:'center',fontSize:9,fontWeight:700,color:'var(--text3)',padding:'3px 0',letterSpacing:0.5}}>{d}</div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
          {days.map((d,i)=>{
            if(!d)return<div key={'e'+i}/>
            const dk=toK(d),sl=date&&toK(date)===dk,past=isP(d),sun=d.getDay()===0
            const av=monthAvail[dk]
            const avC=av==='green'?'var(--green)':av==='yellow'?'var(--yellow)':av==='orange'?'var(--orange)':null
            return<button key={dk} onClick={()=>!past&&!sun&&setDate(d)} disabled={past||sun} style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,height:46,borderRadius:10,border:'none',cursor:past||sun?'default':'pointer',background:sl?'linear-gradient(135deg,var(--purple),var(--purple-l))':isT(d)?'var(--purple-bg)':'transparent',opacity:past||sun?0.22:1,transition:'all .15s'}}>
              <span style={{fontSize:12,fontWeight:sl||isT(d)?700:400,color:sl?'#fff':'var(--text)',lineHeight:1}}>{d.getDate()}</span>
              {avC&&!past&&!sun&&<div style={{width:18,height:3,borderRadius:2,background:sl?'rgba(255,255,255,0.65)':avC}}/>}
            </button>
          })}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12,marginTop:12,paddingTop:10,borderTop:'1px solid var(--border)'}}>
          <span style={{fontSize:11,color:'var(--text3)',fontWeight:500}}>Disponibilidad:</span>
          {[['var(--green)','+10'],['var(--yellow)','6–10'],['var(--orange)','1–5']].map(([c,l])=><div key={l} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:14,height:3,borderRadius:2,background:c}}/><span style={{fontSize:11,color:'var(--text3)'}}>{l}</span>
          </div>)}
        </div>
      </div>

      {date&&<div style={{background:'var(--white)',borderRadius:18,border:'1.5px solid var(--border)',padding:16,marginBottom:12,boxShadow:'var(--shadow)'}}>
        <p style={{fontSize:13,fontWeight:700,color:'var(--text)',marginBottom:12}}>{fDF(date)}</p>
        {sL?<Sp/>:slots.length===0?<Em icon="😔" text="Sin horarios disponibles este día"/>:
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
            {slots.map(s=><button key={s} onClick={()=>setTime(s)} style={{padding:'10px 6px',borderRadius:12,border:time===s?'none':'1.5px solid var(--border)',background:time===s?'linear-gradient(135deg,var(--purple),var(--purple-l))':'var(--white)',color:time===s?'#fff':'var(--text)',fontSize:13,fontWeight:time===s?700:500,cursor:'pointer',fontFamily:'inherit',boxShadow:time===s?'0 4px 12px rgba(124,58,237,0.30)':'none',transition:'all .15s'}}>{s}</button>)}
          </div>}
      </div>}

      {date&&time&&<div style={{background:'var(--white)',borderRadius:18,border:'1.5px solid var(--border)',padding:16,boxShadow:'var(--shadow)'}}>
        <label style={{fontSize:13,fontWeight:600,marginBottom:8,display:'block',color:'var(--text)'}}>Nota (opcional)</label>
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Ej: foto de referencia, alergias..." rows={3} style={{width:'100%',padding:'10px 12px',fontSize:13,border:'1px solid var(--border2)',borderRadius:10,background:'var(--bg)',color:'var(--text)',fontFamily:'inherit'}}/>
      </div>}
    </div>}

    <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'rgba(255,255,255,0.94)',backdropFilter:'blur(14px)',borderTop:'1px solid var(--border)',padding:'12px 20px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',zIndex:50}}>
      {svc?<div><p style={{fontSize:12,color:'var(--text3)'}}>1 servicio · {svc.duration}min</p><p style={{fontSize:20,fontWeight:900,color:'var(--purple)'}}>{Number(svc.price).toFixed(0)}€</p></div>:<div/>}
      <Bt onClick={step===2?confirm:()=>setStep(step+1)} disabled={!can||bk}>{bk?'Reservando...':step===2?'Confirmar reserva':'Continuar'}</Bt>
    </div>
  </div>
}

// ═══ ACCOUNT ══════════════════════════════════════════════════════════════════
function Account({user,profile,stys,onBook,onLogout,onBack,onUp}) {
  const [tab,setTab]=useState('upcoming'),[up,setUp]=useState([]),[hist,setHist]=useState([]),[ld,setLd]=useState(true)
  const load=useCallback(async()=>{
    const td=toK(new Date())
    const [{data:u},{data:h}]=await Promise.all([
      supabase.from('appointments').select('*,stylists(name),services(name,price,duration)').eq('user_id',user.id).gte('appointment_date',td).eq('status','confirmed').order('appointment_date'),
      supabase.from('appointments').select('*,stylists(name),services(name,price,duration)').eq('user_id',user.id).or(`appointment_date.lt.${td},status.eq.completed,status.eq.cancelled`).order('appointment_date',{ascending:false}).limit(20),
    ])
    setUp(u||[]);setHist(h||[]);setLd(false)
  },[user.id])
  useEffect(()=>{load()},[load])
  const cancel=async id=>{await supabase.from('appointments').update({status:'cancelled',cancelled_by:'client'}).eq('id',id);load()}
  const setFav=async sid=>{const v=profile?.favorite_stylist_id===sid?null:sid;await supabase.from('profiles').update({favorite_stylist_id:v}).eq('id',user.id);onUp({...profile,favorite_stylist_id:v})}
  const togR=async()=>{const v=!profile?.email_reminders;await supabase.from('profiles').update({email_reminders:v}).eq('id',user.id);onUp({...profile,email_reminders:v})}
  const ini=(profile?.full_name||'?').split(' ').map(n=>n[0]).join('').toUpperCase()
  if(ld)return<Sp/>
  return <div>
    <div style={{padding:'8px 20px 0'}}><BB onClick={onBack} label="Volver"/></div>
    <div style={{padding:'8px 20px 20px',background:'var(--white)',borderBottom:'1px solid var(--border)'}}>
      <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:16}}>
        <div style={{width:52,height:52,borderRadius:16,background:'linear-gradient(135deg,var(--purple),var(--purple-l))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:800,color:'#fff',boxShadow:'0 4px 14px rgba(124,58,237,0.32)'}}>{ini}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:17,fontWeight:700,color:'var(--text)'}}>{profile?.full_name}</div>
          <div style={{fontSize:13,color:'var(--text3)'}}>{user.email}</div>
        </div>
        <button onClick={onLogout} style={{fontSize:12,color:'var(--text3)',background:'none',border:'1px solid var(--border)',borderRadius:10,padding:'7px 12px',cursor:'pointer',fontFamily:'inherit',fontWeight:500}}>Salir</button>
      </div>
      <Bt full onClick={onBook}>+ Nueva reserva</Bt>
    </div>
    <div style={{display:'flex',background:'var(--white)',borderBottom:'1px solid var(--border)',padding:'0 20px'}}>
      {[['upcoming','Próximas',up.length],['history','Historial',hist.length],['settings','Ajustes',null]].map(([id,l,c])=>
        <button key={id} onClick={()=>setTab(id)} style={{padding:'13px 12px',fontFamily:'inherit',fontSize:13,fontWeight:500,background:'none',border:'none',cursor:'pointer',color:tab===id?'var(--purple)':'var(--text3)',borderBottom:tab===id?'2px solid var(--purple)':'2px solid transparent',display:'flex',alignItems:'center',gap:5}}>
          {l}{c!==null&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:tab===id?'var(--purple)':'var(--text3)',padding:'1px 6px',borderRadius:10}}>{c}</span>}
        </button>
      )}
    </div>
    <div style={{padding:20}}>
      {tab==='upcoming'&&(up.length===0?<Em icon="📅" text="No tienes citas programadas"/>:
        <div style={{display:'flex',flexDirection:'column',gap:10}}>{up.map(a=>
          <div key={a.id} className="anim" style={{padding:16,background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:16,boxShadow:'var(--shadow)'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{a.services?.name}</div>
                <div style={{fontSize:13,color:'var(--text3)',marginTop:2}}>con {a.stylists?.name}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--text)'}}>{fS(parseDate(a.appointment_date))}</div>
                <div style={{fontSize:14,color:'var(--purple)',fontWeight:700}}>{a.appointment_time?.slice(0,5)}h</div>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end'}}><Bt small variant="danger" onClick={()=>cancel(a.id)}>Cancelar cita</Bt></div>
          </div>
        )}</div>
      )}
      {tab==='history'&&(hist.length===0?<Em icon="📋" text="Sin visitas anteriores"/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>{hist.map(a=>
          <div key={a.id} style={{display:'flex',alignItems:'center',gap:12,padding:14,background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:14,opacity:a.status==='cancelled'?0.5:1,boxShadow:'var(--shadow)'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:600,color:'var(--text)'}}>{a.services?.name}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{a.stylists?.name} · {fS(parseDate(a.appointment_date))}</div>
            </div>
            <div style={{fontSize:14,fontWeight:700,color:a.status==='cancelled'?'var(--red)':'var(--purple)'}}>
              {a.status==='cancelled'?'Cancelada':`${Number(a.services?.price).toFixed(0)} €`}
            </div>
          </div>
        )}</div>
      )}
      {tab==='settings'&&<div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{background:'var(--white)',borderRadius:16,border:'1.5px solid var(--border)',overflow:'hidden',boxShadow:'var(--shadow)'}}>
          <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border)'}}><span style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Profesional favorito</span></div>
          <div style={{padding:'6px 16px'}}>{stys.map(s=>{const f=profile?.favorite_stylist_id===s.id;return<button key={s.id} onClick={()=>setFav(s.id)} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 0',background:'none',border:'none',cursor:'pointer',borderBottom:'1px solid var(--border)'}}>
            <div style={{width:32,height:32,borderRadius:16,background:'var(--purple-bg)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'var(--purple)'}}>{s.name[0]}</div>
            <div style={{flex:1,textAlign:'left'}}><div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{s.name}</div></div>
            <div style={{width:20,height:20,borderRadius:10,border:f?'none':'2px solid var(--border2)',background:f?'var(--purple)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',transition:'all .2s'}}>
              {f&&<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
            </div>
          </button>})}</div>
        </div>
        <div style={{background:'var(--white)',borderRadius:16,border:'1.5px solid var(--border)',padding:16,display:'flex',alignItems:'center',justifyContent:'space-between',boxShadow:'var(--shadow)'}}>
          <div><span style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Recordatorios email</span><p style={{fontSize:12,color:'var(--text3)',marginTop:2}}>24h antes de cada cita</p></div>
          <button onClick={togR} style={{width:44,height:24,borderRadius:12,position:'relative',cursor:'pointer',border:'none',background:profile?.email_reminders?'var(--purple)':'var(--border)',transition:'all .3s'}}>
            <div style={{width:20,height:20,borderRadius:10,background:'#fff',position:'absolute',top:2,left:profile?.email_reminders?22:2,transition:'all .3s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
          </button>
        </div>
        <div style={{background:'var(--white)',borderRadius:16,border:'1.5px solid var(--border)',padding:16,boxShadow:'var(--shadow)'}}>
          <span style={{fontSize:14,fontWeight:700,marginBottom:10,display:'block',color:'var(--text)'}}>Datos personales</span>
          {[['Nombre',profile?.full_name],['Email',user.email],['Teléfono',profile?.phone||'—']].map(([k,v])=>
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)',fontSize:14}}>
              <span style={{color:'var(--text3)'}}>{k}</span><span style={{fontWeight:500,color:'var(--text)'}}>{v}</span>
            </div>
          )}
        </div>
      </div>}
    </div>
  </div>
}

// ═══ MODAL HORARIO SEMANAL FIJO ════════════════════════════════════════════════
// Admin → Equipo → botón "Horario" de cada barbero
// Permite definir por día de semana: activo/inactivo + hora inicio/fin
function WeeklyScheduleModal({stylist, onClose, onSaved}) {
  const DAYS = [1,2,3,4,5,6] // Lun-Sáb
  const DEFAULT_CLOSE = {1:'20:00',2:'20:00',3:'20:00',4:'20:00',5:'20:00',6:'14:00'}

  const [rows, setRows] = useState(DAYS.map(d=>({
    day_of_week: d,
    active: d!==0,
    start_time: '09:00',
    end_time: DEFAULT_CLOSE[d]
  })))
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(()=>{
    supabase.from('stylist_schedules').select('*').eq('stylist_id', stylist.id).then(({data})=>{
      if(data && data.length > 0){
        setRows(DAYS.map(d=>{
          const existing = data.find(r=>r.day_of_week===d)
          return existing
            ? {day_of_week:d, active:existing.active, start_time:existing.start_time.slice(0,5), end_time:existing.end_time.slice(0,5)}
            : {day_of_week:d, active:d!==0, start_time:'09:00', end_time:DEFAULT_CLOSE[d]}
        }))
      }
      setLoaded(true)
    })
  },[stylist.id])

  const update = (dow, field, val) => setRows(r=>r.map(x=>x.day_of_week===dow?{...x,[field]:val}:x))

  const save = async () => {
    setSaving(true)
    // Upsert todos los días
    for(const row of rows){
      await supabase.from('stylist_schedules').upsert({
        stylist_id: stylist.id,
        day_of_week: row.day_of_week,
        active: row.active,
        start_time: row.start_time,
        end_time: row.end_time
      }, {onConflict: 'stylist_id,day_of_week'})
    }
    setSaving(false)
    onSaved()
  }

  const allSlots = gS('06:00','23:30')
  const endSlots = h => gS('06:30','24:00').filter(s=>s>h)

  if(!loaded) return <Modal><Sp/></Modal>

  return <Modal>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
      <div style={{width:36,height:36,borderRadius:10,background:'var(--purple-bg)',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',flexShrink:0}}>
        {stylist.photo_url?<img src={stylist.photo_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:16,fontWeight:700,color:'var(--purple)'}}>{stylist.name[0]}</span>}
      </div>
      <div>
        <div style={{fontSize:16,fontWeight:800,color:'var(--text)'}}>{stylist.name}</div>
        <div style={{fontSize:12,color:'var(--text3)'}}>Horario semanal fijo</div>
      </div>
    </div>

    <div style={{background:'var(--purple-bg)',borderRadius:10,padding:'10px 12px',margin:'14px 0',fontSize:12,color:'var(--purple)',lineHeight:1.5}}>
      💡 Este horario se aplica automáticamente cada semana. Los clientes solo verán huecos dentro del turno configurado.
    </div>

    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {rows.map(row=>{
        const dName = dayLong[row.day_of_week-1]
        return <div key={row.day_of_week} style={{borderRadius:12,border:`1.5px solid ${row.active?'var(--border2)':'var(--border)'}`,overflow:'hidden',transition:'all .2s',opacity:row.active?1:0.6}}>
          {/* Cabecera día */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:row.active?'var(--white)':'var(--bg)'}}>
            <span style={{fontSize:14,fontWeight:700,color:row.active?'var(--text)':'var(--text3)'}}>{dName}</span>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:12,color:row.active?'var(--green)':'var(--text3)',fontWeight:600}}>{row.active?'Trabaja':'Libre'}</span>
              <button onClick={()=>update(row.day_of_week,'active',!row.active)} style={{width:40,height:22,borderRadius:11,position:'relative',cursor:'pointer',border:'none',background:row.active?'var(--green)':'var(--border)',transition:'all .3s'}}>
                <div style={{width:18,height:18,borderRadius:9,background:'#fff',position:'absolute',top:2,left:row.active?20:2,transition:'all .3s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
              </button>
            </div>
          </div>
          {/* Selectores hora */}
          {row.active&&<div style={{display:'flex',gap:8,padding:'8px 14px 12px',background:'var(--white)',borderTop:'1px solid var(--border)'}}>
            <div style={{flex:1}}>
              <label style={{fontSize:11,fontWeight:600,color:'var(--text3)',display:'block',marginBottom:4}}>ENTRADA</label>
              <select value={row.start_time} onChange={e=>{update(row.day_of_week,'start_time',e.target.value);if(e.target.value>=row.end_time)update(row.day_of_week,'end_time',aM(e.target.value,30))}} style={{width:'100%',padding:'8px 10px',fontSize:13,border:'1px solid var(--border2)',borderRadius:8,background:'var(--bg)',color:'var(--text)',fontFamily:'inherit',cursor:'pointer',paddingRight:28}}>
                {allSlots.map(h=><option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div style={{flex:1}}>
              <label style={{fontSize:11,fontWeight:600,color:'var(--text3)',display:'block',marginBottom:4}}>SALIDA</label>
              <select value={row.end_time} onChange={e=>update(row.day_of_week,'end_time',e.target.value)} style={{width:'100%',padding:'8px 10px',fontSize:13,border:'1px solid var(--border2)',borderRadius:8,background:'var(--bg)',color:'var(--text)',fontFamily:'inherit',cursor:'pointer',paddingRight:28}}>
                {endSlots(row.start_time).map(h=><option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div style={{display:'flex',alignItems:'flex-end',paddingBottom:2}}>
              <div style={{padding:'8px 10px',background:'var(--purple-bg)',borderRadius:8,fontSize:12,fontWeight:700,color:'var(--purple)',whiteSpace:'nowrap'}}>
                {row.start_time}–{row.end_time}
              </div>
            </div>
          </div>}
        </div>
      })}
    </div>

    <div style={{display:'flex',gap:10,marginTop:18}}>
      <Bt variant="secondary" onClick={onClose} style={{flex:1}}>Cancelar</Bt>
      <Bt onClick={save} disabled={saving} style={{flex:1}}>{saving?'Guardando...':'Guardar horario'}</Bt>
    </div>
  </Modal>
}

// ═══ MODAL CONFIG SALÓN ═══════════════════════════════════════════════════════
function SalonConfigModal({config,onSave,onClose}) {
  const [addr,setAddr]=useState(config?.address||'')
  const [phone,setPhone]=useState(config?.phone||'')
  const [insta,setInsta]=useState(config?.instagram||'')
  const [saving,setSaving]=useState(false)
  const save=async()=>{
    setSaving(true)
    if(config?.id){await supabase.from('salon_config').update({address:addr,phone,instagram:insta}).eq('id',config.id)}
    else{await supabase.from('salon_config').insert({address:addr,phone,instagram:insta})}
    setSaving(false);onSave()
  }
  return <Modal>
    <h3 style={{fontSize:18,fontWeight:800,marginBottom:18,color:'var(--text)'}}>Datos del salón</h3>
    <div style={{marginBottom:14}}>
      <label style={{fontSize:13,fontWeight:600,marginBottom:6,display:'block',color:'var(--text)'}}>Dirección</label>
      <textarea value={addr} onChange={e=>setAddr(e.target.value)} rows={2} placeholder="Calle Portal, 33&#10;50740, Fuentes de Ebro, Zaragoza" style={{width:'100%',padding:'12px 14px',fontSize:14,border:'1px solid var(--border2)',borderRadius:12,background:'var(--white)',color:'var(--text)',fontFamily:'inherit'}}/>
    </div>
    <In label="Teléfono" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+34 976 XXX XXX"/>
    <In label="Instagram" value={insta} onChange={e=>setInsta(e.target.value)} placeholder="@clocksschool"/>
    <div style={{display:'flex',gap:10,marginTop:8}}>
      <Bt variant="secondary" onClick={onClose} style={{flex:1}}>Cancelar</Bt>
      <Bt onClick={save} disabled={saving} style={{flex:1}}>{saving?'Guardando...':'Guardar'}</Bt>
    </div>
  </Modal>
}

// ═══ MODALES CRUD ═════════════════════════════════════════════════════════════
function SvcModal({data,onSave,onClose}) {
  const [name,setName]=useState(data.name||''),[desc,setDesc]=useState(data.description||'')
  const [dur,setDur]=useState(data.duration||30),[price,setPrice]=useState(data.price||0)
  const [cat,setCat]=useState(data.category||'popular')
  return <Modal>
    <h3 style={{fontSize:18,fontWeight:800,marginBottom:18,color:'var(--text)'}}>{data.id?'Editar servicio':'Nuevo servicio'}</h3>
    <In label="Nombre" required value={name} onChange={e=>setName(e.target.value)} placeholder="Ej: CORTE CLOCKS"/>
    <In label="Descripción" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Descripción corta"/>
    <div style={{display:'flex',gap:10}}>
      <div style={{flex:1}}><In label="Duración (min)" type="number" value={dur} onChange={e=>setDur(parseInt(e.target.value)||0)}/></div>
      <div style={{flex:1}}><In label="Precio (€)" type="number" step="0.01" value={price} onChange={e=>setPrice(parseFloat(e.target.value)||0)}/></div>
    </div>
    <Sl label="Categoría" value={cat} onChange={e=>setCat(e.target.value)}>
      <option value="popular">⭐ Popular</option>
      <option value="other">Otro</option>
    </Sl>
    <div style={{display:'flex',gap:10,marginTop:8}}>
      <Bt variant="secondary" onClick={onClose} style={{flex:1}}>Cancelar</Bt>
      <Bt onClick={()=>onSave({...data,name,description:desc,duration:dur,price,category:cat})} disabled={!name.trim()} style={{flex:1}}>Guardar</Bt>
    </div>
  </Modal>
}

function StyModal({data,onSave,onClose}) {
  const [name,setName]=useState(data.name||''),[username,setUsername]=useState(data.username||'')
  const [role,setRole]=useState(data.role_title||'Barbero'),[photo,setPhoto]=useState(data.photo_url||'')
  const [active,setActive]=useState(data.active!==false)
  return <Modal>
    <h3 style={{fontSize:18,fontWeight:800,marginBottom:18,color:'var(--text)'}}>{data.id?'Editar profesional':'Nuevo profesional'}</h3>
    <In label="Nombre" required value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre"/>
    <In label="Username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="@usuario"/>
    <In label="Rol" value={role} onChange={e=>setRole(e.target.value)} placeholder="Ej: Barbero"/>
    <In label="URL foto" value={photo} onChange={e=>setPhoto(e.target.value)} placeholder="/images/team-nombre.jpg"/>
    {photo&&<div style={{marginBottom:14,borderRadius:12,overflow:'hidden',height:80,width:80,background:'var(--bg)',border:'1px solid var(--border)'}}><img src={photo} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/></div>}
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
      <span style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>Activo</span>
      <button onClick={()=>setActive(!active)} style={{width:44,height:24,borderRadius:12,position:'relative',cursor:'pointer',border:'none',background:active?'var(--purple)':'var(--border)',transition:'all .3s',boxShadow:active?'0 2px 8px rgba(124,58,237,0.35)':'none'}}>
        <div style={{width:20,height:20,borderRadius:10,background:'#fff',position:'absolute',top:2,left:active?22:2,transition:'all .3s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
      </button>
    </div>
    <div style={{display:'flex',gap:10,marginTop:8}}>
      <Bt variant="secondary" onClick={onClose} style={{flex:1}}>Cancelar</Bt>
      <Bt onClick={()=>onSave({...data,name,username,role_title:role,photo_url:photo,active})} disabled={!name.trim()} style={{flex:1}}>Guardar</Bt>
    </div>
  </Modal>
}

// ═══ ADMIN ════════════════════════════════════════════════════════════════════
function Admin({user,onBack,onDataChanged,salonConfig,onSalonConfigChanged}) {
  const LS_KEY='clocks-admin-stylist'
  const [myStylistId,setMyStylistId]=useState(()=>{
    try{const v=localStorage.getItem(LS_KEY);return v?Number(v):null}catch{return null}
  })
  const [tab,setTab]=useState('cal'),[sd,setSd]=useState(new Date())
  const [ap,setAp]=useState([]),[profiles,setProfiles]=useState({}),[bl,setBl]=useState([])
  const [st,setSt]=useState([]),[sv,setSv]=useState([]),[ld,setLd]=useState(true)
  const [cM,setCM]=useState(new Date().getMonth()),[cY,setCY]=useState(new Date().getFullYear())
  const [showBlock,setShowBlock]=useState(false),[bS,setBS]=useState(null)
  const [bD,setBD]=useState(toK(new Date())),[bSt,setBSt]=useState('09:00'),[bE,setBE]=useState('10:00'),[bR,setBR]=useState('')
  const [editSvc,setEditSvc]=useState(null),[editSty,setEditSty]=useState(null)
  const [delConfirm,setDelConfirm]=useState(null),[cancelConfirm,setCancelConfirm]=useState(null)
  const [showSalonConfig,setShowSalonConfig]=useState(false)
  const [showStylistPicker,setShowStylistPicker]=useState(false)
  const [scheduleFor,setScheduleFor]=useState(null) // barbero cuyo horario estamos editando

  const selectMyStylist=id=>{
    setMyStylistId(id)
    try{if(id)localStorage.setItem(LS_KEY,String(id));else localStorage.removeItem(LS_KEY)}catch{}
    setShowStylistPicker(false)
  }

  const filteredAp = myStylistId ? ap.filter(a=>a.stylist_id===myStylistId) : ap
  const filteredBl = myStylistId ? bl.filter(b=>b.stylist_id===myStylistId) : bl
  const myStylist = st.find(s=>s.id===myStylistId)

  const loadDay=useCallback(async d=>{
    const dk=toK(d)
    const [{data:a},{data:b},{data:s},{data:v}]=await Promise.all([
      supabase.from('appointments').select('*,stylists(name),services(name,price,duration)').eq('appointment_date',dk).order('appointment_time'),
      supabase.from('blocked_slots').select('*,stylists(name)').eq('blocked_date',dk).order('start_time'),
      supabase.from('stylists').select('*').order('display_order'),
      supabase.from('services').select('*').order('display_order'),
    ])
    setAp(a||[]);setBl(b||[]);setSt(s||[]);setSv(v||[])
    if(!bS&&s?.length)setBS(s[0].id)
    const userIds=[...new Set((a||[]).map(x=>x.user_id).filter(Boolean))]
    if(userIds.length>0){
      const {data:profs}=await supabase.from('profiles').select('id,full_name,phone').in('id',userIds)
      const map={};(profs||[]).forEach(p=>{map[p.id]=p});setProfiles(map)
    } else setProfiles({})
    setLd(false)
  },[bS])

  useEffect(()=>{loadDay(sd)},[sd])

  const reloadLists=async()=>{
    const [{data:s},{data:v}]=await Promise.all([supabase.from('stylists').select('*').order('display_order'),supabase.from('services').select('*').order('display_order')])
    setSt(s||[]);setSv(v||[]);if(onDataChanged)onDataChanged()
  }

  const doCancelAppt=async id=>{await supabase.from('appointments').update({status:'cancelled',cancelled_by:'admin'}).eq('id',id);setCancelConfirm(null);loadDay(sd)}
  const addBlock=async()=>{
    await supabase.from('blocked_slots').insert({stylist_id:bS,blocked_date:bD,start_time:bSt,end_time:bE,reason:bR||'Bloqueado',created_by:user.id})
    setShowBlock(false);setBR('');loadDay(sd)
  }
  const rmBlock=async id=>{await supabase.from('blocked_slots').delete().eq('id',id);loadDay(sd)}
  const saveSvc=async data=>{
    if(data.id){await supabase.from('services').update({name:data.name,description:data.description,duration:data.duration,price:data.price,category:data.category}).eq('id',data.id)}
    else{const mx=sv.reduce((m,s)=>Math.max(m,s.display_order||0),0);await supabase.from('services').insert({...data,display_order:mx+1,active:true})}
    setEditSvc(null);reloadLists()
  }
  const delSvc=async id=>{await supabase.from('services').delete().eq('id',id);setDelConfirm(null);reloadLists()}
  const saveSty=async data=>{
    if(data.id){await supabase.from('stylists').update({name:data.name,username:data.username,role_title:data.role_title,photo_url:data.photo_url,active:data.active}).eq('id',data.id)}
    else{const mx=st.reduce((m,s)=>Math.max(m,s.display_order||0),0);await supabase.from('stylists').insert({...data,display_order:mx+1,active:true})}
    setEditSty(null);reloadLists()
  }
  const delSty=async id=>{await supabase.from('stylists').delete().eq('id',id);setDelConfirm(null);reloadLists()}

  const stMap={confirmed:{l:'Confirmada',c:'var(--green)',bg:'var(--green-bg)'},cancelled:{l:'Cancelada',c:'var(--red)',bg:'var(--red-bg)'},completed:{l:'Completada',c:'var(--text3)',bg:'var(--bg)'},no_show:{l:'No vino',c:'var(--orange)',bg:'var(--orange-bg)'}}
  const days=gMD(cY,cM)
  const cf=filteredAp.filter(a=>a.status==='confirmed').length

  if(ld)return<Sp/>

  return <div style={{minHeight:'100vh'}}>

    {/* Header */}
    <div style={{padding:'14px 16px',background:'var(--white)',borderBottom:'1px solid var(--border)'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:36,height:36,borderRadius:10,background:'linear-gradient(135deg,var(--purple),var(--purple-l))',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 3px 10px rgba(124,58,237,0.35)'}}>
            <ClockSVG size={20}/>
          </div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:'var(--text)'}}>Panel Admin</div>
            <div style={{fontSize:10,color:'var(--text3)',letterSpacing:0.3}}>Clocks School</div>
          </div>
        </div>
        <Bt small variant="secondary" onClick={onBack}>← Salir</Bt>
      </div>

      {/* Selector barbero propio */}
      <button onClick={()=>setShowStylistPicker(true)} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:myStylist?'linear-gradient(135deg,var(--purple),var(--purple-l))':'var(--bg)',border:myStylist?'none':'1.5px dashed var(--border2)',borderRadius:12,cursor:'pointer',transition:'all .2s',boxShadow:myStylist?'0 4px 14px rgba(124,58,237,0.28)':'none'}}>
        {myStylist?<>
          <div style={{width:30,height:30,borderRadius:15,background:'rgba(255,255,255,0.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:'#fff',overflow:'hidden',flexShrink:0}}>
            {myStylist.photo_url?<img src={myStylist.photo_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:myStylist.name[0]}
          </div>
          <div style={{flex:1,textAlign:'left'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#fff'}}>Viendo como: {myStylist.name}</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.7)'}}>Solo tus citas · Toca para cambiar</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </>:<>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span style={{fontSize:13,color:'var(--text3)',fontWeight:500}}>¿Quién eres? Selecciona tu perfil</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </>}
      </button>
    </div>

    {/* Picker barbero */}
    {showStylistPicker&&<Modal>
      <h3 style={{fontSize:18,fontWeight:800,marginBottom:6,color:'var(--text)'}}>¿Quién eres?</h3>
      <p style={{fontSize:13,color:'var(--text3)',marginBottom:18}}>Filtra el calendario con tus citas únicamente</p>
      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
        {st.filter(s=>s.active).map(s=>{
          const sel=myStylistId===s.id
          return<button key={s.id} onClick={()=>selectMyStylist(s.id)} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:12,background:sel?'linear-gradient(135deg,var(--purple),var(--purple-l))':'var(--bg)',border:sel?'none':'1.5px solid var(--border)',cursor:'pointer',transition:'all .2s',boxShadow:sel?'0 4px 14px rgba(124,58,237,0.28)':'none'}}>
            <div style={{width:38,height:38,borderRadius:19,background:sel?'rgba(255,255,255,0.22)':'var(--purple-bg)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:700,color:sel?'#fff':'var(--purple)',overflow:'hidden',flexShrink:0}}>
              {s.photo_url?<img src={s.photo_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:s.name[0]}
            </div>
            <div style={{flex:1,textAlign:'left'}}>
              <div style={{fontSize:15,fontWeight:700,color:sel?'#fff':'var(--text)'}}>{s.name}</div>
              <div style={{fontSize:12,color:sel?'rgba(255,255,255,0.7)':'var(--text3)'}}>{s.role_title}</div>
            </div>
            {sel&&<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>}
          </button>
        })}
      </div>
      <div style={{display:'flex',gap:10}}>
        {myStylistId&&<Bt variant="secondary" onClick={()=>selectMyStylist(null)} style={{flex:1}}>Ver todo</Bt>}
        <Bt variant="secondary" onClick={()=>setShowStylistPicker(false)} style={{flex:1}}>Cerrar</Bt>
      </div>
    </Modal>}

    {/* Tabs */}
    <div style={{display:'flex',background:'var(--white)',borderBottom:'1px solid var(--border)',padding:'0 16px',overflowX:'auto'}}>
      {[['cal','📅 Calendario'],['team','👤 Equipo'],['svc','✂️ Servicios'],['config','⚙️ Config']].map(([id,l])=>
        <button key={id} onClick={()=>setTab(id)} style={{padding:'13px 12px',fontFamily:'inherit',fontSize:12,fontWeight:600,background:'none',border:'none',cursor:'pointer',color:tab===id?'var(--purple)':'var(--text3)',borderBottom:tab===id?'2.5px solid var(--purple)':'2.5px solid transparent',whiteSpace:'nowrap'}}>{l}</button>
      )}
    </div>

    <div style={{padding:16}}>

      {/* ── CALENDARIO ── */}
      {tab==='cal'&&<div>
        <div style={{background:'var(--white)',borderRadius:16,border:'1.5px solid var(--border)',padding:14,marginBottom:16,boxShadow:'var(--shadow)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <h3 style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>{MO[cM]} {cY}</h3>
            <div style={{display:'flex',gap:4}}>
              {[[-1,'M15 18l-6-6 6-6'],[1,'M9 18l6-6-6-6']].map(([d,path])=><button key={d} onClick={()=>{const nm=cM+d;if(nm<0){setCM(11);setCY(cY-1)}else if(nm>11){setCM(0);setCY(cY+1)}else setCM(nm)}} style={{width:28,height:28,borderRadius:6,border:'1px solid var(--border)',background:'var(--white)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2"><path d={path}/></svg>
              </button>)}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
            {dayL.map(d=><div key={d} style={{textAlign:'center',fontSize:9,fontWeight:600,color:'var(--text3)',padding:'3px 0'}}>{d}</div>)}
            {days.map((d,i)=>{
              if(!d)return<div key={'e'+i}/>
              const sl=toK(sd)===toK(d)
              return<button key={toK(d)} onClick={()=>setSd(d)} style={{height:30,borderRadius:15,background:sl?'linear-gradient(135deg,var(--purple),var(--purple-l))':'transparent',border:'none',cursor:'pointer',fontSize:11,fontWeight:sl||isT(d)?700:400,color:sl?'#fff':isT(d)?'var(--purple)':'var(--text)',boxShadow:sl?'0 2px 8px rgba(124,58,237,0.3)':'none'}}>{d.getDate()}</button>
            })}
          </div>
        </div>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div>
            <h3 style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>{fDF(sd)}</h3>
            <p style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{myStylist?`${cf} cita${cf!==1?'s':''} · ${myStylist.name}`:`${cf} cita${cf!==1?'s':''} confirmada${cf!==1?'s':''}`}</p>
          </div>
          <Bt small variant="secondary" onClick={()=>{setBD(toK(sd));setShowBlock(true)}}>🚫 Bloquear</Bt>
        </div>

        {filteredBl.map(b=><div key={b.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:'var(--red-bg)',border:'1px solid rgba(239,68,68,0.12)',borderRadius:12,marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:700,color:'var(--red)',minWidth:44}}>{b.start_time?.slice(0,5)}</span>
          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:'var(--red)'}}>{b.reason}</div><div style={{fontSize:11,color:'var(--text3)'}}>{b.stylists?.name}</div></div>
          <button onClick={()=>rmBlock(b.id)} style={{fontSize:11,color:'var(--red)',background:'none',border:'1px solid rgba(239,68,68,0.2)',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>Quitar</button>
        </div>)}

        {filteredAp.length===0&&filteredBl.length===0&&<Em icon="📅" text="Sin citas este día"/>}

        {filteredAp.sort((a,b)=>a.appointment_time.localeCompare(b.appointment_time)).map(a=>{
          const s=stMap[a.status]||stMap.confirmed;const prof=profiles[a.user_id]
          return<div key={a.id} style={{display:'flex',alignItems:'center',gap:10,padding:14,background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:14,marginBottom:8,opacity:a.status==='cancelled'?0.4:1,boxShadow:'var(--shadow)'}}>
            <span style={{fontSize:13,fontWeight:700,color:'var(--purple)',minWidth:44}}>{a.appointment_time?.slice(0,5)}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:600,color:'var(--text)'}}>{prof?.full_name||'—'}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:1}}>{a.services?.name} · {a.stylists?.name}</div>
              {prof?.phone&&<div style={{fontSize:11,color:'var(--text3)'}}>📞 {prof.phone}</div>}
            </div>
            <Bg color={s.c} bg={s.bg}>{s.l}</Bg>
            {a.status==='confirmed'&&<button onClick={()=>setCancelConfirm({id:a.id,name:prof?.full_name||'—',service:a.services?.name,time:a.appointment_time?.slice(0,5)})} style={{fontSize:11,color:'var(--red)',background:'var(--red-bg)',border:'1px solid rgba(239,68,68,0.12)',borderRadius:8,padding:'5px 8px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>✕</button>}
          </div>
        })}

        {cancelConfirm&&<Modal>
          <h3 style={{fontSize:18,fontWeight:800,marginBottom:12,color:'var(--text)'}}>¿Cancelar esta cita?</h3>
          <div style={{padding:16,background:'var(--bg)',borderRadius:12,marginBottom:16,border:'1px solid var(--border)'}}>
            <div style={{fontSize:15,fontWeight:600,color:'var(--text)'}}>{cancelConfirm.name}</div>
            <div style={{fontSize:13,color:'var(--text3)',marginTop:4}}>{cancelConfirm.service} · {cancelConfirm.time}h</div>
          </div>
          <p style={{fontSize:13,color:'var(--text2)',marginBottom:20}}>El cliente será notificado de la cancelación.</p>
          <div style={{display:'flex',gap:10}}>
            <Bt variant="secondary" onClick={()=>setCancelConfirm(null)} style={{flex:1}}>Volver</Bt>
            <Bt variant="danger" onClick={()=>doCancelAppt(cancelConfirm.id)} style={{flex:1}}>Cancelar cita</Bt>
          </div>
        </Modal>}

        {showBlock&&<Modal>
          <h3 style={{fontSize:18,fontWeight:800,marginBottom:18,color:'var(--text)'}}>Bloquear horario</h3>
          <Sl label="Profesional" value={bS} onChange={e=>setBS(Number(e.target.value))}>
            {st.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </Sl>
          <In label="Fecha" type="date" value={bD} onChange={e=>setBD(e.target.value)}/>
          <div style={{display:'flex',gap:10}}>
            <div style={{flex:1}}><Sl label="Desde" value={bSt} onChange={e=>setBSt(e.target.value)}>{gS('06:00','23:30').map(h=><option key={h} value={h}>{h}</option>)}</Sl></div>
            <div style={{flex:1}}><Sl label="Hasta" value={bE} onChange={e=>setBE(e.target.value)}>{gS('06:30','24:00').map(h=><option key={h} value={h}>{h}</option>)}</Sl></div>
          </div>
          <In label="Motivo" value={bR} onChange={e=>setBR(e.target.value)} placeholder="Ej: Vacaciones, baja..."/>
          <div style={{display:'flex',gap:10,marginTop:8}}>
            <Bt variant="secondary" onClick={()=>setShowBlock(false)} style={{flex:1}}>Cancelar</Bt>
            <Bt onClick={addBlock} style={{flex:1}}>Bloquear</Bt>
          </div>
        </Modal>}
      </div>}

      {/* ── EQUIPO ── */}
      {tab==='team'&&<div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <h2 style={{fontSize:18,fontWeight:800,color:'var(--text)'}}>Equipo</h2>
          <Bt small onClick={()=>setEditSty({name:'',username:'',role_title:'Barbero',photo_url:'',active:true})}>+ Añadir</Bt>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {st.map((s,i)=><div key={s.id} className={`anim d${i+1}`} style={{background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:16,boxShadow:'var(--shadow)',opacity:s.active?1:0.5,overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',gap:14,padding:16}}>
              <div style={{width:48,height:48,borderRadius:24,background:'var(--purple-bg)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'var(--purple)',overflow:'hidden',flexShrink:0}}>
                {s.photo_url?<img src={s.photo_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:s.name[0]}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:15,fontWeight:600,color:'var(--text)'}}>{s.name}</div>
                <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{s.role_title} · {s.username||'—'}</div>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>setEditSty(s)} style={{fontSize:12,color:'var(--purple)',background:'var(--purple-bg)',border:'1px solid var(--border)',borderRadius:8,padding:'5px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>Editar</button>
                <button onClick={()=>setDelConfirm({type:'stylist',id:s.id,name:s.name})} style={{fontSize:12,color:'var(--red)',background:'var(--red-bg)',border:'1px solid rgba(239,68,68,0.15)',borderRadius:8,padding:'5px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>✕</button>
              </div>
            </div>
            {/* Botón horario semanal */}
            <button onClick={()=>setScheduleFor(s)} style={{width:'100%',padding:'10px 16px',background:'var(--bg)',border:'none',borderTop:'1px solid var(--border)',cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:12,fontWeight:600,color:'var(--purple)',display:'flex',alignItems:'center',gap:6}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                Configurar horario semanal
              </span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>)}
        </div>
      </div>}

      {/* ── SERVICIOS ── */}
      {tab==='svc'&&<div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <h2 style={{fontSize:18,fontWeight:800,color:'var(--text)'}}>Servicios</h2>
          <Bt small onClick={()=>setEditSvc({name:'',description:'',duration:30,price:0,category:'popular'})}>+ Añadir</Bt>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {sv.map((s,i)=><div key={s.id} className={`anim d${(i%5)+1}`} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:14,boxShadow:'var(--shadow)',opacity:s.active?1:0.5}}>
            <div style={{width:36,height:36,borderRadius:10,background:'var(--purple-bg2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{svcIcon(s.name)}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:600,color:'var(--text)'}}>{s.name}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{s.duration} min · {s.category==='popular'?'⭐ Popular':'Otro'}</div>
            </div>
            <div style={{fontSize:16,fontWeight:800,color:'var(--purple)',marginRight:8}}>{Number(s.price).toFixed(2)} €</div>
            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>setEditSvc(s)} style={{fontSize:12,color:'var(--purple)',background:'var(--purple-bg)',border:'1px solid var(--border)',borderRadius:8,padding:'5px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>Editar</button>
              <button onClick={()=>setDelConfirm({type:'service',id:s.id,name:s.name})} style={{fontSize:12,color:'var(--red)',background:'var(--red-bg)',border:'1px solid rgba(239,68,68,0.15)',borderRadius:8,padding:'5px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>✕</button>
            </div>
          </div>)}
        </div>
      </div>}

      {/* ── CONFIG ── */}
      {tab==='config'&&<div>
        <div style={{background:'var(--white)',borderRadius:16,border:'1.5px solid var(--border)',padding:16,marginBottom:12,boxShadow:'var(--shadow)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <span style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>Datos del salón</span>
            <Bt small onClick={()=>setShowSalonConfig(true)}>Editar</Bt>
          </div>
          {[{l:'Nombre',v:'Clocks School'},{l:'Dirección',v:salonConfig?.address||'—'},{l:'Teléfono',v:salonConfig?.phone||'—'},{l:'Instagram',v:salonConfig?.instagram||'—'}].map(({l,v})=>
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
              <span style={{color:'var(--text3)',fontWeight:500}}>{l}</span>
              <span style={{fontWeight:600,color:'var(--text)',maxWidth:200,textAlign:'right',wordBreak:'break-word'}}>{v}</span>
            </div>
          )}
        </div>
        <div style={{background:'var(--purple-bg)',borderRadius:14,padding:'14px 16px',border:'1px solid var(--border)'}}>
          <div style={{fontSize:13,fontWeight:700,color:'var(--purple)',marginBottom:6}}>💡 Horarios semanales</div>
          <p style={{fontSize:12,color:'var(--text2)',lineHeight:1.6}}>Ve a <strong>Equipo</strong> y pulsa "Configurar horario semanal" en cada barbero para definir qué días y en qué franjas trabaja. Los clientes solo verán huecos dentro de esos turnos. Puedes añadir bloqueos puntuales encima (vacaciones, bajas) desde el Calendario.</p>
        </div>
      </div>}
    </div>

    {editSvc&&<SvcModal data={editSvc} onSave={saveSvc} onClose={()=>setEditSvc(null)}/>}
    {editSty&&<StyModal data={editSty} onSave={saveSty} onClose={()=>setEditSty(null)}/>}
    {scheduleFor&&<WeeklyScheduleModal stylist={scheduleFor} onClose={()=>setScheduleFor(null)} onSaved={()=>{setScheduleFor(null);if(onDataChanged)onDataChanged()}}/>}
    {showSalonConfig&&<SalonConfigModal config={salonConfig} onSave={()=>{setShowSalonConfig(false);if(onSalonConfigChanged)onSalonConfigChanged()}} onClose={()=>setShowSalonConfig(false)}/>}

    {delConfirm&&<Modal>
      <h3 style={{fontSize:18,fontWeight:800,marginBottom:12,color:'var(--text)'}}>¿Eliminar {delConfirm.name}?</h3>
      <p style={{fontSize:14,color:'var(--text2)',marginBottom:20}}>Esta acción no se puede deshacer.</p>
      <div style={{display:'flex',gap:10}}>
        <Bt variant="secondary" onClick={()=>setDelConfirm(null)} style={{flex:1}}>Cancelar</Bt>
        <Bt variant="danger" onClick={()=>delConfirm.type==='service'?delSvc(delConfirm.id):delSty(delConfirm.id)} style={{flex:1}}>Eliminar</Bt>
      </div>
    </Modal>}
  </div>
}

// ═══ DONE ═════════════════════════════════════════════════════════════════════
function Done({bk,onR}) {
  return <div className="scale-in" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 28px',textAlign:'center',minHeight:'80vh'}}>
    <div style={{width:80,height:80,borderRadius:40,background:'var(--green-bg)',border:'2px solid rgba(34,197,94,0.2)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:24}}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </div>
    <h1 style={{fontSize:26,fontWeight:900,marginBottom:8,letterSpacing:-1,color:'var(--text)'}}>¡Reserva confirmada!</h1>
    <p style={{fontSize:14,color:'var(--text2)',lineHeight:1.7,maxWidth:300}}>
      <strong>{bk.service.name}</strong> con {bk.stylist.name}<br/>
      {fDF(bk.date)} a las <strong style={{color:'var(--purple)'}}>{bk.time}h</strong>
    </p>
    <div style={{marginTop:16,padding:'12px 22px',background:'var(--purple-bg)',borderRadius:12,fontSize:13,color:'var(--purple)',fontWeight:600}}>
      📩 Recibirás confirmación por email
    </div>
    <Bt onClick={onR} style={{marginTop:28}}>Volver al inicio</Bt>
  </div>
}

// ═══ MAIN ═════════════════════════════════════════════════════════════════════
export default function App() {
  const [user,setUser]=useState(null),[profile,setProfile]=useState(null)
  const [view,setView]=useState('loading')
  const [svcs,setSvcs]=useState([]),[stys,setStys]=useState([])
  const [lb,setLb]=useState(null),[ps,setPs]=useState(null)
  const [salonConfig,setSalonConfig]=useState(null)

  const loadPublic=async()=>{
    const [{data:sv},{data:st},{data:sc}]=await Promise.all([
      supabase.from('services').select('*').eq('active',true).order('display_order'),
      supabase.from('stylists').select('*').eq('active',true).order('display_order'),
      supabase.from('salon_config').select('*').limit(1).maybeSingle(),
    ])
    setSvcs(sv||[]);setStys(st||[]);setSalonConfig(sc||null)
  }

  useEffect(()=>{
    loadPublic()
    supabase.auth.getSession().then(({data:{session}})=>{
      if(session?.user){setUser(session.user);lP(session.user.id)}
      setView('landing')
    })
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{
      if(s?.user){setUser(s.user);lP(s.user.id)}else{setUser(null);setProfile(null)}
    })
    return()=>subscription.unsubscribe()
  },[])

  const lP=async id=>{const{data}=await supabase.from('profiles').select('*').eq('id',id).single();setProfile(data)}
  const hL=u=>{setUser(u);lP(u.id);if(ps)setView('booking');else setView('landing')}
  const hO=async()=>{await supabase.auth.signOut();setUser(null);setProfile(null);setView('landing')}
  const hR=s=>{setPs(s);if(user)setView('booking');else setView('auth')}
  const isA=profile?.role==='admin'

  const reloadSalonConfig=async()=>{
    const{data}=await supabase.from('salon_config').select('*').limit(1).maybeSingle()
    setSalonConfig(data||null)
  }

  if(view==='loading')return<div style={{maxWidth:480,margin:'0 auto',minHeight:'100vh',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center'}}><style>{CSS}</style><Sp/></div>

  return <div style={{maxWidth:480,margin:'0 auto',minHeight:'100vh',background:'var(--bg)',boxShadow:'0 0 60px rgba(109,40,217,0.06)'}}>
    <style>{CSS}</style>
    {view==='landing'&&<Landing svcs={svcs} stys={stys} user={user} isA={isA} onRes={hR} onLog={()=>setView('auth')} onAcc={()=>setView('account')} onAdm={()=>setView('admin')} salonConfig={salonConfig}/>}
    {view==='auth'&&<Auth onLogin={hL} onBack={()=>setView('landing')}/>}
    {view==='booking'&&user&&<Booking user={user} profile={profile} svcs={svcs} stys={stys} pre={ps} onDone={b=>{setLb(b);setView('done')}} onBack={()=>setView('landing')}/>}
    {view==='account'&&user&&<Account user={user} profile={profile} stys={stys} onBook={()=>{setPs(null);setView('booking')}} onLogout={hO} onBack={()=>setView('landing')} onUp={setProfile}/>}
    {view==='done'&&lb&&<Done bk={lb} onR={()=>setView('landing')}/>}
    {view==='admin'&&user&&<Admin user={user} onBack={()=>setView('landing')} onDataChanged={loadPublic} salonConfig={salonConfig} onSalonConfigChanged={reloadSalonConfig}/>}
  </div>
}
