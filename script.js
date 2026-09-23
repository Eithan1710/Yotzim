// script.js
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
const PAST_AFTER=3*3600e3;

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
  t.classList.remove('in');void t.offsetWidth;t.classList.add('in');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true},2600);
}

function rideRole(ev,name){
  if(!ev||!name)return null;
  const own=ev.rides.find(r=>r.driver===name);
  if(own)return{type:'driver',ride:own};
  const seat=ev.rides.find(r=>r.passengers.includes(name));
  if(seat)return{type:'passenger',ride:seat};
  return null;
}
function applyRsvpToRides(rides,name,st){
  if(st==='yes'||!Array.isArray(rides))return rides;
  const out=rides.filter(r=>r.driver!==name);
  out.forEach(r=>{r.passengers=r.passengers.filter(p=>p!==name)});
  return out;
}
const RIDE_ERR={
  YZ_ALREADY_PASSENGER:'אתה כבר נוסע ברכב של מישהו אחר',
  YZ_ALREADY_DRIVER:'אתה מוציא רכב ביציאה הזו',
  YZ_OWN_RIDE:'זה הרכב שלך',
  YZ_RIDE_FULL:'אין יותר מקום ברכב הזה',
  YZ_RIDE_NOT_FOUND:'הרכב הזה כבר לא קיים',
  YZ_NOT_GOING:'רק מי שמגיע יכול להיות ברכב',
  YZ_ALREADY_IN_RIDE:'אתה כבר משובץ ברכב אחר',
  YZ_SEATS_TAKEN:'יש ברכב יותר נוסעים ממספר המקומות'
};

/* ---------- identity ---------- */
let me=null;
try{const m=JSON.parse(LS.get('yotz.me')||'null');if(m&&m.name)me={id:m.name,name:m.name}}catch(e){}
const myId=()=>me?me.id:null;

/* ---------- state ---------- */
const state={people:[],events:[],ready:false,mode:null,err:false};
let store=null;
let pendingEventId=null;
try{pendingEventId=new URLSearchParams(location.search).get('event')||null}catch(e){}
function clearDeepLink(){
  pendingEventId=null;
  try{history.replaceState(null,'',location.pathname+location.hash)}catch(e){}
}
function maybeOpenDeepLink(){
  if(!pendingEventId||!me||sheetEl)return;
  if(!state.events.some(e=>e.id===pendingEventId)){
    if(state.fresh){clearDeepLink();toast('היציאה הזו כבר לא קיימת')}
    return;
  }
  const id=pendingEventId;clearDeepLink();
  openDetail(id);
}

function setEvents(o,fresh){
  state.events=Object.entries(o).map(([id,v])=>{
    v=v||{};const rs=Object.create(null);
    if(v.rsvps&&typeof v.rsvps==='object'){
      for(const k in v.rsvps){const s=v.rsvps[k];if(s==='yes'||s==='maybe'||s==='no')rs[k]=s}
    }
    const rides=Array.isArray(v.rides)?v.rides.map(r=>({
      id:String(r.id),driver:String(r.driver||''),seats:Math.max(0,Number(r.seats)||0),
      pickup:String(r.pickup||''),note:String(r.note||''),
      passengers:Array.isArray(r.passengers)?r.passengers.map(String).slice(0,20):[]
    })).filter(r=>r.driver):[];
    return{id:String(id),kind:has(KINDS,v.kind)?v.kind:'other',place:String(v.place||'').slice(0,80),when:Number(v.when)||0,
      transport:has(TRANSPORT,v.transport)?v.transport:'unknown',
      description:String(v.description||'').slice(0,500),by:v.by?String(v.by):null,
      rsvps:rs,rides};
  }).filter(e=>e.when);
  const names=new Set();
  state.events.forEach(e=>{for(const n in e.rsvps)names.add(n)});
  state.people=[...names].sort((a,b)=>a.localeCompare(b,'he')).map(n=>({id:n,name:n}));
  state.ready=true;
  if(fresh)state.fresh=true;
  render();refreshSheet();paintInvite();maybeOpenDeepLink();
}

/* ---------- writes ---------- */
let chain=Promise.resolve();
function enqueue(fn){const p=chain.then(fn);chain=p.catch(()=>{});return p}
function writeFail(e){
  const c=e&&e.code;
  if(e&&e.msg&&RIDE_ERR[e.msg]){toast(RIDE_ERR[e.msg]);return}
  if(e&&e.userMsg){toast(e.userMsg);return}
  toast(c==='forbidden'?'אין הרשאה. בדקו את ההגדרות ב-Supabase'
    :c==='conflict'?'השם הזה כבר תפוס'
    :'לא נשמר. בדקו חיבור ונסו שוב');
}

/* ---------- storage ---------- */
const STATUS_OUT={yes:'going',maybe:'maybe',no:'not_going'};
const STATUS_IN={going:'yes',maybe:'maybe',not_going:'no'};
const kindFromLabel=t=>Object.keys(KINDS).find(k=>KINDS[k].t===t)||'other';
const trFromLabel=t=>Object.keys(TRANSPORT).find(k=>TRANSPORT[k].t===t)||'unknown';

function makeLocal(){
  let data={events:{}};
  try{const s=LS.get('yotz.local.v3');if(s)data=JSON.parse(s)}catch(e){}
  if(!data.events)data={events:{}};
  let onE;
  const save=()=>LS.set('yotz.local.v3',JSON.stringify(data));
  const emit=()=>{onE&&onE(JSON.parse(JSON.stringify(data.events)),true)};
  const err=(msg,code)=>{const e=new Error(msg);e.code=code||'invalid';return e};
  const ridesOf=id=>data.events[id]&&Array.isArray(data.events[id].rides)?data.events[id].rides:(data.events[id]?(data.events[id].rides=[]):null);
  const rule=code=>{const e=err(code);e.msg=code;return e};
  return{
    subscribe(cb){onE=cb;emit()},
    async addEvent(ev){const id=rid('e');data.events[id]={...ev,rides:[]};save();emit();return id},
    async updateEvent(id,patch){const e=data.events[id];if(!e)throw err('not found');Object.assign(e,patch);save();emit()},
    async setRsvp(id,name,st){
      const e=data.events[id];if(!e)return;
      e.rsvps[name]=st;e.rides=applyRsvpToRides(ridesOf(id),name,st);
      save();emit();
    },
    async deleteEvent(id){delete data.events[id];save();emit()},
    async renamePerson(from,to){
      for(const id in data.events){
        const ev=data.events[id],r=ev.rsvps;if(has(r,from)){r[to]=r[from];delete r[from]}
        (ev.rides||[]).forEach(x=>{if(x.driver===from)x.driver=to;x.passengers=x.passengers.map(p=>p===from?to:p)});
      }
      save();emit();
    },
    async createRide(eventId,driver,seats,pickup,note,sw){
      const rs=ridesOf(eventId);if(!rs)throw err('not found');
      if(rs.some(r=>r.driver===driver))throw err('כבר יש לך רכב ביציאה הזו','conflict');
      if(rs.some(r=>r.passengers.includes(driver))){
        if(!sw)throw rule('YZ_ALREADY_PASSENGER');
        rs.forEach(r=>{r.passengers=r.passengers.filter(p=>p!==driver)});
      }
      data.events[eventId].rsvps[driver]='yes';
      rs.push({id:rid('r'),driver,seats:Math.max(0,Math.min(20,Number(seats)||0)),pickup:pickup||'',note:note||'',passengers:[]});
      save();emit();
    },
    async joinRide(eventId,rideId,name,sw){
      let rs=ridesOf(eventId);if(!rs)throw err('not found');
      const ride=rs.find(r=>r.id===rideId);if(!ride)throw rule('YZ_RIDE_NOT_FOUND');
      if(ride.driver===name)throw rule('YZ_OWN_RIDE');
      if(ride.passengers.includes(name))return;
      if(ride.passengers.length>=ride.seats)throw rule('YZ_RIDE_FULL');
      if(rs.some(r=>r.driver===name)){
        if(!sw)throw rule('YZ_ALREADY_DRIVER');
        rs=data.events[eventId].rides=rs.filter(r=>r.driver!==name);
      }
      data.events[eventId].rsvps[name]='yes';
      rs.forEach(r=>{r.passengers=r.passengers.filter(p=>p!==name)});
      ride.passengers.push(name);
      save();emit();
    },
    async leaveRide(eventId,rideId,name){
      const rs=ridesOf(eventId);if(!rs)return;
      const ride=rs.find(r=>r.id===rideId);if(ride)ride.passengers=ride.passengers.filter(p=>p!==name);
      save();emit();
    },
    async deleteRide(eventId,rideId,driver){
      const rs=ridesOf(eventId);if(!rs)return;
      const i=rs.findIndex(r=>r.id===rideId&&r.driver===driver);if(i>=0)rs.splice(i,1);
      save();emit();
    },
    async rateOuting(id, name, rating, feedback){}
  };
}

