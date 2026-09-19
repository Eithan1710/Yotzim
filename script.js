(function(){
'use strict';

/* ---------- constants ---------- */
const KINDS={
  bar:{e:'🍺',t:'בר',h:38},beach:{e:'🏖️',t:'חוף',h:195},party:{e:'🎉',t:'מסיבה',h:325},
  food:{e:'🍔',t:'אוכל',h:14},movie:{e:'🎬',t:'סרט',h:262},billiard:{e:'🎱',t:'ביליארד',h:170},
  trip:{e:'🌳',t:'טיול',h:95},home:{e:'🏠',t:'בית',h:350},gaming:{e:'🎮',t:'גיימינג',h:235},other:{e:'✏️',t:'אחר',h:215}
};
const TRANSPORT={
  car:{e:'🚗',t:'רכב'},bus:{e:'🚌',t:'אוטובוס'},train:{e:'🚆',t:'רכבת'},
  taxi:{e:'🚕',t:'מונית'},walk:{e:'🚶',t:'הליכה'},unknown:{e:'❓',t:'לא ידוע'}
};
const DAYS=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const PAST_AFTER=3*3600e3; // an outing moves to "past" 3 hours after it starts

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const hhmm=d=>pad(d.getHours())+':'+pad(d.getMinutes());
const ddmm=d=>pad(d.getDate())+'/'+pad(d.getMonth()+1);
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const sod=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
const rid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const LS={
  get(k){try{return localStorage.getItem(k)}catch(e){return null}},
  set(k,v){try{localStorage.setItem(k,v)}catch(e){}}
};
function whenLabel(ts){
  const d=new Date(ts);
  const diff=Math.round((sod(d)-sod(new Date()))/864e5);
  let day;
  if(diff===0)day='היום';
  else if(diff===1)day='מחר';
  else if(diff===-1)day='אתמול';
  else if(diff>1&&diff<7)day=DAYS[d.getDay()];
  else day=ddmm(d);
  return day+' · '+hhmm(d);
}
let toastTimer;
function toast(msg){
  const t=$('#toast');t.textContent=msg;t.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true},2600);
}

/* ---------- identity: just a name, kept in localStorage ---------- */
let me=null;
try{const m=JSON.parse(LS.get('yotz.me')||'null');if(m&&m.name)me={id:m.name,name:m.name}}catch(e){}
const myId=()=>me?me.id:null;

/* ---------- state ---------- */
const state={people:[],events:[],ready:false,mode:null,err:false};
let store=null;

function setEvents(o){
  state.events=Object.entries(o).map(([id,v])=>{
    v=v||{};const rs=Object.create(null);
    if(v.rsvps&&typeof v.rsvps==='object'){
      for(const k in v.rsvps){const s=v.rsvps[k];if(s==='yes'||s==='maybe'||s==='no')rs[k]=s}
    }
    return{id:String(id),kind:has(KINDS,v.kind)?v.kind:'other',place:String(v.place||'').slice(0,80),when:Number(v.when)||0,
      transport:has(TRANSPORT,v.transport)?v.transport:'unknown',rsvps:rs};
  }).filter(e=>e.when);
  // the group = everyone who has answered at least one outing
  const names=new Set();
  state.events.forEach(e=>{for(const n in e.rsvps)names.add(n)});
  state.people=[...names].sort((a,b)=>a.localeCompare(b,'he')).map(n=>({id:n,name:n}));
  state.ready=true;
  render();refreshSheet();
}

/* ---------- writes: one at a time ---------- */
let chain=Promise.resolve();
function enqueue(fn){const p=chain.then(fn);chain=p.catch(()=>{});return p}
function writeFail(e){
  const c=e&&e.code;
  toast(c==='forbidden'?'אין הרשאה. בדקו את ההגדרות ב-Supabase'
    :c==='conflict'?'השם הזה כבר תפוס'
    :'לא נשמר. בדקו חיבור ונסו שוב');
}

