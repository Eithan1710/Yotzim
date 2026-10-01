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
  t.classList.remove('in');void t.offsetWidth;t.classList.add('in');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true},2600);
}

/* ---------- ride rules (same rules as the database, see supabase-migration-v4.sql) ----------
   In one outing a person is exactly one of: driver / passenger in one car / no car.
   Only someone marked "going" can be in a car. */
function rideRole(ev,name){
  if(!ev||!name)return null;
  const own=ev.rides.find(r=>r.driver===name);
  if(own)return{type:'driver',ride:own};
  const seat=ev.rides.find(r=>r.passengers.includes(name));
  if(seat)return{type:'passenger',ride:seat};
  return null;
}
// Mutates an event object (from either store) after `name` changed their RSVP to `st`
function applyRsvpToRides(rides,name,st){
  if(st==='yes'||!Array.isArray(rides))return rides;
  const out=rides.filter(r=>r.driver!==name);                    // a driver who isn't coming: the car is gone
  out.forEach(r=>{r.passengers=r.passengers.filter(p=>p!==name)}); // a passenger who isn't coming: out of the car
  return out;
}
const RULE_ERR={
  YZ_ALREADY_PASSENGER:'אתה כבר נוסע ברכב של מישהו אחר',
  YZ_ALREADY_DRIVER:'אתה מוציא רכב ביציאה הזו',
  YZ_OWN_RIDE:'זה הרכב שלך',
  YZ_RIDE_FULL:'אין יותר מקום ברכב הזה',
  YZ_RIDE_NOT_FOUND:'הרכב הזה כבר לא קיים',
  YZ_NOT_GOING:'רק מי שמגיע יכול להיות ברכב',
  YZ_ALREADY_IN_RIDE:'אתה כבר משובץ ברכב אחר',
  YZ_SEATS_TAKEN:'יש ברכב יותר נוסעים ממספר המקומות',
  YZ_ITEM_TAKEN:'הפריט הזה כבר משובץ למישהו אחר',
  YZ_ITEM_NOT_FOUND:'הפריט הזה כבר לא קיים',
  YZ_NAME_TAKEN:'השם הזה כבר תפוס',YZ_BAD_NAME:'השם לא תקין',YZ_BAD_CODE:'הקוד לא נכון',
  YZ_BAD_INVITE:'הקישור לא תקין או שפג תוקפו',YZ_NO_PROFILE:'צריך קודם לבחור שם',YZ_FORBIDDEN:'אין לך הרשאה לפעולה הזו',
  YZ_DELETE_FORBIDDEN:'רק מי שיצר את היציאה יכול למחוק אותה',YZ_EDIT_FORBIDDEN:'אין לך הרשאה לערוך את היציאה הזו',
  YZ_DAILY_LIMIT:'הגעתם למגבלה של 3 יציאות ביום. אפשר ליצור יציאה נוספת מחר 🌅'
};

/* ---------- identity: just a name, kept in localStorage ---------- */
let me=null;
try{const m=JSON.parse(LS.get('yotz.me')||'null');if(m&&m.name)me={id:m.name,name:m.name}}catch(e){}
const myId=()=>me?me.id:null;

/* ---------- state ---------- */
const state={people:[],events:[],ready:false,mode:null,err:false,avatars:{},groups:[],groupsOk:false,profiles:[],notifications:[],notificationsOk:false};
let metaSig='';
function setMeta(m){
  const sig=JSON.stringify([m.avatars,m.groups,m.profiles,m.notifications]);
  state.groupsOk=!!(m.ok&&m.ok.groups);
  state.notificationsOk=!!(m.ok&&m.ok.notifications);
  if(sig===metaSig)return;
  metaSig=sig;state.avatars=m.avatars||{};state.groups=m.groups||[];state.profiles=m.profiles||[];
  notifyNewOnes(state.notifications,m.notifications||[]);
  state.notifications=m.notifications||[];
  render();refreshSheet();maybeOpenInvite();
}
let store=null;
// a link from a calendar event (?event=123) opens that outing once the board has loaded and a name is set
let pendingEventId=null;
try{pendingEventId=new URLSearchParams(location.search).get('event')||null}catch(e){}
function clearDeepLink(){
  pendingEventId=null;
  try{history.replaceState(null,'',location.pathname+location.hash)}catch(e){}
}
function maybeOpenDeepLink(){
  if(!pendingEventId||!me||sheetEl)return;
  if(!state.events.some(e=>e.id===pendingEventId)){
    // only give up after the server answered (the cached board may simply be older than the link)
    if(state.fresh){clearDeepLink();toast('היציאה הזו כבר לא קיימת')}
    return;
  }
  const id=pendingEventId;clearDeepLink();
  openDetail(id);
}

function cleanRatings(o){
  const out=Object.create(null);
  if(o&&typeof o==='object')for(const k in o){
    const r=o[k],st=Math.round(Number(r&&r.stars));
    if(st>=1&&st<=5)out[k]={stars:st,comment:String((r&&r.comment)||'').slice(0,300)};
  }
  return out;
}
function cleanEquipment(arr){
  if(!Array.isArray(arr))return [];
  return arr.map(x=>({id:String(x&&x.id),name:String((x&&x.name)||'').slice(0,60),
    addedBy:x&&x.addedBy?String(x.addedBy):null,assignedTo:x&&x.assignedTo?String(x.assignedTo):null}))
    .filter(x=>x.name).slice(0,60);
}
// What an outing's info is based on (set only when it was created from an AI idea; never shown as who
// created it - that's always the real person in `by`). Re-validated here too, since this travels through
// the database as plain JSON: only ever real http(s) URLs the AI actually cited, never a guess.
const isHttpUrl=u=>/^https?:\/\//i.test(u||'');
function cleanAiSources(v){
  if(!v||typeof v!=='object')return null;
  const sources=(Array.isArray(v.sources)?v.sources:[]).map(s=>({
    url:String((s&&s.url)||'').slice(0,500),label:s&&s.label?String(s.label).slice(0,40):null,
    quote:s&&s.quote?String(s.quote).slice(0,140):null})).filter(s=>isHttpUrl(s.url)).slice(0,5);
  const eventUrl=isHttpUrl(v.eventUrl)?String(v.eventUrl).slice(0,500):null;
  const eventQuote=eventUrl&&v.eventQuote?String(v.eventQuote).slice(0,140):null;
  return(sources.length||eventUrl)?{sources,eventUrl,eventQuote}:null;
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
      description:String(v.description||'').slice(0,500),by:v.by?String(v.by):null,createdAt:v.createdAt||null,
      aiSources:cleanAiSources(v.aiSources),
      rsvps:rs,rides,ratings:cleanRatings(v.ratings),equipment:cleanEquipment(v.equipment),
      groupIds:Array.isArray(v.groupIds)?v.groupIds.map(String):[],priv:!!v.priv};
  }).filter(e=>e.when);
  // the group = everyone who has answered at least one outing
  const names=new Set();
  state.events.forEach(e=>{for(const n in e.rsvps)names.add(n)});
  state.people=[...names].sort((a,b)=>a.localeCompare(b,'he')).map(n=>({id:n,name:n}));
  state.ready=true;
  if(fresh)state.fresh=true;
  render();refreshSheet();paintInvite();maybeOpenDeepLink();
}

/* ---------- writes: one at a time ---------- */
let chain=Promise.resolve();
function enqueue(fn){const p=chain.then(fn);chain=p.catch(()=>{});return p}
function writeFail(e){
  const c=e&&e.code;
  if(e&&e.msg&&RULE_ERR[e.msg]){toast(RULE_ERR[e.msg]);return}
  if(e&&e.userMsg){toast(e.userMsg);return}
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
  let data={events:{},prefs:{}};
  try{const s=LS.get('yotz.local.v3');if(s)data=JSON.parse(s)}catch(e){}
  if(!data.events)data={events:{},prefs:{}};
  if(!data.prefs)data.prefs={};
  let onE;
  const save=()=>LS.set('yotz.local.v3',JSON.stringify(data));
  const emit=()=>{onE&&onE(JSON.parse(JSON.stringify(data.events)),true)};
  const err=(msg,code)=>{const e=new Error(msg);e.code=code||'invalid';return e};
  const ridesOf=id=>data.events[id]&&Array.isArray(data.events[id].rides)?data.events[id].rides:(data.events[id]?(data.events[id].rides=[]):null);
  const rule=code=>{const e=err(code);e.msg=code;return e};
  const equipOf=id=>data.events[id]&&Array.isArray(data.events[id].equipment)?data.events[id].equipment:(data.events[id]?(data.events[id].equipment=[]):null);
  return{
    subscribe(cb){onE=cb;emit()},
    async addEvent(ev){const id=rid('e');data.events[id]={...ev,rides:[],equipment:[]};save();emit();return id},
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
        if(ev.ratings&&has(ev.ratings,from)){ev.ratings[to]=ev.ratings[from];delete ev.ratings[from]}
      }
      if(has(data.prefs,from)){data.prefs[to]=data.prefs[from];delete data.prefs[from]}
      save();emit();
    },
    async setRating(id,name,stars,comment){
      const e=data.events[id];if(!e)return;
      (e.ratings||(e.ratings={}))[name]={stars,comment:comment||''};save();emit();
    },
    async loadPrefs(){return Object.keys(data.prefs).map(n=>({name:n,tags:data.prefs[n].tags||[],free_text:data.prefs[n].free_text||''}))},
    async savePrefs(name,tags,text){data.prefs[name]={tags,free_text:text||''};save()},
    async createRide(eventId,driver,seats,pickup,note,sw){
      const rs=ridesOf(eventId);if(!rs)throw err('not found');
      if(rs.some(r=>r.driver===driver))throw err('כבר יש לך רכב ביציאה הזו','conflict');
      if(rs.some(r=>r.passengers.includes(driver))){
        if(!sw)throw rule('YZ_ALREADY_PASSENGER');
        rs.forEach(r=>{r.passengers=r.passengers.filter(p=>p!==driver)});
      }
      data.events[eventId].rsvps[driver]='yes';   // driving means you're coming
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
        rs=data.events[eventId].rides=rs.filter(r=>r.driver!==name);   // their own car (and its passengers' seats) is gone
      }
      data.events[eventId].rsvps[name]='yes';     // needing a ride means you're coming
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
    async addEquipmentItem(eventId,name,addedBy){
      const eq=equipOf(eventId);if(!eq)throw err('not found');
      const trimmed=String(name||'').trim().slice(0,40);if(!trimmed)throw err('name required');
      const id=rid('q');eq.push({id,name:trimmed,addedBy:addedBy||null,assignedTo:null});
      save();emit();return id;
    },
    async addEquipmentItems(eventId,names,addedBy){
      const eq=equipOf(eventId);if(!eq)throw err('not found');
      (names||[]).forEach(n=>{const trimmed=String(n||'').trim().slice(0,40);if(trimmed&&eq.length<60)eq.push({id:rid('q'),name:trimmed,addedBy:addedBy||null,assignedTo:null})});
      save();emit();
    },
    async renameEquipmentItem(eventId,itemId,name){
      const eq=equipOf(eventId);if(!eq)return;
      const it=eq.find(x=>x.id===itemId),v=String(name||'').trim().slice(0,40);
      if(it&&v){it.name=v;save();emit()}
    },
    async removeEquipmentItem(eventId,itemId){
      const eq=equipOf(eventId);if(!eq)return;
      const i=eq.findIndex(x=>x.id===itemId);if(i>=0)eq.splice(i,1);
      save();emit();
    },
    async claimEquipment(eventId,itemId,name){
      const eq=equipOf(eventId);if(!eq)return;
      const it=eq.find(x=>x.id===itemId);if(!it)throw rule('YZ_ITEM_NOT_FOUND');
      if(it.assignedTo&&it.assignedTo!==name)throw rule('YZ_ITEM_TAKEN');
      it.assignedTo=name;save();emit();
    },
    async unclaimEquipment(eventId,itemId,name){
      const eq=equipOf(eventId);if(!eq)return;
      const it=eq.find(x=>x.id===itemId);if(it&&it.assignedTo===name)it.assignedTo=null;
      save();emit();
    },
    equipmentOk:()=>true
  };
}