function makeSupabase(url,key){
  url=url.replace(/\/+$/,'');
  const H={apikey:key,'Content-Type':'application/json'};
  if(key.indexOf('eyJ')===0)H.Authorization='Bearer '+key;
  const UP='resolution=merge-duplicates,return=minimal';
  async function api(method,path,body,prefer){
    const headers=Object.assign({},H);if(prefer)headers.Prefer=prefer;
    const r=await fetch(url+'/rest/v1/'+path,{method,headers,body:body?JSON.stringify(body):undefined});
    if(!r.ok){
      const e=new Error('http '+r.status);
      e.code=(r.status===401||r.status===403)?'forbidden':r.status===409?'conflict':'unavailable';
      try{const j=await r.json();if(j&&j.message){e.msg=String(j.message);if(RIDE_ERR[e.msg])e.code='rule'}}catch(_){}
      throw e;
    }
    return(method==='GET'||(prefer&&prefer.indexOf('representation')>=0))?r.json():null;
  }
  let cache={},onE,pending=0,lastSig=null,firstDone=false;
  const emit=()=>onE(cache,firstDone);
  const findRide=(eventId,rideId)=>{const e=cache[eventId];return e?e.rides.find(r=>String(r.id)===String(rideId)):null};
  async function pull(){
    if(pending)return;
    const since=new Date(Date.now()-60*864e5);
    const rows=await api('GET','events?select=*,participants(name,status),rides(id,driver_name,available_seats,pickup_location,note,ride_passengers(passenger_name))&date=gte.'+iso(since)+'&order=date.asc,time.asc');
    if(pending)return;
    const events={};
    rows.forEach(e=>{
      const [y,m,d]=String(e.date).split('-').map(Number),[hh,mm]=String(e.time).split(':').map(Number);
      const rs=Object.create(null);
      (e.participants||[]).forEach(p=>{if(has(STATUS_IN,p.status))rs[p.name]=STATUS_IN[p.status]});
      const rides=(e.rides||[]).map(r=>({id:r.id,driver:r.driver_name,seats:r.available_seats,
        pickup:r.pickup_location||'',note:r.note||'',passengers:(r.ride_passengers||[]).map(p=>p.passenger_name)}));
      events[e.id]={kind:kindFromLabel(e.type),place:e.title||e.location,when:new Date(y,m-1,d,hh,mm).getTime(),
        transport:trFromLabel(e.transport),description:e.description||'',by:e.created_by||null,rsvps:rs,rides};
    });
    firstDone=true;
    const sig=JSON.stringify(events);
    if(sig===lastSig)return;
    lastSig=sig;cache=events;LS.set('yotz.cache.v1',sig);emit();
  }
  async function write(opt,fn){
    pending++;let out;
    try{if(opt){opt();lastSig=null;emit()}out=await fn()}
    catch(e){pending--;pull().catch(()=>{});throw e}
    pending--;await pull().catch(()=>{});
    return out;
  }
  return{
    subscribe(cb,onErr){
      onE=cb;
      try{const c=JSON.parse(LS.get('yotz.cache.v1')||'null');if(c&&typeof c==='object'){cache=c;emit()}}catch(e){}
      const tick=()=>pull().catch(err=>{if(!firstDone)onErr(err)});
      tick();
      setInterval(()=>{if(!document.hidden)tick()},5000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
      window.addEventListener('focus',tick);
    },
    addEvent:ev=>write(null,async()=>{
      const d=new Date(ev.when);
      const rows=await api('POST','events',{title:ev.place,type:KINDS[ev.kind].t,location:ev.place,
        date:iso(d),time:hhmm(d),transport:TRANSPORT[ev.transport].t,
        description:ev.description||null,created_by:ev.by||null},'return=representation');
      const id=rows[0].id;
      await api('POST','participants?on_conflict=event_id,name',
        Object.keys(ev.rsvps).map(n=>({event_id:id,name:n,status:STATUS_OUT[ev.rsvps[n]]})),UP);
      return String(id);
    }),
    updateEvent:(id,patch)=>write(()=>{if(cache[id])Object.assign(cache[id],patch)},()=>{
      const body={};
      if('place' in patch){body.title=patch.place;body.location=patch.place}
      if('kind'  in patch)body.type=KINDS[patch.kind].t;
      if('when'  in patch){const d=new Date(patch.when);body.date=iso(d);body.time=hhmm(d)}
      if('transport' in patch)body.transport=TRANSPORT[patch.transport].t;
      if('description' in patch)body.description=patch.description||null;
      return api('PATCH','events?id=eq.'+encodeURIComponent(id),body,'return=minimal');
    }),
    setRsvp:(id,name,st)=>write(()=>{if(cache[id]){cache[id].rsvps[name]=st;cache[id].rides=applyRsvpToRides(cache[id].rides,name,st)}},
      ()=>api('POST','participants?on_conflict=event_id,name',[{event_id:Number(id),name,status:STATUS_OUT[st]}],UP)),
    deleteEvent:id=>write(()=>{delete cache[id]},
      ()=>api('DELETE','events?id=eq.'+encodeURIComponent(id))),
    renamePerson:(from,to)=>write(null,
      ()=>api('PATCH','participants?name=eq.'+encodeURIComponent(from),{name:to},'return=minimal')),
    createRide:(eventId,driver,seats,pickup,note,sw)=>write(null,async()=>{
      try{await api('POST','rpc/create_ride',{p_event_id:Number(eventId),p_driver:driver,p_seats:seats,p_pickup:pickup||'',p_note:note||'',p_switch:!!sw})}
      catch(e){if(e.code==='conflict')e.userMsg='כבר יש לך רכב ביציאה הזו';throw e}
    }),
    joinRide:(eventId,rideId,name,sw)=>write(()=>{
      const ev=cache[eventId],ride=findRide(eventId,rideId);if(!ev||!ride)return;
      if(sw)ev.rides=ev.rides.filter(r=>r.driver!==name);
      ev.rides.forEach(r=>{r.passengers=r.passengers.filter(p=>p!==name)});
      ride.passengers.push(name);ev.rsvps[name]='yes';
    },async()=>{
      try{await api('POST','rpc/join_ride',{p_ride_id:Number(rideId),p_passenger:name,p_switch:!!sw})}
      catch(e){if(!e.msg||!RIDE_ERR[e.msg])e.userMsg='לא הצלחנו להצטרף לרכב. נסו שוב';throw e}
    }),
    leaveRide:(eventId,rideId,name)=>write(()=>{const r=findRide(eventId,rideId);if(r)r.passengers=r.passengers.filter(p=>p!==name)},
      ()=>api('POST','rpc/leave_ride',{p_ride_id:Number(rideId),p_passenger:name})),
    deleteRide:(eventId,rideId,driver)=>write(()=>{const e=cache[eventId];if(e)e.rides=e.rides.filter(r=>String(r.id)!==String(rideId))},
      ()=>api('DELETE','rides?id=eq.'+encodeURIComponent(rideId)+'&driver_name=eq.'+encodeURIComponent(driver))),
    rateOuting:(id, name, rating, feedback)=>write(null, 
      ()=>api('POST', 'outing_ratings?on_conflict=event_id,user_name', [{event_id: Number(id), user_name: name, rating: Number(rating), feedback: feedback||null}], 'resolution=merge-duplicates'))
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
const IS_NATIVE=!!window.Capacitor;
const IS_STANDALONE=navigator.standalone===true||!!(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);
const IS_SAFARI=IS_IOS&&/Safari/.test(UA)&&!/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|MicroMessenger|TikTok|Bytedance|musical_ly|Snapchat|Telegram/.test(UA);
const SAFARI_VER=Number((UA.match(/Version\/(\d+)/)||[0,0])[1]);
const IS_ANDROID=/Android/.test(UA);
const IS_MOBILE=IS_IOS||IS_ANDROID;
const IS_ANDROID_INAPP=IS_ANDROID&&/; wv\)|FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|TikTok|Bytedance|Snapchat|Telegram/.test(UA);
const IS_SAMSUNG=IS_ANDROID&&/SamsungBrowser/.test(UA);
const IS_FIREFOX_ANDROID=IS_ANDROID&&/Firefox/.test(UA);
const installLabel=()=>IS_IOS?'📱 הוסף את יוצאים למסך הבית':'📲 התקן את יוצאים כאפליקציה';
let deferredPrompt=null;
let installed=LS.get('yotz.installed')==='1';
const canShowInstall=()=>!IS_NATIVE&&!IS_STANDALONE;

function installUI(){
  if(!canShowInstall())return '';
  if(installed)return '<div class="inst-done">✓ יוצאים כבר מותקן אצלך</div>';
  if(IS_MOBILE||deferredPrompt){
    return '<button class="install" data-act="install"><span>'+installLabel()+'</span><span class="chev" aria-hidden="true">‹</span></button>';
  }
  return '';
}
function markInstalled(){installed=true;LS.set('yotz.installed','1');render()}
async function doInstall(){
  if(deferredPrompt){
    const p=deferredPrompt;deferredPrompt=null;
    try{p.prompt();const r=await p.userChoice;if(r&&r.outcome==='accepted')markInstalled()}catch(e){}
    render();return;
  }
  if(IS_MOBILE)openGuide();
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;render()});
window.addEventListener('appinstalled',()=>{deferredPrompt=null;markInstalled()});

const SHARE_SVG='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
const gstep=(n,title,vis)=>`<div class="gstep"><div class="gnum">${n}</div><div class="gbody"><div class="gtitle">${title}</div>${vis}</div></div>`;

function androidGuideHTML(){
  const top=`<div class="grab"></div><div class="dhead"><h2 class="dt">התקנת האפליקציה</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>`;
  if(IS_ANDROID_INAPP){
    const url=esc(location.href.split('#')[0]);
    return top+`<div class="pad"><p class="gp">כדי להתקין צריך לפתוח את האתר ב-<b>Chrome</b>.</p>`
      +gstep(1,'העתיקו את הקישור',`<input class="txt" readonly value="${url}" aria-label="קישור לאתר"><button class="submit" data-act="copy-link" style="margin-top:12px">העתק קישור</button>`)
      +gstep(2,'פתחו את Chrome והדביקו את הקישור בשורת הכתובת','')
      +gstep(3,'חזרו לכאן ולחצו שוב על ״התקן את יוצאים״','')
      +`</div>`;
  }
  let t1,v1,t2,rows,t3;
  if(IS_SAMSUNG){
    t1='לחצו על <b>☰</b> (תפריט) בתחתית הדפדפן';
    v1='<div class="mock"><span class="addr">🔒 יוצאים</span><span class="hl">☰</span></div>';
    t2='בחרו <b>Add page to</b> ואז <b>Home screen</b> (הוספת דף / מסך הבית)';
    rows='<div class="mrow dim"><span>Bookmarks</span></div><div class="mrow hl"><span>Add page to → Home screen</span><span>⊞</span></div><div class="mrow dim"><span>Settings</span></div>';
    t3='לחצו <b>Add</b> (הוסף)';
  }else if(IS_FIREFOX_ANDROID){
    t1='לחצו על <b>⋮</b> (שלוש נקודות) בפינה של הדפדפן';
    v1='<div class="mock"><span class="addr">🔒 יוצאים</span><span class="hl">⋮</span></div>';
    t2='בחרו <b>Install</b> (התקנה)';
    rows='<div class="mrow dim"><span>Settings</span></div><div class="mrow hl"><span>Install <span class="he">(התקנה)</span></span><span>⊞</span></div><div class="mrow dim"><span>Find in page</span></div>';
    t3='לחצו <b>Add</b> (הוסף)';
  }else{
    t1='לחצו על <b>⋮</b> (שלוש נקודות) בפינה העליונה של הדפדפן';
    v1='<div class="mock"><span class="addr">🔒 יוצאים</span><span class="hl">⋮</span></div>';
    t2='בחרו <b>Install app</b> (התקנת אפליקציה). אם אין, בחרו <b>Add to Home screen</b> (הוספה למסך הבית)';
    rows='<div class="mrow dim"><span>Share…</span></div><div class="mrow hl"><span>Install app <span class="he">(התקנת אפליקציה)</span></span><span>⊞</span></div><div class="mrow dim"><span>Find in page</span></div>';
    t3='לחצו <b>Install</b> (התקנה) ואשרו';
  }
  const v2=`<div class="mock menu">${rows}</div>`;
  const v3=`<div class="mock dlg"><div class="dr"><span class="appic">?</span><span>יוצאים</span></div><div class="dh"><span class="dim">Cancel</span><span class="hl">${IS_SAMSUNG||IS_FIREFOX_ANDROID?'Add':'Install'}</span></div></div>`;
  return top+`<div class="pad">`+gstep(1,t1,v1)+gstep(2,t2,v2)+gstep(3,t3,v3)
    +`<p class="gnote">האתר נפתח בתוך אפליקציה אחרת (למשל וואטסאפ)? פתחו אותו ב-Chrome ואז חזרו לכאן.</p>
      <button class="submit" data-act="guide-done">התקנתי ✓</button></div>`;
}

function guideHTML(){
  if(IS_ANDROID)return androidGuideHTML();
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

const shouldOnboard=()=>IS_MOBILE&&canShowInstall()&&!installed&&LS.get('yotz.ob')!=='1';
function showOnboarding(){
  LS.set('yotz.ob','1');
  const g=document.createElement('div');g.className='gate';g.id='ob';
  g.innerHTML=`<div class="gin"><div class="brand">יוצאים?</div>
    <div class="q">📱 רוצה לפתוח את יוצאים כמו אפליקציה?</div>
    <p class="obp">בלי להוריד כלום. לוקח כמה שניות.</p>
    <button class="submit" data-act="ob-add">${IS_IOS?'הוסף למסך הבית':'התקן אפליקציה'}</button>
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
  .map(([s,l])=>`<button class="${cls}${my===s?' on':''}${my===s&&tapped===ev.id+'|'+s?' pop':''}" data-act="rsvp" data-id="${esc(ev.id)}" data-s="${s}" aria-pressed="${my===s}">${l}</button>`).join('');

function hero(ev){
  const k=KINDS[ev.kind],g=groups(ev),my=ev.rsvps[myId()];
  const names=g.yes.length
    ?g.yes.map(p=>`<span class="nm${me&&p.id===me.id?' me':''}">${esc(p.name)}</span>`).join('')
    :'<span class="none-yet">עוד אף אחד לא אישר. תהיו הראשונים.</span>';
  return `<section class="hero" style="--h:${k.h}">
    <div class="info" data-act="open" data-id="${esc(ev.id)}" role="button" tabindex="0">
      <div class="hrow"><span class="emo">${k.e}</span><span class="hrt">${trText(ev)?`<span class="tr">${trText(ev)}</span>`:''}<button class="hshare" data-act="share" data-id="${esc(ev.id)}" aria-label="שתפו את היציאה">${SHARE_ICON}<span>שתפו</span></button></span></div>
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
  
  const d=new Date(ev.when);
  const diff=Math.round((sod(d)-sod(new Date()))/864e5);
  let relBadge='';
  if(diff>1)relBadge=`<span class="crel">בעוד ${diff} ימים</span>`;
  else if(diff===1)relBadge=`<span class="crel">מחר</span>`;
  else if(diff===0)relBadge=`<span class="crel today">היום</span>`;

  const sub=whenLabel(ev.when)+(trText(ev)?' · '+trText(ev):'');
  const action=my==='yes'
    ?`<button class="cbtn done" data-act="open" data-id="${id}">✓ אתה מגיע</button>`
    :`<button class="cbtn" data-act="rsvp" data-id="${id}" data-s="yes">אני מגיע</button>`;
    
  const goingNames = g.yes.length
    ? `<div class="c-names">${g.yes.map(p=>`<span class="nm-sm${me&&p.id===me.id?' me':''}">${esc(p.name)}</span>`).join('')}</div>`
    : `<div class="c-none">עוד אף אחד לא אישר. תהיו הראשונים.</div>`;

  return `<article class="card" style="--h:${k.h}">
    <div class="info" data-act="open" data-id="${id}" role="button" tabindex="0">
      <div class="crow">
        <span class="tile">${k.e}</span>
        <div class="ctxt">
          <div class="cplace-wrap">
            <div class="cplace">${esc(ev.place)}</div>
            ${pill}
          </div>
          <div class="cwhen">${sub} ${relBadge}</div>
        </div>
      </div>
      <div class="c-going">
        <div class="ccnts">${cn(g)}</div>
        ${goingNames}
      </div>
    </div>${action}</article>`;
}
function prow(ev){
  const k=KINDS[ev.kind],g=groups(ev);
  return `<button class="prow" data-act="open" data-id="${esc(ev.id)}"><span class="pt">${k.e} ${esc(ev.place)} — ${ddmm(new Date(ev.when))}</span><span class="pc">${g.yes.length} הגיעו</span></button>`;
}
const head=()=>'<header class="top"><h1 class="brand">יוצאים?</h1>'+
  '<div style="display:flex;gap:8px">'+
  '<button class="ai-fab" data-act="open-ai">✨ רעיונות</button>'+
  (me?`<button class="who" data-act="rename" aria-label="שינוי שם">👤 ${esc(me.name)}</button>`:'')+'</div></header>';

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

/* ---------- share ---------- */
const SHARE_ICON='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14V3"/><path d="M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const shareBtn=ev=>`<button class="sharebtn" data-act="share" data-id="${esc(ev.id)}">${SHARE_ICON}<span>שתפו את היציאה</span></button>`;

function siteUrl(){
  const c=window.APP_CONFIG&&window.APP_CONFIG.SHARE_URL;
  if(c)return c;
  if(IS_NATIVE||!/^https?:$/.test(location.protocol))return '';
  return location.origin+location.pathname;
}
function eventUrl(id){
  const base=siteUrl();if(!base)return '';
  try{const u=new URL(base,location.href);u.search='';u.hash='';u.searchParams.set('event',id);return u.toString()}
  catch(e){return base+(base.indexOf('?')>=0?'&':'?')+'event='+encodeURIComponent(id)}
}

const SHARE_WHAT={
  bar:'יוצאים לבר',beach:'יורדים לחוף',party:'יוצאים למסיבה',food:'יוצאים לאכול',movie:'הולכים לסרט',
  billiard:'יוצאים לביליארד',trip:'יוצאים לטיול',home:'נפגשים',gaming:'עושים ערב גיימינג',other:'יוצאים'
};
const CLOCKS=['🕛','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚'];
const CTAS=['מי מצטרף? 👀','מי בא? 🙌','מי איתנו? 😎','נו, מי בא? 🔥'];
function listNames(ns){return ns.length<2?ns.join(''):ns.slice(0,-1).join(', ')+' ו'+ns[ns.length-1]}
function hashOf(s){let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))|0;return Math.abs(h)}