/* ---------- storage ---------- */
// The database uses: events(title,type,location,date,time,transport) and participants(event_id,name,status)
const STATUS_OUT={yes:'going',maybe:'maybe',no:'not_going'};
const STATUS_IN={going:'yes',maybe:'maybe',not_going:'no'};
const kindFromLabel=t=>Object.keys(KINDS).find(k=>KINDS[k].t===t)||'other';
const trFromLabel=t=>Object.keys(TRANSPORT).find(k=>TRANSPORT[k].t===t)||'unknown';

// Fallback when config.js is empty: everything stays on this device (for trying the UI in a browser)
function makeLocal(){
  let data={events:{}};
  try{const s=LS.get('yotz.local.v2');if(s)data=JSON.parse(s)}catch(e){}
  if(!data.events)data={events:{}};
  let onE;
  const save=()=>LS.set('yotz.local.v2',JSON.stringify(data));
  const emit=()=>{onE&&onE(data.events)};
  return{
    subscribe(cb){onE=cb;emit()},
    async addEvent(ev){data.events[rid('e')]=ev;save();emit()},
    async setRsvp(id,name,st){const e=data.events[id];if(e){e.rsvps[name]=st;save();emit()}},
    async deleteEvent(id){delete data.events[id];save();emit()},
    async renamePerson(from,to){
      for(const id in data.events){const r=data.events[id].rsvps;if(has(r,from)){r[to]=r[from];delete r[from]}}
      save();emit();
    }
  };
}

