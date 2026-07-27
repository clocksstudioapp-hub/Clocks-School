import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { toK, aM, gS } from './timeUtils.js'
import { getSlotsForDay } from './availability.js'

// ═══ CSS ══════════════════════════════════════════════════════════════════════
const CSS = `
:root{
  --bg:#F7F7FD;--white:#FFFFFF;--border:#E7E7F6;--border2:#D3D3EE;
  --text:#2D2D2F;--text2:#4B5563;--text3:#9CA3AF;
  --purple:#696BC6;--purple-l:#9294D6;--purple-d:#53559F;
  --purple-bg:#E7E7F6;--purple-bg2:#F2F2FB;
  --green:#22C55E;--green-bg:rgba(34,197,94,0.10);
  --yellow:#F59E0B;--yellow-bg:rgba(245,158,11,0.10);--orange:#F97316;--orange-bg:rgba(249,115,22,0.09);
  --red:#EF4444;--red-bg:rgba(239,68,68,0.08);
  --shadow:0 2px 8px rgba(83,85,159,0.07);
  --shadow-md:0 8px 24px rgba(83,85,159,0.15)
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--purple)!important;box-shadow:0 0 0 3px rgba(105,107,198,0.12)!important}
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
const isT = d => toK(d) === toK(new Date())
const isP = d => { const t = new Date(); t.setHours(0,0,0,0); return d < t }
const fD = d => `${d.getDate()} de ${MO[d.getMonth()]}`
const fDF = d => `${dayF[d.getDay()]}, ${fD(d)}`
const fS = d => `${d.getDate()} ${MS[d.getMonth()]}`
const parseDate = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d) }
const gMD = (y,m) => { const f=new Date(y,m,1),l=new Date(y,m+1,0); let s=f.getDay()-1; if(s<0)s=6; const d=[]; for(let i=0;i<s;i++)d.push(null); for(let i=1;i<=l.getDate();i++)d.push(new Date(y,m,i)); return d }

// Álvaro tiene slots de 30 min para cortes y barba
const alvaroEffDur = (sty, svc) => {
  if(!sty||!svc) return svc?.duration||30
  const styName=(sty.name||'').toLowerCase()
  const svcName=(svc.name||'').toLowerCase()
  const isAlvaro=styName.includes('álvaro')||styName.includes('alvaro')
  const isQuickSvc=svcName.includes('corte')||svcName.includes('barba')
  return (isAlvaro&&isQuickSvc) ? 30 : svc.duration
}

// Punto unico de referencia a los logos oficiales de Clocks School.
// Ambos llevan fondo blanco solido (sin alfa): solo sobre fondos blancos.
const LOGO_H = '/images/logo-school-h.png'        // logotipo horizontal
const LOGO_MARK = '/images/logo-school-mark.png'  // isotipo (ovalo BCS)

const HERO = ['images/hero-1.jpg','images/hero-2.jpg','images/hero-3.jpg','images/hero-4.jpg']
const GALL = ['images/work-1.jpg','images/work-2.jpg','images/work-3.jpg','images/work-4.jpg','images/work-5.jpg','images/work-6.jpg']

// Service category detector — used by <ServiceIcon/>
const serviceKind = n => {
  const s = (n||'').toLowerCase()
  if(s.includes('barba')&&!s.includes('cejas'))return'beard'
  if(s.includes('ceja'))return'eyebrow'
  if(s.includes('color')||s.includes('tinte'))return'color'
  if(s.includes('mecha')||s.includes('decolor'))return'highlights'
  if(s.includes('lavad')||(s.includes('champ')&&s.includes('serv')))return'wash'
  if(s.includes('tratam')||s.includes('mascarill')||s.includes('hidrat')||s.includes('keratin'))return'treatment'
  if(s.includes('afeit')||s.includes('shave'))return'shave'
  if(s.includes('niñ')||s.includes('kids')||s.includes('infantil'))return'kids'
  if(s.includes('pack')||s.includes('combo'))return'pack'
  if(s.includes('diseñ')||s.includes('design'))return'design'
  if(s.includes('peinad')||s.includes('styling')||s.includes('moldead'))return'styling'
  if(s.includes('masaj')||s.includes('relax'))return'massage'
  return 'haircut'
}
// SVG glyphs — viewBox 32x32, currentColor stroke, line-art style
const SERVICE_SVG = {
  haircut:    <><path d="M12 6l8 8M20 6l-8 8M9 22a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM23 22a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM11 19l8-8M21 19l-8-8" strokeWidth="1.8"/></>,
  beard:      <><path d="M12 6c0 4 2 6 4 6s4-2 4-6"/><path d="M16 12v3"/><circle cx="12" cy="9" r="0.7" fill="currentColor" stroke="none"/><circle cx="20" cy="9" r="0.7" fill="currentColor" stroke="none"/><path d="M9 16c0 7 3 12 7 12s7-5 7-12c-1 0-3 1-7 1s-6-1-7-1z"/><path d="M11 19c1 0 1-1 2-1M21 19c-1 0-1-1-2-1" strokeWidth="1.4"/></>,
  eyebrow:    <><path d="M5 15c4-4 12-4 22 0"/><path d="M7 19c3-3 11-3 18 0" strokeOpacity="0.45"/><circle cx="16" cy="22" r="1.2" fill="currentColor" stroke="none"/></>,
  color:      <><path d="M16 5c-3 5-7 8-7 12a7 7 0 1 0 14 0c0-4-4-7-7-12z"/><path d="M11 16c1 3 3 5 5 5" strokeOpacity="0.5"/><circle cx="22" cy="9" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="11" r="1" fill="currentColor" stroke="none"/></>,
  highlights: <><path d="M10 5v8M14 5v10M18 5v9M22 5v11"/><path d="M8 14h16l-2 12H10z"/><path d="M11 18l1 6M17 18l1 6M22 18l-1 6" strokeOpacity="0.55"/></>,
  wash:       <><path d="M16 5c-1 0-3 2-3 4v2"/><rect x="11" y="11" width="10" height="16" rx="2.5"/><path d="M11 16h10" strokeOpacity="0.5"/><circle cx="14" cy="20" r="0.8" fill="currentColor" stroke="none"/><circle cx="18" cy="22" r="0.6" fill="currentColor" stroke="none"/></>,
  treatment:  <><path d="M16 4c-2 4-5 7-5 11a5 5 0 0 0 10 0c0-4-3-7-5-11z"/><path d="M22 7l1.5 1.5M22 7l-1.5 1.5M22 7l-1 -1.5M22 7l1.5 -.5" strokeWidth="1.4"/><path d="M9 18l1 1M9 18l1 -.5M9 18l-1 .5M9 18l-1 -1" strokeWidth="1.4"/></>,
  shave:      <><path d="M9 6h14v3a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V6z"/><path d="M14 11h4v4h-4z"/><rect x="13" y="15" width="6" height="13" rx="1.5"/><path d="M11 7.5h2M19 7.5h2" strokeWidth="2.2"/></>,
  kids:       <><path d="M11 6l5 5M21 6l-5 5M9 17a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM23 17a3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1 3-3 3 3 0 0 1 3 3z"/><circle cx="20" cy="22" r="5"/><path d="M18 22c1 1.5 3 1.5 4 0" strokeWidth="1.4"/><circle cx="18.5" cy="20.5" r="0.5" fill="currentColor" stroke="none"/><circle cx="21.5" cy="20.5" r="0.5" fill="currentColor" stroke="none"/></>,
  pack:       <><rect x="6" y="11" width="20" height="16" rx="2"/><rect x="9" y="8" width="14" height="3" rx="1" strokeOpacity="0.7"/><rect x="11" y="5" width="10" height="3" rx="1" strokeOpacity="0.4"/><path d="M14 17l4 4M18 17l-4 4" strokeWidth="1.6" strokeOpacity="0.6"/></>,
  design:     <><path d="M18 4l-9 14h6l-2 10 9-14h-6z"/></>,
  styling:    <><path d="M5 11h22a1 1 0 0 1 1 1v3H4v-3a1 1 0 0 1 1-1z"/><path d="M6 15v4M9 15v6M12 15v4M15 15v6M18 15v4M21 15v6M24 15v4M27 15v6" strokeWidth="1.6"/><path d="M4 24c4-2 8 2 12 0s8 2 12 0" strokeOpacity="0.6"/></>,
  massage:    <><circle cx="11" cy="11" r="3"/><circle cx="21" cy="11" r="3"/><circle cx="16" cy="20" r="3"/><circle cx="9" cy="22" r="2" strokeOpacity="0.5"/><circle cx="23" cy="22" r="2" strokeOpacity="0.5"/></>,
}
function ServiceIcon({ name, sel = false, size = 22 }) {
  const kind = serviceKind(name)
  const color = sel ? '#fff' : 'var(--purple)'
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{color,display:'block',filter:sel?'drop-shadow(0 1px 2px rgba(0,0,0,0.18))':'none'}}>
    {SERVICE_SVG[kind] || SERVICE_SVG.haircut}
  </svg>
}

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
    boxShadow:p&&!disabled?'0 4px 16px rgba(105,107,198,0.38)':'none',
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
    position:'relative',padding:'18px 20px',borderRadius:18,cursor:'pointer',
    background:sel?'linear-gradient(135deg,var(--purple),var(--purple-l))':'var(--white)',
    border:sel?'none':'1.5px solid var(--border)',
    boxShadow:sel?'0 12px 28px rgba(105,107,198,0.28)':'var(--shadow)',
    marginBottom:12,transition:'transform .15s, box-shadow .2s'
  }}
  onMouseDown={e=>e.currentTarget.style.transform='scale(0.985)'}
  onMouseUp={e=>e.currentTarget.style.transform='scale(1)'}
  onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}
  onTouchStart={e=>e.currentTarget.style.transform='scale(0.985)'}
  onTouchEnd={e=>e.currentTarget.style.transform='scale(1)'}>
    {/* Accent bar a la izquierda (vertical) para identidad de marca */}
    {!sel && <div style={{position:'absolute',left:0,top:14,bottom:14,width:3,borderRadius:'0 3px 3px 0',background:s.category==='popular'?'linear-gradient(180deg,var(--purple),var(--purple-l))':'var(--border2)'}}/>}
    <div style={{display:'flex',alignItems:'flex-start',gap:14}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
          <span style={{fontSize:15,fontWeight:700,color:sel?'#fff':'var(--text)',letterSpacing:-0.1}}>{s.name}</span>
          {s.category==='popular'&&<span style={{fontSize:9,fontWeight:800,padding:'2px 7px',borderRadius:6,background:sel?'rgba(255,255,255,0.22)':'var(--purple-bg)',color:sel?'#fff':'var(--purple)',letterSpacing:'0.08em'}}>TOP</span>}
        </div>
        <div style={{fontSize:12,color:sel?'rgba(255,255,255,0.78)':'var(--text3)',lineHeight:1.4,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          <span style={{display:'inline-flex',alignItems:'center',gap:4,fontWeight:600,color:sel?'rgba(255,255,255,0.92)':'var(--text2)'}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            {s.duration} min
          </span>
          {s.description && <><span style={{opacity:0.5}}>·</span><span>{s.description}</span></>}
        </div>
      </div>
      <div style={{flexShrink:0,textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',gap:8,minWidth:64}}>
        <div style={{fontSize:22,fontWeight:900,color:sel?'#fff':'var(--purple)',letterSpacing:-1,lineHeight:1}}>{Number(s.price).toFixed(0)}€</div>
        {bookBtn&&!sel&&<button onClick={e=>{e.stopPropagation();onClick()}} style={{fontSize:11,color:'#fff',background:'linear-gradient(135deg,var(--purple),var(--purple-l))',border:'none',borderRadius:9,padding:'6px 12px',cursor:'pointer',fontFamily:'inherit',fontWeight:700,boxShadow:'0 3px 10px rgba(105,107,198,0.32)',letterSpacing:0.2,minHeight:28}}>Reservar</button>}
      </div>
    </div>
  </div>
}
// ═══ LANDING ══════════════════════════════════════════════════════════════════
function Landing({svcs,stys,user,profile,isA,isBarber,onRes,onLog,onAcc,onAdm,onBar,salonConfig,salonSchedule=[],closures=[],cfTeams=[],cfService=null,initialTab}) {
  const [hi,setHi]=useState(0)
  const [logoOk,setLogoOk]=useState(true)
  const [tab,setTab]=useState(initialTab||'servicios')
  const isPlayer=profile?.role==='player'
  useEffect(()=>{const t=setInterval(()=>setHi(i=>(i+1)%HERO.length),4500);return()=>clearInterval(t)},[])

  const spainParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date())
  const wkMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}
  const dow=wkMap[spainParts.find(p=>p.type==='weekday')?.value]??new Date().getDay()
  const spH=Number(spainParts.find(p=>p.type==='hour')?.value||0)
  const spM=Number(spainParts.find(p=>p.type==='minute')?.value||0)
  const hr=(spH===24?0:spH)+spM/60
  const tF=t=>{ const[h,m]=t.slice(0,5).split(':').map(Number);return h+m/60 }
  const salSched=salonSchedule.find(s=>s.day_of_week===dow)
  const closedToday=closures.some(c=>c.start_date<=toK(new Date())&&toK(new Date())<=c.end_date)
  const isOpen=!closedToday&&(salSched
    ? salSched.active&&hr>=tF(salSched.open_time)&&hr<tF(salSched.close_time)
      &&!(salSched.break_start&&salSched.break_end&&hr>=tF(salSched.break_start)&&hr<tF(salSched.break_end))
    : (dow>=1&&dow<=5?hr>=9&&hr<20:dow===6?hr>=9&&hr<14:false))
  const pop=svcs.filter(s=>s.category==='popular')
  const oth=svcs.filter(s=>s.category!=='popular')
  const addr=salonConfig?.address||'C/ José Pellicer, 29, Zaragoza'
  const phone=salonConfig?.phone||'620 96 48 50'
  const insta=salonConfig?.instagram||'@clocks.school'

  return <div style={{paddingBottom:88}}>
    <div style={{position:'relative',height:260,overflow:'hidden',background:tab==='juventud'?'#000':'#D3D3EE'}}>
      {tab==='juventud'
        ? <img src="/images/hero-juventud.png" alt="Colaboración CF Juventud" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
        : HERO.map((src,i)=><div key={i} style={{position:'absolute',inset:0,opacity:hi===i?1:0,transition:'opacity .85s'}}>
            <img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>{e.target.style.display='none';e.target.parentElement.style.background=`hsl(${260+i*15},25%,${65+i*4}%)`}}/>
          </div>)}
      <div style={{position:'absolute',inset:0,background:'linear-gradient(to bottom,rgba(83,85,159,0.08) 0%,rgba(83,85,159,0.55) 100%)'}}/>
      {tab!=='juventud'&&<div style={{position:'absolute',bottom:14,left:'50%',transform:'translateX(-50%)',display:'flex',gap:6,zIndex:3}}>
        {HERO.map((_,i)=><button key={i} onClick={()=>setHi(i)} style={{width:hi===i?20:6,height:6,borderRadius:3,border:'none',cursor:'pointer',background:'#fff',opacity:hi===i?1:0.5,transition:'all .3s'}}/>)}
      </div>}
      {user&&<button onClick={onAcc} style={{position:'absolute',top:14,left:14,zIndex:3,width:36,height:36,borderRadius:18,background:'rgba(255,255,255,0.92)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.15)'}}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </button>}
      <div style={{position:'absolute',top:14,right:14,zIndex:3,display:'flex',gap:8}}>
        {isA&&<button onClick={onAdm} style={{height:36,borderRadius:18,background:'rgba(255,255,255,0.92)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',padding:'0 14px',fontSize:12,fontWeight:700,fontFamily:'inherit',color:'var(--purple)'}}>⚙ Admin</button>}
        {isBarber&&!isA&&<button onClick={onBar} style={{height:36,borderRadius:18,background:'rgba(255,255,255,0.92)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',padding:'0 14px',fontSize:12,fontWeight:700,fontFamily:'inherit',color:'var(--purple)'}}>✂️ Mi panel</button>}
        {!user&&<button onClick={onLog} style={{height:36,borderRadius:18,background:'rgba(255,255,255,0.92)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',padding:'0 14px',fontSize:12,fontWeight:600,fontFamily:'inherit',color:'var(--text)'}}>Iniciar sesión</button>}
      </div>
    </div>

    <div style={{height:95,background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'0 16px',borderBottom:'1px solid var(--border)'}}>
      {logoOk
        ?<img src={LOGO_H} alt="Clocks Barber School" style={{height:64,width:'auto',display:'block',flexShrink:0}} onError={()=>setLogoOk(false)}/>
        :<span style={{fontSize:30,fontWeight:900,color:'var(--purple)',letterSpacing:-1.6,flexShrink:0}}>CLOCKS</span>}
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,fontFamily:'inherit',lineHeight:1.2,flexShrink:0}}>
        <span aria-label={isOpen?'Estado: abierto ahora':'Estado: cerrado'} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'5px 10px 5px 9px',borderRadius:18,background:isOpen?'var(--green-bg)':'var(--bg)',border:`1px solid ${isOpen?'rgba(22,163,74,0.22)':'var(--border2)'}`}}>
          <span style={{width:7,height:7,borderRadius:'50%',background:isOpen?'var(--green)':'var(--text3)',boxShadow:isOpen?'0 0 8px var(--green)':'none',animation:isOpen?'glow 2.2s ease-in-out infinite':'none',flexShrink:0}}/>
          <span style={{fontSize:10.5,fontWeight:800,color:isOpen?'var(--green)':'var(--text3)',letterSpacing:'0.05em',textTransform:'uppercase'}}>{isOpen?'Abierto':'Cerrado'}</span>
        </span>
        <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11.5,fontWeight:600,color:'var(--text2)'}}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          Zaragoza
        </span>
      </div>
    </div>

    <div style={{display:'flex',background:'var(--white)',borderBottom:'1px solid var(--border)',padding:'0 20px',overflowX:'auto'}}>
      {[['servicios','SERVICIOS'],['equipo','EQUIPO'],['portafolio','PORTAFOLIO'],['detalles','DETALLES'],...(isPlayer||isA?[['juventud','CF JUVENTUD']]:[])].map(([id,lbl])=>
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
      {(()=>{
        const horarioTxt=salonSchedule.length>0?['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d,i)=>{const s=salonSchedule.find(x=>x.day_of_week===i);return s?.active?`${d}: ${s.open_time?.slice(0,5)} – ${s.close_time?.slice(0,5)}`:null}).filter(Boolean).join('\n')||'Ver horarios en el local':'Ver horarios en el local'
        const items=[
          {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>,l:'Dirección',t:addr,href:`https://maps.google.com/?q=${encodeURIComponent(addr)}`,cta:'Ver en mapa'},
          {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,l:'Horario',t:horarioTxt,href:null,cta:null},
          {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,l:'Teléfono',t:phone,href:`tel:${phone.replace(/\s/g,'')}`,cta:'Llamar'},
          {icon:<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.5" cy="6.5" r="1.1" fill="#fff" stroke="none"/></svg>,grad:'radial-gradient(circle at 30% 107%,#fdf497 0%,#fdf497 5%,#fd5949 45%,#d6249f 60%,#285AEB 90%)',l:'Instagram',t:insta,href:`https://instagram.com/${insta.replace('@','')}`,cta:'Abrir Instagram'}
        ]
        return<div style={{display:'flex',flexDirection:'column',gap:10}}>{items.map((d,idx)=><div key={idx} className={`anim d${idx+1}`} style={{display:'flex',gap:14,alignItems:'flex-start',padding:'16px 18px',background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:16,boxShadow:'var(--shadow)'}}>
          <div style={{width:42,height:42,borderRadius:13,background:d.grad||'linear-gradient(135deg,var(--purple-bg2),var(--purple-bg))',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,border:d.grad?'none':'1px solid var(--border)',boxShadow:d.grad?'0 3px 10px rgba(214,36,159,0.30)':'none'}}>{d.icon}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,color:'var(--text3)',fontWeight:700,marginBottom:4,letterSpacing:'0.06em',textTransform:'uppercase'}}>{d.l}</div>
            <div style={{fontSize:14,fontWeight:600,lineHeight:1.55,whiteSpace:'pre-line',color:'var(--text)'}}>{d.t}</div>
            {d.href&&d.cta&&<a href={d.href} target={d.href.startsWith('http')?'_blank':undefined} rel="noopener noreferrer" style={{display:'inline-block',marginTop:8,fontSize:12,fontWeight:700,color:'var(--purple)',textDecoration:'none',padding:'5px 11px',background:'var(--purple-bg)',borderRadius:8}}>{d.cta} →</a>}
          </div>
        </div>)}</div>
      })()}
    </div>}

    {tab==='juventud'&&(isPlayer||isA)&&<div style={{padding:16}}>
      <CFJuventudTab user={user} profile={profile} isA={isA} cfService={cfService} cfTeams={cfTeams} onRes={onRes}/>
    </div>}

    <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'rgba(255,255,255,0.94)',backdropFilter:'blur(14px)',borderTop:'1px solid var(--border)',padding:'12px 20px 18px',zIndex:50}}>
      <button onClick={()=>onRes(null)} style={{width:'100%',padding:15,fontSize:15,fontWeight:700,color:'#fff',background:'linear-gradient(135deg,var(--purple),var(--purple-l))',border:'none',borderRadius:14,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:8,boxShadow:'0 6px 20px rgba(105,107,198,0.42)'}}>
        Reservar cita
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
      </button>
    </div>
  </div>
}