function shareText(ev){
  const k=KINDS[ev.kind],d=new Date(ev.when),g=groups(ev);
  const diff=Math.round((sod(d)-sod(new Date()))/864e5),evening=d.getHours()>=17||d.getHours()<4;
  const whenWord=diff===0?(evening?'הערב':'היום'):diff===1?(evening?'מחר בערב':'מחר'):(diff>1&&diff<7)?'ב'+DAYS[d.getDay()]:'ב-'+ddmm(d);
  const lines=[`${k.e} ${whenWord} ${SHARE_WHAT[ev.kind]}!`];
  if(ev.place&&ev.place!==k.t)lines.push('📍 '+ev.place);
  lines.push(`📅 יום ${DAYS[d.getDay()]} ${ddmm(d)} | ${CLOCKS[d.getHours()%12]} ${hhmm(d)}`);
  const desc=(ev.description||'').split('\n')[0].trim();
  if(desc&&desc.length<=90)lines.push('💬 '+desc);

  const going=g.yes.map(p=>p.name),n=going.length,meGoing=!!(me&&ev.rsvps[me.id]==='yes');
  let social='';
  if(n>=4)social=`👥 כבר ${n} מגיעים 🔥`;
  else if(n>=2)social=`👥 ${listNames(going)} כבר מגיעים`;
  else if(n===1)social=meGoing?'🙋 אני כבר בפנים':`👥 ${going[0]} כבר בפנים`;
  const free=ev.rides.reduce((s,r)=>s+Math.max(0,r.seats-r.passengers.length),0);
  const extra=[social,free>0?(free===1?'🚗 נשאר מקום אחד ברכב':`🚗 יש עוד ${free} מקומות ברכב`):''].filter(Boolean);

  const link=eventUrl(ev.id);
  const out=[lines.join('\n')];
  if(extra.length)out.push(extra.join('\n'));
  out.push(CTAS[hashOf(ev.id)%CTAS.length]+(link?'\n'+link:''));
  if(link)out.push('נכנסים ומסמנים אם באים 🚀');
  return out.join('\n\n');
}
async function shareEvent(id){
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  if(navigator.share&&IS_MOBILE){
    try{await navigator.share({text:shareText(ev)});return}
    catch(e){if(e&&e.name==='AbortError')return}
  }
  openShareSheet(ev,false);
}
function shareSheetHTML(ev,justCreated){
  const k=KINDS[ev.kind];
  const head=`<div class="grab"></div><div class="dhead"><h2 class="dt">${justCreated?'היציאה באוויר 🎉':'שיתוף היציאה'}</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>`
    +(justCreated?'<p class="shsub">שלחו לחבורה. מי שלוחץ על הקישור מגיע ישר ליציאה ומסמן אם הוא בא.</p>':'');
  const primary=(navigator.share&&IS_MOBILE)
    ?`<button class="sharebtn big" data-act="share-native" data-id="${esc(ev.id)}">${SHARE_ICON}<span>שתפו עכשיו</span></button>`
    :`<button class="sharebtn big" data-act="share-wa" data-id="${esc(ev.id)}"><span>💬 שלחו בוואטסאפ</span></button>`;
  return head+`<div class="pad">
    <div class="bubble">${esc(shareText(ev)).replace(/https?:\/\/\S+/g,u=>`<span class="lnk" dir="ltr">${u}</span>`).replace(/\n/g,'<br>')}</div>
    ${primary}
    <div class="actrow">
      <button class="actbtn" data-act="copy-msg" data-id="${esc(ev.id)}">📋 העתק הודעה</button>
      <button class="actbtn" data-act="copy-ev-link" data-id="${esc(ev.id)}">🔗 העתק קישור</button>
    </div></div>`;
}
function openShareSheet(ev,justCreated){openSheet(shareSheetHTML(ev,justCreated));view={type:'share',id:ev.id}}
async function shareNative(id){
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  try{await navigator.share({text:shareText(ev)});closeSheet()}catch(e){}
}
function shareWhatsApp(id){
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  const plain=shareText(ev).replace(/[\p{Extended_Pictographic}️‍]/gu,'').split('\n').map(l=>l.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
  window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(plain),'_blank','noopener');
}
async function copyText(text,okMsg){
  try{await navigator.clipboard.writeText(text);toast(okMsg)}
  catch(e){toast('לא הצלחנו להעתיק')}
}