function makeSupabase(url,key){
  url=url.replace(/\/+$/,'');
  const H={apikey:key,'Content-Type':'application/json'};
  if(key.indexOf('eyJ')===0)H.Authorization='Bearer '+key;   // legacy JWT-style anon key
  const UP='resolution=merge-duplicates,return=minimal';
  async function api(method,path,body,prefer){
    const headers=Object.assign({},H);if(prefer)headers.Prefer=prefer;
    const r=await fetch(url+'/rest/v1/'+path,{method,headers,body:body?JSON.stringify(body):undefined});
    if(!r.ok){
      const e=new Error('http '+r.status);
      e.code=(r.status===401||r.status===403)?'forbidden':r.status===409?'conflict':'unavailable';
      throw e;
    }
    return(method==='GET'||(prefer&&prefer.indexOf('representation')>=0))?r.json():null;
  }
  let cache={},onE,pending=0,lastSig=null,firstDone=false;
  const emit=()=>onE(cache);
  async function pull(){
    if(pending)return;
    const since=new Date(Date.now()-60*864e5);
    const rows=await api('GET','events?select=*,participants(name,status)&date=gte.'+iso(since)+'&order=date.asc,time.asc');
    if(pending)return;
    const events={};
    rows.forEach(e=>{
      const [y,m,d]=String(e.date).split('-').map(Number),[hh,mm]=String(e.time).split(':').map(Number);
      const rs=Object.create(null);
      (e.participants||[]).forEach(p=>{if(has(STATUS_IN,p.status))rs[p.name]=STATUS_IN[p.status]});
      events[e.id]={kind:kindFromLabel(e.type),place:e.title||e.location,when:new Date(y,m-1,d,hh,mm).getTime(),
        transport:trFromLabel(e.transport),rsvps:rs};
    });
    firstDone=true;
    const sig=JSON.stringify(events);
    if(sig===lastSig)return;
    lastSig=sig;cache=events;emit();
  }
  async function write(opt,fn){
    pending++;
    try{if(opt){opt();lastSig=null;emit()}await fn()}
    catch(e){pending--;pull().catch(()=>{});throw e}
    pending--;await pull().catch(()=>{});
  }
  return{
    subscribe(cb,onErr){
      onE=cb;
      const tick=()=>pull().catch(err=>{if(!firstDone)onErr(err)});
      tick();
      setInterval(()=>{if(!document.hidden)tick()},5000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
      window.addEventListener('focus',tick);
    },
    addEvent:ev=>write(null,async()=>{
      const d=new Date(ev.when);
      const rows=await api('POST','events',{title:ev.place,type:KINDS[ev.kind].t,location:ev.place,
        date:iso(d),time:hhmm(d),transport:TRANSPORT[ev.transport].t},'return=representation');
      const id=rows[0].id;
      await api('POST','participants?on_conflict=event_id,name',
        Object.keys(ev.rsvps).map(n=>({event_id:id,name:n,status:STATUS_OUT[ev.rsvps[n]]})),UP);
    }),
    setRsvp:(id,name,st)=>write(()=>{if(cache[id])cache[id].rsvps[name]=st},
      ()=>api('POST','participants?on_conflict=event_id,name',[{event_id:Number(id),name,status:STATUS_OUT[st]}],UP)),
    deleteEvent:id=>write(()=>{delete cache[id]},
      ()=>api('DELETE','events?id=eq.'+encodeURIComponent(id))),
    renamePerson:(from,to)=>write(null,
      ()=>api('PATCH','participants?name=eq.'+encodeURIComponent(from),{name:to},'return=minimal'))
  };
}
async function makeStore(){
  const c=window.APP_CONFIG||{};
  if(c.SUPABASE_URL&&c.SUPABASE_ANON_KEY){state.mode='supabase';return makeSupabase(c.SUPABASE_URL,c.SUPABASE_ANON_KEY)}
  state.mode='local';return makeLocal();
}

/* ---------- add to home screen (PWA) ---------- */
const UA=navigator.userAgent||'';
const IS_IPAD=/iPad/.test(UA)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const IS_IOS=/iPhone|iPod/.test(UA)||IS_IPAD;
const IS_NATIVE=!!window.Capacitor;   // inside the Capacitor app: no install UI at all
const IS_STANDALONE=navigator.standalone===true||!!(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);
// Real Safari, not Chrome/Firefox/Edge on iOS and not the in-app browsers of Facebook, Instagram etc.
const IS_SAFARI=IS_IOS&&/Safari/.test(UA)&&!/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|MicroMessenger|TikTok|Bytedance|musical_ly|Snapchat|Telegram/.test(UA);
const SAFARI_VER=Number((UA.match(/Version\/(\d+)/)||[0,0])[1]);
let deferredPrompt=null;                       // Android / desktop Chrome & Edge native install prompt
let installed=LS.get('yotz.installed')==='1';
const canShowInstall=()=>!IS_NATIVE&&!IS_STANDALONE;

function installUI(){
  if(!canShowInstall())return '';
  if(installed)return '<div class="inst-done">✓ יוצאים כבר מותקן אצלך</div>';
  if(IS_IOS||deferredPrompt){
    return '<button class="install" data-act="install"><span>📱 הוסף את יוצאים למסך הבית</span><span class="chev" aria-hidden="true">‹</span></button>';
  }
  return '';
}
function markInstalled(){installed=true;LS.set('yotz.installed','1');render()}
async function doInstall(){
  if(deferredPrompt){                          // built-in prompt (Android / desktop)
    const p=deferredPrompt;deferredPrompt=null;
    try{p.prompt();const r=await p.userChoice;if(r&&r.outcome==='accepted')markInstalled()}catch(e){}
    render();return;
  }
  if(IS_IOS)openGuide();                       // iOS has no built-in prompt: show the guide
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;render()});
window.addEventListener('appinstalled',()=>{deferredPrompt=null;markInstalled()});

const SHARE_SVG='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
const gstep=(n,title,vis)=>`<div class="gstep"><div class="gnum">${n}</div><div class="gbody"><div class="gtitle">${title}</div>${vis}</div></div>`;