function makeSupabase(url,key){
  url=url.replace(/\/+$/,'');
  const UP='resolution=merge-duplicates,return=minimal';
  /* Identity: every device signs in anonymously (Supabase Auth) and gets a real JWT. The database (RLS) knows who is
     calling from that JWT, so permissions no longer depend on a name the browser claims. No form, no password. */
  const AK='yotz.auth';
  let sess=null;try{sess=JSON.parse(LS.get(AK)||'null')}catch(e){}
  let sessP=null;
  async function authFetch(path,body){
    let r;
    try{r=await fetch(url+'/auth/v1/'+path,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body||{})})}
    catch(e){const x=new Error('offline');x.code='unavailable';throw x}
    if(!r.ok){const x=new Error('auth '+r.status);x.code='auth';x.status=r.status;throw x}
    return r.json();
  }
  const keepSession=j=>{
    sess={access:j.access_token,refresh:j.refresh_token,
      exp:j.expires_at?j.expires_at*1000:Date.now()+(j.expires_in||3600)*1000,uid:(j.user&&j.user.id)||(sess&&sess.uid)||null};
    LS.set(AK,JSON.stringify(sess));return sess;
  };
  function getSession(force){
    if(!force&&sess&&sess.exp-60000>Date.now())return Promise.resolve(sess);
    if(!sessP)sessP=(async()=>{
      try{
        if(sess&&sess.refresh){
          try{return keepSession(await authFetch('token?grant_type=refresh_token',{refresh_token:sess.refresh}))}
          catch(e){if(e.code!=='auth')throw e}   // offline: keep the identity, try again later. Only a refused token starts over.
        }
        return keepSession(await authFetch('signup',{}));
      }finally{sessP=null}
    })();
    return sessP;
  }
  const rpc=(fn,args)=>api('POST','rpc/'+fn,args||{},'return=representation');
  async function api(method,path,body,prefer,retried){
    const s=await getSession();
    const headers={apikey:key,'Content-Type':'application/json',Authorization:'Bearer '+s.access};
    if(prefer)headers.Prefer=prefer;
    const r=await fetch(url+'/rest/v1/'+path,{method,headers,body:body?JSON.stringify(body):undefined});
    if(r.status===401&&!retried){if(sess)sess.exp=0;return api(method,path,body,prefer,true)}
    if(!r.ok){
      const e=new Error('http '+r.status);
      e.code=(r.status===401||r.status===403)?'forbidden':r.status===409?'conflict':'unavailable';
      // rule violations raised by the database (YZ_…) come back as the error message
      try{const j=await r.json();if(j&&j.message){e.msg=String(j.message);if(RULE_ERR[e.msg])e.code='rule'}}catch(_){}
      throw e;
    }
    if(r.status===204)return null;
    return(method==='GET'||(prefer&&prefer.indexOf('representation')>=0))?r.json():null;
  }
  let cache={},onE,onM,pending=0,lastSig=null,firstDone=false,ratingsAvail=true,equipmentAvail=true;
  const emit=()=>onE(cache,firstDone);
  const findRide=(eventId,rideId)=>{const e=cache[eventId];return e?e.rides.find(r=>String(r.id)===String(rideId)):null};
  const findEquip=(eventId,itemId)=>{const e=cache[eventId];return e?e.equipment.find(x=>String(x.id)===String(itemId)):null};
  async function pull(){
    if(pending)return;
    const since=new Date(Date.now()-60*864e5);
    // ratings and equipment each live in their own request: if the matching migration wasn't run yet, the board still works without them
    const ratingsP=api('GET','outing_ratings?select=event_id,rater_name,stars,comment').catch(()=>null);
    const equipP=api('GET','equipment_items?select=id,event_id,name,added_by,assigned_to').catch(()=>null);
    const profP=api('GET','profiles?select=name,avatar_path,avatar_v').catch(()=>null);
    const grpP=api('GET','groups?select=id,name,invite_token,group_members(member_name)').catch(()=>null);
    // RLS scopes this to the signed-in device's own name automatically - no explicit filter needed
    const notifP=api('GET','notifications?select=id,event_id,created_at,read_at&order=created_at.desc&limit=60').catch(()=>null);
    const rows=await api('GET','events?select=*,participants(name,status),event_groups(group_id),rides(id,driver_name,available_seats,pickup_location,note,ride_passengers(passenger_name))&date=gte.'+iso(since)+'&order=date.asc,time.asc');
    if(pending)return;
    const rr=await ratingsP;
    ratingsAvail=rr!==null;
    const rmap={};
    (rr||[]).forEach(x=>{(rmap[x.event_id]||(rmap[x.event_id]=Object.create(null)))[x.rater_name]={stars:x.stars,comment:x.comment||''}});
    const eq=await equipP;
    equipmentAvail=eq!==null;
    const emap={};
    (eq||[]).forEach(x=>{(emap[x.event_id]||(emap[x.event_id]=[])).push({id:x.id,name:x.name,addedBy:x.added_by||null,assignedTo:x.assigned_to||null})});
    const events={};
    rows.forEach(e=>{
      const [y,m,d]=String(e.date).split('-').map(Number),[hh,mm]=String(e.time).split(':').map(Number);
      const rs=Object.create(null);
      (e.participants||[]).forEach(p=>{if(has(STATUS_IN,p.status))rs[p.name]=STATUS_IN[p.status]});
      const rides=(e.rides||[]).map(r=>({id:r.id,driver:r.driver_name,seats:r.available_seats,
        pickup:r.pickup_location||'',note:r.note||'',passengers:(r.ride_passengers||[]).map(p=>p.passenger_name)}));
      events[e.id]={kind:kindFromLabel(e.type),place:e.title||e.location,when:new Date(y,m-1,d,hh,mm).getTime(),
        transport:trFromLabel(e.transport),description:e.description||'',by:e.created_by||null,createdAt:e.created_at||null,
        aiSources:e.ai_sources||null,rsvps:rs,rides,ratings:rmap[e.id]||{},equipment:emap[e.id]||[],
        groupIds:(e.event_groups||[]).map(g=>g.group_id),priv:!!e.is_private};
    });
    firstDone=true;
    // events land in state (via emit/setEvents) before the meta callback runs, so a brand-new outing that
    // just triggered a notification is already in state.events when notifyNewOnes looks it up below
    const sig=JSON.stringify(events);
    if(sig!==lastSig){lastSig=sig;cache=events;LS.set('yotz.cache.v1',sig);emit();}
    if(onM){
      const pr=await profP,gr=await grpP,nt=await notifP,base=url+'/storage/v1/object/public/avatars/';
      const avatars={};(pr||[]).forEach(x=>{if(x.avatar_path)avatars[x.name]=base+encodeURIComponent(x.avatar_path)+'?v='+x.avatar_v});
      const groups=(gr||[]).map(g=>({id:g.id,name:g.name,token:g.invite_token,members:(g.group_members||[]).map(m=>m.member_name)}));
      const notifications=(nt||[]).map(x=>({id:String(x.id),eventId:String(x.event_id),createdAt:x.created_at,readAt:x.read_at}));
      onM({avatars,groups,profiles:(pr||[]).map(x=>x.name),notifications,ok:{avatars:pr!==null,groups:gr!==null,notifications:nt!==null}});
    }
  }
  async function write(opt,fn){
    pending++;let out;
    try{if(opt){opt();lastSig=null;emit()}out=await fn()}
    catch(e){pending--;pull().catch(()=>{});throw e}
    pending--;await pull().catch(()=>{});
    return out;
  }
  return{
    subscribe(cb,onErr,onMeta){
      onE=cb;onM=onMeta;
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
        description:ev.description||null,created_by:ev.by||null,is_private:!!(ev.groupIds&&ev.groupIds.length),
        ai_sources:ev.aiSources||null},'return=representation');
      const id=rows[0].id;
      try{
        // private from the first instant (is_private above); the group links follow. If they fail the outing is removed, never left open.
        if(ev.groupIds&&ev.groupIds.length)await api('POST','event_groups',ev.groupIds.map(g=>({event_id:id,group_id:g})),'return=minimal');
        await api('POST','participants?on_conflict=event_id,name',
          Object.keys(ev.rsvps).map(n=>({event_id:id,name:n,status:STATUS_OUT[ev.rsvps[n]]})),UP);
      }catch(e){try{await api('DELETE','events?id=eq.'+id)}catch(_){}throw e}
      return String(id);
    }),
    updateEvent:(id,patch)=>write(()=>{if(cache[id])Object.assign(cache[id],patch)},()=>{
      const body={};
      if('place' in patch){body.title=patch.place;body.location=patch.place}
      if('kind'  in patch)body.type=KINDS[patch.kind].t;
      if('when'  in patch){const d=new Date(patch.when);body.date=iso(d);body.time=hhmm(d)}
      if('transport' in patch)body.transport=TRANSPORT[patch.transport].t;
      if('description' in patch)body.description=patch.description||null;
      // row-level security turns a forbidden update into "0 rows changed", not an error: check that something really changed
      return api('PATCH','events?id=eq.'+encodeURIComponent(id),body,'return=representation').then(r=>{
        if(!r||!r.length){const e=new Error('forbidden');e.code='forbidden';e.msg='YZ_EDIT_FORBIDDEN';throw e}
      });
    }),
    // Not "going" anymore → the database trigger takes them out of any car (and removes their own car).
    // The same thing is applied to the screen right away so it never shows a seat that no longer exists.
    setRsvp:(id,name,st)=>write(()=>{if(cache[id]){cache[id].rsvps[name]=st;cache[id].rides=applyRsvpToRides(cache[id].rides,name,st)}},
      ()=>api('POST','participants?on_conflict=event_id,name',[{event_id:Number(id),name,status:STATUS_OUT[st]}],UP)),
    deleteEvent:id=>write(()=>{delete cache[id]},
      // same here: only the creator's delete removes a row, and only the server can say so
      ()=>api('DELETE','events?id=eq.'+encodeURIComponent(id),null,'return=representation').then(r=>{
        if(!r||!r.length){const e=new Error('forbidden');e.code='forbidden';e.msg='YZ_DELETE_FORBIDDEN';throw e}
      })),
    /* notifications: created server-side (trigger on a new outing); the client only ever marks them read */
    markNotificationsRead:ids=>write(null,()=>rpc('mark_notifications_read',{p_ids:ids.map(Number)})),
    /* profile: name <-> this device, optional picture, recovery code for a new device */
    claimProfile:name=>rpc('claim_profile',{p_name:name}),
    recoverProfile:(name,code)=>rpc('recover_profile',{p_name:name,p_code:code}),
    getRecoveryCode:()=>rpc('get_recovery_code',{}),
    setAvatar:blob=>write(null,async()=>{
      const s=await getSession(),path=s.uid+'.jpg';
      const r=await fetch(url+'/storage/v1/object/avatars/'+path,{method:'POST',
        headers:{apikey:key,Authorization:'Bearer '+s.access,'Content-Type':'image/jpeg','x-upsert':'true'},body:blob});
      if(!r.ok){const e=new Error('upload '+r.status);e.code='unavailable';throw e}
      await rpc('set_avatar',{p_path:path});
    }),
    clearAvatar:()=>write(null,async()=>{
      await rpc('clear_avatar',{});
      try{const s=await getSession();await fetch(url+'/storage/v1/object/avatars/'+s.uid+'.jpg',{method:'DELETE',headers:{apikey:key,Authorization:'Bearer '+s.access}})}catch(e){}
    }),
    /* groups */
    createGroup:name=>write(null,()=>rpc('create_group',{p_name:name})),
    groupPreview:token=>rpc('group_preview',{p_token:token}),
    joinGroup:token=>write(null,()=>rpc('join_group',{p_token:token})),
    leaveGroup:id=>write(null,()=>rpc('leave_group',{p_group:id})),
    groupsOk:()=>true,
    renamePerson:(from,to)=>write(null,()=>rpc('rename_profile',{p_new:to})),
    ratingsOk:()=>ratingsAvail,
    setRating:(id,name,stars,comment)=>write(()=>{const e=cache[id];if(e){(e.ratings||(e.ratings={}))[name]={stars,comment:comment||''}}},
      ()=>api('POST','outing_ratings?on_conflict=event_id,rater_name',[{event_id:Number(id),rater_name:name,stars,comment:comment||null}],UP)),
    loadPrefs:async()=>{try{return await api('GET','user_prefs?select=name,tags,free_text')}catch(e){return []}},
    savePrefs:(name,tags,text)=>api('POST','user_prefs?on_conflict=name',[{name,tags,free_text:text||null,updated_at:new Date().toISOString()}],UP),
    // sw=true: "switch" (leave the car I'm in and drive / drop my car and ride with someone). Atomic in the database.
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
      catch(e){if(!e.msg||!RULE_ERR[e.msg])e.userMsg='לא הצלחנו להצטרף לרכב. נסו שוב';throw e}
    }),
    leaveRide:(eventId,rideId,name)=>write(()=>{const r=findRide(eventId,rideId);if(r)r.passengers=r.passengers.filter(p=>p!==name)},
      ()=>api('POST','rpc/leave_ride',{p_ride_id:Number(rideId),p_passenger:name})),
    deleteRide:(eventId,rideId,driver)=>write(()=>{const e=cache[eventId];if(e)e.rides=e.rides.filter(r=>String(r.id)!==String(rideId))},
      ()=>api('DELETE','rides?id=eq.'+encodeURIComponent(rideId)+'&driver_name=eq.'+encodeURIComponent(driver))),
    equipmentOk:()=>equipmentAvail,
    addEquipmentItem:(eventId,name,addedBy)=>write(null,()=>
      api('POST','equipment_items',{event_id:Number(eventId),name,added_by:addedBy||null},'return=minimal')),
    addEquipmentItems:(eventId,names,addedBy)=>write(null,()=>{
      const rows=(names||[]).map(n=>String(n||'').trim().slice(0,40)).filter(Boolean)
        .map(n=>({event_id:Number(eventId),name:n,added_by:addedBy||null}));
      return rows.length?api('POST','equipment_items',rows,'return=minimal'):null;
    }),
    renameEquipmentItem:(eventId,itemId,name)=>write(()=>{const it=findEquip(eventId,itemId);if(it)it.name=name},
      ()=>api('PATCH','equipment_items?id=eq.'+encodeURIComponent(itemId),{name},'return=representation').then(r=>{
        if(!r||!r.length){const e=new Error('forbidden');e.code='forbidden';e.msg='YZ_EDIT_FORBIDDEN';throw e}
      })),
    removeEquipmentItem:(eventId,itemId)=>write(()=>{const e=cache[eventId];if(e)e.equipment=e.equipment.filter(x=>String(x.id)!==String(itemId))},
      ()=>api('DELETE','equipment_items?id=eq.'+encodeURIComponent(itemId))),
    claimEquipment:(eventId,itemId,name)=>write(()=>{const it=findEquip(eventId,itemId);if(it)it.assignedTo=name},
      async()=>{
        try{await api('POST','rpc/claim_equipment',{p_item_id:Number(itemId),p_name:name})}
        catch(e){if(!e.msg||!RULE_ERR[e.msg])e.userMsg='לא הצלחנו לשבץ את הפריט. נסו שוב';throw e}
      }),
    unclaimEquipment:(eventId,itemId,name)=>write(()=>{const it=findEquip(eventId,itemId);if(it&&it.assignedTo===name)it.assignedTo=null},
      ()=>api('POST','rpc/unclaim_equipment',{p_item_id:Number(itemId),p_name:name}))
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
const IS_ANDROID=/Android/.test(UA);
const IS_MOBILE=IS_IOS||IS_ANDROID;
// Facebook/Instagram/WhatsApp-style in-app browsers on Android can't install anything
const IS_ANDROID_INAPP=IS_ANDROID&&/; wv\)|FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|TikTok|Bytedance|Snapchat|Telegram/.test(UA);
const IS_SAMSUNG=IS_ANDROID&&/SamsungBrowser/.test(UA);
const IS_FIREFOX_ANDROID=IS_ANDROID&&/Firefox/.test(UA);
// iPhone/iPad: "add to home screen" (manual). Android/desktop: "install app" (native prompt when the browser offers it).
const installLabel=()=>IS_IOS?'📱 הוסף את יוצאים למסך הבית':'📲 התקן את יוצאים כאפליקציה';
let deferredPrompt=null;                       // Android / desktop Chrome & Edge native install prompt
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
  if(deferredPrompt){                          // built-in prompt (Android / desktop)
    const p=deferredPrompt;deferredPrompt=null;
    try{p.prompt();const r=await p.userChoice;if(r&&r.outcome==='accepted')markInstalled()}catch(e){}
    render();return;
  }
  if(IS_MOBILE)openGuide();                    // no built-in prompt available (always the case on iOS): show the guide
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