// ═══ CF JUVENTUD TAB ═══════════════════════════════════════════════════════
const CF_ORANGE='#F26A21', CF_ORANGE_D='#D9560F'
const monthRange=d=>{const y=d.getFullYear(),m=d.getMonth();return[toK(new Date(y,m,1)),toK(new Date(y,m+1,0))]}

function CFJuventudTab({user,profile,isA,cfService,cfTeams,onRes}) {
  if(isA) return <CFJuventudAdminPanel cfService={cfService} cfTeams={cfTeams}/>

  const [status,setStatus]=useState('loading') // 'loading' | 'available' | 'used'
  const team=cfTeams.find(t=>t.id===profile?.team_id)

  useEffect(()=>{
    if(!cfService||!user){setStatus('available');return}
    const[from,to]=monthRange(new Date())
    supabase.from('appointments').select('id').eq('user_id',user.id).eq('service_id',cfService.id).eq('status','confirmed')
      .gte('appointment_date',from).lte('appointment_date',to).maybeSingle()
      .then(({data})=>setStatus(data?'used':'available'))
  },[cfService,user])

  return <div>
    <div style={{maxWidth:340,margin:'0 auto',borderRadius:18,overflow:'hidden',boxShadow:'var(--shadow-md)'}}>
      <img src="/images/banner-juventud.png" alt="Clocks School × C.F. Santo Domingo Juventud" style={{width:'100%',display:'block'}}/>
      <div style={{background:'var(--white)',padding:'16px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>{profile?.full_name}</div>
          <div style={{fontSize:12,color:'var(--text3)'}}>{team?.name||'—'}</div>
        </div>
        {status==='loading'
          ?<span style={{fontSize:12,color:'var(--text3)'}}>Cargando…</span>
          :status==='available'
            ?<span style={{background:'rgba(34,197,94,0.12)',color:'var(--green)',padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:800,whiteSpace:'nowrap'}}>✓ Corte disponible</span>
            :<span style={{background:'rgba(156,163,175,0.15)',color:'var(--text3)',padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:800,whiteSpace:'nowrap'}}>Ya usado · vuelve el 1</span>}
      </div>
    </div>
    {status==='available'&&cfService&&<button onClick={()=>onRes(cfService)} style={{width:'100%',maxWidth:340,margin:'14px auto 0',display:'block',padding:15,fontSize:15,fontWeight:700,color:'#fff',background:`linear-gradient(135deg,${CF_ORANGE},${CF_ORANGE_D})`,border:'none',borderRadius:14,cursor:'pointer',fontFamily:'inherit',boxShadow:'0 6px 20px rgba(242,106,33,0.42)'}}>
      Reservar mi corte gratis
    </button>}
  </div>
}

// ═══ CF JUVENTUD — PANEL ADMIN (también en clocks-admin) ═══
const exportCSVLocal=(rows,filename)=>{
  if(rows.length===0)return
  const header=Object.keys(rows[0]).join(';')
  const csv=header+'\n'+rows.map(r=>Object.values(r).join(';')).join('\n')
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a');a.href=url;a.download=filename+'.csv';a.click()
  URL.revokeObjectURL(url)
}

function CFJuventudAdminPanel({cfService,cfTeams:initialTeams}) {
  const [players,setPlayers]=useState([])
  const [redeemedIds,setRedeemedIds]=useState(new Set())
  const [teams,setTeams]=useState(initialTeams)
  const [ld,setLd]=useState(true)
  const [editTeam,setEditTeam]=useState(null)

  const load=useCallback(async()=>{
    setLd(true)
    const[{data:pl},{data:tm}]=await Promise.all([
      supabase.from('profiles').select('id,full_name,team_id').eq('role','player').order('full_name'),
      supabase.from('cf_teams').select('*').order('display_order'),
    ])
    setPlayers(pl||[]);setTeams(tm||[])
    if(cfService){
      const[from,to]=monthRange(new Date())
      const{data:red}=await supabase.from('appointments').select('user_id').eq('service_id',cfService.id).eq('status','confirmed').gte('appointment_date',from).lte('appointment_date',to)
      setRedeemedIds(new Set((red||[]).map(r=>r.user_id)))
    }
    setLd(false)
  },[cfService])
  useEffect(()=>{load()},[load])

  const saveTeam=async d=>{
    if(d.id)await supabase.from('cf_teams').update({name:d.name,active:d.active}).eq('id',d.id)
    else{const mx=teams.reduce((m,t)=>Math.max(m,t.display_order||0),0);await supabase.from('cf_teams').insert({name:d.name,active:d.active,display_order:mx+1})}
    setEditTeam(null);load()
  }
  const delTeam=async id=>{await supabase.from('cf_teams').delete().eq('id',id);load()}

  const exportRows=()=>{
    const rows=players.map(p=>({Jugador:p.full_name||'—',Equipo:teams.find(t=>t.id===p.team_id)?.name||'—',Estado:redeemedIds.has(p.id)?'Usado este mes':'Disponible'}))
    exportCSVLocal(rows,'cf_juventud_jugadores')
  }

  if(ld)return<Sp/>

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
      <h2 style={{fontSize:18,fontWeight:800,color:'var(--text)'}}>CF Juventud</h2>
      <button onClick={exportRows} style={{fontSize:12,color:'var(--purple)',background:'var(--purple-bg)',border:'1px solid var(--border)',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>📥 Exportar CSV</button>
    </div>

    <p style={{fontSize:12,fontWeight:700,color:'var(--text3)',letterSpacing:0.5,textTransform:'uppercase',marginBottom:10}}>Jugadores ({players.length})</p>
    <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:20}}>
      {players.length===0&&<Em icon="⚽" text="Sin jugadores registrados todavía"/>}
      {players.map(p=><div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:12,boxShadow:'var(--shadow)'}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{p.full_name||'Sin nombre'}</div>
          <div style={{fontSize:11,color:'var(--text3)'}}>{teams.find(t=>t.id===p.team_id)?.name||'—'}</div>
        </div>
        {redeemedIds.has(p.id)
          ?<Bg color="var(--text3)" bg="rgba(156,163,175,0.15)">Usado</Bg>
          :<Bg color="var(--green)" bg="var(--green-bg)">Disponible</Bg>}
      </div>)}
    </div>

    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
      <p style={{fontSize:12,fontWeight:700,color:'var(--text3)',letterSpacing:0.5,textTransform:'uppercase'}}>Equipos ({teams.length})</p>
      <button onClick={()=>setEditTeam({name:'',active:true})} style={{fontSize:12,color:'var(--purple)',background:'var(--purple-bg)',border:'1px solid var(--border)',borderRadius:8,padding:'5px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>+ Añadir</button>
    </div>
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {teams.map(t=><div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:10,opacity:t.active?1:0.5}}>
        <span style={{flex:1,fontSize:13,fontWeight:500,color:'var(--text)'}}>{t.name}</span>
        <button onClick={()=>setEditTeam(t)} style={{fontSize:11,color:'var(--purple)',background:'var(--purple-bg)',border:'1px solid var(--border)',borderRadius:7,padding:'4px 9px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>Editar</button>
      </div>)}
    </div>

    {editTeam&&<CfTeamModal data={editTeam} onSave={saveTeam} onDelete={editTeam.id?()=>{delTeam(editTeam.id);setEditTeam(null)}:null} onClose={()=>setEditTeam(null)}/>}
  </div>
}

function CfTeamModal({data,onSave,onDelete,onClose}) {
  const [name,setName]=useState(data.name||''),[active,setActive]=useState(data.active!==false)
  return <Modal>
    <h3 style={{fontSize:18,fontWeight:800,marginBottom:18,color:'var(--text)'}}>{data.id?'Editar equipo':'Nuevo equipo'}</h3>
    <In label="Nombre" required value={name} onChange={e=>setName(e.target.value)} placeholder="Ej: Alevín A"/>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
      <span style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>Activo</span>
      <button onClick={()=>setActive(!active)} style={{width:44,height:24,borderRadius:12,position:'relative',cursor:'pointer',border:'none',background:active?'var(--purple)':'var(--border)',transition:'all .3s'}}>
        <div style={{width:20,height:20,borderRadius:10,background:'#fff',position:'absolute',top:2,left:active?22:2,transition:'all .3s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
      </button>
    </div>
    <div style={{display:'flex',gap:10,marginTop:8}}>
      <Bt variant="secondary" onClick={onClose} style={{flex:1}}>Cancelar</Bt>
      {onDelete&&<Bt variant="danger" onClick={onDelete}>Eliminar</Bt>}
      <Bt onClick={()=>onSave({...data,name,active})} disabled={!name.trim()} style={{flex:1}}>Guardar</Bt>
    </div>
  </Modal>
}

// ═══ RESET PASSWORD ═══════════════════════════════════════════════════════════
function ResetPasswordForm({onDone}) {
  const [pw,setPw]=useState(''),[pw2,setPw2]=useState(''),[ld,setLd]=useState(false),[msg,setMsg]=useState(''),[ok,setOk]=useState(false)
  const submit=async()=>{
    if(pw.length<6){setMsg('La contraseña debe tener mínimo 6 caracteres');return}
    if(pw!==pw2){setMsg('Las contraseñas no coinciden');return}
    setLd(true);setMsg('')
    const{error}=await supabase.auth.updateUser({password:pw})
    setLd(false)
    if(error){setMsg(error.message||'Error al actualizar la contraseña')}
    else{setOk(true);setTimeout(onDone,2200)}
  }
  return<div style={{maxWidth:480,margin:'0 auto',minHeight:'100vh',background:'var(--white)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'0 28px'}}>
    <div className="scale-in" style={{width:'100%'}}>
      <div style={{textAlign:'center',marginBottom:32}}>
        <div style={{width:62,height:62,borderRadius:20,background:'linear-gradient(135deg,var(--purple),var(--purple-l))',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 18px',boxShadow:'0 6px 22px rgba(105,107,198,0.38)'}}>
          <ClockSVG size={32}/>
        </div>
        <h1 style={{fontSize:24,fontWeight:900,marginBottom:6,letterSpacing:-1,color:'var(--text)'}}>{ok?'¡Listo!':'Nueva contraseña'}</h1>
        <p style={{fontSize:14,color:'var(--text3)'}}>{ok?'Contraseña actualizada correctamente':'Introduce tu nueva contraseña'}</p>
      </div>
      {!ok&&<>
        <In label="Nueva contraseña" required type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Mínimo 6 caracteres" onKeyDown={e=>e.key==='Enter'&&submit()}/>
        <In label="Repite la contraseña" required type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="Repite la contraseña" onKeyDown={e=>e.key==='Enter'&&submit()}/>
        {msg&&<div style={{padding:'11px 14px',background:'var(--red-bg)',borderRadius:10,marginBottom:14,border:'1px solid rgba(239,68,68,0.12)'}}><p style={{fontSize:13,color:'var(--red)',fontWeight:500}}>{msg}</p></div>}
        <Bt full onClick={submit} disabled={ld||!pw||!pw2}>{ld?'Guardando...':'Guardar contraseña'}</Bt>
      </>}
      {ok&&<div style={{textAlign:'center',padding:'24px 0'}}>
        <div style={{fontSize:52,marginBottom:12}}>✅</div>
        <p style={{fontSize:14,color:'var(--text3)'}}>Redirigiendo...</p>
      </div>}
    </div>
  </div>
}

// ═══ AUTH ═════════════════════════════════════════════════════════════════════
function Auth({onLogin,onBack}) {
  const [m,setM]=useState('login'),[em,setEm]=useState(''),[pw,setPw]=useState(''),[nm,setNm]=useState(''),[ph,setPh]=useState(''),[ld,setLd]=useState(false),[er,setEr]=useState('')
  const [logoOk,setLogoOk]=useState(true)
  const [resetSent,setResetSent]=useState(false)
  const [consent,setConsent]=useState(false),[showPrivacy,setShowPrivacy]=useState(false)
  const sendReset=async()=>{
    if(!em.trim()){setEr('Introduce tu email primero');return}
    setLd(true);setEr('')
    const{error}=await supabase.auth.resetPasswordForEmail(em.trim(),{redirectTo:window.location.origin})
    setLd(false)
    if(error)setEr(error.message||'Error al enviar el correo')
    else setResetSent(true)
  }
  const sub=async()=>{
    setEr('');setLd(true)
    try {
      if(m==='register'){
        if(!nm.trim()||!em.trim()||!pw.trim()){setEr('Rellena los campos obligatorios');setLd(false);return}
        if(pw.length<6){setEr('Mínimo 6 caracteres');setLd(false);return}
        if(!consent){setEr('Debes aceptar la política de privacidad para crear una cuenta');setLd(false);return}
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
    <div style={{padding:'32px 28px 26px',display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
      {logoOk
        ?<>
          <img src={LOGO_MARK} alt="" style={{height:80,width:'auto',maxWidth:'55%',display:'block'}} onError={()=>setLogoOk(false)}/>
          <img src={LOGO_H} alt="Clocks Barber School" style={{width:200,maxWidth:'72%',height:'auto',display:'block'}} onError={()=>setLogoOk(false)}/>
        </>
        :<>
          <h1 style={{fontSize:24,fontWeight:900,marginBottom:4,letterSpacing:-1,color:'var(--text)'}}>Clocks School</h1>
          <p style={{fontSize:14,color:'var(--text3)'}}>Accede para reservar tu cita</p>
        </>}
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
      {m==='register'&&<label style={{display:'flex',alignItems:'flex-start',gap:9,marginBottom:14,cursor:'pointer'}}>
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:2,width:16,height:16,accentColor:'var(--purple)',flexShrink:0,cursor:'pointer'}}/>
        <span style={{fontSize:12,color:'var(--text2)',lineHeight:1.5}}>He leído y acepto la <button type="button" onClick={()=>setShowPrivacy(true)} style={{fontFamily:'inherit',fontSize:12,color:'var(--purple)',background:'none',border:'none',padding:0,cursor:'pointer',fontWeight:700,textDecoration:'underline'}}>política de privacidad</button> y el tratamiento de mis datos para gestionar mis reservas.</span>
      </label>}
      {er&&<div style={{padding:'11px 14px',background:'var(--red-bg)',borderRadius:10,marginBottom:14,border:'1px solid rgba(239,68,68,0.12)'}}><p style={{fontSize:13,color:'var(--red)',fontWeight:500}}>{er}</p></div>}
      {resetSent&&<div style={{padding:'11px 14px',background:'var(--green-bg)',borderRadius:10,marginBottom:14,border:'1px solid rgba(34,197,94,0.15)'}}><p style={{fontSize:13,color:'var(--green)',fontWeight:600}}>✅ Revisa tu email — te hemos enviado un enlace para restablecer la contraseña.</p></div>}
      <Bt full onClick={sub} disabled={ld}>{ld?'Cargando...':m==='register'?'Crear cuenta':'Entrar'}</Bt>
      {m==='login'&&<button onClick={sendReset} disabled={ld} style={{fontFamily:'inherit',fontSize:13,color:'var(--text3)',background:'none',border:'none',cursor:'pointer',width:'100%',textAlign:'center',marginTop:14,padding:'4px 0'}}>¿Olvidaste tu contraseña?</button>}
      <p style={{fontSize:13,color:'var(--text3)',textAlign:'center',marginTop:10}}>
        {m==='login'?'¿No tienes cuenta? ':'¿Ya tienes cuenta? '}
        <button onClick={()=>{setM(m==='login'?'register':'login');setEr('');setResetSent(false)}} style={{fontFamily:'inherit',fontSize:13,color:'var(--purple)',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>
          {m==='login'?'Regístrate':'Inicia sesión'}
        </button>
      </p>
    </div>
    {showPrivacy&&<Modal>
      <h3 style={{fontSize:18,fontWeight:800,marginBottom:14,color:'var(--text)'}}>Política de privacidad</h3>
      <div style={{fontSize:13,color:'var(--text2)',lineHeight:1.65,maxHeight:'52vh',overflowY:'auto',marginBottom:16}}>
        <p style={{marginBottom:10}}><strong>Responsable:</strong> Clocks School (Zaragoza). Para consultas sobre tus datos escribe al salón.</p>
        <p style={{marginBottom:10}}><strong>Datos que tratamos:</strong> nombre, teléfono, email e historial de tus citas.</p>
        <p style={{marginBottom:10}}><strong>Finalidad:</strong> gestionar tus reservas y enviarte confirmaciones y recordatorios.</p>
        <p style={{marginBottom:10}}><strong>Base legal:</strong> la ejecución de la reserva que solicitas y tu consentimiento.</p>
        <p style={{marginBottom:10}}><strong>Encargados:</strong> Supabase y Vercel (alojamiento) y Google (envío de emails).</p>
        <p style={{marginBottom:10}}><strong>Tus derechos:</strong> acceso, rectificación, supresión y oposición, solicitándolo al salón.</p>
        <p style={{color:'var(--text3)',fontSize:12,fontStyle:'italic'}}>Este texto es un borrador base. El negocio debe revisarlo y completarlo con sus datos fiscales y de contacto antes del lanzamiento.</p>
      </div>
      <Bt full onClick={()=>setShowPrivacy(false)}>Entendido</Bt>
    </Modal>}
  </div>
}

// ═══ PLAYER ONBOARDING (/juventud) ═══
// Sin código de acceso: el jugador se autodeclara y elige su equipo. El
// barbero verifica en persona con el carnet físico del club antes de aplicar
// el corte gratis (decisión de negocio documentada en la spec).
function PlayerOnboarding({user,profile,teams,onDone,onLogin}) {
  const isActivateMode = !!user && profile?.role==='client'
  const [teamId,setTeamId]=useState(teams[0]?.id||'')
  const [nm,setNm]=useState(''),[em,setEm]=useState(''),[pw,setPw]=useState(''),[ph,setPh]=useState('')
  const [consent,setConsent]=useState(false)
  const [ld,setLd]=useState(false),[er,setEr]=useState('')

  const activate=async()=>{
    if(!teamId){setEr('Selecciona tu equipo');return}
    setLd(true);setEr('')
    const{error}=await supabase.rpc('claim_player_role',{p_team_id:Number(teamId)})
    setLd(false)
    if(error){setEr(error.message||'Error al activar la tarjeta');return}
    onDone()
  }

  const registerAndActivate=async()=>{
    if(!nm.trim()||!em.trim()||!pw.trim()){setEr('Rellena los campos obligatorios');return}
    if(pw.length<6){setEr('Mínimo 6 caracteres');return}
    if(!consent){setEr('Debes aceptar la política de privacidad para crear una cuenta');return}
    if(!teamId){setEr('Selecciona tu equipo');return}
    setLd(true);setEr('')
    try {
      const {data,error:e}=await supabase.auth.signUp({email:em.trim(),password:pw,options:{data:{full_name:nm.trim(),phone:ph.trim()}}})
      if(e)throw e
      if(!data.user)throw new Error('No se pudo crear la cuenta')
      await onLogin(data.user)
      const{error:rpcErr}=await supabase.rpc('claim_player_role',{p_team_id:Number(teamId)})
      if(rpcErr)throw rpcErr
      onDone()
    } catch(e){
      if(e.message?.includes('already registered'))setEr('Email ya registrado')
      else setEr(e.message||'Error')
    }
    setLd(false)
  }

  if(user&&(profile?.role==='player'||profile?.role==='admin'||profile?.role==='barber')){
    onDone()
    return <Sp/>
  }

  return <div style={{maxWidth:480,margin:'0 auto',minHeight:'100vh',background:'var(--white)'}}>
    <div style={{padding:'32px 28px 26px',textAlign:'center'}}>
      <img src="/images/logo-juventud.png" alt="C.F. Santo Domingo Juventud" style={{height:80,width:'auto',margin:'0 auto 16px',display:'block'}}/>
      <h1 style={{fontSize:22,fontWeight:900,marginBottom:6,letterSpacing:-1,color:'var(--text)'}}>Tarjeta CF Juventud</h1>
      <p style={{fontSize:14,color:'var(--text3)'}}>{isActivateMode?'Activa tu corte gratis mensual':'Regístrate para reservar tu corte gratis mensual'}</p>
    </div>
    <div className="anim" style={{padding:'0 28px 40px'}}>
      {!isActivateMode&&!user&&<>
        <In label="Nombre completo" required value={nm} onChange={e=>setNm(e.target.value)} placeholder="Tu nombre"/>
        <In label="Teléfono" value={ph} onChange={e=>setPh(e.target.value)} placeholder="612 345 678"/>
        <In label="Email" required type="email" value={em} onChange={e=>setEm(e.target.value)} placeholder="tu@email.com"/>
        <In label="Contraseña" required type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Mínimo 6 caracteres"/>
        <label style={{display:'flex',alignItems:'flex-start',gap:9,marginBottom:14,cursor:'pointer'}}>
          <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:2,width:16,height:16,accentColor:'var(--purple)',flexShrink:0,cursor:'pointer'}}/>
          <span style={{fontSize:12,color:'var(--text2)',lineHeight:1.5}}>He leído y acepto la política de privacidad y el tratamiento de mis datos para gestionar mis reservas.</span>
        </label>
      </>}
      <Sl label="Tu equipo" value={teamId} onChange={e=>setTeamId(e.target.value)}>
        {teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </Sl>
      {er&&<div style={{padding:'11px 14px',background:'var(--red-bg)',borderRadius:10,marginBottom:14,border:'1px solid rgba(239,68,68,0.12)'}}><p style={{fontSize:13,color:'var(--red)',fontWeight:500}}>{er}</p></div>}
      <Bt full onClick={isActivateMode?activate:registerAndActivate} disabled={ld} style={{background:'linear-gradient(135deg,#F26A21,#D9560F)',boxShadow:'0 4px 16px rgba(242,106,33,0.38)'}}>
        {ld?'Procesando...':isActivateMode?'Activar mi tarjeta':'Crear cuenta y activar tarjeta'}
      </Bt>
    </div>
  </div>
}

// ═══ BOOKING ══════════════════════════════════════════════════════════════════
function Booking({user,profile,svcs,stys,pre,onDone,onBack,salonSchedule=[],closures=[]}) {
  const [step,setStep]=useState(pre?1:0)
  const [svc,setSvc]=useState(pre),[sty,setSty]=useState(null)
  const [date,setDate]=useState(null),[time,setTime]=useState(null)
  const [note,setNote]=useState('')
  const [cM,setCM]=useState(new Date().getMonth()),[cY,setCY]=useState(new Date().getFullYear())
  const [slots,setSlots]=useState([]),[sL,setSL]=useState(false),[bk,setBk]=useState(false)
  const [bookErr,setBookErr]=useState('')
  const [monthAvail,setMonthAvail]=useState({})
  const [dayData,setDayData]=useState({bd:[],bl:[]})
  const [schedules,setSchedules]=useState([])
  const [timeOff,setTimeOff]=useState([])
  const [overrides,setOverrides]=useState([])

  // Cargar horarios fijos, ausencias aprobadas y excepciones de turno una vez
  useEffect(()=>{
    supabase.from('stylist_schedules').select('*').then(({data})=>setSchedules(data||[]))
    supabase.from('time_off_public').select('*').then(({data})=>setTimeOff(data||[]))
    supabase.from('schedule_overrides').select('*').then(({data})=>setOverrides(data||[]))
  },[])

  // Disponibilidad mensual (tiene en cuenta horario fijo)
  useEffect(()=>{
    if(!stys.length)return
    ;(async()=>{
      const startDate=`${cY}-${String(cM+1).padStart(2,'0')}-01`
      const endDate=`${cM===11?cY+1:cY}-${String(cM===11?1:cM+2).padStart(2,'0')}-01`
      const [{data:bd},{data:bl}]=await Promise.all([
      supabase.rpc('get_busy_slots',{p_from:startDate,p_to:endDate}),
      supabase.from('blocked_slots').select('blocked_date,start_time,end_time,stylist_id').gte('blocked_date',startDate).lt('blocked_date',endDate),
      ])
      const avail={},daysInMonth=new Date(cY,cM+1,0).getDate()
      for(let i=1;i<=daysInMonth;i++){
        const d=new Date(cY,cM,i)
        const sal=salonSchedule.find(s=>s.day_of_week===d.getDay())
        const closed=(sal&&!sal.active)||closures.some(c=>c.start_date<=toK(d)&&toK(d)<=c.end_date)
        if(closed){avail[toK(d)]='none';continue}
        const maxFree=Math.max(...stys.map(s=>getSlotsForDay(d,s.id,schedules,(bd||[]),(bl||[]),
          alvaroEffDur(s,svc),salonSchedule,30,timeOff,closures,overrides).length))
       const free=maxFree
        avail[toK(d)]=free>10?'green':free>5?'yellow':free>0?'orange':'none'
      }
      setMonthAvail(avail)
    })()
  },[cM,cY,stys,schedules,svc,timeOff,closures,overrides])

  // Barbero favorito
  useEffect(()=>{
    if(profile?.favorite_stylist_id&&stys.length){const f=stys.find(s=>s.id===profile.favorite_stylist_id);if(f)setSty(f)}
  },[profile,stys])

  // Slots del día seleccionado
  useEffect(()=>{
    if(!date){setSlots([]);return}
    ;(async()=>{
      setSL(true);const dk=toK(date)
      const [{data:bd},{data:bl},{data:mine}]=await Promise.all([
  supabase.rpc('get_busy_slots',{p_from:dk,p_to:dk}),
  supabase.from('blocked_slots').select('start_time,end_time,stylist_id,blocked_date').eq('blocked_date',dk),
  supabase.from('appointments').select('appointment_time,end_time').eq('appointment_date',dk).eq('user_id',user.id).eq('status','confirmed'),
])
const allSlotSets=stys.map(s=>getSlotsForDay(date,s.id,schedules,bd||[],bl||[],alvaroEffDur(s,svc),salonSchedule,30,timeOff,closures,overrides))
const userTaken=new Set();(mine||[]).forEach(a=>{let c=a.appointment_time.slice(0,5);const e=a.end_time.slice(0,5);while(c<e){userTaken.add(c);c=aM(c,30)}})
const unionSlots=[...new Set(allSlotSets.flat())].filter(s=>!userTaken.has(s)).sort()
setDayData({bd:bd||[],bl:bl||[]})
setSlots(unionSlots)
      setSL(false)
    })()
  },[date,sty,svc,schedules,timeOff,closures,overrides])

  const confirm=async()=>{
    if(!svc||!sty||!date||!time)return;setBk(true);setBookErr('')
    const dur=alvaroEffDur(sty,svc)
    const {data,error}=await supabase.from('appointments').insert({user_id:user.id,stylist_id:sty.id,service_id:svc.id,appointment_date:toK(date),appointment_time:time,end_time:aM(time,dur),notes:note||null,status:'confirmed'}).select('id').single()
    setBk(false)
    if(error){setBookErr(error.message||'Error al guardar la reserva. Inténtalo de nuevo.')}
    else{
      // fire-and-forget: el email no debe bloquear ni romper la reserva.
      // Enviamos el JWT para que el endpoint valide la propiedad de la cita (SEC-001).
      supabase.auth.getSession().then(({data:{session}})=>{
        fetch('/api/send-confirmation',{method:'POST',headers:{'Content-Type':'application/json',...(session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{})},body:JSON.stringify({appointmentId:data.id})}).catch(()=>{})
      })
      onDone({service:svc,stylist:sty,date,time})
    }
  }

  const pop=svcs.filter(s=>s.category==='popular'),oth=svcs.filter(s=>s.category!=='popular')
  const days=gMD(cY,cM)
  const can=[!!svc,!!(date&&time),!!sty][step]
  const navMonth=dir=>{const nm=cM+dir;if(nm<0){setCM(11);setCY(cY-1)}else if(nm>11){setCM(0);setCY(cY+1)}else setCM(nm)}

  return <div style={{paddingBottom:110}}>
    <div style={{padding:'8px 20px 0'}}><BB onClick={step>0?()=>{setStep(step-1);if(step===2)setSty(null)}:onBack}/></div>
    <div style={{display:'flex',gap:6,padding:'0 20px 18px'}}>
      {['Servicio','Fecha y hora','Profesional'].map((l,i)=><div key={i} style={{flex:1}}>
        <div style={{height:3,borderRadius:2,background:i<=step?'linear-gradient(90deg,var(--purple),var(--purple-l))':'var(--border)',transition:'all .4s',marginBottom:6}}/>
        <span style={{fontSize:10,fontWeight:i<=step?700:400,color:i<=step?'var(--purple)':'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{l}</span>
      </div>)}
    </div>

    {step===0&&<div style={{padding:'0 16px'}}>
      {pop.length>0&&<><p style={{fontSize:12,fontWeight:700,color:'var(--text3)',letterSpacing:0.5,textTransform:'uppercase',marginBottom:12}}>Populares</p>{pop.map((s,i)=><SvcCard key={s.id} s={s} sel={svc?.id===s.id} onClick={()=>setSvc(s)} i={i}/>)}</>}
      {oth.length>0&&<><p style={{fontSize:12,fontWeight:700,color:'var(--text3)',letterSpacing:0.5,textTransform:'uppercase',margin:'8px 0 12px'}}>Otros servicios</p>{oth.map((s,i)=><SvcCard key={s.id} s={s} sel={svc?.id===s.id} onClick={()=>setSvc(s)} i={i}/>)}</>}
    </div>}

    {step===2&&<div style={{background:'var(--white)',padding:20}}>
      <h2 style={{fontSize:18,fontWeight:800,marginBottom:18,color:'var(--text)'}}>Elige profesional</h2>
      <div style={{display:'flex',gap:12,overflowX:'auto',paddingBottom:6}}>
        {(time?stys.filter(s=>getSlotsForDay(date,s.id,schedules,dayData.bd,dayData.bl,alvaroEffDur(s,svc),salonSchedule,30,timeOff,closures,overrides).includes(time)):stys).map(s=>{const sl=sty?.id===s.id;return<button key={s.id} onClick={()=>setSty(s)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,minWidth:80,background:'none',border:'none',cursor:'pointer',padding:'8px 4px',flexShrink:0}}>
          <div style={{width:64,height:64,borderRadius:32,background:'var(--purple-bg2)',border:sl?'3px solid var(--purple)':'2px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:700,color:'var(--purple)',overflow:'hidden',transition:'all .2s',boxShadow:sl?'0 4px 16px rgba(105,107,198,0.32)':'none'}}>
            {s.photo_url?<img src={s.photo_url} alt={s.name} style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>:s.name[0]}
          </div>
          <span style={{fontSize:12,fontWeight:sl?700:500,color:sl?'var(--purple)':'var(--text2)',textAlign:'center'}}>{s.name}</span>
          {sl&&<div style={{width:6,height:6,borderRadius:3,background:'var(--purple)'}}/>}
        </button>})}
      </div>
    </div>}

    {step===1&&<div style={{padding:'0 16px'}}>
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
            const dk=toK(d),sl=date&&toK(date)===dk,past=isP(d)
            const salD=salonSchedule.find(x=>x.day_of_week===d.getDay())
            const closedDay=(salD&&!salD.active)||closures.some(c=>c.start_date<=dk&&dk<=c.end_date)
            const av=monthAvail[dk]
            const avC=av==='green'?'var(--green)':av==='yellow'?'var(--yellow)':av==='orange'?'var(--orange)':null
            return<button key={dk} onClick={()=>!past&&!closedDay&&setDate(d)} disabled={past||closedDay} style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,height:46,borderRadius:10,border:'none',cursor:past||closedDay?'default':'pointer',background:sl?'linear-gradient(135deg,var(--purple),var(--purple-l))':isT(d)?'var(--purple-bg)':'transparent',opacity:past||closedDay?0.22:1,transition:'all .15s'}}>
              <span style={{fontSize:12,fontWeight:sl||isT(d)?700:400,color:sl?'#fff':'var(--text)',lineHeight:1}}>{d.getDate()}</span>
              {avC&&!past&&!closedDay&&<div style={{width:18,height:3,borderRadius:2,background:sl?'rgba(255,255,255,0.65)':avC}}/>}
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
            {slots.map(s=><button key={s} onClick={()=>setTime(s)} style={{padding:'10px 6px',borderRadius:12,border:time===s?'none':'1.5px solid var(--border)',background:time===s?'linear-gradient(135deg,var(--purple),var(--purple-l))':'var(--white)',color:time===s?'#fff':'var(--text)',fontSize:13,fontWeight:time===s?700:500,cursor:'pointer',fontFamily:'inherit',boxShadow:time===s?'0 4px 12px rgba(105,107,198,0.30)':'none',transition:'all .15s'}}>{s}</button>)}
          </div>}
      </div>}

      {date&&time&&<div style={{background:'var(--white)',borderRadius:18,border:'1.5px solid var(--border)',padding:16,boxShadow:'var(--shadow)'}}>
        <label style={{fontSize:13,fontWeight:600,marginBottom:8,display:'block',color:'var(--text)'}}>Nota (opcional)</label>
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Ej: foto de referencia, alergias..." rows={3} style={{width:'100%',padding:'10px 12px',fontSize:13,border:'1px solid var(--border2)',borderRadius:10,background:'var(--bg)',color:'var(--text)',fontFamily:'inherit'}}/>
      </div>}
    </div>}

    <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'rgba(255,255,255,0.94)',backdropFilter:'blur(14px)',borderTop:'1px solid var(--border)',padding:'12px 20px 20px',zIndex:50}}>
      {bookErr&&<p style={{fontSize:12,color:'var(--red)',marginBottom:8,textAlign:'center',background:'var(--red-bg)',padding:'8px 12px',borderRadius:10,border:'1px solid rgba(239,68,68,0.15)'}}>{bookErr}</p>}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        {svc?<div><p style={{fontSize:12,color:'var(--text3)'}}>1 servicio · {alvaroEffDur(sty,svc)}min</p><p style={{fontSize:20,fontWeight:900,color:'var(--purple)'}}>{Number(svc.price).toFixed(0)}€</p></div>:<div/>}
        <Bt onClick={step===2?confirm:()=>setStep(step+1)} disabled={!can||bk}>{bk?'Reservando...':step===2?'Confirmar reserva':'Continuar'}</Bt>
      </div>
    </div>
  </div>
}

// ═══ ACCOUNT ══════════════════════════════════════════════════════════════════
function Account({user,profile,stys,onBook,onLogout,onBack,onUp}) {
  const [tab,setTab]=useState('upcoming'),[up,setUp]=useState([]),[hist,setHist]=useState([]),[ld,setLd]=useState(true)
  const [cancelling,setCancelling]=useState(null)
  const load=useCallback(async()=>{
    const td=toK(new Date())
    const [{data:u},{data:h}]=await Promise.all([
      supabase.from('appointments').select('*,stylists(name),services(name,price,duration)').eq('user_id',user.id).gte('appointment_date',td).eq('status','confirmed').order('appointment_date'),
      supabase.from('appointments').select('*,stylists(name),services(name,price,duration)').eq('user_id',user.id).or(`appointment_date.lt.${td},status.eq.completed,status.eq.cancelled`).order('appointment_date',{ascending:false}).limit(20),
    ])
    setUp(u||[]);setHist(h||[]);setLd(false)
  },[user.id])
  useEffect(()=>{load()},[load])
  const cancel=async id=>{
    if(cancelling)return
    setCancelling(id)
    const{error}=await supabase.from('appointments').update({status:'cancelled',cancelled_by:'client'}).eq('id',id)
    setCancelling(null)
    if(error){alert('No se pudo cancelar la cita. Inténtalo de nuevo.');return}
    load()
  }
  const setFav=async sid=>{const v=profile?.favorite_stylist_id===sid?null:sid;const{error}=await supabase.from('profiles').update({favorite_stylist_id:v}).eq('id',user.id);if(error)return;onUp({...profile,favorite_stylist_id:v})}
  const togR=async()=>{const v=!profile?.email_reminders;const{error}=await supabase.from('profiles').update({email_reminders:v}).eq('id',user.id);if(error)return;onUp({...profile,email_reminders:v})}
  const ini=(profile?.full_name||'?').split(' ').map(n=>n[0]).join('').toUpperCase()
  if(ld)return<Sp/>
  return <div>
    <div style={{padding:'8px 20px 0'}}><BB onClick={onBack} label="Volver"/></div>
    <div style={{padding:'8px 20px 20px',background:'var(--white)',borderBottom:'1px solid var(--border)'}}>
      <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:16}}>
        <div style={{width:52,height:52,borderRadius:16,background:'linear-gradient(135deg,var(--purple),var(--purple-l))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:800,color:'#fff',boxShadow:'0 4px 14px rgba(105,107,198,0.32)'}}>{ini}</div>
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
            <div style={{display:'flex',justifyContent:'flex-end'}}><Bt small variant="danger" disabled={cancelling===a.id} onClick={()=>cancel(a.id)}>{cancelling===a.id?'Cancelando...':'Cancelar cita'}</Bt></div>
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
function WeeklyScheduleModal({stylist, onClose, onSaved, inline=false}) {
  const DAYS = [1,2,3,4,5,6] // Lun-Sáb
  const DEFAULT_CLOSE = {1:'20:00',2:'20:00',3:'20:00',4:'20:00',5:'20:00',6:'14:00'}

  const [rows, setRows] = useState(DAYS.map(d=>({
    day_of_week: d,
    active: d!==0,
    start_time: '09:00',
    end_time: DEFAULT_CLOSE[d],
    hasBreak:false, break_start:'14:00', break_end:'15:00'
  })))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(()=>{
    supabase.from('stylist_schedules').select('*').eq('stylist_id', stylist.id).then(({data})=>{
      if(data && data.length > 0){
        setRows(DAYS.map(d=>{
          const existing = data.find(r=>r.day_of_week===d)
          return existing
            ? {day_of_week:d, active:existing.active, start_time:existing.start_time.slice(0,5), end_time:existing.end_time.slice(0,5), hasBreak:!!(existing.break_start&&existing.break_end), break_start:existing.break_start?.slice(0,5)||'14:00', break_end:existing.break_end?.slice(0,5)||'15:00'}
            : {day_of_week:d, active:d!==0, start_time:'09:00', end_time:DEFAULT_CLOSE[d], hasBreak:false, break_start:'14:00', break_end:'15:00'}
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
        end_time: row.end_time,
        break_start: row.hasBreak?row.break_start:null,
        break_end: row.hasBreak?row.break_end:null
      }, {onConflict: 'stylist_id,day_of_week'})
    }
    setSaving(false)
    setSaved(true)
    setTimeout(()=>setSaved(false),2500)
    onSaved()
  }

  const allSlots = gS('06:00','23:30')
  const endSlots = h => gS('06:30','24:00').filter(s=>s>h)

  if(!loaded) return inline?<Sp/>:<Modal><Sp/></Modal>

  const content = <>
    {!inline&&<div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
      <div style={{width:36,height:36,borderRadius:10,background:'var(--purple-bg)',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',flexShrink:0}}>
        {stylist.photo_url?<img src={stylist.photo_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:16,fontWeight:700,color:'var(--purple)'}}>{stylist.name[0]}</span>}
      </div>
      <div>
        <div style={{fontSize:16,fontWeight:800,color:'var(--text)'}}>{stylist.name}</div>
        <div style={{fontSize:12,color:'var(--text3)'}}>Horario semanal fijo</div>
      </div>
    </div>}

    <div style={{background:'var(--purple-bg)',borderRadius:10,padding:'10px 12px',margin:inline?'0 0 14px':'14px 0',fontSize:12,color:'var(--purple)',lineHeight:1.5}}>
      💡 Este horario se aplica automáticamente cada semana. Los clientes solo verán huecos dentro de tu turno.
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
          {row.active&&<>
          <div style={{display:'flex',gap:8,padding:'8px 14px 12px',background:'var(--white)',borderTop:'1px solid var(--border)'}}>
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
          </div>
          <div style={{display:'flex',gap:8,padding:'0 14px 12px',background:'var(--white)',alignItems:'center'}}>
            <button onClick={()=>update(row.day_of_week,'hasBreak',!row.hasBreak)} style={{display:'flex',alignItems:'center',gap:5,padding:'6px 12px',borderRadius:8,border:`1.5px solid ${row.hasBreak?'var(--orange)':'var(--border2)'}`,background:row.hasBreak?'var(--orange-bg)':'var(--white)',cursor:'pointer',fontSize:12,fontWeight:700,color:row.hasBreak?'var(--orange)':'var(--text3)',fontFamily:'inherit'}}>☕ {row.hasBreak?'Break':'+ Break'}</button>
            {row.hasBreak&&<>
              <select value={row.break_start} onChange={e=>update(row.day_of_week,'break_start',e.target.value)} style={{flex:1,padding:'8px 10px',fontSize:13,border:'1px solid var(--border2)',borderRadius:8,background:'var(--bg)',color:'var(--text)',fontFamily:'inherit',cursor:'pointer',paddingRight:28}}>{allSlots.map(h=><option key={h} value={h}>{h}</option>)}</select>
              <span style={{fontSize:12,color:'var(--text3)'}}>→</span>
              <select value={row.break_end} onChange={e=>update(row.day_of_week,'break_end',e.target.value)} style={{flex:1,padding:'8px 10px',fontSize:13,border:'1px solid var(--border2)',borderRadius:8,background:'var(--bg)',color:'var(--text)',fontFamily:'inherit',cursor:'pointer',paddingRight:28}}>{endSlots(row.break_start).map(h=><option key={h} value={h}>{h}</option>)}</select>
            </>}
          </div>
          </>}
        </div>
      })}
    </div>

    <div style={{display:'flex',gap:10,marginTop:18,alignItems:'center'}}>
      {!inline&&<Bt variant="secondary" onClick={onClose} style={{flex:1}}>Cancelar</Bt>}
      <Bt onClick={save} disabled={saving} style={{flex:1}}>{saving?'Guardando...':'Guardar horario'}</Bt>
      {inline&&saved&&<span style={{fontSize:13,fontWeight:600,color:'var(--green)'}}>✅ Guardado</span>}
    </div>
  </>

  return inline ? <div>{content}</div> : <Modal>{content}</Modal>
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
      <button onClick={()=>setActive(!active)} style={{width:44,height:24,borderRadius:12,position:'relative',cursor:'pointer',border:'none',background:active?'var(--purple)':'var(--border)',transition:'all .3s',boxShadow:active?'0 2px 8px rgba(105,107,198,0.35)':'none'}}>
        <div style={{width:20,height:20,borderRadius:10,background:'#fff',position:'absolute',top:2,left:active?22:2,transition:'all .3s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
      </button>
    </div>
    <div style={{display:'flex',gap:10,marginTop:8}}>
      <Bt variant="secondary" onClick={onClose} style={{flex:1}}>Cancelar</Bt>
      <Bt onClick={()=>onSave({...data,name,username,role_title:role,photo_url:photo,active})} disabled={!name.trim()} style={{flex:1}}>Guardar</Bt>
    </div>
  </Modal>
}

// ═══ SHARE TAB ════════════════════════════════════════════════════════════════
function ShareTab() {
  const url = window.location.origin
  const [copied, setCopied] = useState(false)
  const [qrErr, setQrErr] = useState(false)

  const copy = async () => {
    try { await navigator.clipboard.writeText(url) } catch { }
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Clocks School · Reserva tu cita', url })
      } catch {}
    } else {
      copy()
    }
  }

  return (
    <div className="anim">
      {/* Título */}
      <div style={{marginBottom:28}}>
        <h2 style={{fontSize:22,fontWeight:900,color:'var(--text)',marginBottom:6}}>Compartir perfil</h2>
        <p style={{fontSize:14,color:'var(--text2)',lineHeight:1.6}}>
          Los clientes pueden reservar contigo en cualquier momento con este enlace.
        </p>
      </div>

      {/* URL */}
      <div style={{background:'var(--bg)',border:'1.5px solid var(--border)',borderRadius:14,padding:'14px 16px',marginBottom:16,fontSize:14,color:'var(--text2)',fontWeight:500,wordBreak:'break-all',letterSpacing:0.1}}>
        {url}
      </div>

      {/* Botones copiar / compartir */}
      <div style={{display:'flex',gap:10,marginBottom:32}}>
        <button onClick={copy} style={{flex:1,padding:'14px 0',borderRadius:14,border:'1.5px solid var(--border2)',background:'var(--white)',cursor:'pointer',fontFamily:'inherit',fontSize:14,fontWeight:700,color:copied?'var(--green)':'var(--text)',display:'flex',alignItems:'center',justifyContent:'center',gap:8,transition:'all .2s',boxShadow:'var(--shadow)'}}>
          {copied
            ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>¡Copiado!</>
            : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar</>}
        </button>
        <button onClick={share} style={{flex:1,padding:'14px 0',borderRadius:14,border:'none',background:'linear-gradient(135deg,var(--purple),var(--purple-l))',cursor:'pointer',fontFamily:'inherit',fontSize:14,fontWeight:700,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',gap:8,boxShadow:'0 4px 16px rgba(105,107,198,0.38)'}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          Compartir enlace
        </button>
      </div>

      {/* Divisor */}
      <div style={{height:1,background:'var(--border)',marginBottom:28}}/>

      {/* QR */}
      <div style={{marginBottom:28}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
          <h3 style={{fontSize:16,fontWeight:800,color:'var(--text)'}}>Código QR de tu perfil</h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h.01M18 14h.01M14 18h.01M18 18h.01M14 21h.01M21 14v7"/></svg>
        </div>
        {!qrErr
          ? <div style={{display:'flex',justifyContent:'center'}}>
              <div style={{background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:20,padding:16,boxShadow:'var(--shadow-md)',display:'inline-block'}}>
                <img
                  src="/images/qr-code.jpg"
                  alt="QR Clocks School"
                  style={{width:200,height:200,objectFit:'contain',display:'block',borderRadius:8}}
                  onError={()=>setQrErr(true)}
                />
              </div>
            </div>
          : <div style={{textAlign:'center',padding:'32px 20px',background:'var(--bg)',borderRadius:16,border:'1.5px dashed var(--border2)'}}>
              <div style={{fontSize:32,marginBottom:8,opacity:0.3}}>📷</div>
              <p style={{fontSize:13,color:'var(--text3)'}}>Añade <strong>qr-code.jpg</strong> en <code>public/images/</code></p>
            </div>}
      </div>

      {/* Tips */}
      <div style={{display:'flex',flexDirection:'column',gap:16}}>
        {[
          {icon:'🌐',title:'Añádelo a tus redes sociales',desc:'Comparte el enlace en tu bio de Instagram, Facebook o Google para que los clientes reserven directamente.'},
          {icon:'💬',title:'Envíalo por mensaje a tus clientes',desc:'Cuando un cliente quiera reservar, mándale el enlace para que elija el horario que más le convenga.'},
        ].map(({icon,title,desc})=>
          <div key={title} style={{display:'flex',gap:14,padding:'14px 16px',background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:16,boxShadow:'var(--shadow)'}}>
            <div style={{fontSize:28,flexShrink:0}}>{icon}</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:4}}>{title}</div>
              <div style={{fontSize:13,color:'var(--text2)',lineHeight:1.55}}>{desc}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══ MODAL SOLICITAR AUSENCIA (profesor) ═══
function MyAbsenceModal({onSubmit,onClose}) {
  const [sd,setSd]=useState(toK(new Date())),[ed,setEd]=useState(toK(new Date()))
  const [allDay,setAllDay]=useState(true),[st,setSt]=useState('09:00'),[et,setEt]=useState('14:00')
  const [type,setType]=useState('vacation'),[reason,setReason]=useState('')
  const [saving,setSaving]=useState(false),[err,setErr]=useState('')
  const valid=ed>=sd&&(allDay||et>st)
  const submit=async()=>{
    setSaving(true);setErr('')
    const e=await onSubmit({start_date:sd,end_date:ed,all_day:allDay,start_time:allDay?null:st,end_time:allDay?null:et,type,reason:reason||null})
    setSaving(false)
    if(e)setErr(e.message||'Error al guardar')
  }
  return <Modal>
    <h3 style={{fontSize:18,fontWeight:800,marginBottom:18,color:'var(--text)'}}>Solicitar ausencia</h3>
    <div style={{display:'flex',gap:10}}>
      <div style={{flex:1}}><In label="Desde" type="date" value={sd} onChange={e=>setSd(e.target.value)}/></div>
      <div style={{flex:1}}><In label="Hasta" type="date" value={ed} onChange={e=>setEd(e.target.value)}/></div>
    </div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
      <span style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>Todo el día</span>
      <button onClick={()=>setAllDay(!allDay)} style={{width:44,height:24,borderRadius:12,position:'relative',cursor:'pointer',border:'none',background:allDay?'var(--purple)':'var(--border)',transition:'all .3s'}}>
        <div style={{width:20,height:20,borderRadius:10,background:'#fff',position:'absolute',top:2,left:allDay?22:2,transition:'all .3s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
      </button>
    </div>
    {!allDay&&<div style={{display:'flex',gap:10}}>
      <div style={{flex:1}}><Sl label="Desde" value={st} onChange={e=>setSt(e.target.value)}>{gS('07:00','22:30').map(h=><option key={h} value={h}>{h}</option>)}</Sl></div>
      <div style={{flex:1}}><Sl label="Hasta" value={et} onChange={e=>setEt(e.target.value)}>{gS('07:30','23:00').map(h=><option key={h} value={h}>{h}</option>)}</Sl></div>
    </div>}
    <Sl label="Tipo" value={type} onChange={e=>setType(e.target.value)}>
      <option value="vacation">🌴 Vacaciones</option>
      <option value="sick">🤒 Baja</option>
      <option value="personal">🙍 Personal</option>
      <option value="other">📝 Otro</option>
    </Sl>
    <In label="Motivo (opcional)" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ej: viaje familiar"/>
    {err&&<p style={{fontSize:12,color:'var(--red)',marginBottom:10}}>{err}</p>}
    <div style={{display:'flex',gap:10,marginTop:8}}>
      <Bt variant="secondary" onClick={onClose} style={{flex:1}}>Cancelar</Bt>
      <Bt onClick={submit} disabled={saving||!valid} style={{flex:1}}>{saving?'Enviando...':'Solicitar'}</Bt>
    </div>
  </Modal>
}

// ═══ ADMIN ════════════════════════════════════════════════════════════════════
function Admin({user,onBack,onDataChanged,salonConfig,onSalonConfigChanged,barberStylistId=null}) {
  const isBarberMode=!!barberStylistId
  const LS_KEY='clocks-admin-stylist'
  const [myStylistId,setMyStylistId]=useState(()=>{
    if(barberStylistId)return barberStylistId
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
  const [allBl,setAllBl]=useState([]) // todos los bloqueos del barbero (modo barber)
  const [myTO,setMyTO]=useState([])           // mis ausencias (modo barber)
  const [showAbsence,setShowAbsence]=useState(false)

  const selectMyStylist=id=>{
    setMyStylistId(id)
    try{if(id)localStorage.setItem(LS_KEY,String(id));else localStorage.removeItem(LS_KEY)}catch{}
    setShowStylistPicker(false)
  }

  const filteredAp = myStylistId ? ap.filter(a=>a.stylist_id===myStylistId) : ap
  const filteredBl = myStylistId ? bl.filter(b=>b.stylist_id===myStylistId) : bl
  const myStylist = st.find(s=>s.id===myStylistId)

  const loadAllBlocks=useCallback(async()=>{
    if(!barberStylistId)return
    const{data}=await supabase.from('blocked_slots').select('*').eq('stylist_id',barberStylistId).gte('blocked_date',toK(new Date())).order('blocked_date').order('start_time')
    setAllBl(data||[])
  },[barberStylistId])

  useEffect(()=>{if(isBarberMode&&tab==='bloqueos')loadAllBlocks()},[tab,isBarberMode,loadAllBlocks])

  const loadMyTimeOff=useCallback(async()=>{
    if(!barberStylistId)return
    const{data}=await supabase.from('time_off').select('*').eq('stylist_id',barberStylistId).gte('end_date',toK(new Date())).order('start_date')
    setMyTO(data||[])
  },[barberStylistId])

  useEffect(()=>{if(isBarberMode&&tab==='ausencias')loadMyTimeOff()},[tab,isBarberMode,loadMyTimeOff])

  const addMyTimeOff=async d=>{
    const{error}=await supabase.from('time_off').insert({...d,stylist_id:barberStylistId,approved:false,created_by:user.id})
    if(!error){setShowAbsence(false);loadMyTimeOff()}
    return error
  }
  const delMyTimeOff=async id=>{await supabase.from('time_off').delete().eq('id',id);loadMyTimeOff()}

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
    const styId=isBarberMode?barberStylistId:bS
    await supabase.from('blocked_slots').insert({stylist_id:styId,blocked_date:bD,start_time:bSt,end_time:bE,reason:bR||'Bloqueado',created_by:user.id})
    setShowBlock(false);setBR('');loadDay(sd);if(isBarberMode)loadAllBlocks()
  }
  const rmBlock=async id=>{await supabase.from('blocked_slots').delete().eq('id',id);loadDay(sd);if(isBarberMode)loadAllBlocks()}
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
          <div style={{width:36,height:36,borderRadius:10,background:'linear-gradient(135deg,var(--purple),var(--purple-l))',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 3px 10px rgba(105,107,198,0.35)'}}>
            <ClockSVG size={20}/>
          </div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:'var(--text)'}}>{isBarberMode?'Mi Panel':' Panel Admin'}</div>
            <div style={{fontSize:10,color:'var(--text3)',letterSpacing:0.3}}>Clocks School</div>
          </div>
        </div>
        <Bt small variant="secondary" onClick={onBack}>← Salir</Bt>
      </div>

      {/* Selector barbero propio — solo para admin completo */}
      {!isBarberMode&&<button onClick={()=>setShowStylistPicker(true)} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:myStylist?'linear-gradient(135deg,var(--purple),var(--purple-l))':'var(--bg)',border:myStylist?'none':'1.5px dashed var(--border2)',borderRadius:12,cursor:'pointer',transition:'all .2s',boxShadow:myStylist?'0 4px 14px rgba(105,107,198,0.28)':'none'}}>
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
      </button>}
    </div>

    {/* Picker barbero */}
    {!isBarberMode&&showStylistPicker&&<Modal>
      <h3 style={{fontSize:18,fontWeight:800,marginBottom:6,color:'var(--text)'}}>¿Quién eres?</h3>
      <p style={{fontSize:13,color:'var(--text3)',marginBottom:18}}>Filtra el calendario con tus citas únicamente</p>
      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
        {st.filter(s=>s.active).map(s=>{
          const sel=myStylistId===s.id
          return<button key={s.id} onClick={()=>selectMyStylist(s.id)} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:12,background:sel?'linear-gradient(135deg,var(--purple),var(--purple-l))':'var(--bg)',border:sel?'none':'1.5px solid var(--border)',cursor:'pointer',transition:'all .2s',boxShadow:sel?'0 4px 14px rgba(105,107,198,0.28)':'none'}}>
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
      {(isBarberMode
        ?[['cal','📅 Calendario'],['horario','🕐 Mi horario'],['bloqueos','🚫 Mis bloqueos'],['ausencias','🌴 Mis ausencias']]
        :[['cal','📅 Calendario'],['team','👤 Equipo'],['svc','✂️ Servicios'],['compartir','🔗 Compartir']]
      ).map(([id,l])=>
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
              return<button key={toK(d)} onClick={()=>setSd(d)} style={{height:30,borderRadius:15,background:sl?'linear-gradient(135deg,var(--purple),var(--purple-l))':'transparent',border:'none',cursor:'pointer',fontSize:11,fontWeight:sl||isT(d)?700:400,color:sl?'#fff':isT(d)?'var(--purple)':'var(--text)',boxShadow:sl?'0 2px 8px rgba(105,107,198,0.3)':'none'}}>{d.getDate()}</button>
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
          {isBarberMode
            ?<div style={{marginBottom:13,padding:'9px 12px',background:'var(--purple-bg)',borderRadius:9,fontSize:13,fontWeight:600,color:'var(--purple)'}}>{myStylist?.name}</div>
            :<Sl label="Profesional" value={bS} onChange={e=>setBS(Number(e.target.value))}>
              {st.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </Sl>}
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
            <div style={{width:36,height:36,borderRadius:10,background:'var(--purple-bg2)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><ServiceIcon name={s.name} size={18}/></div>
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

      {/* ── COMPARTIR ── */}
      {tab==='compartir'&&<ShareTab/>}

      {/* ── MI HORARIO (barber mode) ── */}
      {tab==='horario'&&isBarberMode&&myStylist&&<WeeklyScheduleModal stylist={myStylist} onSaved={()=>{if(onDataChanged)onDataChanged()}} inline/>}
      {tab==='horario'&&isBarberMode&&!myStylist&&<div style={{padding:40,textAlign:'center',color:'var(--text3)'}}>Cargando...</div>}

      {/* ── MIS BLOQUEOS (barber mode) ── */}
      {tab==='bloqueos'&&isBarberMode&&<div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <h2 style={{fontSize:16,fontWeight:700}}>Mis bloqueos</h2>
          <Bt small variant="secondary" onClick={()=>{setBD(toK(sd));setBS(barberStylistId);setShowBlock(true)}}>🚫 Añadir</Bt>
        </div>
        {allBl.length===0&&<Em icon="✅" text="No tienes bloqueos activos"/>}
        {allBl.map(b=><div key={b.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:'var(--red-bg)',border:'1px solid rgba(239,68,68,0.12)',borderRadius:12,marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:700,color:'var(--red)',minWidth:44}}>{b.start_time?.slice(0,5)}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--red)'}}>{b.reason}</div>
            <div style={{fontSize:11,color:'var(--text3)'}}>{new Date(b.blocked_date+'T12:00').toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'})} · {b.start_time?.slice(0,5)}–{b.end_time?.slice(0,5)}</div>
          </div>
          <button onClick={()=>rmBlock(b.id)} style={{fontSize:11,color:'var(--red)',background:'none',border:'1px solid rgba(239,68,68,0.2)',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>Quitar</button>
        </div>)}
      </div>}

      {/* ── MIS AUSENCIAS (barber mode) ── */}
      {tab==='ausencias'&&isBarberMode&&<div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div><h2 style={{fontSize:16,fontWeight:700}}>Mis ausencias</h2><p style={{fontSize:12,color:'var(--text3)'}}>El administrador debe aprobarlas</p></div>
          <Bt small onClick={()=>setShowAbsence(true)}>+ Solicitar</Bt>
        </div>
        {myTO.length===0&&<Em icon="🌴" text="No tienes ausencias próximas"/>}
        {myTO.map(t=>{
          const icon={vacation:'🌴',sick:'🤒',personal:'🙍',other:'📝'}[t.type]||'📝'
          const range=t.start_date===t.end_date?fS(parseDate(t.start_date)):`${fS(parseDate(t.start_date))} – ${fS(parseDate(t.end_date))}`
          return<div key={t.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:'var(--white)',border:'1.5px solid var(--border)',borderRadius:12,marginBottom:8,boxShadow:'var(--shadow)'}}>
            <span style={{fontSize:18}}>{icon}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{range}</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>{t.all_day?'Todo el día':`${t.start_time?.slice(0,5)}–${t.end_time?.slice(0,5)}`}{t.reason?` · ${t.reason}`:''}</div>
            </div>
            <Bg color={t.approved?'var(--green)':'var(--orange)'} bg={t.approved?'var(--green-bg)':'var(--orange-bg)'}>{t.approved?'Aprobada':'Pendiente'}</Bg>
            {!t.approved&&<button onClick={()=>delMyTimeOff(t.id)} style={{fontSize:11,color:'var(--red)',background:'none',border:'1px solid rgba(239,68,68,0.2)',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>Quitar</button>}
          </div>
        })}
        {showAbsence&&<MyAbsenceModal onSubmit={addMyTimeOff} onClose={()=>setShowAbsence(false)}/>}
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
async function subscribePush(userId) {
  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (existing) return

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: import.meta.env.VITE_VAPID_PUBLIC_KEY
    })

    await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      subscription: sub.toJSON()
    }, { onConflict: 'user_id' })
  } catch (e) {
    console.error('Push subscription error:', e)
  }
}
// ═══ MAIN ═════════════════════════════════════════════════════════════════════
export default function App() {
  const [user,setUser]=useState(null),[profile,setProfile]=useState(null)
  const [view,setView]=useState('loading')
  const [svcs,setSvcs]=useState([]),[stys,setStys]=useState([])
  const [lb,setLb]=useState(null),[ps,setPs]=useState(null)
  const [salonConfig,setSalonConfig]=useState(null)
  const [salonSchedule,setSalonSchedule]=useState([])
  const [salonClosures,setSalonClosures]=useState([])
  const [cfTeams,setCfTeams]=useState([])
  const [cfService,setCfService]=useState(null)
  const [landingTab,setLandingTab]=useState(undefined) // pestaña inicial de Landing, solo para el flujo /juventud

  const loadPublic=async()=>{
    const [{data:sv},{data:st},{data:sc},{data:ss},{data:cl},{data:tm},{data:cfsv}]=await Promise.all([
      supabase.from('services').select('*').eq('active',true).eq('player_only',false).order('display_order'),
      supabase.from('stylists').select('*').eq('active',true).order('display_order'),
      supabase.from('salon_config').select('*').limit(1).maybeSingle(),
      supabase.from('salon_schedule').select('*').order('day_of_week'),
      supabase.from('salon_closures').select('start_date,end_date,reason'),
      supabase.from('cf_teams').select('*').eq('active',true).order('display_order'),
      supabase.from('services').select('*').eq('active',true).eq('player_only',true).maybeSingle(),
    ])
    setSvcs(sv||[]);setStys(st||[]);setSalonConfig(sc||null);setSalonSchedule(ss||[]);setSalonClosures(cl||[])
    setCfTeams(tm||[]);setCfService(cfsv||null)
  }

  useEffect(()=>{
    loadPublic()
    const isJuventudPath=window.location.pathname.startsWith('/juventud')
    let recoveryMode=false
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,s)=>{
      if(event==='PASSWORD_RECOVERY'){recoveryMode=true;setView('recovery');return}
      if(s?.user){setUser(s.user);lP(s.user.id)}else{setUser(null);setProfile(null)}
    })
    supabase.auth.getSession().then(async({data:{session}})=>{
      if(recoveryMode)return
      if(session?.user){
        setUser(session.user);subscribePush(session.user.id)
        const prof=await lP(session.user.id)
        if(isJuventudPath&&!['player','admin','barber'].includes(prof?.role)){setView('player-onboarding');return}
        // La pestaña CF Juventud solo existe para player/admin (ver Landing); un
        // barber que llegue por /juventud va a landing normal, sin forzar la pestaña.
        if(isJuventudPath&&['player','admin'].includes(prof?.role)){setLandingTab('juventud')}
        setView('landing');return
      }
      setView(isJuventudPath?'player-onboarding':'landing')
    })
    return()=>subscription.unsubscribe()
  },[])

  const lP=async id=>{const{data}=await supabase.from('profiles').select('*').eq('id',id).single();setProfile(data);return data}
  const hL=u=>{setUser(u);lP(u.id);subscribePush(u.id);if(ps)setView('booking');else setView('landing')}
  const hO=async()=>{await supabase.auth.signOut();setUser(null);setProfile(null);setView('landing')}
  const hR=s=>{setPs(s);if(user)setView('booking');else setView('auth')}
  const isA=profile?.role==='admin'
  const isBarber=profile?.role==='barber'

  const reloadSalonConfig=async()=>{
    const{data}=await supabase.from('salon_config').select('*').limit(1).maybeSingle()
    setSalonConfig(data||null)
  }

  if(view==='loading')return<div style={{maxWidth:480,margin:'0 auto',minHeight:'100vh',background:'var(--white)',display:'flex',alignItems:'center',justifyContent:'center'}}><style>{CSS}</style><Sp/></div>

  return <div style={{maxWidth:480,margin:'0 auto',minHeight:'100vh',background:'var(--bg)',boxShadow:'0 0 60px rgba(83,85,159,0.06)'}}>
    <style>{CSS}</style>
    {view==='recovery'&&<ResetPasswordForm onDone={()=>setView('landing')}/>}
    {view==='landing'&&<Landing svcs={svcs} stys={stys} user={user} profile={profile} isA={isA} isBarber={isBarber} onRes={hR} onLog={()=>setView('auth')} onAcc={()=>setView('account')} onAdm={()=>setView('admin')} onBar={()=>setView('barber')} salonConfig={salonConfig} salonSchedule={salonSchedule} closures={salonClosures} cfTeams={cfTeams} cfService={cfService} initialTab={landingTab}/>}
    {view==='auth'&&<Auth onLogin={hL} onBack={()=>setView('landing')}/>}
    {view==='booking'&&user&&<Booking user={user} profile={profile} svcs={svcs} stys={stys} pre={ps} onDone={b=>{setLb(b);setView('done')}} onBack={()=>setView('landing')} salonSchedule={salonSchedule} closures={salonClosures}/>}
    {view==='account'&&user&&<Account user={user} profile={profile} stys={stys} onBook={()=>{setPs(null);setView('booking')}} onLogout={hO} onBack={()=>setView('landing')} onUp={setProfile}/>}
    {view==='done'&&lb&&<Done bk={lb} onR={()=>setView('landing')}/>}
    {view==='admin'&&user&&isA&&<Admin user={user} onBack={()=>setView('landing')} onDataChanged={loadPublic} salonConfig={salonConfig} onSalonConfigChanged={reloadSalonConfig}/>}
    {view==='barber'&&user&&isBarber&&<Admin user={user} onBack={()=>setView('landing')} onDataChanged={loadPublic} salonConfig={salonConfig} onSalonConfigChanged={reloadSalonConfig} barberStylistId={profile?.stylist_id}/>}
    {view==='player-onboarding'&&<PlayerOnboarding user={user} profile={profile} teams={cfTeams} onDone={()=>{setLandingTab('juventud');setView('landing')}} onLogin={async u=>{setUser(u);await lP(u.id)}}/>}
  </div>
}