function guideHTML(){
  const top=`<div class="grab"></div><div class="dhead"><h2 class="dt">הוספה למסך הבית</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>`;
  if(!IS_SAFARI){
    const url=esc(location.href.split('#')[0]);
    return top+`<div class="pad"><p class="gp">כדי להוסיף למסך הבית צריך לפתוח את האתר ב-<b>Safari</b>.</p>`
      +gstep(1,'העתיקו את הקישור',`<input class="txt" readonly value="${url}" aria-label="קישור לאתר"><button class="submit" data-act="copy-link" style="margin-top:12px">העתק קישור</button>`)
      +gstep(2,'פתחו את Safari והדביקו את הקישור בשורת הכתובת','')
      +gstep(3,'חזרו לכאן ותראו את ההוראות המלאות','')
      +`</div>`;
  }
  const isPad=IS_IPAD, new26=SAFARI_VER>=26;
  let v1,t1;
  if(isPad){
    t1='לחצו על כפתור השיתוף (ריבוע עם חץ) בשורה העליונה של Safari';
    v1=`<div class="mock"><span class="dim">‹ ›</span><span class="addr">🔒 יוצאים</span><span class="hl">${SHARE_SVG}</span></div>`;
  }else if(new26){
    t1='לחצו על <b>⋯</b> (שלוש נקודות) ליד שורת הכתובת, ואז על <b>Share (שיתוף)</b>';
    v1=`<div class="mock"><span class="dim">‹</span><span class="addr">🔒 יוצאים</span><span class="hl">⋯</span></div>
        <div class="mock menu"><div class="mrow dim"><span>Copy</span></div><div class="mrow hl"><span>Share</span><span>${SHARE_SVG}</span></div></div>`;
  }else{
    t1='לחצו על כפתור השיתוף: ריבוע עם חץ למעלה, בתחתית המסך';
    v1=`<div class="mock"><span class="dim">‹</span><span class="dim">›</span><span class="hl">${SHARE_SVG}</span><span class="dim">📖</span><span class="dim">⧉</span></div>`;
  }
  const v2=`<div class="mock menu"><div class="mrow dim"><span>Add to Bookmarks</span></div>
      <div class="mrow hl"><span>Add to Home Screen <span class="he">(הוסף למסך הבית)</span></span><span>⊞</span></div>
      <div class="mrow dim"><span>Find on Page</span></div></div>
      <p class="gnote">לא רואים? גללו למטה ברשימה.</p>`;
  const v3=`<div class="mock dlg"><div class="dh"><span class="dim">Cancel</span><span class="hl">Add (הוסף)</span></div>
      <div class="dr"><span class="appic">?</span><span>יוצאים</span></div>
      ${new26?'<div class="dr"><span>Open as Web App</span><span class="tg"></span></div>':''}</div>`;
  const t3=new26?'השאירו את <b>Open as Web App</b> דלוק, ולחצו <b>Add (הוסף)</b> למעלה':'לחצו <b>Add (הוסף)</b> בפינה העליונה';
  return top+`<div class="pad">`
    +gstep(1,t1,v1)+gstep(2,'גללו ובחרו <b>Add to Home Screen</b> (הוסף למסך הבית)',v2)+gstep(3,t3,v3)
    +`<p class="gnote">בפעם הראשונה באפליקציה תכניסו שוב את השם. זה תקין, הכול נשמר בענן.</p>
      <p class="gnote">נכנסתם מתוך וואטסאפ או אפליקציה אחרת? חפשו ״Open in Safari״ (סמל המצפן), פתחו שם ואז חזרו לכאן.</p>
      <button class="submit" data-act="guide-done">הוספתי ✓</button></div>`;
}
function openGuide(){openSheet(guideHTML());view={type:'guide'}}
async function copyLink(){
  const url=location.href.split('#')[0];
  try{await navigator.clipboard.writeText(url);toast('הקישור הועתק')}
  catch(e){toast('לא הצלחנו להעתיק. לחצו והחזיקו על הכתובת')}
}

// First visit on an iPhone/iPad: offer the home-screen install BEFORE asking for a name
const shouldOnboard=()=>IS_IOS&&canShowInstall()&&!installed&&LS.get('yotz.ob')!=='1';
function showOnboarding(){
  LS.set('yotz.ob','1');
  const g=document.createElement('div');g.className='gate';g.id='ob';
  g.innerHTML=`<div class="gin"><div class="brand">יוצאים?</div>
    <div class="q">📱 רוצה לפתוח את יוצאים כמו אפליקציה?</div>
    <p class="obp">בלי להוריד כלום. לוקח כמה שניות.</p>
    <button class="submit" data-act="ob-add">הוסף למסך הבית</button>
    <button class="ob-skip" data-act="ob-skip">לא עכשיו</button></div>`;
  document.body.appendChild(g);
}