// First visit on a phone: offer the install BEFORE asking for a name
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
// Who counts as the "audience" for an outing, for the yes/maybe/no/haven't-responded breakdown:
// only that group's members for a group outing, everyone (all claimed profiles) for a public one.
// Either way, the creator and anyone who already responded are always included, even if they since
// left the group or haven't claimed a profile - so nobody who took an action just disappears from view.
function audiencePool(ev){
  const names=new Set();
  if(ev.groupIds&&ev.groupIds.length){
    ev.groupIds.forEach(id=>{const grp=state.groups.find(x=>x.id===id);if(grp)grp.members.forEach(n=>names.add(n))});
  }else{
    (state.profiles.length?state.profiles:state.people.map(p=>p.id)).forEach(n=>names.add(n));
  }
  if(ev.by)names.add(ev.by);
  for(const n in ev.rsvps)names.add(n);
  return [...names].sort((a,b)=>a.localeCompare(b,'he')).map(n=>({id:n,name:n}));
}
function groups(ev){
  const g={yes:[],maybe:[],no:[],none:[]};
  for(const p of audiencePool(ev)){const s=ev.rsvps[p.id];(s?g[s]:g.none).push(p)}
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
      <div class="when">${whenLabel(ev.when)}${groupBadge(ev)}</div>
      <div class="cnts">${cn(g)}</div>
      <div class="names">${names}</div>
    </div>
    <div class="hbtns">${btns(ev,my,'hb','לא')}</div>
  </section>`;
}
const MONTHS=['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];
// How far away an outing is, in plain words + a tone (soon / week / far) that drives the chip color
function relInfo(ts){
  const diff=Math.round((sod(new Date(ts))-sod(new Date()))/864e5);
  let t,tone='far';
  if(ts<=Date.now())return{t:'קורה עכשיו',tone:'now',diff:0};
  if(diff<=0){t='היום';tone='soon'}
  else if(diff===1){t='מחר';tone='soon'}
  else if(diff===2){t='מחרתיים';tone='soon'}
  else if(diff<7){t='בעוד '+diff+' ימים';tone='week'}
  else if(diff<14)t='בעוד שבוע';
  else if(diff<30)t='בעוד '+Math.round(diff/7)+' שבועות';
  else if(diff<60)t='בעוד חודש';
  else t='בעוד '+Math.round(diff/30)+' חודשים';
  return{t,tone,diff};
}
// One avatar: the person's own picture when they added one, otherwise the colored initial (the existing default)
function avEl(name,extra){
  const u=state.avatars[name];
  return u?`<span class="av pic${extra||''}" title="${esc(name)}"><img src="${esc(u)}" alt="" loading="lazy" decoding="async"></span>`
    :`<span class="av${extra||''}" style="--ah:${hashOf(name)%360}" title="${esc(name)}">${esc([...name][0]||'?')}</span>`;
}
// Which crew an outing belongs to, shown right on the card
function groupBadge(ev){
  if(!ev.priv&&!ev.groupIds.length)return '';
  const n=ev.groupIds.map(id=>{const g=state.groups.find(x=>x.id===id);return g?g.name:null}).filter(Boolean);
  return `<span class="gbadge">👥 ${esc(n.length?n.join(' · '):'קבוצה פרטית')}</span>`;
}
// Small round initials for who's coming (real names only, colors are stable per name)
function avatars(list){
  if(!list.length)return '<span class="av-empty">היו הראשונים להגיע</span>';
  const show=list.slice(0,4).map(p=>avEl(p.name,me&&p.id===me.id?' me':'')).join('');
  const more=list.length>4?`<span class="av more">+${list.length-4}</span>`:'';
  return `<span class="avs">${show}${more}</span>`;
}
function card(ev){
  const k=KINDS[ev.kind],g=groups(ev),my=ev.rsvps[myId()],id=esc(ev.id),d=new Date(ev.when),rel=relInfo(ev.when);
  const pill=my?`<span class="mine ${my}">${my==='yes'?'✓ אתה מגיע':(my==='maybe'?'🟡 אולי':'🔴 לא מגיע')}</span>`:'';
  const action=my==='yes'
    ?`<button class="cbtn done" data-act="open" data-id="${id}">✓ אתה מגיע</button>`
    :`<button class="cbtn" data-act="rsvp" data-id="${id}" data-s="yes">אני מגיע</button>`;
  const going=g.yes.length?`<span class="gtxt"><b>${g.yes.length}</b> ${g.yes.length===1?'מגיע':'מגיעים'}${g.maybe.length?' · '+g.maybe.length+' אולי':''}</span>`:'';
  return `<article class="card ev ${rel.tone}${my==='yes'?' going':''}" style="--h:${k.h}">
    <div class="info" data-act="open" data-id="${id}" role="button" tabindex="0">
      <div class="crow">
        <div class="dbadge" aria-hidden="true"><span class="dw">${DAYS[d.getDay()]}</span><span class="dd">${d.getDate()}</span><span class="dm">${MONTHS[d.getMonth()]}</span></div>
        <div class="ctxt">
          <div class="cplace"><span class="ke" aria-hidden="true">${k.e}</span>${esc(ev.place)}</div>
          <div class="cwhen">🕘 ${hhmm(d)}${trText(ev)?' · '+trText(ev):''}</div>
          <span class="rel">${rel.t}</span>${groupBadge(ev)}
        </div>${pill}
      </div>
      <div class="cfoot">${avatars(g.yes)}${going}</div>
    </div>${action}</article>`;
}
function prow(ev){
  const k=KINDS[ev.kind],g=groups(ev),d=new Date(ev.when);
  const went=!!(me&&ev.rsvps[myId()]==='yes');
  const ratingsOn=!store||!store.ratingsOk||store.ratingsOk();
  const rs=Object.values(ev.ratings||{}),n=rs.length,mean=n?Math.round(rs.reduce((t,r)=>t+r.stars,0)/n*10)/10:null;
  const myRated=!!(me&&ev.ratings[me.id]);
  const cta=(ratingsOn&&went&&!myRated)
    ?`<button class="prate" data-act="open" data-id="${esc(ev.id)}">⭐ דרגו</button>`
    :(myRated?`<span class="pravg mine">✓ דירגת ${ev.ratings[me.id].stars}★</span>`:(mean?`<span class="pravg">⭐ ${mean}</span>`:''));
  return `<article class="pcard">
    <div class="info" data-act="open" data-id="${esc(ev.id)}" role="button" tabindex="0">
      <span class="ptile" aria-hidden="true">${k.e}</span>
      <div class="pctxt">
        <div class="ptop"><span class="pplace">${esc(ev.place)}</span><span class="pbadge">🕘 עבר</span></div>
        <div class="pwhen">${DAYS[d.getDay()]} · ${ddmm(d)} · ${hhmm(d)}</div>
        <div class="pfoot">${avatars(g.yes)}<span class="pgtxt">${g.yes.length?g.yes.length+' הגיעו':'אף אחד לא סימן שהגיע'}</span></div>
      </div>
    </div>${cta}</article>`;
}
const head=()=>'<header class="top"><h1 class="brand">יוצאים?</h1><div class="hdract">'+
  bellHTML()+
  (me?`<button class="who" data-act="rename" aria-label="הפרופיל שלי">${state.avatars[me.name]?avEl(me.name,' sm'):'👤'} ${esc(me.name)}</button>`
    :'<button class="who" data-act="pick-other">בחירת שם</button>')+'</div></header>';

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
  let h=head()+installUI()+aiCardHTML()+groupsBarHTML()+'<h2 class="sec">🔥 קרוב</h2>';
  if(!up.length){
    h+='<div class="empty-state">אין יציאות קרובות.<br>לחצו על ״+ יציאה״ ופתחו את הראשונה.</div>';
  }else{
    h+=hero(up[0]);
    const rest=up.slice(1),wk=rest.filter(e=>Math.round((sod(new Date(e.when))-sod(new Date()))/864e5)<7),later=rest.filter(e=>!wk.includes(e));
    if(wk.length){h+='<h2 class="sec">📅 השבוע</h2>';wk.forEach(e=>{h+=card(e)})}
    if(later.length){h+='<h2 class="sec">🗓️ בהמשך</h2>';later.forEach(e=>{h+=card(e)})}
  }
  if(past.length){h+='<h2 class="sec">🕘 עבר</h2>';past.forEach(e=>{h+=prow(e)})}
  if(state.mode==='local')h+='<p class="note">מצב מקומי: לא מחובר ל-Supabase, הנתונים נשמרים רק במכשיר הזה.</p>';
  app.innerHTML=h;
}

/* ---------- sheets ---------- */
let sheetEl=null,view=null;
function openSheet(html,extraClass){
  closeSheet(true);
  const root=document.createElement('div');
  root.innerHTML='<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" tabindex="-1"></div>';
  const sh=root.querySelector('.sheet');sh.innerHTML=html;
  if(extraClass)sh.classList.add(extraClass);
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
/* ---------- share: the main way new people get in ---------- */
const SHARE_ICON='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14V3"/><path d="M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const shareBtn=ev=>`<button class="sharebtn" data-act="share" data-id="${esc(ev.id)}">${SHARE_ICON}<span>שתפו את היציאה</span></button>`;

// Base address of the site (config SHARE_URL wins, so links from the app/localhost still point at the real site)
function siteUrl(){
  const c=window.APP_CONFIG&&window.APP_CONFIG.SHARE_URL;
  if(c)return c;
  if(IS_NATIVE||!/^https?:$/.test(location.protocol))return '';
  return location.origin+location.pathname;
}
// Direct link to one outing: opens the site straight on it
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

// A short, friendly message built from the outing's real details (never claims people who aren't there)
function shareText(ev){
  const k=KINDS[ev.kind],d=new Date(ev.when),g=groups(ev);
  const diff=Math.round((sod(d)-sod(new Date()))/864e5),evening=d.getHours()>=17||d.getHours()<4;
  const whenWord=diff===0?(evening?'הערב':'היום'):diff===1?(evening?'מחר בערב':'מחר'):(diff>1&&diff<7)?'ב'+DAYS[d.getDay()]:'ב-'+ddmm(d);
  const lines=[`${k.e} ${whenWord} ${SHARE_WHAT[ev.kind]}!`];
  if(ev.place&&ev.place!==k.t)lines.push('📍 '+ev.place);
  lines.push(`📅 יום ${DAYS[d.getDay()]} ${ddmm(d)} | ${CLOCKS[d.getHours()%12]} ${hhmm(d)}`);
  const desc=(ev.description||'').split('\n')[0].trim();
  if(desc&&desc.length<=90)lines.push('💬 '+desc);

  // social proof: real names/numbers only
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
  // Phone: its own share sheet (WhatsApp, Messages, Telegram…) gets the text as-is, emojis intact.
  if(navigator.share&&IS_MOBILE){
    try{await navigator.share({text:shareText(ev)});return}
    catch(e){if(e&&e.name==='AbortError')return}
  }
  openShareSheet(ev,false);
}
// Fallback (desktop / no share sheet), and the "your outing is live" moment right after creating one
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
  // WhatsApp web links can garble emojis, so this path sends the same text without them
  const plain=shareText(ev).replace(/[\p{Extended_Pictographic}️‍]/gu,'').split('\n').map(l=>l.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
  window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(plain),'_blank','noopener');
}
async function copyText(text,okMsg){
  try{await navigator.clipboard.writeText(text);toast(okMsg)}
  catch(e){toast('לא הצלחנו להעתיק')}
}
/* ---------- calendar + navigate ---------- */
const CAL_END_AFTER=3*3600e3; // no end time is stored, so the calendar event defaults to 3 hours
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
function navHTML(ev,fromAI){
  const q=encodeURIComponent(ev.place);
  const opts=[
    {e:'🗺️',t:'Google Maps',href:'https://www.google.com/maps/search/?api=1&query='+q},
    {e:'🚗',t:'Waze',href:'https://waze.com/ul?q='+q+'&navigate=yes'}
  ];
  if(IS_IOS)opts.push({e:'🍎',t:'Apple Maps',href:'https://maps.apple.com/?q='+q});
  const rows=opts.map(o=>`<a class="navrow" href="${esc(o.href)}" target="_blank" rel="noopener" data-act="${fromAI?'ai-back':'close'}">
    <span class="nave">${o.e}</span><span>${o.t}</span></a>`).join('');
  return `<div class="grab"></div><div class="dhead"><h2 class="dt">נווט באמצעות</h2><button class="x" data-act="${fromAI?'ai-back':'close'}" aria-label="סגור">✕</button></div>
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
    // my own car first, then the rest in the order they were added
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

// A contradicting action: explain in one line why, and offer the clean way to switch
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
  if(!html){refreshSheet();return}   // the state already changed under us: just show the fresh details
  openSheet(html);view={type:'blocked',id:eventId};
}