/* ---------- calendar + navigate ---------- */
const CAL_END_AFTER=3*3600e3;
function calendarUrl(ev){
  const start=new Date(ev.when),end=new Date(ev.when+CAL_END_AFTER);
  const f=d=>d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'T'+pad(d.getHours())+pad(d.getMinutes())+'00';
  const back=eventUrl(ev.id);
  const details=[ev.description,back?'פרטים ועדכון סטטוס: '+back:null].filter(Boolean).join('\n\n');
  const p=new URLSearchParams({action:'TEMPLATE',text:ev.place,dates:f(start)+'/'+f(end),details,location:ev.place,ctz:'Asia/Jerusalem'});
  return 'https://calendar.google.com/calendar/render?'+p.toString();
}
const calBtn=ev=>`<a class="actbtn" href="${esc(calendarUrl(ev))}" target="_blank" rel="noopener">📅 הוסף ליומן</a>`;
const navBtn=ev=>`<button class="actbtn" data-act="nav" data-id="${esc(ev.id)}">🗺️ נווט</button>`;
function navHTML(ev){
  const q=encodeURIComponent(ev.place);
  const opts=[
    {e:'🗺️',t:'Google Maps',href:'https://www.google.com/maps/search/?api=1&query='+q},
    {e:'🚗',t:'Waze',href:'https://waze.com/ul?q='+q+'&navigate=yes'}
  ];
  if(IS_IOS)opts.push({e:'🍎',t:'Apple Maps',href:'https://maps.apple.com/?q='+q});
  const rows=opts.map(o=>`<a class="navrow" href="${esc(o.href)}" target="_blank" rel="noopener" data-act="close">
    <span class="nave">${o.e}</span><span>${o.t}</span></a>`).join('');
  return `<div class="grab"></div><div class="dhead"><h2 class="dt">נווט באמצעות</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div class="pad">${rows}</div>`;
}
function openNav(id){
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  openSheet(navHTML(ev));view={type:'nav'};
}