/* ---------- views ---------- */
function groups(ev){
  const g={yes:[],maybe:[],no:[],none:[]};
  for(const p of state.people){const s=ev.rsvps[p.id];(s?g[s]:g.none).push(p)}
  return g;
}
const cn=g=>
  `<span class="cnt">🟢 ${g.yes.length} ${g.yes.length===1?'מגיע':'מגיעים'}</span>`+
  `<span class="cnt">🟡 ${g.maybe.length} אולי</span>`+
  `<span class="cnt">⚪ ${g.none.length} עדיין לא ענו</span>`+
  (g.no.length?`<span class="cnt">🔴 ${g.no.length} לא</span>`:'');
const trText=ev=>ev.transport==='unknown'?'':TRANSPORT[ev.transport].e+' '+TRANSPORT[ev.transport].t;
const btns=(ev,my,cls,noLabel)=>[['yes','🟢 אני מגיע'],['maybe','🟡 אולי'],['no','🔴 '+noLabel]]
  .map(([s,l])=>`<button class="${cls}${my===s?' on':''}" data-act="rsvp" data-id="${esc(ev.id)}" data-s="${s}" aria-pressed="${my===s}">${l}</button>`).join('');

function hero(ev){
  const k=KINDS[ev.kind],g=groups(ev),my=ev.rsvps[myId()];
  const names=g.yes.length
    ?g.yes.map(p=>`<span class="nm${me&&p.id===me.id?' me':''}">${esc(p.name)}</span>`).join('')
    :'<span class="none-yet">עוד אף אחד לא אישר. תהיו הראשונים.</span>';
  return `<section class="hero" style="--h:${k.h}">
    <div class="info" data-act="open" data-id="${esc(ev.id)}" role="button" tabindex="0">
      <div class="hrow"><span class="emo">${k.e}</span>${trText(ev)?`<span class="tr">${trText(ev)}</span>`:''}</div>
      <div class="place">${esc(ev.place)}</div>
      <div class="when">${whenLabel(ev.when)}</div>
      <div class="cnts">${cn(g)}</div>
      <div class="names">${names}</div>
    </div>
    <div class="hbtns">${btns(ev,my,'hb','לא')}</div>
  </section>`;
}
function card(ev){
  const k=KINDS[ev.kind],g=groups(ev),my=ev.rsvps[myId()],id=esc(ev.id);
  const pill=my==='maybe'||my==='no'?`<span class="mine ${my}">${my==='maybe'?'🟡 אולי':'🔴 לא מגיע'}</span>`:'';
  const sub=whenLabel(ev.when)+(trText(ev)?' · '+trText(ev):'');
  const action=my==='yes'
    ?`<button class="cbtn done" data-act="open" data-id="${id}">✓ אתה מגיע</button>`
    :`<button class="cbtn" data-act="rsvp" data-id="${id}" data-s="yes">אני מגיע</button>`;
  return `<article class="card" style="--h:${k.h}">
    <div class="info" data-act="open" data-id="${id}" role="button" tabindex="0">
      <div class="crow"><span class="tile">${k.e}</span>
        <div class="ctxt"><div class="cplace">${esc(ev.place)}</div><div class="cwhen">${sub}</div></div>${pill}</div>
      <div class="ccnts">${cn(g)}</div>
    </div>${action}</article>`;
}
function prow(ev){
  const k=KINDS[ev.kind],g=groups(ev);
  return `<button class="prow" data-act="open" data-id="${esc(ev.id)}"><span class="pt">${k.e} ${esc(ev.place)} — ${ddmm(new Date(ev.when))}</span><span class="pc">${g.yes.length} הגיעו</span></button>`;
}
const head=()=>'<header class="top"><h1 class="brand">יוצאים?</h1>'+
  (me?`<button class="who" data-act="rename" aria-label="שינוי שם">👤 ${esc(me.name)}</button>`:'')+'</header>';