/* ---------- equipment: a simple packing list, one assignee per item ---------- */
function equipmentHTML(ev,isPast){
  const items=ev.equipment||[];
  const canManage=!isPast&&!!me;   // anyone in the outing can add / rename / remove items
  if(isPast&&!items.length)return '';   // nothing to show in history if nobody listed anything
  let h='<div class="grp equip"><div class="gh">🎒 ציוד</div>';
  if(!items.length){
    h+='<p class="dash" style="margin:2px 0 0">עדיין אין רשימת ציוד.</p>';
  }else{
    h+='<div class="eqlist">'+items.map(it=>{
      const mine=!!(me&&it.assignedTo===me.id),taken=!!it.assignedTo;
      let action;
      if(isPast)action=taken?`<span class="eqwho">${esc(it.assignedTo)} הביא/א</span>`:'<span class="eqwho dash">לא שובץ</span>';
      else if(mine)action=`<button class="eqbtn mine" data-act="equip-unclaim" data-id="${esc(ev.id)}" data-item="${esc(it.id)}">✓ אתה מביא · הסר</button>`;
      else if(taken)action=`<span class="eqwho">${esc(it.assignedTo)} מביא</span>`;
      else action=`<button class="eqbtn" data-act="equip-claim" data-id="${esc(ev.id)}" data-item="${esc(it.id)}">אני אביא</button>`;
      const ed=canManage?`<button class="pillx" data-act="equip-edit" data-id="${esc(ev.id)}" data-item="${esc(it.id)}" aria-label="שינוי שם של ${esc(it.name)}">✏️</button>`:'';
      const rm=canManage?`<button class="pillx" data-act="equip-del" data-id="${esc(ev.id)}" data-item="${esc(it.id)}" aria-label="מחק את ${esc(it.name)}">🗑️</button>`:'';
      if(canManage&&eqEdit===it.id)return `<div class="eqitem"><input class="txt eqedit" id="eq-edit" maxlength="40" value="${esc(it.name)}" aria-label="שם הפריט" enterkeyhint="done"><button class="ch" data-act="equip-save" data-id="${esc(ev.id)}">✓</button></div>`;
      return `<div class="eqitem${taken?' taken':''}">
        <span class="eqname">${taken?'✅':'⚪'} ${esc(it.name)}</span>
        <span class="eqact">${action}${ed}${rm}</span>
      </div>`;
    }).join('')+'</div>';
  }
  if(canManage){
    h+=`<div class="dtrow" style="margin-top:12px"><input class="txt" id="eq-new" maxlength="40" placeholder="הוסיפו פריט…" autocomplete="off" enterkeyhint="done" aria-label="פריט ציוד חדש"><button class="ch" data-act="equip-add-live" data-id="${esc(ev.id)}">+ הוסף</button></div>`;
  }
  h+='</div>';
  return h;
}
function claimEquip(eventId,itemId){
  if(!me)return;
  enqueue(()=>store.claimEquipment(eventId,itemId,me.id)).then(()=>toast('רשמנו אותך על הפריט ✓')).catch(writeFail);
}
function unclaimEquip(eventId,itemId){
  if(!me)return;
  enqueue(()=>store.unclaimEquipment(eventId,itemId,me.id)).then(()=>toast('הוסר')).catch(writeFail);
}
function delEquip(eventId,itemId){
  enqueue(()=>store.removeEquipmentItem(eventId,itemId)).then(()=>toast('הפריט הוסר')).catch(writeFail);
}
function addEquipLive(eventId){
  if(!me)return;
  const inp=$('#eq-new');if(!inp)return;
  const v=inp.value.trim().slice(0,40);if(!v)return;
  inp.value='';
  enqueue(()=>store.addEquipmentItem(eventId,v,me.id)).then(()=>toast('הפריט נוסף ✓')).catch(writeFail);
}

const delBtn=ev=>`<button class="del" data-act="del" data-id="${esc(ev.id)}">🗑️ מחק יציאה</button>`;
function detailHTML(ev){
  const k=KINDS[ev.kind],g=groups(ev),my=ev.rsvps[myId()],d=new Date(ev.when);
  const isPast=ev.when+PAST_AFTER<Date.now();
  const sub=(isPast?ddmm(d)+' · '+hhmm(d):whenLabel(ev.when))+(trText(ev)?' · '+trText(ev):'');
  const canEdit=!isPast&&!!me&&ev.by===me.id;         // only its creator may edit it (the database enforces this too)
  const canDelete=!isPast&&!!me&&ev.by===me.id;       // only its creator may delete it (the database enforces this too)
  let h=`<div class="grab"></div><div class="dhead" style="--h:${k.h}"><span class="tile">${k.e}</span>
    <div class="ctxt"><h2 class="dt">${esc(ev.place)}</h2><div class="cwhen">${sub}</div>${groupBadge(ev)}</div>
    <button class="x" data-act="close" aria-label="סגור">✕</button></div>`;
  if(!isPast)h+=shareBtn(ev)+`<div class="actrow">${navBtn(ev)}${calBtn(ev)}</div>`;
  if(ev.description)h+=`<p class="descr">${esc(ev.description)}</p>`;
  h+=creatorHTML(ev)+aiSourcesHTML(ev);
  if(isPast){
    // a past outing is locked in: no delete option, anywhere in this sheet
    h+=grp('yes','🟢','הגיעו',g.yes)+equipmentHTML(ev,true)+ratingHTML(ev)+'<div class="pad"></div>';
  }else{
    h+=grp('yes','🟢','מגיעים',g.yes)+grp('maybe','🟡','אולי',g.maybe)
      +grp('none','⚪','עדיין לא ענו',g.none)+grp('no','🔴','לא מגיעים',g.no)
      +ridesHTML(ev)+equipmentHTML(ev,false)
      +(canEdit?`<button class="edit" data-act="edit" data-id="${esc(ev.id)}">✏️ ערוך יציאה</button>`:'')
      +(canDelete?delBtn(ev):'')
      +`<div class="rsvpbar">${btns(ev,my,'sb','לא מגיע')}</div>`;
  }
  return h;
}
// Who actually created this outing - always a real person, even one started from an AI idea (they still
// had to open the form and save it). Kept visually separate from aiSourcesHTML below on purpose: creator
// and "what the info is based on" are two different questions.
function creatorHTML(ev){
  if(!ev.by)return '';
  return `<div class="creator">נוצר על ידי ${avEl(ev.by,' sm')}<b>${esc(ev.by)}</b></div>`;
}
// Present only when this outing was created from an AI idea: the AI's own real sources, carried over from
// the suggestion so they aren't lost once the outing is saved. Reuses the exact same helpers and markup as
// the AI results list (AI.moreInfoUrl/infoLabel, sourcesBlockHTML) - nothing new to keep in sync, and the
// same guarantee applies: never a link that wasn't a real cited source.
function aiSourcesHTML(ev){
  const a=ev.aiSources;if(!a)return '';
  const url=AI.moreInfoUrl(a);
  const btn=url?`<a class="actbtn" href="${esc(safeHref(url))}" target="_blank" rel="noopener noreferrer">${esc(AI.infoLabel(a))}</a>`:'';
  const list=sourcesBlockHTML(a.sources,'מקורות נוספים');
  if(!btn&&!list)return '';
  return `<div class="aisrc"><div class="aisrc-h">🤖 המידע על היציאה הזו מבוסס על הצעת AI</div>${btn?`<div class="actrow">${btn}</div>`:''}${list}</div>`;
}
function openDetail(id){
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  openSheet(detailHTML(ev));view={type:'detail',id};
}
function refreshSheet(){
  if(!sheetEl||!view)return;
  const sh=sheetEl.querySelector('.sheet');if(!sh)return;
  const st=sh.scrollTop;
  if(view.type==='detail'){
    const ev=state.events.find(e=>e.id===view.id);
    if(!ev){closeSheet();return}
    sh.innerHTML=detailHTML(ev);sh.scrollTop=st;
  }else if(view.type==='groups'){
    const keep=($('#g-new')||{}).value||'';
    sh.innerHTML=groupsHTML();const inp=$('#g-new');if(inp)inp.value=keep;sh.scrollTop=st;
  }else if(view.type==='group'){
    const g=state.groups.find(x=>x.id===view.id);
    if(!g){openGroups();return}           // left the group (or it vanished): back to the list
    sh.innerHTML=groupHTML(g);sh.scrollTop=st;
  }else if(view.type==='rename'){paintProfileAvatar()}
  else if(view.type==='notifs'){sh.innerHTML=notifListHTML();sh.scrollTop=st}
}

/* ---------- create / edit form (same sheet, two modes) ---------- */
let form=null;
function dayModeOf(when){
  const diff=Math.round((sod(new Date(when))-sod(new Date()))/864e5);
  return diff===0?'today':diff===1?'tomorrow':'custom';
}
// Same day boundary the server enforces the 3-a-day limit with (Asia/Jerusalem), so the app never blocks
// someone the server would allow, or the other way around.
const DAILY_LIMIT=3;
function outingsCreatedToday(){
  if(!me)return 0;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});
  return state.events.filter(e=>e.by===me.id&&e.createdAt
    &&new Date(e.createdAt).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'})===today).length;
}
function openForm(editEv,draft){
  if(!state.ready||!me){toast('רגע, הלוח נטען');return}
  const editing=!!editEv;
  // a soft, optimistic check only - the database enforces this for real, so a stale/offline cache can never bypass it
  if(!editing&&state.mode==='supabase'&&outingsCreatedToday()>=DAILY_LIMIT){toast(RULE_ERR.YZ_DAILY_LIMIT);return}
  const d=editing?new Date(editEv.when):new Date(Math.ceil((Date.now()+10*60e3)/(30*60e3))*(30*60e3));
  form={editId:editing?editEv.id:null,
    kind:editing?editEv.kind:(draft?draft.kind:null),
    transport:editing?editEv.transport:(has(TRANSPORT,LS.get('yotz.tr'))?LS.get('yotz.tr'):'unknown'),
    dm:editing?dayModeOf(editEv.when):(d.getDate()===new Date().getDate()?'today':'tomorrow'),
    aiSources:!editing&&draft?draft.aiSources||null:null,
    equipment:[],groupIds:[]};
  if(draft&&draft.date&&draft.date>=iso(new Date()))form.dm='custom';   // an event with a real date: start from it
  const kinds=Object.entries(KINDS).map(([k,v])=>`<button class="opt" data-act="kind" data-v="${k}"><span class="e">${v.e}</span>${v.t}</button>`).join('');
  const trs=Object.entries(TRANSPORT).map(([k,v])=>`<button class="ch" data-act="tr" data-v="${k}">${v.e} ${v.t}</button>`).join('');
  openSheet(`<div class="grab"></div>
    <div class="dhead"><h2 class="dt">${editing?'עריכת יציאה':'יציאה חדשה'}</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    ${!editing&&!draft&&state.mode==='supabase'&&window.AIOuting?'<button class="aihint" data-act="ai-open">✨ אין רעיון? קבלו רעיונות</button>':''}
    <div>
      <div class="fl">מה עושים?</div><div class="kinds">${kinds}</div>
      <div class="fl">איפה?</div>
      <input class="txt" id="f-place" maxlength="60" placeholder="לאגר הוד השרון (לא חובה)" autocomplete="off" enterkeyhint="done" value="${editing?esc(editEv.place):(draft?esc(draft.place):'')}">
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
      <textarea class="txt area" id="f-descr" maxlength="500" placeholder="נפגשים ב-21:30 אצל דניאל, משם ממשיכים לבר…">${editing?esc(editEv.description||''):(draft?esc(draft.description||''):'')}</textarea>
      ${!editing&&groupsOn()&&state.groups.length?`<div class="fl">למי היציאה?</div><div class="row" id="f-aud"></div>`:''}
      ${editing?'':`<div class="fl">ציוד לקחת (לא חובה)</div>
      <div class="dtrow"><input class="txt" id="f-equip" maxlength="40" placeholder="לדוגמה: אוהל" autocomplete="off" enterkeyhint="done"><button class="ch" data-act="equip-add">+ הוסף</button></div>
      <div class="row equip-row" id="f-equip-list" style="margin-top:8px">${equipChips(form.equipment)}</div>`}
      <div class="formbar">
        ${editing?'<button class="cancel" data-act="close">ביטול</button>':''}
        <button class="submit" id="f-submit" data-act="submit" disabled>${editing?'שמור':'צור יציאה'}</button>
      </div>
    </div>`);
  view={type:'form'};
  $('#f-time').value=hhmm(d);
  $('#f-date').min=iso(new Date());
  if(editing&&form.dm==='custom')$('#f-date').value=iso(d);
  else if(draft&&form.dm==='custom'){$('#f-date').value=draft.date;$('#f-time').value=draft.time||'21:00'}
  paintAudience();
  syncForm();
}
function syncForm(){
  if(!sheetEl||!form)return;
  const mark=(act,val)=>sheetEl.querySelectorAll('[data-act="'+act+'"]').forEach(b=>{
    const on=b.dataset.v===val;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
  });
  mark('kind',form.kind);mark('dm',form.dm);mark('tr',form.transport);mark('tm',$('#f-time').value);
  $('#f-date').hidden=form.dm!=='custom';
  $('#f-submit').disabled=!(form.kind&&(form.kind!=='other'||$('#f-place').value.trim()));
}
function equipChips(list){
  return list.length
    ?list.map((n,i)=>`<span class="ch equip-chip">${esc(n)}<button class="pillx" data-act="equip-rm" data-i="${i}" aria-label="הסר את ${esc(n)}">✕</button></span>`).join('')
    :'<span class="dash">אין פריטים עדיין</span>';
}
function addEquipDraft(){
  if(!form)return;
  const inp=$('#f-equip');if(!inp)return;
  const v=inp.value.trim().slice(0,40);if(!v)return;
  if(form.equipment.length>=20){toast('עד 20 פריטים');return}
  form.equipment.push(v);inp.value='';
  const list=$('#f-equip-list');if(list)list.innerHTML=equipChips(form.equipment);
}
function rmEquipDraft(i){
  if(!form)return;
  form.equipment.splice(i,1);
  const list=$('#f-equip-list');if(list)list.innerHTML=equipChips(form.equipment);
}
function submitForm(){
  if(!form||!form.kind)return;
  const place=$('#f-place').value.trim()||(form.kind==='other'?'':KINDS[form.kind].t);   // no place typed: use the activity name
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
    const ev={kind:form.kind,place,when,transport:form.transport,description,by:me.id,rsvps:{[me.id]:'yes'},aiSources:form.aiSources||null};
    const equipToAdd=form.equipment.slice();
    ev.groupIds=form.groupIds.filter(g=>state.groups.some(x=>x.id===g));   // only crews I really belong to
    closeSheet();
    enqueue(()=>store.addEvent(ev)).then(id=>{
      celebrate();
      if(equipToAdd.length&&store.addEquipmentItems)enqueue(()=>store.addEquipmentItems(id,equipToAdd,me.id)).catch(()=>{});
      // the moment to bring the group in: offer to share right away (only if nothing else was opened meanwhile)
      const created=id&&state.events.find(e=>e.id===String(id));
      if(created&&!sheetEl)openShareSheet(created,true);else toast('היציאה נוצרה 🎉');
    }).catch(writeFail);
  }
}
function openEditForm(id){
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  if(!me||ev.by!==me.id){toast('רק מי שיצר את היציאה יכול לערוך אותה');return}   // defense-in-depth; the server enforces this too
  openForm(ev);
}