/* ---------- rides ---------- */
function ridesHTML(ev){
  const role=rideRole(ev,myId());
  const myRide=role&&role.type==='passenger'?role.ride:null;
  const myCar =role&&role.type==='driver'?role.ride:null;
  let h='<div class="grp rides"><div class="gh">🚗 רכבים</div>';
  if(myRide){
    h+=`<div class="mystatus">🚗 אתה נוסע עם <b>${esc(myRide.driver)}</b>
      <button class="link-btn" data-act="leave-ride" data-rid="${esc(myRide.id)}">עזוב את הרכב</button></div>`;
  }
  if(!ev.rides.length){
    h+='<p class="dash" style="margin:2px 0 0">עדיין אין רכבים. תהיו הראשונים.</p>';
  }else{
    const list=myCar?[myCar,...ev.rides.filter(r=>r!==myCar)]:ev.rides;
    list.forEach(r=>{
      const free=r.seats-r.passengers.length;
      const isMine=r===myCar,imIn=r===myRide;
      const passHTML=r.passengers.length
        ?r.passengers.map(p=>`<span class="pill yes${me&&p===me.id?' me':''}">${esc(p)}${isMine?`<button class="pillx" data-act="kick" data-rid="${esc(r.id)}" data-name="${esc(p)}" aria-label="הסר את ${esc(p)}">✕</button>`:''}</span>`).join('')
        :'<span class="dash">אין נוסעים עדיין</span>';
      let btn;
      if(isMine)btn=`<button class="del" data-act="del-ride" data-rid="${esc(r.id)}" data-n="${r.passengers.length}">🗑️ בטל את הרכב שלי</button>`;
      else if(imIn)btn='';
      else if(free<=0)btn='<button class="ridebtn" disabled>אין מקומות פנויים</button>';
      else if(myCar)btn=`<button class="ridebtn blocked" data-act="join-blocked" data-rid="${esc(r.id)}" aria-describedby="why-${esc(r.id)}">הצטרף לרכב</button>`;
      else btn=`<button class="ridebtn" data-act="join-ride" data-rid="${esc(r.id)}">${myRide?'עבור לרכב הזה':'הצטרף לרכב'}</button>`;
      h+=`<div class="ride${isMine?' mine':''}${imIn?' in':''}">
        <div class="rhead"><span class="rdrv">🚗 ${esc(r.driver)}${isMine?' <span class="you">(אתה)</span>':''}</span>
          <span class="rseats${free<=0?' full':''}">${free>0?free+' מקומות פנוי'+(free===1?'':'ים'):'מלא'}</span></div>
        ${r.pickup?`<div class="rmeta">📍 ${esc(r.pickup)}</div>`:''}${r.note?`<div class="rmeta">${esc(r.note)}</div>`:''}
        <div class="pills" style="margin-top:8px">${passHTML}</div>
        ${btn}
      </div>`;
    });
  }
  const noCar=state.people.filter(p=>ev.rsvps[p.id]==='yes'&&!rideRole(ev,p.id));
  if(noCar.length)h+=`<div class="nocar"><span class="gh" style="margin-bottom:6px">🚶 ללא רכב</span><div class="pills">${noCar.map(p=>`<span class="pill none${me&&p.id===me.id?' me':''}">${esc(p.name)}</span>`).join('')}</div></div>`;
  if(!myCar){
    h+=myRide
      ?`<button class="ridebtn add blocked" data-act="drive-blocked" data-id="${esc(ev.id)}">🚗 אני מוציא רכב</button>`
      :`<button class="ridebtn add" data-act="ride-form" data-id="${esc(ev.id)}">🚗 אני מוציא רכב</button>`;
  }
  h+='</div>';
  return h;
}

function blockedHTML(ev,kind,rideId){
  const role=rideRole(ev,myId());
  let title,text,go;
  if(kind==='drive'&&role&&role.type==='passenger'){
    title=`אתה כבר נוסע עם ${esc(role.ride.driver)}`;
    text='אי אפשר גם לנסוע ברכב של מישהו וגם להוציא רכב.';
    go=`<button class="submit" data-act="drive-switch" data-id="${esc(ev.id)}">צא מהרכב והוצא רכב</button>`;
  }else if(kind==='join'&&role&&role.type==='driver'){
    const target=ev.rides.find(r=>String(r.id)===String(rideId));if(!target)return '';
    const n=role.ride.passengers.length;
    title='אתה מוציא רכב ביציאה הזו';
    text='אי אפשר גם להוציא רכב וגם לנסוע עם מישהו אחר.'
      +(n?` אם תעבור, הרכב שלך יבוטל ו${n===1?'הנוסע שלך יישאר':'-'+n+' הנוסעים שלך יישארו'} בלי רכב.`:'');
    go=`<button class="submit" data-act="join-switch" data-rid="${esc(target.id)}">בטל את הרכב שלי ועבור ל${esc(target.driver)}</button>`;
  }else return '';
  return `<div class="grab"></div><div class="dhead"><h2 class="dt">${title}</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div class="pad"><p class="why">${text}</p>${go}<button class="cancel wide" data-act="back-detail">השאר כמו שזה</button></div>`;
}
function openBlocked(eventId,kind,rideId){
  const ev=state.events.find(e=>e.id===eventId);if(!ev)return;
  const html=blockedHTML(ev,kind,rideId);
  if(!html){refreshSheet();return}
  openSheet(html);view={type:'blocked',id:eventId};
}