function render(){
  const app=$('#app');if(!app)return;
  if(!state.ready){
    app.innerHTML=head()+(state.err
      ?'<div class="msg" style="margin-top:20px">אין גישה ללוח כרגע. נסו לרענן את העמוד.</div>'
      :'<div class="skel" style="margin-top:20px"></div><div class="skel s2"></div>');
    return;
  }
  const now=Date.now();
  const up=state.events.filter(e=>e.when+PAST_AFTER>=now).sort((a,b)=>a.when-b.when);
  const past=state.events.filter(e=>e.when+PAST_AFTER<now).sort((a,b)=>b.when-a.when).slice(0,15);
  let h=head()+installUI()+'<h2 class="sec">🔥 קרוב</h2>';
  if(!up.length){
    h+='<div class="empty-state">אין יציאות קרובות.<br>לחצו על ״+ יציאה״ ופתחו את הראשונה.</div>';
  }else{
    h+=hero(up[0]);
    up.slice(1).forEach(e=>{h+=card(e)});
  }
  if(past.length){h+='<h2 class="sec">🕘 עבר</h2>';past.forEach(e=>{h+=prow(e)})}
  if(state.mode==='local')h+='<p class="note">מצב מקומי: לא מחובר ל-Supabase, הנתונים נשמרים רק במכשיר הזה.</p>';
  app.innerHTML=h;
}

/* ---------- sheets ---------- */
let sheetEl=null,view=null;
function openSheet(html){
  closeSheet(true);
  const root=document.createElement('div');
  root.innerHTML='<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" tabindex="-1"></div>';
  const sh=root.querySelector('.sheet');sh.innerHTML=html;
  document.body.appendChild(root);
  sheetEl=root;
  document.documentElement.classList.add('lock');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{root.classList.add('shown');sh.focus({preventScroll:true})}));
}
function closeSheet(instant){
  if(!sheetEl)return;
  const r=sheetEl;sheetEl=null;view=null;
  document.documentElement.classList.remove('lock');
  if(instant){r.remove();return}
  r.classList.remove('shown');setTimeout(()=>r.remove(),270);
}
function grp(cls,emoji,label,list){
  const pills=list.length
    ?list.map(p=>`<span class="pill ${cls}${me&&p.id===me.id?' me':''}">${esc(p.name)}</span>`).join('')
    :'<span class="dash">—</span>';
  return `<div class="grp"><div class="gh">${emoji} ${label} <span class="n">${list.length}</span></div><div class="pills">${pills}</div></div>`;
}
const delBtn=ev=>`<button class="del" data-act="del" data-id="${esc(ev.id)}">🗑️ מחק יציאה</button>`;
function detailHTML(ev){
  const k=KINDS[ev.kind],g=groups(ev),my=ev.rsvps[myId()],d=new Date(ev.when);
  const isPast=ev.when+PAST_AFTER<Date.now();
  const sub=(isPast?ddmm(d)+' · '+hhmm(d):whenLabel(ev.when))+(trText(ev)?' · '+trText(ev):'');
  let h=`<div class="grab"></div><div class="dhead" style="--h:${k.h}"><span class="tile">${k.e}</span>
    <div class="ctxt"><h2 class="dt">${esc(ev.place)}</h2><div class="cwhen">${sub}</div></div>
    <button class="x" data-act="close" aria-label="סגור">✕</button></div>`;
  if(isPast){
    h+=grp('yes','🟢','הגיעו',g.yes)+delBtn(ev)+'<div class="pad"></div>';
  }else{
    h+=grp('yes','🟢','מגיעים',g.yes)+grp('maybe','🟡','אולי',g.maybe)
      +grp('none','⚪','עדיין לא ענו',g.none)+grp('no','🔴','לא מגיעים',g.no)+delBtn(ev)
      +`<div class="rsvpbar">${btns(ev,my,'sb','לא מגיע')}</div>`;
  }
  return h;
}
function openDetail(id){
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  openSheet(detailHTML(ev));view={type:'detail',id};
}
function refreshSheet(){
  if(!sheetEl||!view||view.type!=='detail')return;
  const ev=state.events.find(e=>e.id===view.id);
  if(!ev){closeSheet();return}
  const sh=sheetEl.querySelector('.sheet'),st=sh.scrollTop;
  sh.innerHTML=detailHTML(ev);sh.scrollTop=st;
}

