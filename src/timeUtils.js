// Helpers de tiempo compartidos entre App.jsx y availability.js
export const toK = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
export const aM = (t,m) => { let[h,mi]=t.split(':').map(Number);mi+=m;while(mi>=60){h++;mi-=60}return`${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}` }
export const gS = (o='09:00',c='20:00',step=30) => { const s=[];let[h,m]=o.split(':').map(Number);const[ch,cm]=c.split(':').map(Number);while(h<ch||(h===ch&&m<cm)){s.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);m+=step;if(m>=60){h++;m-=60}}return s }