const delBtn=ev=>`<button class="del" data-act="del" data-id="${esc(ev.id)}">🗑️ מחק יציאה</button>`;

/* ---------- Detail & Rating ---------- */
function detailHTML(ev){
  const k=KINDS[ev.kind],g=groups(ev),my=ev.rsvps[myId()],d=new Date(ev.when);
  const isPast=ev.when+PAST_AFTER<Date.now();
  const sub=(isPast?ddmm(d)+' · '+hhmm(d):whenLabel(ev.when))+(trText(ev)?' · '+trText(ev):'');
  const canEdit=!isPast&&me&&(!ev.by||ev.by===me.id);
  let h=`<div class="grab"></div><div class="dhead" style="--h:${k.h}"><span class="tile">${k.e}</span>
    <div class="ctxt"><h2 class="dt">${esc(ev.place)}</h2><div class="cwhen">${sub}</div></div>
    <button class="x" data-act="close" aria-label="סגור">✕</button></div>`;
  if(!isPast)h+=shareBtn(ev)+`<div class="actrow">${navBtn(ev)}${calBtn(ev)}</div>`;
  if(ev.description)h+=`<p class="descr">${esc(ev.description)}</p>`;
  if(isPast){
    h+=grp('yes','🟢','הגיעו',g.yes);
    if(me && ev.rsvps[me.id]==='yes'){
      h+=`<div class="rating-box" id="rating-box-${esc(ev.id)}">
           <div class="gh" style="justify-content:center">⭐ איך הייתה היציאה?</div>
           <div class="stars" data-id="${esc(ev.id)}">
             ${[1,2,3,4,5].map(i=>`<span class="star" data-act="rate-star" data-val="${i}" data-id="${esc(ev.id)}">★</span>`).join('')}
           </div>
           <textarea class="txt area" id="rate-txt-${esc(ev.id)}" placeholder="מה אהבתם / פחות אהבתם? (לא חובה)" style="margin-top:10px;height:70px"></textarea>
           <button class="submit" data-act="submit-rate" data-id="${esc(ev.id)}" style="height:44px;margin-top:12px;font-size:16px">שמור דירוג</button>
         </div>`;
    }
    h+=delBtn(ev)+'<div class="pad"></div>';
  }else{
    h+=grp('yes','🟢','מגיעים',g.yes)+grp('maybe','🟡','אולי',g.maybe)
      +grp('none','⚪','עדיין לא ענו',g.none)+grp('no','🔴','לא מגיעים',g.no)
      +ridesHTML(ev)
      +(canEdit?`<button class="edit" data-act="edit" data-id="${esc(ev.id)}">✏️ ערוך יציאה</button>`:'')
      +delBtn(ev)
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

/* ---------- create / edit form ---------- */
let form=null;
function dayModeOf(when){
  const diff=Math.round((sod(new Date(when))-sod(new Date()))/864e5);
  return diff===0?'today':diff===1?'tomorrow':'custom';
}
function openForm(editEv){
  if(!state.ready||!me){toast('רגע, הלוח נטען');return}
  const editing=!!editEv;
  const d=editing?new Date(editEv.when):new Date(Math.ceil((Date.now()+10*60e3)/(30*60e3))*(30*60e3));
  form={editId:editing?editEv.id:null,
    kind:editing?editEv.kind:null,
    transport:editing?editEv.transport:(has(TRANSPORT,LS.get('yotz.tr'))?LS.get('yotz.tr'):'unknown'),
    dm:editing?dayModeOf(editEv.when):(d.getDate()===new Date().getDate()?'today':'tomorrow')};
  const kinds=Object.entries(KINDS).map(([k,v])=>`<button class="opt" data-act="kind" data-v="${k}"><span class="e">${v.e}</span>${v.t}</button>`).join('');
  const trs=Object.entries(TRANSPORT).map(([k,v])=>`<button class="ch" data-act="tr" data-v="${k}">${v.e} ${v.t}</button>`).join('');
  openSheet(`<div class="grab"></div>
    <div class="dhead"><h2 class="dt">${editing?'עריכת יציאה':'יציאה חדשה'}</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div>
      <div class="fl">מה עושים?</div><div class="kinds">${kinds}</div>
      <div class="fl">איפה?</div>
      <input class="txt" id="f-place" maxlength="60" placeholder="לאגר הוד השרון (לא חובה)" autocomplete="off" enterkeyhint="done" value="${editing?esc(editEv.place):''}">
      <div class="fl">מתי?</div>
      <div class="row">
        <button class="ch" data-act="dm" data-v="today">היום</button>
        <button class="ch" data-act="dm" data-v="tomorrow">מחר</button>
        <button class="ch" data-act="dm" data-v="custom">📅 תאריך אחר</button>
      </div>
      <div class="row" style="margin-top:10px">${['20:00','21:00','22:00'].map(t=>`<button class="ch" data-act="tm" data-v="${t}">${t}</button>`).join('')}</div>
      <div class="dtrow"><input class="txt" type="date" id="f-date" hidden><input class="txt" type="time" id="f-time"></div>
      <div class="fl">איך מגיעים?</div><div class="row">${trs}</div>
      <div class="fl">תיאור (לא חובה)</div>
      <textarea class="txt area" id="f-descr" maxlength="500" placeholder="נפגשים ב-21:30 אצל דניאל, משם ממשיכים לבר…">${editing?esc(editEv.description||''):''}</textarea>
      <div class="formbar">
        ${editing?'<button class="cancel" data-act="close">ביטול</button>':''}
        <button class="submit" id="f-submit" data-act="submit" disabled>${editing?'שמור':'צור יציאה'}</button>
      </div>
    </div>`);
  view={type:'form'};
  $('#f-time').value=hhmm(d);
  $('#f-date').min=iso(new Date());
  if(editing&&form.dm==='custom')$('#f-date').value=iso(d);
  syncForm();
}
function syncForm(){
  if(!sheetEl||!form)return;
  const mark=(act,val)=>sheetEl.querySelectorAll('[data-act="'+act+'"]').forEach(b=>{
    const on=b.dataset.v===val;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
  });
  mark('kind',form.kind);mark('dm',form.dm);mark('tr',form.transport);mark('tm',$('#f-time').value);
  $('#f-date').hidden=form.dm!=='custom';
  $('#f-submit').disabled=!(form.kind&&(form.kind!=='other'\vert{}\vert{}$('#f-place').value.trim()));
}
function submitForm(){
  if(!form||!form.kind)return;
  const place=$('#f-place').value.trim()||(form.kind==='other'?'':KINDS[form.kind].t);
  if(!place)return;
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
  const description=$('#f-descr').value.trim();
  LS.set('yotz.tr',form.transport);
  if(form.editId){
    const id=form.editId;
    closeSheet();
    enqueue(()=>store.updateEvent(id,{kind:form.kind,place,when,transport:form.transport,description}))
      .then(()=>toast('היציאה עודכנה')).catch(writeFail);
  }else{
    const ev={kind:form.kind,place,when,transport:form.transport,description,by:me.id,rsvps:{[me.id]:'yes'}};
    closeSheet();
    enqueue(()=>store.addEvent(ev)).then(id=>{
      celebrate();
      const created=id&&state.events.find(e=>e.id===String(id));
      if(created&&!sheetEl)openShareSheet(created,true);else toast('היציאה נוצרה 🎉');
    }).catch(writeFail);
  }
}
function openEditForm(id){
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  openForm(ev);
}

/* ---------- AI Suggestions ---------- */
function openAISuggestions(){
  openSheet(`<div class="grab"></div>
    <div class="dhead"><h2 class="dt">✨ רעיונות ליציאה</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div class="pad" id="ai-container">
      <div class="fl">איפה? (אפשר כמה)</div>
      <input class="txt" id="ai-loc" placeholder="לדוגמה: תל אביב, הרצליה" autocomplete="off">
      <div class="fl">כמה אנשים?</div>
      <input class="txt" type="number" id="ai-pax" value="7" min="1">
      <div class="fl">גיל ממוצע?</div>
      <input class="txt" type="number" id="ai-age" value="20" min="1">
      <div class="fl">מה מחפשים?</div>
      <textarea class="txt area" id="ai-prefs" placeholder="משהו חברתי עם הרבה אנשים, אווירה טובה..."></textarea>
      <button class="submit" style="margin-top:24px" data-act="fetch-ai">✨ תן לי רעיונות</button>
    </div>`);
  view={type:'ai-suggestions'};
}

async function fetchAISuggestions(){
  const container=$('#ai-container');
  const loc=$('#ai-loc').value.trim(), pax=$('#ai-pax').value, age=$('#ai-age').value, prefs=$('#ai-prefs').value.trim();
  
  container.innerHTML=`<div class="ai-loading"><div class="spinner">✨</div>
    <div>מחפש רעיונות...</div>
    <div style="font-size:14px;opacity:0.8;margin-top:8px">בודק התאמה לחבורה ולמיקום</div></div>`;
  
  try{
    const history = state.events.filter(e=>e.when < Date.now()).slice(0, 5).map(e=>({place:e.place, kind:e.kind}));
    const payload = { location: loc||'לא הוגדר', pax, age, prefs, history };
    const c=window.APP_CONFIG||{};
    if(!c.SUPABASE_URL) throw new Error('No backend');
    const res = await fetch(c.SUPABASE_URL+'/functions/v1/ai-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+c.SUPABASE_ANON_KEY },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error('API Error');
    const data = await res.json();
    let html='';
    (data.recommendations||[]).forEach((r, i)=>{
      const rStr = encodeURIComponent(JSON.stringify(r));
      html+=`<div class="ai-card">
        <h3>${esc(r.name)}</h3>
        <div class="ai-meta">📍 ${esc(r.location)} · ${esc(r.type)} ${r.estimated_cost?' · ₪ '+esc(r.estimated_cost):''}</div>
        <div class="ai-desc">${esc(r.description)}</div>
        <div class="ai-why">✨ <b>למה זה מתאים?</b><br>${esc(r.why_it_fits)}</div>
        <div class="actrow" style="margin-top:14px">
          <button class="actbtn" data-act="create-ai" data-rec="${rStr}">➕ צור יציאה</button>
          <a class="actbtn" href="https://waze.com/ul?q=${encodeURIComponent(r.name+' '+r.location)}&navigate=yes" target="_blank">📍 נווט</a>
        </div>
        ${r.sources&&r.sources.length?`<div class="ai-src">מקורות: ${esc(r.sources.join(' · '))}</div>`:''}
      </div>`;
    });
    container.innerHTML=html;
  }catch(e){
    container.innerHTML=`<div class="msg">לא הצלחנו לייצר המלצות כרגע. נסו שוב עוד מעט.</div>
    <button class="submit" data-act="open-ai" style="margin-top:16px">חזור</button>`;
  }
}

function createFromAI(recStr){
  try{
    const r = JSON.parse(decodeURIComponent(recStr));
    openForm();
    setTimeout(()=>{
      const p = $('#f-place'); if(p) p.value = r.name + ' ('+r.location+')';
      const d = $('#f-descr'); if(d) d.value = r.description + '\n\nלמה זה מתאים? ' + r.why_it_fits;
      syncForm();
    },100);
  }catch(e){}
}

/* ---------- ride form ---------- */
let rform=null;
function openRideForm(eventId,sw){
  if(!me)return;
  const ev=state.events.find(e=>e.id===eventId);if(!ev)return;
  const role=rideRole(ev,me.id);
  if(role&&role.type==='driver'){openDetail(eventId);return}
  if(role&&role.type==='passenger'&&!sw){openBlocked(eventId,'drive');return}
  rform={eventId,seats:3,pickup:'',note:'',sw:!!sw};
  const leaving=role&&role.type==='passenger'?`<p class="why">תצא מהרכב של <b>${esc(role.ride.driver)}</b> ותוציא רכב משלך.</p>`:'';
  openSheet(`<div class="grab"></div>
    <div class="dhead"><h2 class="dt">אני מוציא רכב</h2><button class="x" data-act="back-detail" aria-label="סגור">✕</button></div>
    <div>${leaving}
      <div class="fl">כמה מקומות פנויים? (בלי הנהג)</div>
      <div class="stepper">
        <button class="stbtn" data-act="seat-dec" aria-label="פחות מקומות">－</button>
        <span class="stval" id="r-seats">3</span>
        <button class="stbtn" data-act="seat-inc" aria-label="עוד מקומות">＋</button>
      </div>
      <div class="fl">מאיפה יוצאים? (לא חובה)</div>
      <input class="txt" id="r-pickup" maxlength="60" placeholder="לדוגמה: מהקניון" autocomplete="off" enterkeyhint="done">
      <div class="fl">הערה לנוסעים (לא חובה)</div>
      <input class="txt" id="r-note" maxlength="80" placeholder="לדוגמה: יוצא ב-21:00 בדיוק" autocomplete="off" enterkeyhint="done">
      <div class="formbar"><button class="submit" data-act="ride-submit">🚗 הוסף רכב</button></div>
    </div>`);
  view={type:'ride-form',id:eventId};
}
function stepSeats(d){
  if(!rform)return;
  rform.seats=Math.max(1,Math.min(8,rform.seats+d));
  const el=$('#r-seats');if(el)el.textContent=rform.seats;
}
function submitRide(){
  if(!rform||!me)return;
  const pickup=$('#r-pickup').value.trim(),note=$('#r-note').value.trim();
  const {eventId,seats,sw}=rform;rform=null;
  openDetail(eventId);
  enqueue(()=>store.createRide(eventId,me.id,seats,pickup,note,sw))
    .then(()=>{toast('הרכב נוסף 🚗');celebrate()}).catch(writeFail);
}
function joinRide(eventId,rideId,sw){
  if(!me)return;
  const ev=state.events.find(e=>e.id===eventId);if(!ev)return;
  const role=rideRole(ev,me.id),target=ev.rides.find(r=>String(r.id)===String(rideId));
  if(!target)return;
  if(role&&role.type==='driver'&&!sw){openBlocked(eventId,'join',rideId);return}
  const wasGoing=ev.rsvps[me.id]==='yes';
  const msg=role&&role.type==='passenger'?'עברת לרכב של '+target.driver
    :'הצטרפת לרכב של '+target.driver+(wasGoing?'':' · סומנת כמגיע');
  if(!sheetEl||!view||view.type!=='detail')openDetail(eventId);
  enqueue(()=>store.joinRide(eventId,rideId,me.id,sw)).then(()=>{toast(msg);celebrate()}).catch(writeFail);
}
function leaveRide(eventId,rideId){
  if(!me)return;
  enqueue(()=>store.leaveRide(eventId,rideId,me.id)).then(()=>toast('יצאת מהרכב')).catch(writeFail);
}
function kickPassenger(eventId,rideId,name){
  enqueue(()=>store.leaveRide(eventId,rideId,name)).then(()=>toast(name+' הוסר מהרכב')).catch(writeFail);
}
function deleteRide(eventId,el){
  if(!me)return;
  const n=Number(el.dataset.n)||0;
  if(n>0&&!el.dataset.armed){
    el.dataset.armed='1';el.classList.add('armed');
    el.textContent=n===1?'הנוסע שלך יישאר בלי רכב. לחצו שוב':'ה-'+n+' נוסעים שלך יישארו בלי רכב. לחצו שוב';
    setTimeout(()=>{if(el.isConnected){delete el.dataset.armed;el.classList.remove('armed');el.textContent='🗑️ בטל את הרכב שלי'}},4000);
    return;
  }
  enqueue(()=>store.deleteRide(eventId,el.dataset.rid,me.id)).then(()=>toast('הרכב בוטל')).catch(writeFail);
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
let tapped=null;
function setRsvp(id,s){
  const ev=state.events.find(e=>e.id===id);
  if(!ev||!me||ev.rsvps[me.id]===s)return;
  const role=s!=='yes'?rideRole(ev,me.id):null;
  tapped=id+'|'+s;setTimeout(()=>{tapped=null},700);
  if(s==='yes')celebrate();
  enqueue(()=>store.setRsvp(id,me.id,s)).then(()=>{
    if(!role)return;
    if(role.type==='passenger')toast('יצאת מהרכב של '+role.ride.driver);
    else{const n=role.ride.passengers.length;toast(n?'הרכב שלך בוטל · '+(n===1?'הנוסע חזר':n+' נוסעים חזרו')+' לרשימת ״ללא רכב״':'הרכב שלך בוטל')}
  }).catch(writeFail);
}
function celebrate(){try{if(navigator.vibrate)navigator.vibrate(12)}catch(e){}}

/* ---------- name gate ---------- */
function showGate(){
  const g=document.createElement('div');g.className='gate';g.id='gate';
  const invited=!!pendingEventId;
  g.innerHTML=`<div class="gin"><div class="brand">יוצאים?</div>
    ${invited?'<div class="invite" id="invite" hidden></div>':''}
    <div class="q">איך קוראים לך?</div>
    <input class="txt" id="g-name" maxlength="20" autocomplete="off" enterkeyhint="go" aria-label="איך קוראים לך?">
    <button class="submit" data-act="gate">${invited?'כניסה ליציאה':'המשך'}</button></div>`;
  document.body.appendChild(g);
  paintInvite();
}
function paintInvite(){
  const box=$('#invite');if(!box)return;
  const ev=pendingEventId&&state.events.find(e=>e.id===pendingEventId);
  if(!ev){box.hidden=true;return}
  const k=KINDS[ev.kind],n=groups(ev).yes.length;
  box.hidden=false;
  box.innerHTML=`<div class="inv-k">הזמינו אותך 👋</div><div class="inv-t">${k.e} ${esc(ev.place)}</div>
    <div class="inv-w">${esc(whenLabel(ev.when))}${n?' · '+n+' כבר '+(n===1?'מגיע':'מגיעים'):''}</div>`;
}
function submitGate(){
  const inp=$('#g-name'),name=inp.value.trim();
  if(!name){inp.focus();return}
  const nm=name.slice(0,20);me={id:nm,name:nm};
  LS.set('yotz.me',JSON.stringify(me));
  $('#gate').remove();
  render();maybeOpenDeepLink();
}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el)return;
  const a=el.dataset.act,id=el.dataset.id,rid_=el.dataset.rid,name_=el.dataset.name;
  if(a==='rsvp')setRsvp(id,el.dataset.s);
  else if(a==='open')openDetail(id);
  else if(a==='close')closeSheet();
  else if(a==='new')openForm();
  else if(a==='edit')openEditForm(id);
  else if(a==='nav')openNav(id);
  else if(a==='ride-form')openRideForm(id);
  else if(a==='seat-dec'){e.preventDefault();stepSeats(-1)}
  else if(a==='seat-inc'){e.preventDefault();stepSeats(1)}
  else if(a==='ride-submit')submitRide();
  else if(a==='join-ride'){if(view&&view.type==='detail')joinRide(view.id,rid_)}
  else if(a==='leave-ride'){if(view&&view.type==='detail')leaveRide(view.id,rid_)}
  else if(a==='kick'){if(view&&view.type==='detail')kickPassenger(view.id,rid_,name_)}
  else if(a==='del-ride'){if(view&&view.type==='detail')deleteRide(view.id,el)}
  else if(a==='join-blocked'){if(view&&view.type==='detail')openBlocked(view.id,'join',rid_)}
  else if(a==='drive-blocked')openBlocked(id,'drive');
  else if(a==='drive-switch')openRideForm(id,true);
  else if(a==='join-switch'){if(view&&view.type==='blocked')joinRide(view.id,rid_,true)}
  else if(a==='back-detail'){if(view&&view.id)openDetail(view.id);else closeSheet()}
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
  else if(a==='share')shareEvent(id);
  else if(a==='share-native')shareNative(id);
  else if(a==='share-wa')shareWhatsApp(id);
  else if(a==='copy-msg'){const ev=state.events.find(x=>x.id===id);if(ev)copyText(shareText(ev),'ההודעה הועתקה, אפשר להדביק בקבוצה')}
  else if(a==='copy-ev-link')copyText(eventUrl(id)||location.href.split('#')[0],'הקישור הועתק');
  else if(a==='tm'){$('#f-time').value=el.dataset.v;syncForm()}
  else if(a==='install')doInstall();
  else if(a==='copy-link')copyLink();
  else if(a==='guide-done'){markInstalled();closeSheet();toast('מעולה! חפשו את יוצאים במסך הבית')}
  else if(a==='ob-add'){const o=$('#ob');if(o)o.remove();showGate();doInstall()}
  else if(a==='ob-skip'){const o=$('#ob');if(o)o.remove();showGate()}
  else if(a==='open-ai')openAISuggestions();
  else if(a==='fetch-ai')fetchAISuggestions();
  else if(a==='create-ai')createFromAI(el.dataset.rec);
  else if(a==='rate-star'){
    const val = Number(el.dataset.val);
    const box = el.closest('.stars');
    if(box) {
       box.dataset.current = val;
       box.querySelectorAll('.star').forEach(s => s.classList.toggle('on', Number(s.dataset.val) <= val));
    }
  }
  else if(a==='submit-rate'){
     const box = document.querySelector(`.stars[data-id="${id}"]`);
     const val = box ? Number(box.dataset.current) : 0;
     const txt = $(`#rate-txt-${id}`) ? $(`#rate-txt-${id}`).value : '';
     if(!val) return toast('בחרו דירוג (כוכבים)');
     if(!store.rateOuting) return toast('מצב מקומי אינו תומך בדירוג');
     el.disabled = true;
     enqueue(()=>store.rateOuting(id, me.id, val, txt)).then(()=>{
        toast('הדירוג נשמר, תודה!');
        const rbox = $(`#rating-box-${id}`);
        if(rbox) rbox.innerHTML = `<div class="gh" style="justify-content:center;color:var(--yes)">✓ הדירוג נשמר</div>`;
     }).catch(writeFail);
  }
});
document.addEventListener('input',e=>{if(e.target.id==='f-place'||e.target.id==='f-time')syncForm()});
document.addEventListener('change',e=>{if(e.target.id==='f-time')syncForm()});
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
  if(!me){if(shouldOnboard()&&!pendingEventId)showOnboarding();else showGate()}
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)&&!IS_NATIVE){
    window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})});
  }
  try{
    store=await makeStore();
    store.subscribe(setEvents,()=>{state.err=true;render()});
  }catch(e){state.err=true;render()}
})();
})();