/* ---------- create form ---------- */
let form=null;
function openForm(){
  if(!state.ready||!me){toast('רגע, הלוח נטען');return}
  const d=new Date(Math.ceil((Date.now()+10*60e3)/(30*60e3))*(30*60e3));
  form={kind:null,transport:'unknown',dm:d.getDate()===new Date().getDate()?'today':'tomorrow'};
  const kinds=Object.entries(KINDS).map(([k,v])=>`<button class="opt" data-act="kind" data-v="${k}"><span class="e">${v.e}</span>${v.t}</button>`).join('');
  const trs=Object.entries(TRANSPORT).map(([k,v])=>`<button class="ch" data-act="tr" data-v="${k}">${v.e} ${v.t}</button>`).join('');
  openSheet(`<div class="grab"></div>
    <div class="dhead"><h2 class="dt">יציאה חדשה</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div class="pad">
      <div class="fl">מה עושים?</div><div class="kinds">${kinds}</div>
      <div class="fl">איפה?</div>
      <input class="txt" id="f-place" maxlength="60" placeholder="לאגר הוד השרון" autocomplete="off" enterkeyhint="done">
      <div class="fl">מתי?</div>
      <div class="row">
        <button class="ch" data-act="dm" data-v="today">היום</button>
        <button class="ch" data-act="dm" data-v="tomorrow">מחר</button>
        <button class="ch" data-act="dm" data-v="custom">📅 תאריך אחר</button>
      </div>
      <div class="dtrow"><input class="txt" type="date" id="f-date" hidden><input class="txt" type="time" id="f-time"></div>
      <div class="fl">איך מגיעים?</div><div class="row">${trs}</div>
      <button class="submit" id="f-submit" data-act="submit" disabled>צור יציאה</button>
    </div>`);
  view={type:'form'};
  $('#f-time').value=hhmm(d);
  $('#f-date').min=iso(new Date());
  syncForm();
}
function syncForm(){
  if(!sheetEl||!form)return;
  const mark=(act,val)=>sheetEl.querySelectorAll('[data-act="'+act+'"]').forEach(b=>{
    const on=b.dataset.v===val;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
  });
  mark('kind',form.kind);mark('dm',form.dm);mark('tr',form.transport);
  $('#f-date').hidden=form.dm!=='custom';
  $('#f-submit').disabled=!(form.kind&&$('#f-place').value.trim());
}
function submitForm(){
  const place=$('#f-place').value.trim();
  if(!form||!form.kind||!place)return;
  const t=($('#f-time').value||'21:00').split(':').map(Number);
  const base=new Date();
  if(form.dm==='tomorrow')base.setDate(base.getDate()+1);
  else if(form.dm==='custom'){
    const dv=$('#f-date').value;
    if(!dv){toast('בחרו תאריך');return}
    const [y,m,d]=dv.split('-').map(Number);base.setFullYear(y,m-1,d);
  }
  base.setHours(t[0],t[1],0,0);
  const when=base.getTime();
  if(when<Date.now()-30*60e3){toast('השעה הזו כבר עברה');return}
  const ev={kind:form.kind,place,when,transport:form.transport,rsvps:{[me.id]:'yes'}};
  closeSheet();
  enqueue(()=>store.addEvent(ev)).then(()=>toast('היציאה נוצרה 🎉')).catch(writeFail);
}