/* ---------- ride form ---------- */
let rform=null;
// sw=true: the user is a passenger right now and chose "leave that car and drive instead"
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
  openDetail(eventId);   // back to the outing, where the new car shows up
  enqueue(()=>store.createRide(eventId,me.id,seats,pickup,note,sw))
    .then(()=>{toast('הרכב נוסף 🚗');celebrate()}).catch(writeFail);
}
// sw=true: the user is a driver right now and chose "cancel my car and ride with them"
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
// Cancelling a car with passengers affects other people: ask for a second tap (no extra screen)
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
function paintProfileAvatar(){const el=$('#p-av');if(el&&me)el.innerHTML=avEl(me.name,' big')+''}
function openRename(){
  if(!me)return;
  if(!state.ready){toast('רגע, הלוח נטען');return}
  const sup=state.mode==='supabase',has_=!!state.avatars[me.name];
  openSheet(`<div class="grab"></div>
    <div class="dhead"><h2 class="dt">הפרופיל שלי</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div class="pad">
      ${sup?`<div class="pform"><span id="p-av">${avEl(me.name,' big')}</span>
        <div class="pbtns"><button class="actbtn" data-act="avatar-pick">📷 ${has_?'החלפת תמונה':'הוספת תמונה'}</button>${has_?'<button class="actbtn" data-act="avatar-clear">הסרה</button>':''}</div>
        <input type="file" id="p-file" accept="image/*" hidden></div>
        <p class="gnote" style="margin:0 0 14px">התמונה לא חובה. בלעדיה מוצג העיגול הצבעוני עם האות הראשונה.</p>`:''}
      <div class="fl">איך קוראים לך?</div>
      <input class="txt" id="r-name" maxlength="20" autocomplete="off" enterkeyhint="done" aria-label="שם">
      <button class="submit" data-act="rename-save">שמור</button>
      ${sup?`<div class="fl" style="margin-top:18px">קוד שחזור</div>
        <p class="gnote" style="margin:0 0 8px">מתחברים ממכשיר אחר? הקוד הזה מחזיר לך את השם והקבוצות שלך. שמרו אותו במקום בטוח.</p>
        <div class="codebox"><span class="code" id="p-code" dir="ltr">••••••••••</span><button class="actbtn" data-act="code-show">הצג</button></div>`:''}
    </div>`);
  view={type:'rename'};
  $('#r-name').value=me.name;
}
async function showRecoveryCode(el){
  if(!store||!store.getRecoveryCode)return;
  const box=$('#p-code');if(!box)return;
  if(el.dataset.shown){try{await navigator.clipboard.writeText(box.textContent);toast('הקוד הועתק')}catch(e){toast('לא הצלחנו להעתיק')}return}
  try{const c=await store.getRecoveryCode();if(c){box.textContent=c;el.textContent='העתק';el.dataset.shown='1'}else toast('אין קוד עדיין')}
  catch(e){writeFail(e)}
}
// Picture: cropped to a small square in the browser, so uploads stay tiny and every avatar looks the same
async function avatarBlob(file){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=url});
    const S=256,c=document.createElement('canvas');c.width=c.height=S;
    const m=Math.min(img.width,img.height);
    c.getContext('2d').drawImage(img,(img.width-m)/2,(img.height-m)/2,m,m,0,0,S,S);
    return await new Promise(ok=>c.toBlob(ok,'image/jpeg',.85));
  }finally{URL.revokeObjectURL(url)}
}
async function uploadAvatar(file){
  if(!me||!store||!store.setAvatar)return;
  if(!/^image\//.test(file.type)||file.size>20*1024*1024){toast('בחרו תמונה רגילה (עד 20MB)');return}
  let blob;try{blob=await avatarBlob(file)}catch(e){toast('לא הצלחנו לקרוא את התמונה');return}
  if(!blob){toast('לא הצלחנו לקרוא את התמונה');return}
  state.avatars={...state.avatars,[me.name]:URL.createObjectURL(blob)};metaSig='';render();openRenameKeep();   // show it at once
  enqueue(()=>store.setAvatar(blob)).then(()=>toast('התמונה עודכנה ✓')).catch(e=>{writeFail(e)});
}
function openRenameKeep(){if(view&&view.type==='rename'){const v=($('#r-name')||{}).value;openRename();if(v!=null)$('#r-name').value=v}}
function clearAvatar(){
  if(!me||!store||!store.clearAvatar)return;
  const a={...state.avatars};delete a[me.name];state.avatars=a;metaSig='';render();openRenameKeep();
  enqueue(()=>store.clearAvatar()).then(()=>toast('התמונה הוסרה')).catch(writeFail);
}

/* ---------- identity: claim the name for this device (server side), recover it on a new one ---------- */
let profileOk=false;
async function ensureProfile(){
  if(!me||!store||!store.claimProfile)return;
  try{
    const nm=await store.claimProfile(me.name);
    if(nm&&nm!==me.name){me={id:nm,name:nm};LS.set('yotz.me',JSON.stringify(me));render()}
    profileOk=true;maybeOpenInvite();
  }catch(e){
    if(e&&e.msg==='YZ_NAME_TAKEN')showNameTaken(me.name);
    else if(e&&e.code==='unavailable')setTimeout(ensureProfile,5000);
    else if(e&&e.code==='auth')toast('צריך להפעיל כניסה אנונימית ב-Supabase (ראו SETUP.md)');
    else writeFail(e);
  }
}
function showNameTaken(name){
  me=null;LS.set('yotz.me','');render();
  openSheet(`<div class="grab"></div>
    <div class="dhead"><h2 class="dt">השם ״${esc(name)}״ כבר תפוס</h2></div>
    <div class="pad"><p class="shsub" style="margin-top:0">אם זה אתה ממכשיר אחר, הכניסו את קוד השחזור (בפרופיל במכשיר הקודם). אחרת, בחרו שם אחר.</p>
      <input class="txt" id="rc-code" maxlength="20" autocomplete="off" dir="ltr" placeholder="קוד שחזור" aria-label="קוד שחזור">
      <button class="submit" data-act="recover" data-name="${esc(name)}">זה אני, שחזר</button>
      <button class="cancel wide" data-act="pick-other">בחירת שם אחר</button></div>`);
  view={type:'taken'};
}
async function recoverName(name){
  const code=(($('#rc-code')||{}).value||'').trim();
  if(!code){const i=$('#rc-code');if(i)i.focus();return}
  try{
    const nm=await store.recoverProfile(name,code);
    me={id:nm,name:nm};LS.set('yotz.me',JSON.stringify(me));profileOk=true;
    closeSheet();render();toast('ברוך שובך, '+nm+' ✓');maybeOpenInvite();
  }catch(e){if(e&&e.msg==='YZ_BAD_CODE')toast('הקוד לא נכון');else writeFail(e)}
}

/* ---------- groups / crews ---------- */
let pendingGroupToken=null;
try{const t=new URLSearchParams(location.search).get('g');if(t&&/^[a-f0-9]{16,64}$/i.test(t))pendingGroupToken=t}catch(e){}
function clearGroupLink(){
  pendingGroupToken=null;
  try{const u=new URL(location.href);u.searchParams.delete('g');history.replaceState(null,'',u.pathname+u.search+u.hash)}catch(e){}
}
function groupInviteUrl(g){
  const base=siteUrl();if(!base)return '';
  try{const u=new URL(base,location.href);u.search='';u.hash='';u.searchParams.set('g',g.token);return u.toString()}
  catch(e){return base+(base.indexOf('?')>=0?'&':'?')+'g='+encodeURIComponent(g.token)}
}
/* ---------- notifications: created server-side (a trigger fires the moment a new outing is posted) ---------- */
const notifOn=()=>state.mode==='supabase'&&store&&store.markNotificationsRead;
function unreadNotifs(){return state.notifications.filter(n=>!n.readAt&&state.events.some(e=>e.id===n.eventId))}
function bellHTML(){
  if(!(state.ready&&me&&notifOn()))return '';
  const n=unreadNotifs().length;
  return `<button class="bell" data-act="notif-open" aria-label="התראות${n?', '+n+' חדשות':''}">🔔${n?`<span class="dot">${n>9?'9+':n}</span>`:''}</button>`;
}
// Short Hebrew "time since" for a notification's own timestamp (not the outing's date - see notifText for that)
function timeAgo(iso){
  const s=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/1000));
  if(s<60)return 'עכשיו';
  const m=Math.round(s/60);if(m<60)return m===1?'לפני דקה':'לפני '+m+' דקות';
  const h=Math.round(m/60);if(h<24)return h===1?'לפני שעה':'לפני '+h+' שעות';
  const d=Math.round(h/24);return d===1?'לפני יום':'לפני '+d+' ימים';
}
// Who it's for ("everyone" or the group name(s)), reusing the same badge the outing cards already show
function notifAudience(ev){
  if(!ev.priv&&!ev.groupIds.length)return '🌍 לכולם';
  const n=ev.groupIds.map(id=>{const g=state.groups.find(x=>x.id===id);return g?g.name:null}).filter(Boolean);
  return '👥 '+(n.length?n.join(' · '):'קבוצה פרטית');
}
function notifRow(n){
  const ev=state.events.find(e=>e.id===n.eventId);
  if(!ev)return '';   // the outing is outside the loaded window (very old) or was deleted - nothing useful to show
  const k=KINDS[ev.kind],d=new Date(ev.when);
  return `<button class="nrow${n.readAt?'':' unread'}" data-act="notif-go" data-id="${esc(ev.id)}" style="--h:${k.h}">
    <span class="tile sm">${k.e}</span>
    <span class="ntext"><b>${esc(ev.place)}</b><span class="naud">${esc(notifAudience(ev))}</span><span class="nwhen">📅 ${DAYS[d.getDay()]} ${ddmm(d)} · ${hhmm(d)}</span></span>
    <span class="nago">${timeAgo(n.createdAt)}</span></button>`;
}
function notifListHTML(){
  const rows=state.notifications.map(notifRow).filter(Boolean).join('');
  return `<div class="grab"></div>
    <div class="dhead"><h2 class="dt">התראות</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    ${rows?`<div class="nlist">${rows}</div>`:'<p class="dash" style="margin:8px 0 0">אין עדיין התראות. כשתיפתח יציאה חדשה בקבוצה שלכם (או לכולם), היא תופיע כאן.</p>'}
    <div class="pad"></div>`;
}
function openNotifications(){
  if(!me||!notifOn())return;
  if(!state.notificationsOk){toast('צריך להריץ את migration העדכני ב-Supabase');return}
  if(typeof Notification!=='undefined'&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});
  openSheet(notifListHTML(),'sheet-short');view={type:'notifs'};
  const unread=unreadNotifs().map(n=>n.id);
  if(unread.length){
    state.notifications=state.notifications.map(n=>unread.includes(n.id)?Object.assign({},n,{readAt:new Date().toISOString()}):n);
    store.markNotificationsRead(unread).catch(()=>{});
    render();   // clears the bell badge right away; the open sheet already shows its own snapshot
  }
}
function goToNotification(eventId){
  closeSheet();
  openDetail(eventId);
}
// Fires a real OS/browser notification for genuinely new items only - never for the backlog a first load finds,
// and never a second time for one already shown. Clicking it jumps straight to that outing.
let knownNotifIds=null;
function notifyNewOnes(prev,next){
  const ids=new Set(next.map(n=>n.id));
  const firstRun=knownNotifIds===null;
  const isNew=firstRun?[]:next.filter(n=>!n.readAt&&!knownNotifIds.has(n.id));
  knownNotifIds=ids;
  if(!isNew.length||typeof Notification==='undefined'||Notification.permission!=='granted')return;
  isNew.forEach(n=>{
    const ev=state.events.find(e=>e.id===n.eventId);if(!ev)return;
    const d=new Date(ev.when);
    try{
      const note=new Notification('יציאה חדשה: '+ev.place,{
        body:`${notifAudience(ev)} · ${DAYS[d.getDay()]} ${ddmm(d)} ${hhmm(d)}`,
        tag:'yotz-outing-'+ev.id,icon:'icons/icon-192.png',badge:'icons/icon-192.png'});
      note.onclick=()=>{try{window.focus()}catch(e){}goToNotification(ev.id);note.close()};
    }catch(e){}
  });
}
const groupsOn=()=>state.mode==='supabase'&&store&&store.createGroup;
function groupsBarHTML(){
  if(!(state.ready&&me&&groupsOn()))return '';
  const n=state.groups.length;
  return `<button class="groupsbar" data-act="groups"><span class="gb-ic" aria-hidden="true">👥</span><span class="gb-t">${n?'הקבוצות שלי':'קבוצות: יציאות פרטיות לחבורה'}</span>${n?`<span class="gb-n">${n}</span>`:'<span class="gb-n plus">+</span>'}</button>`;
}
function groupsHTML(){
  const rows=state.groups.length
    ?state.groups.map(g=>`<button class="grow" data-act="group-open" data-g="${esc(g.id)}"><span class="gname">👥 ${esc(g.name)}</span><span class="gcount">${g.members.length} ${g.members.length===1?'חבר':'חברים'}</span><span class="chev" aria-hidden="true">‹</span></button>`).join('')
    :'<p class="dash" style="margin:0 0 6px">עוד לא הצטרפת לאף קבוצה.</p>';
  return `<div class="grab"></div>
    <div class="dhead"><h2 class="dt">הקבוצות שלי</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <p class="shsub">יציאות פרטיות שרק חברי הקבוצה רואים. יוצרים קבוצה ושולחים בוואטסאפ קישור הצטרפות.</p>
    <div class="glist">${rows}</div>
    <div class="fl">קבוצה חדשה</div>
    <div class="dtrow"><input class="txt" id="g-new" maxlength="30" placeholder="לדוגמה: נשמות" autocomplete="off" enterkeyhint="done" aria-label="שם הקבוצה"><button class="ch" data-act="group-create">+ צור</button></div>
    <div class="pad"></div>`;
}
function groupHTML(g){
  const url=groupInviteUrl(g);
  const mem=[...g.members].sort((a,b)=>a.localeCompare(b,'he')).map(n=>`<div class="mrow2">${avEl(n,me&&n===me.name?' me':'')}<span>${esc(n)}${me&&n===me.name?' <span class="dash">(אני)</span>':''}</span></div>`).join('');
  return `<div class="grab"></div>
    <div class="dhead"><button class="x back" data-act="groups" aria-label="חזרה">›</button><div class="ctxt"><h2 class="dt">👥 ${esc(g.name)}</h2><div class="cwhen">${g.members.length} ${g.members.length===1?'חבר':'חברים'}</div></div><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div class="grp"><div class="gh">🔗 קישור הצטרפות</div>
      ${url?`<div class="invurl" dir="ltr">${esc(url)}</div>
      <div class="actrow"><button class="actbtn wa" data-act="group-share" data-g="${esc(g.id)}">שליחה בוואטסאפ</button><button class="actbtn" data-act="group-copy" data-g="${esc(g.id)}">העתקת קישור</button></div>`
      :'<p class="dash">אין כתובת אתר מוגדרת (SHARE_URL ב-config.js).</p>'}
      <p class="gnote" style="margin:8px 0 0">כל מי שיש לו את הקישור יכול להצטרף. שלחו אותו רק למי שאתם רוצים בקבוצה.</p></div>
    <div class="grp"><div class="gh">חברים <span class="n">${g.members.length}</span></div><div class="mlist">${mem}</div></div>
    <button class="del" data-act="group-leave" data-g="${esc(g.id)}">יציאה מהקבוצה</button><div class="pad"></div>`;
}
function openGroups(){
  if(!me||!state.ready){toast('רגע, הלוח נטען');return}
  if(!state.groupsOk){toast('צריך להריץ את supabase-migration-v7.sql');return}
  openSheet(groupsHTML(),'sheet-short');view={type:'groups'};
}
function openGroup(id){
  const g=state.groups.find(x=>x.id===id);if(!g)return;
  openSheet(groupHTML(g));view={type:'group',id};
}
function createGroupNow(){
  const inp=$('#g-new');if(!inp||!me)return;
  const name=inp.value.replace(/\s+/g,' ').trim().slice(0,30);if(!name){inp.focus();return}
  inp.value='';
  enqueue(()=>store.createGroup(name)).then(id=>{toast('הקבוצה נוצרה ✓');if(id)openGroup(String(id).replace(/"/g,''))}).catch(writeFail);
}
async function shareGroup(id,copy){
  const g=state.groups.find(x=>x.id===id);if(!g)return;
  const url=groupInviteUrl(g);if(!url)return;
  if(copy){try{await navigator.clipboard.writeText(url);toast('הקישור הועתק')}catch(e){toast('לא הצלחנו להעתיק')}return}
  const text=`הצטרפו לקבוצה ״${g.name}״ ביוצאים: ${url}`;
  if(navigator.share&&IS_MOBILE){try{await navigator.share({text});return}catch(e){if(e&&e.name==='AbortError')return}}
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener');
}
function leaveGroup(el){
  const id=el.dataset.g;
  if(!el.dataset.armed){
    el.dataset.armed='1';el.textContent='לצאת? לא תראו יותר את היציאות הפרטיות שלה. לחצו שוב';
    setTimeout(()=>{if(el.isConnected){delete el.dataset.armed;el.textContent='יציאה מהקבוצה'}},4000);return;
  }
  enqueue(()=>store.leaveGroup(id)).then(()=>{toast('יצאת מהקבוצה');openGroups()}).catch(writeFail);
}
// Someone opened a group invite link: show what they're joining, and join on one tap
let inviteBusy=false;
async function maybeOpenInvite(){
  if(!pendingGroupToken||!me||!profileOk||!store||!store.groupPreview||sheetEl||inviteBusy)return;
  inviteBusy=true;
  try{
    const p=await store.groupPreview(pendingGroupToken);
    if(!p){toast('הקישור לא תקין או שפג תוקפו');clearGroupLink();return}
    if(p.is_member){clearGroupLink();toast('אתה כבר בקבוצה ״'+p.name+'״');return}
    openSheet(`<div class="grab"></div><div class="pad" style="text-align:center">
      <div class="inv-k">הוזמנת להצטרף לקבוצה 👋</div><div class="inv-t">👥 ${esc(p.name)}</div>
      <div class="inv-w">${p.members} ${p.members===1?'חבר':'חברים'} · תראו את היציאות הפרטיות שלה</div>
      <button class="submit" data-act="group-join">הצטרפות לקבוצה</button>
      <button class="cancel wide" data-act="group-later">לא עכשיו</button></div>`);
    view={type:'invite',name:p.name};
  }catch(e){if(e&&e.code!=='unavailable')writeFail(e)}
  finally{inviteBusy=false}
}
function joinGroupNow(){
  const token=pendingGroupToken,name=view&&view.name;if(!token)return;
  enqueue(()=>store.joinGroup(token)).then(id=>{
    clearGroupLink();closeSheet();toast('הצטרפת ל״'+(name||'קבוצה')+'״ ✓');
  }).catch(e=>{if(e&&e.msg==='YZ_BAD_INVITE')clearGroupLink();writeFail(e)});
}

/* audience picker inside the "new outing" form */
function paintAudience(){
  const box=$('#f-aud');if(!box||!form)return;
  const on=form.groupIds;
  box.innerHTML=`<button class="ch${on.length?'':' on'}" data-act="aud" data-g="" aria-pressed="${!on.length}">🌍 כולם</button>`
    +state.groups.map(g=>{const a=on.includes(g.id);return `<button class="ch${a?' on':''}" data-act="aud" data-g="${esc(g.id)}" aria-pressed="${a}">👥 ${esc(g.name)}</button>`}).join('')
    +(on.length?'<p class="gnote aud-note">🔒 רק חברי הקבוצה יראו את היציאה הזו.</p>':'');
}
function toggleAudience(g){
  if(!form)return;
  if(!g)form.groupIds=[];
  else{const i=form.groupIds.indexOf(g);if(i>=0)form.groupIds.splice(i,1);else form.groupIds.push(g)}
  paintAudience();
}

/* equipment: rename an item in place */
let eqEdit=null;
function startEquipEdit(itemId){eqEdit=itemId;refreshSheet();const i=$('#eq-edit');if(i){i.focus();i.select()}}
function saveEquipEdit(eventId){
  const i=$('#eq-edit');if(!i)return;
  const v=i.value.trim().slice(0,40),item=eqEdit;eqEdit=null;
  if(!v){refreshSheet();return}
  enqueue(()=>store.renameEquipmentItem(eventId,item,v)).then(()=>toast('עודכן ✓')).catch(writeFail);
  refreshSheet();
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
  const ev0=state.events.find(e=>e.id===el.dataset.id);
  if(ev0&&ev0.when+PAST_AFTER<Date.now()){toast('אי אפשר למחוק יציאה שכבר עברה');return}
  if(ev0&&(!me||ev0.by!==me.id)){toast('רק מי שיצר את היציאה יכול למחוק אותה');return}
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
let tapped=null;   // the RSVP button just pressed gets a one-time "pop"
function setRsvp(id,s){
  const ev=state.events.find(e=>e.id===id);
  if(!ev||!me||ev.rsvps[me.id]===s)return;
  // Only "going" people can be in a car: anything else takes them out (the store + database do it; we just say so)
  const role=s!=='yes'?rideRole(ev,me.id):null;
  tapped=id+'|'+s;setTimeout(()=>{tapped=null},700);
  enqueue(()=>store.setRsvp(id,me.id,s)).then(()=>{
    if(s==='yes'){celebrate();toast('אחלה! אתה בא 🎉')}   // only after the server confirmed it
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
// Arrived through a shared link: show what they were invited to, right on the name screen
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
  if(store)ensureProfile();   // (if the board is still loading, boot() does it once it is ready)
}

/* ---------- ratings: optional, only inside a past outing, only for people who were there ---------- */
let ratingFlash=null;   // the outing whose rating was just saved (drives the short highlight)
let ratingDraft=null;   // keeps a half-typed comment alive while the sheet re-renders
function ratingHTML(ev){
  if(store&&store.ratingsOk&&!store.ratingsOk())return '';   // the ratings table isn't set up yet: no UI
  const rs=Object.values(ev.ratings||{}),n=rs.length;
  const mean=n?Math.round(rs.reduce((t,r)=>t+r.stars,0)/n*10)/10:null;
  const summary=n?`<span class="ravg">${mean} <span class="dash">(${n} ${n===1?'דירוג':'דירוגים'})</span></span>`:'';
  const went=!!(me&&ev.rsvps[me.id]==='yes');
  if(!went)return n?`<div class="grp"><div class="gh">⭐ דירוג היציאה ${summary}</div></div>`:'';
  const my=ev.ratings[me.id]||null;
  const d=ratingDraft&&ratingDraft.id===ev.id?ratingDraft:null;
  const stars=d?d.stars:(my?my.stars:0);
  const comment=d?d.comment:(my?my.comment:'');
  const st=[1,2,3,4,5].map(i=>`<button class="star${i<=stars?' on':''}" data-act="rate" data-id="${esc(ev.id)}" data-v="${i}" aria-label="${i} מתוך 5" aria-pressed="${i===stars}">★</button>`).join('');
  const state_=d&&d.saving?`<div class="rstate saving" role="status">שומר…</div>`
    :(my?`<div class="rstate saved${ratingFlash===ev.id?' flash':''}" role="status"><span class="ok">✓</span> הדירוג שלך נשמר · ${'★'.repeat(my.stars)}${'☆'.repeat(5-my.stars)}</div>`:'');
  const more=stars
    ?`${state_}<textarea class="txt area" id="r-comment" maxlength="300" placeholder="מה אהבתם ומה פחות? (לא חובה)">${esc(comment)}</textarea>
      <button class="actbtn rsave" data-act="rate-save" data-id="${esc(ev.id)}">שמירת ההערה</button>`
    :'<p class="dash" style="margin:0">לא חובה. זה עוזר להציע רעיונות שמתאימים לכם.</p>';
  return `<div class="grp rating"><div class="gh">⭐ איך הייתה היציאה? ${summary}</div><div class="stars${ratingFlash===ev.id?' flash':''}" role="group" aria-label="דירוג">${st}</div>${more}</div>`;
}
function rateStars(id,v){
  if(!me||!(v>=1&&v<=5))return;
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  const ta=$('#r-comment');
  const comment=(ta?ta.value:(ratingDraft&&ratingDraft.id===id?ratingDraft.comment:((ev.ratings[me.id]||{}).comment||''))).trim();
  ratingDraft={id,stars:v,comment,saving:true};
  refreshSheet();
  enqueue(()=>store.setRating(id,me.id,v,comment)).then(()=>{
    ratingDraft=null;ratingFlash=id;setTimeout(()=>{if(ratingFlash===id){ratingFlash=null;refreshSheet()}},2600);
    celebrate();toast('הדירוג נשמר ✓');refreshSheet();
  }).catch(e=>{ratingDraft=null;writeFail(e);refreshSheet()});
}
function saveComment(id){
  if(!me)return;
  const ev=state.events.find(e=>e.id===id);if(!ev)return;
  const my=ev.ratings[me.id];
  const stars=ratingDraft&&ratingDraft.id===id?ratingDraft.stars:(my?my.stars:0);
  if(!stars){toast('בחרו כוכבים קודם');return}
  const ta=$('#r-comment'),comment=(ta?ta.value:'').trim();
  toast('ההערה נשמרה, תודה! ✓');
  enqueue(()=>store.setRating(id,me.id,stars,comment)).then(()=>{ratingDraft=null;refreshSheet()}).catch(writeFail);
}

/* ---------- ✨ AI suggestions (UI only; the logic is in ai-service.js, the Groq key is in the Edge Function) ---------- */
const AI=window.AIOuting;
const AI_AREAS=['תל אביב','הרצליה','כפר סבא','אזור השרון'];
const PREF_TAGS=[['מסיבות','🎉'],['מקומות חברתיים','👥'],['חוף','🏖️'],['ברים','🍺'],['מוזיקה','🎵'],['אוכל','🍔'],['טיולים','🌳'],['ספורט','⚽'],['גיימינג','🎮'],['ביליארד','🎱']];
let aiRun=0,aiForm=null,prefsDraft=null;
const aiState={res:null};
try{const r=JSON.parse(LS.get('yotz.ai.last')||'null');if(r&&Array.isArray(r.recs)&&r.recs.length&&r.at)aiState.res=r}catch(e){}
const safeHref=u=>/^https?:\/\//i.test(u||'')?u:'#';

function loadAIForm(){
  let f=null;try{f=JSON.parse(LS.get('yotz.ai.form')||'null')}catch(e){}
  const defN=Math.min(12,Math.max(2,state.people.length||6));
  const areas=Array.isArray(f&&f.areas)?f.areas.map(a=>String(a).slice(0,40)).filter(Boolean).slice(0,4):[];
  aiForm={areas:areas.length?areas:['תל אביב'],n:Math.min(40,Math.max(1,Number(f&&f.n)||defN)),age:Math.min(60,Math.max(16,Number(f&&f.age)||20)),wish:''};
}
const stepHTML=(id,val,dec,inc,l1,l2)=>`<div class="stepper"><button class="stbtn" data-act="${dec}" aria-label="${l1}">－</button><span class="stval" id="${id}">${val}</span><button class="stbtn" data-act="${inc}" aria-label="${l2}">＋</button></div>`;
function aiFormHTML(){
  const all=[...AI_AREAS,...aiForm.areas.filter(a=>!AI_AREAS.includes(a))];
  const chips=all.map(a=>{const on=aiForm.areas.includes(a);return `<button class="ch${on?' on':''}" data-act="ai-area" data-v="${esc(a)}" aria-pressed="${on}">${esc(a)}</button>`}).join('');
  return `<div class="grab"></div><div class="dhead"><h2 class="dt">✨ מה בא לכם לעשות?</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <div class="fl">איפה?</div><div class="row">${chips}</div>
    <div class="dtrow"><input class="txt" id="ai-area-in" maxlength="30" placeholder="עיר או אזור אחר" autocomplete="off" enterkeyhint="done" aria-label="אזור נוסף"><button class="ch" data-act="ai-area-add">+ הוסף</button></div>
    <div class="fl">כמה אנשים?</div>${stepHTML('ai-n',aiForm.n,'ai-n-dec','ai-n-inc','פחות אנשים','עוד אנשים')}
    <div class="fl">גיל</div>${stepHTML('ai-age',aiForm.age,'ai-age-dec','ai-age-inc','גיל נמוך יותר','גיל גבוה יותר')}
    <div class="fl">מה אתם מחפשים?</div>
    <textarea class="txt area" id="ai-wish" maxlength="400" placeholder="משהו חברתי, עם הרבה אנשים, מוזיקה ואווירה טובה">${esc(aiForm.wish)}</textarea>
    <button class="prefslink" data-act="prefs-open">⚙️ ההעדפות שלי</button>
    <div class="formbar"><button class="submit" id="ai-go" data-act="ai-go"${aiForm.areas.length?'':' disabled'}>✨ תנו לי רעיונות</button></div>`;
}
// A hard-to-miss entry point on the main screen (the old hint inside the "new outing" form stays too)
function aiCardHTML(){
  if(!(state.ready&&me&&AI&&state.mode==='supabase'))return '';
  return `<button class="aicard" data-act="ai-open">
    <span class="aic-ic" aria-hidden="true">✨</span>
    <span class="aic-txt"><span class="aic-t">מצאו רעיון ליציאה עם AI</span><span class="aic-s">ספרו לנו מה בא לכם, ונציע יציאות בזמן אמת</span></span>
    <span class="aic-arrow" aria-hidden="true">‹</span>
  </button>`;
}
function openAI(){
  if(!state.ready||!me||!AI){toast('רגע, הלוח נטען');return}
  const fresh=aiState.res&&Date.now()-aiState.res.at<864e5;
  if(fresh)openAIResults();else openAIForm();
}
function openAIForm(){
  if(!state.ready||!me)return;
  if(!aiForm)loadAIForm();
  openSheet(aiFormHTML());view={type:'ai-form'};
}
function toggleArea(v,el){
  const i=aiForm.areas.indexOf(v);
  if(i>=0)aiForm.areas.splice(i,1);
  else if(aiForm.areas.length>=4){toast('עד 4 אזורים');return}
  else aiForm.areas.push(v);
  const on=aiForm.areas.includes(v);el.classList.toggle('on',on);el.setAttribute('aria-pressed',on);
  const go=$('#ai-go');if(go)go.disabled=!aiForm.areas.length;
}
function addArea(){
  const inp=$('#ai-area-in');if(!inp)return;
  const v=inp.value.replace(/\s+/g,' ').trim().slice(0,30);if(!v)return;
  if(!aiForm.areas.includes(v)){
    if(aiForm.areas.length>=4){toast('עד 4 אזורים');return}
    aiForm.areas.push(v);
  }
  const sh=sheetEl&&sheetEl.querySelector('.sheet');if(sh){const st=sh.scrollTop;sh.innerHTML=aiFormHTML();sh.scrollTop=st}
}
function stepAI(a){
  if(a==='ai-n-dec')aiForm.n=Math.max(1,aiForm.n-1);
  else if(a==='ai-n-inc')aiForm.n=Math.min(40,aiForm.n+1);
  else if(a==='ai-age-dec')aiForm.age=Math.max(16,aiForm.age-1);
  else aiForm.age=Math.min(60,aiForm.age+1);
  const n=$('#ai-n'),g=$('#ai-age');if(n)n.textContent=aiForm.n;if(g)g.textContent=aiForm.age;
}
// Honest loading screen: one request does the research and the analysis, so there are no step-by-step fake ticks
function showAILoading(){
  openSheet(`<div class="grab"></div><div class="aiload" role="status" aria-live="polite"><div class="spark" aria-hidden="true">✨</div>
    <h2 class="dt">מחפשים רעיונות שמתאימים לחבורה…</h2>
    <p class="why">בודקים מה קורה עכשיו באזור ומשווים ליציאות ולדירוגים הקודמים שלכם. זה יכול לקחת עד חצי דקה.</p>
    <div class="skel s3"></div><div class="skel s3"></div>
    <button class="cancel wide" data-act="ai-cancel">ביטול</button></div>`);
  view={type:'ai-loading'};
}
async function runAI(){
  if(!AI||!aiForm||!aiForm.areas.length)return;
  const my=++aiRun;
  LS.set('yotz.ai.form',JSON.stringify({areas:aiForm.areas,n:aiForm.n,age:aiForm.age}));
  showAILoading();
  let prefsRows=[];try{prefsRows=await store.loadPrefs()}catch(e){}
  let res=null,msg=null;
  try{
    const ctx=AI.buildContext({events:state.events,kinds:KINDS,now:Date.now(),pastAfter:PAST_AFTER,form:aiForm,prefsRows});
    res=await AI.suggest(ctx);
  }catch(e){msg=(e&&e.userMsg)||AI.MSG.groq}   // only our own short Hebrew messages ever reach the screen
  if(my!==aiRun)return;                          // cancelled, or a newer search started
  const waiting=!!(view&&view.type==='ai-loading');
  if(res){
    aiState.res=res;LS.set('yotz.ai.last',JSON.stringify(res));
    if(waiting)openAIResults();else toast('הרעיונות מוכנים ✨');
  }else if(waiting){
    openSheet(`<div class="grab"></div><div class="dhead"><h2 class="dt">✨ רעיונות</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
      <div class="msg" style="margin-top:18px">${esc(msg)}</div>
      <div class="pad"><button class="submit" data-act="ai-go">נסו שוב</button><button class="cancel wide" data-act="ai-form">שינוי החיפוש</button></div>`);
    view={type:'ai-error'};
  }else toast(msg);
}
const chip=(e,t)=>`<span class="rchip">${e} ${esc(t)}</span>`;
// One source as a tappable chip: icon + site name + (Instagram only) the real handle straight from its
// URL - never just bare "@handle" text, always the actual link. Shared by the AI results list and by a
// saved outing's own "sources" section, so both look and behave the same.
function srcChipHTML(s){
  const m=AI.sourceMeta(s);
  return `<a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">${m.icon} ${esc(m.label)}${m.handle?' — '+esc(m.handle):''}</a>`;
}
function sourcesBlockHTML(sources,heading){
  if(!sources.length)return '';
  const labels=[...new Set(sources.map(s=>AI.sourceLabel(s)))];
  return `<details class="rsrc"><summary>${esc(heading)} · ${esc(labels.join(' · '))}</summary><div class="rlinks">${sources.map(srcChipHTML).join('')}</div></details>`;
}
function recCard(r,i){
  const k=KINDS[r.kind]||KINDS.other;
  const q=AI.navQuery(r);
  let dateChip='';
  if(r.date){const [y,m,d]=r.date.split('-').map(Number);dateChip=chip('📅',ddmm(new Date(y,m-1,d))+(r.time?' · '+r.time:''))}
  else if(r.isEvent)dateChip='<span class="rchip warn">📅 תאריך לא אומת</span>';
  const chips=(r.cost?chip('💰',r.cost):'')+(r.group?chip('👥',r.group):'')+(r.age?chip('🎂',r.age):'')
    +(r.social!=null?chip('🔥','רמה חברתית '+r.social+'/5'):'')+dateChip
    +(r.verified?'':'<span class="rchip warn">רעיון כללי, לא אומת</span>');
  const src=sourcesBlockHTML(r.sources,'מקורות');
  return `<article class="rec" style="--h:${k.h}">
    <div class="rtop"><span class="tile">${k.e}</span><div class="ctxt"><div class="cplace">${esc(r.name)}</div>
      <div class="cwhen">${r.location?'📍 '+esc(r.location):''}${r.type?(r.location?' · ':'')+esc(r.type):''}</div></div></div>
    <p class="rdesc">${esc(r.description)}</p>
    ${r.why?`<div class="rwhy"><b>למה זה מתאים לכם</b>${esc(r.why)}</div>`:''}
    ${chips?`<div class="rchips">${chips}</div>`:''}${src}
    <div class="actrow">${q?`<button class="actbtn" data-act="ai-nav" data-i="${i}">📍 נווט</button>`:''}${moreInfoBtn(r)}</div>
    <button class="rcreate" data-act="ai-create" data-i="${i}">➕ צור יציאה</button>
  </article>`;
}
// A real link straight to the source page the AI actually used (with a text-fragment jump when we have a
// quote), never an in-app synthesized answer. Hidden entirely when there is no genuine source to link to.
function moreInfoBtn(r){
  const url=AI.moreInfoUrl(r);
  if(!url)return '';
  return `<a class="actbtn" href="${esc(safeHref(url))}" target="_blank" rel="noopener noreferrer">${esc(AI.infoLabel(r))}</a>`;
}
function openAIResults(){
  const res=aiState.res;if(!res){openAIForm();return}
  openSheet(`<div class="grab"></div><div class="dhead"><h2 class="dt">✨ רעיונות ליציאה</h2><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <p class="shsub">${esc(res.intro)}</p>${windowNote(res)}${res.general?'<p class="gnote" style="margin:8px 0 0">לא הצלחנו להביא מידע עדכני מהרשת, אז אלה רעיונות כלליים. כדאי לבדוק לפני שיוצאים.</p>':''}${res.recs.map(recCard).join('')}
    <div class="pad"><button class="cancel wide" data-act="ai-form">🔄 חיפוש חדש</button>
    <p class="gnote">כדאי לבדוק פרטים לפני שיוצאים: מחירים ושעות עלולים להשתנות.</p></div>`);
  view={type:'ai-results'};
}
// Which dates the search covered: near-term by default, the user's own range when they asked for one
function windowNote(res){
  const w=res.window;if(!w)return '';
  const f=x=>{const [y,m,d]=x.split('-').map(Number);return ddmm(new Date(y,m-1,d))};
  return `<p class="winnote">📅 ${w.explicit?'לפי הבקשה שלך':'בקרוב'}: ${f(w.from)}–${f(w.to)}${w.explicit?'':' · אפשר לבקש תקופה אחרת בתיאור החיפוש'}</p>`;
}
/* "More information": facts about THIS recommendation only. The server gets its own data (never a generic question). */
const aiDetails=new Map();   // ref -> details, so a second tap is instant
function detailRow(icon,label,val){return val?`<div class="drow"><span class="dic" aria-hidden="true">${icon}</span><div><b>${label}</b><span>${esc(val)}</span></div></div>`:''}
function detailList(icon,label,arr){return arr.length?`<div class="drow"><span class="dic" aria-hidden="true">${icon}</span><div><b>${label}</b><ul>${arr.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>`:''}
function detailsHTML(r,d,i){
  const when=r.date?(()=>{const [y,m,dd]=r.date.split('-').map(Number);return ddmm(new Date(y,m-1,dd))+(r.time?' · '+r.time:'')})():null;
  const where=[r.venue,r.address||r.location].filter(Boolean).join(' · ')||null;
  const LBL={meeting_point:'נקודת מפגש',duration:'משך',difficulty:'רמת קושי',price:'מחיר',organizer:'מארגן',bring:'מה להביא',requirements:'ציוד ותנאים נדרשים',instructions:'הוראות חשובות'};
  const miss=d.unknown.filter(k=>LBL[k]).map(k=>LBL[k]);
  const src=r.sources.length?`<p class="gnote srcline">מקור המידע: ${r.sources.slice(0,3).map(s=>`<a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener noreferrer" dir="ltr">${esc(AI.sourceLabel(s))}</a>`).join(' · ')}</p>`:'';
  return `<div class="grab"></div>
    <div class="dhead"><button class="x back" data-act="ai-results" aria-label="חזרה לרעיונות">›</button><div class="ctxt"><h2 class="dt">${esc(r.name)}</h2><div class="cwhen">${r.type?esc(r.type):'פרטים על היציאה'}</div></div><button class="x" data-act="close" aria-label="סגור">✕</button></div>
    <p class="descr" style="margin-top:0">${esc(d.summary)}</p>
    <div class="dlist">
      ${detailRow('📍','איפה',where)}${detailRow('🕐','מתי',when?when:(r.isEvent?'התאריך לא אומת':null))}
      ${detailRow('🧭','נקודת מפגש',d.meeting_point)}${detailRow('⏱️','משך',d.duration)}${detailRow('🥾','רמת קושי',d.difficulty)}
      ${detailRow('💰','מחיר',d.price||r.cost)}${detailRow('🎂','גיל',d.age_restriction||r.age)}${detailRow('👤','מארגן',d.organizer)}
      ${detailList('🎒','מה להביא',d.bring)}${detailList('🧰','ציוד ותנאים נדרשים',d.requirements)}
      ${detailList('⚠️','הוראות חשובות',d.instructions)}${detailList('ℹ️','עוד פרטים',d.extra)}
    </div>
    ${miss.length?`<div class="missing"><b>לא נמצא במקורות:</b> ${esc(miss.join(' · '))}</div>`:''}
    ${d.pagesRead?'':'<p class="gnote">לא הצלחנו לקרוא את עמוד האירוע עצמו, אז המידע מבוסס על מה שכבר ידוע.</p>'}
    <div class="actrow">${AI.navQuery(r)?`<button class="actbtn" data-act="ai-nav" data-i="${i}">📍 נווט</button>`:''}</div>
    <button class="rcreate" data-act="ai-create" data-i="${i}">➕ צור יציאה</button>${src}<div class="pad"></div>`;
}
async function openAIMore(i){
  const r=aiState.res&&aiState.res.recs[i];if(!r||!AI)return;
  const ref=AI.recRef(r);
  if(aiDetails.has(ref)){openSheet(detailsHTML(r,aiDetails.get(ref),i));view={type:'ai-more',ref};return}
  openSheet(`<div class="grab"></div><div class="aiload" role="status" aria-live="polite"><div class="spark" aria-hidden="true">🔎</div>
    <h2 class="dt">אוספים פרטים על ״${esc(r.name)}״…</h2><p class="why">קוראים את עמוד האירוע ומסכמים לך את מה שחשוב.</p>
    <div class="skel s3"></div><div class="skel s3"></div>
    <button class="cancel wide" data-act="ai-results">חזרה לרעיונות</button></div>`);
  view={type:'ai-more',ref,loading:true};
  try{
    const d=await AI.details(r);
    aiDetails.set(ref,d);
    if(view&&view.type==='ai-more'&&view.ref===ref){openSheet(detailsHTML(r,d,i));view={type:'ai-more',ref}}   // still looking at this one
  }catch(e){
    if(!(view&&view.type==='ai-more'&&view.ref===ref))return;
    openSheet(`<div class="grab"></div><div class="pad" style="text-align:center"><h2 class="dt">לא הצלחנו להביא פרטים</h2>
      <p class="shsub">${esc((e&&e.userMsg)||'נסו שוב עוד רגע.')}</p>
      <button class="submit" data-act="ai-more" data-i="${i}">נסו שוב</button><button class="cancel wide" data-act="ai-results">חזרה לרעיונות</button></div>`);
  }
}
function openAINav(i){
  const r=aiState.res&&aiState.res.recs[i],q=r&&AI.navQuery(r);if(!q)return;
  openSheet(navHTML({place:q},true));view={type:'nav'};   // same Maps / Waze / Apple Maps sheet as an outing
}
function createFromIdea(i){
  const r=aiState.res&&aiState.res.recs[i];if(!r)return;
  openForm(null,AI.toDraft(r));                            // the normal create form, already filled in
}

/* ---------- preferences (kept in Supabase, sent to the AI without names) ---------- */
async function openPrefs(){
  if(!me||!store)return;
  let rows=[];try{rows=await store.loadPrefs()}catch(e){}
  const mine=rows.find(r=>r.name===me.name);
  prefsDraft={tags:new Set((mine&&mine.tags)||[]),text:(mine&&mine.free_text)||''};
  const chips=PREF_TAGS.map(([t,e])=>{const on=prefsDraft.tags.has(t);return `<button class="ch${on?' on':''}" data-act="pref-tag" data-v="${esc(t)}" aria-pressed="${on}">${e} ${t}</button>`}).join('');
  openSheet(`<div class="grab"></div><div class="dhead"><h2 class="dt">ההעדפות שלי</h2><button class="x" data-act="ai-form" aria-label="חזרה">✕</button></div>
    <p class="shsub">עוזר לרעיונות להתאים לחבורה. נשלח ל-AI בלי שמות, ואפשר לשנות בכל רגע.</p>
    <div class="fl">מה אתם אוהבים?</div><div class="row">${chips}</div>
    <div class="fl">במילים שלכם (לא חובה)</div>
    <textarea class="txt area" id="p-text" maxlength="300" placeholder="אני אוהב מקומות חברתיים עם הרבה אנשים בגיל שלי">${esc(prefsDraft.text)}</textarea>
    <div class="formbar"><button class="submit" data-act="pref-save">שמור</button></div>`);
  view={type:'prefs'};
}
function togglePrefTag(v,el){
  if(!prefsDraft)return;
  if(prefsDraft.tags.has(v))prefsDraft.tags.delete(v);else prefsDraft.tags.add(v);
  const on=prefsDraft.tags.has(v);el.classList.toggle('on',on);el.setAttribute('aria-pressed',on);
}
function savePrefs(){
  if(!prefsDraft||!me)return;
  const tags=[...prefsDraft.tags],text=(prefsDraft.text||'').trim().slice(0,300),name=me.name;
  openAIForm();
  enqueue(()=>store.savePrefs(name,tags,text)).then(()=>toast('ההעדפות נשמרו')).catch(writeFail);
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
  else if(a==='rate')rateStars(id,Number(el.dataset.v));
  else if(a==='rate-save')saveComment(id);
  else if(a==='ai-open')openAI();
  else if(a==='ai-form')openAIForm();
  else if(a==='ai-back')openAIResults();
  else if(a==='ai-area')toggleArea(el.dataset.v,el);
  else if(a==='ai-area-add')addArea();
  else if(a==='ai-n-dec'||a==='ai-n-inc'||a==='ai-age-dec'||a==='ai-age-inc'){e.preventDefault();stepAI(a)}
  else if(a==='ai-go')runAI();
  else if(a==='ai-cancel'){aiRun++;openAIForm()}
  else if(a==='ai-nav')openAINav(Number(el.dataset.i));
  else if(a==='ai-create')createFromIdea(Number(el.dataset.i));
  else if(a==='prefs-open')openPrefs();
  else if(a==='pref-tag')togglePrefTag(el.dataset.v,el);
  else if(a==='pref-save')savePrefs();
  else if(a==='equip-add'){e.preventDefault();addEquipDraft()}
  else if(a==='equip-rm')rmEquipDraft(Number(el.dataset.i));
  else if(a==='equip-claim')claimEquip(id,el.dataset.item);
  else if(a==='equip-unclaim')unclaimEquip(id,el.dataset.item);
  else if(a==='equip-del')delEquip(id,el.dataset.item);
  else if(a==='equip-add-live')addEquipLive(id);
  else if(a==='equip-edit')startEquipEdit(el.dataset.item);
  else if(a==='equip-save')saveEquipEdit(id);
  else if(a==='notif-open')openNotifications();
  else if(a==='notif-go')goToNotification(id);
  else if(a==='groups')openGroups();
  else if(a==='group-open')openGroup(el.dataset.g);
  else if(a==='group-create')createGroupNow();
  else if(a==='group-share')shareGroup(el.dataset.g,false);
  else if(a==='group-copy')shareGroup(el.dataset.g,true);
  else if(a==='group-leave')leaveGroup(el);
  else if(a==='group-join')joinGroupNow();
  else if(a==='group-later'){clearGroupLink();closeSheet()}
  else if(a==='aud')toggleAudience(el.dataset.g);
  else if(a==='avatar-pick'){const f=$('#p-file');if(f)f.click()}
  else if(a==='avatar-clear')clearAvatar();
  else if(a==='code-show')showRecoveryCode(el);
  else if(a==='recover')recoverName(el.dataset.name);
  else if(a==='pick-other'){closeSheet();showGate()}
  else if(a==='ai-more')openAIMore(Number(el.dataset.i));
  else if(a==='ai-results')openAIResults();
});
document.addEventListener('change',e=>{if(e.target.id==='p-file'){const f=e.target.files&&e.target.files[0];e.target.value='';if(f)uploadAvatar(f)}});
document.addEventListener('input',e=>{
  const t=e.target.id;
  if(t==='ai-wish'&&aiForm)aiForm.wish=e.target.value;
  else if(t==='p-text'&&prefsDraft)prefsDraft.text=e.target.value;
  else if(t==='r-comment'&&view&&view.type==='detail'){
    const ev=state.events.find(x=>x.id===view.id),my=ev&&me&&ev.ratings[me.id];
    ratingDraft={id:view.id,stars:ratingDraft&&ratingDraft.id===view.id?ratingDraft.stars:(my?my.stars:0),comment:e.target.value};
  }
});
document.addEventListener('input',e=>{if(e.target.id==='f-place'||e.target.id==='f-time')syncForm()});
document.addEventListener('change',e=>{if(e.target.id==='f-time')syncForm()});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeSheet();
  if(e.key==='Enter'&&e.target.id==='g-name'){e.preventDefault();submitGate()}
  if(e.key==='Enter'&&e.target.id==='r-name'){e.preventDefault();saveRename()}
  if(e.key==='Enter'&&e.target.id==='f-place'){e.preventDefault();e.target.blur()}
  if(e.key==='Enter'&&e.target.id==='ai-area-in'){e.preventDefault();addArea()}
  if(e.key==='Enter'&&e.target.id==='f-equip'){e.preventDefault();addEquipDraft()}
  if(e.key==='Enter'&&e.target.id==='g-new'){e.preventDefault();createGroupNow()}
  if(e.key==='Enter'&&e.target.id==='eq-edit'){e.preventDefault();if(view&&view.type==='detail')saveEquipEdit(view.id)}
  if(e.key==='Enter'&&e.target.id==='eq-new'){e.preventDefault();if(view&&view.type==='detail')addEquipLive(view.id)}
  if((e.key==='Enter'||e.key===' ')&&e.target.getAttribute&&e.target.getAttribute('role')==='button'){e.preventDefault();e.target.click()}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)render()});
setInterval(render,60000);

/* ---------- boot ---------- */
(async function boot(){
  render();
  // came from a shared link: straight to the name, then the outing (the install offer can wait)
  if(!me){if(shouldOnboard()&&!pendingEventId&&!pendingGroupToken)showOnboarding();else showGate()}
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)&&!IS_NATIVE){
    window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})});
  }
  try{
    store=await makeStore();
    store.subscribe(setEvents,()=>{state.err=true;render()},setMeta);
    if(me)ensureProfile();
  }catch(e){state.err=true;render()}
})();
})();