/* ---------- rename / delete ---------- */
function openRename(){
  if(!me)return;
  if(!state.ready){toast('רגע, הלוח נטען');return}
  openSheet(`<div class="grab"></div>
    <div class="dhead"><h2 class="dt">איך קוראים לך?</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div class="pad"><div class="fl"></div>
      <input class="txt" id="r-name" maxlength="20" autocomplete="off" enterkeyhint="done" aria-label="שם">
      <button class="submit" data-act="rename-save">שמור</button></div>`);
  view={type:'rename'};
  $('#r-name').value=me.name;
}
function saveRename(){
  const name=$('#r-name').value.trim().slice(0,20);
  if(!name)return;
  closeSheet();
  if(name===me.name)return;
  const from=me.name;
  enqueue(()=>store.renamePerson(from,name)).then(()=>{
    me={id:name,name};LS.set('yotz.me',JSON.stringify(me));render();toast('השם עודכן');
  }).catch(writeFail);
}
function deleteEvent(el){
  if(!el.dataset.armed){
    el.dataset.armed='1';el.classList.add('armed');el.textContent='בטוחים? לחצו שוב למחיקה';
    setTimeout(()=>{if(el.isConnected){delete el.dataset.armed;el.classList.remove('armed');el.textContent='🗑️ מחק יציאה'}},4000);
    return;
  }
  const id=el.dataset.id;
  closeSheet();
  enqueue(()=>store.deleteEvent(id)).then(()=>toast('היציאה נמחקה')).catch(writeFail);
}

/* ---------- RSVP ---------- */
function setRsvp(id,s){
  const ev=state.events.find(e=>e.id===id);
  if(!ev||!me||ev.rsvps[me.id]===s)return;
  enqueue(()=>store.setRsvp(id,me.id,s)).catch(writeFail);
}

/* ---------- name gate ---------- */
function showGate(){
  const g=document.createElement('div');g.className='gate';g.id='gate';
  g.innerHTML=`<div class="gin"><div class="brand">יוצאים?</div>
    <div class="q">איך קוראים לך?</div>
    <input class="txt" id="g-name" maxlength="20" autocomplete="off" enterkeyhint="go" aria-label="איך קוראים לך?">
    <button class="submit" data-act="gate">המשך</button></div>`;
  document.body.appendChild(g);
}
function submitGate(){
  const inp=$('#g-name'),name=inp.value.trim();
  if(!name){inp.focus();return}
  const nm=name.slice(0,20);me={id:nm,name:nm};
  LS.set('yotz.me',JSON.stringify(me));
  $('#gate').remove();
  render();
}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el)return;
  const a=el.dataset.act,id=el.dataset.id;
  if(a==='rsvp')setRsvp(id,el.dataset.s);
  else if(a==='open')openDetail(id);
  else if(a==='close')closeSheet();
  else if(a==='new')openForm();
  else if(a==='kind'){form.kind=el.dataset.v;syncForm()}
  else if(a==='dm'){
    form.dm=el.dataset.v;
    if(form.dm==='custom'&&!$('#f-date').value)$('#f-date').value=iso(new Date());
    syncForm();
  }
  else if(a==='tr'){form.transport=el.dataset.v;syncForm()}
  else if(a==='submit')submitForm();
  else if(a==='gate')submitGate();
  else if(a==='rename')openRename();
  else if(a==='rename-save')saveRename();
  else if(a==='del')deleteEvent(el);
  else if(a==='install')doInstall();
  else if(a==='copy-link')copyLink();
  else if(a==='guide-done'){markInstalled();closeSheet();toast('מעולה! חפשו את יוצאים במסך הבית')}
  else if(a==='ob-add'){const o=$('#ob');if(o)o.remove();showGate();openGuide()}
  else if(a==='ob-skip'){const o=$('#ob');if(o)o.remove();showGate()}
});
document.addEventListener('input',e=>{if(e.target.id==='f-place')syncForm()});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeSheet();
  if(e.key==='Enter'&&e.target.id==='g-name'){e.preventDefault();submitGate()}
  if(e.key==='Enter'&&e.target.id==='r-name'){e.preventDefault();saveRename()}
  if(e.key==='Enter'&&e.target.id==='f-place'){e.preventDefault();e.target.blur()}
  if((e.key==='Enter'||e.key===' ')&&e.target.getAttribute&&e.target.getAttribute('role')==='button'){e.preventDefault();e.target.click()}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)render()});
setInterval(render,60000);

/* ---------- boot ---------- */
(async function boot(){
  render();
  if(!me){if(shouldOnboard())showOnboarding();else showGate()}
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)&&!IS_NATIVE){
    window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})});
  }
  try{
    store=await makeStore();
    store.subscribe(setEvents,()=>{state.err=true;render()});
  }catch(e){state.err=true;render()}
})();
})();
