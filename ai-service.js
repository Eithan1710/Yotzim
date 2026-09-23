/* aiOutingService — everything the browser needs for "✨ רעיונות" except the UI itself.
   Builds a small, privacy-safe context, calls the Supabase Edge Function (the Groq key lives there,
   never here), validates the answer and turns failures into short Hebrew messages.
   Exposes window.AIOuting. No dependencies. */
(function(){
'use strict';

const MSG={
  groq:'לא הצלחנו ליצור הצעות כרגע. נסו שוב עוד רגע.',
  research:'לא הצלחנו להביא מספיק מידע עדכני. נסו שוב או הרחיבו את החיפוש.',
  no_info:'לא מצאנו מספיק מידע לחיפוש הזה. נסו להרחיב את האזור או לשנות את ההעדפות.',
  rate:'ביקשתם הרבה רעיונות בזמן קצר. נסו שוב בעוד כמה דקות.',
  offline:'אין חיבור לאינטרנט. נסו שוב כשיש קליטה.',
  timeout:'זה לוקח יותר מדי זמן. נסו שוב.',
  disabled:'הרעיונות עוד לא הופעלו באתר הזה.'
};
class AIError extends Error{constructor(code){super(code);this.code=code;this.userMsg=MSG[code]||MSG.groq}}

const KIND_KEYS=['bar','beach','party','food','movie','billiard','trip','home','gaming','other'];
const clip=(s,n)=>String(s==null?'':s).replace(/\s+/g,' ').trim().slice(0,n);
const num=(v,a,b)=>{if(v==null||v==='')return null;v=Number(v);return Number.isFinite(v)?Math.min(b,Math.max(a,v)):null};
const avg=a=>a.length?Math.round(a.reduce((s,x)=>s+x,0)/a.length*10)/10:null;

/* ---------- context: only what the model needs, and only the relevant slice of history ---------- */
function summarizeEvent(ev,kinds,status){
  const rs=Object.values(ev.ratings||{}),stars=rs.map(r=>r.stars);
  const d=new Date(ev.when);
  return{
    status,                                                     // 'past' | 'planned'
    type:kinds[ev.kind]?kinds[ev.kind].t:'אחר',
    place:ev.kind==='home'?null:clip(ev.place,60),               // home outings often contain a friend's name: never sent
    month:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),
    attended:Object.values(ev.rsvps||{}).filter(s=>s==='yes').length,
    avg_rating:avg(stars),ratings_count:stars.length,
    feedback:rs.map(r=>clip(r.comment,140)).filter(Boolean).slice(0,2)
  };
}
/* Picks: recent, best rated, worst rated, same area. Everything older is only summarized per type. */
function buildHistory(o){
  const {events,kinds,now,pastAfter,areas}=o;
  const past=events.filter(e=>e.when+pastAfter<now).sort((a,b)=>b.when-a.when);
  const planned=events.filter(e=>e.when+pastAfter>=now).sort((a,b)=>a.when-b.when).slice(0,5);
  const score=e=>avg(Object.values(e.ratings||{}).map(r=>r.stars));
  const pick=new Map();
  const add=(list,n)=>{for(const e of list){if(n<=0)break;if(!pick.has(e.id)){pick.set(e.id,e);n--}}};
  add(past,8);
  add(past.filter(e=>score(e)>=4).sort((a,b)=>score(b)-score(a)),5);
  add(past.filter(e=>score(e)!=null&&score(e)<=2.5).sort((a,b)=>score(a)-score(b)),5);
  const al=(areas||[]).map(a=>a.toLowerCase());
  add(past.filter(e=>al.some(a=>String(e.place).toLowerCase().includes(a))),5);
  const chosen=[...pick.values()].sort((a,b)=>b.when-a.when).map(e=>summarizeEvent(e,kinds,'past'));
  const stats={};
  past.forEach(e=>{
    const t=kinds[e.kind]?kinds[e.kind].t:'אחר',s=stats[t]||(stats[t]={count:0,_r:[]});
    s.count++;const sc=score(e);if(sc!=null)s._r.push(sc);
  });
  Object.keys(stats).forEach(t=>{stats[t]={count:stats[t].count,avg_rating:avg(stats[t]._r)}});
  return{history:chosen.concat(planned.map(e=>summarizeEvent(e,kinds,'planned'))),type_stats:stats,total_past:past.length};
}
/* Preferences of the whole group, anonymous: counts per tag + free-text lines without names */
function buildPrefs(rows){
  rows=(rows||[]).filter(r=>r&&((r.tags&&r.tags.length)||r.free_text));
  if(!rows.length)return null;
  const counts={};
  rows.forEach(r=>(r.tags||[]).forEach(t=>{counts[t]=(counts[t]||0)+1}));
  const notes=[...new Set(rows.map(r=>clip(r.free_text,200)).filter(Boolean))].slice(0,8);
  return{members_with_preferences:rows.length,liked_tags:counts,notes};
}
function buildContext(o){
  const areas=o.form.areas.map(a=>clip(a,40)).filter(Boolean).slice(0,4);
  const h=buildHistory({events:o.events,kinds:o.kinds,now:o.now,pastAfter:o.pastAfter,areas});
  return{
    areas,group_size:Number(o.form.n)||6,age:Number(o.form.age)||20,
    wish:clip(o.form.wish,400),
    preferences:buildPrefs(o.prefsRows),
    history:h.history,type_stats:h.type_stats,total_past_outings:h.total_past
  };
}

/* ---------- request ---------- */
function endpoint(){
  const c=window.APP_CONFIG||{};
  if(c.AI_URL)return c.AI_URL;
  return c.SUPABASE_URL?c.SUPABASE_URL.replace(/\/+$/,'')+'/functions/v1/ai-suggest':'';
}
const isHttp=u=>/^https?:\/\//i.test(u);
function cleanRec(r){
  if(!r||typeof r!=='object')return null;
  const name=clip(r.name,70),desc=clip(r.description,320);
  if(!name||!desc)return null;
  const sources=(Array.isArray(r.sources)?r.sources:[]).map(s=>({url:clip(s&&s.url,500),label:clip(s&&s.label,40)}))
    .filter(s=>isHttp(s.url)).slice(0,5);
  const date=/^\d{4}-\d{2}-\d{2}$/.test(r.event_date||'')?r.event_date:null;
  return{
    name,kind:KIND_KEYS.includes(r.kind)?r.kind:'other',
    type:clip(r.type,30)||null,location:clip(r.location,80)||null,
    venue:clip(r.venue_name,80)||null,address:clip(r.address,120)||null,
    description:desc,why:clip(r.why_it_fits,260)||null,
    cost:clip(r.estimated_cost,50)||null,group:clip(r.group_fit,80)||null,age:clip(r.age_fit,80)||null,
    social:num(r.social_level,1,5),confidence:num(r.confidence,0,1),date,
    verified:sources.length>0,sources
  };
}
async function suggest(ctx){
  const url=endpoint();
  if(!url)throw new AIError('disabled');
  if(navigator.onLine===false)throw new AIError('offline');
  const key=(window.APP_CONFIG||{}).SUPABASE_ANON_KEY||'';
  const headers={'Content-Type':'application/json',apikey:key};
  if(key.indexOf('eyJ')===0)headers.Authorization='Bearer '+key;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),100000);
  let res;
  try{res=await fetch(url,{method:'POST',headers,body:JSON.stringify(ctx),signal:ctl.signal})}
  catch(e){throw new AIError(e&&e.name==='AbortError'?'timeout':(navigator.onLine===false?'offline':'groq'))}
  finally{clearTimeout(timer)}
  let data=null;try{data=await res.json()}catch(e){}
  if(res.status===429)throw new AIError('rate');
  if(!res.ok||!data||data.ok!==true)throw new AIError(data&&MSG[data.error]?data.error:'groq');
  const recs=(Array.isArray(data.recommendations)?data.recommendations:[]).map(cleanRec).filter(Boolean).slice(0,6);
  if(!recs.length)throw new AIError('no_info');
  return{intro:clip(data.intro,120)||'מצאנו כמה רעיונות שיכולים להתאים לכם:',recs,at:Date.now()};
}

/* ---------- small helpers for the UI ---------- */
const SITE={'instagram.com':'Instagram','facebook.com':'Facebook','reddit.com':'Reddit','tiktok.com':'TikTok','eventbuzz.co.il':'Eventbuzz','tripadvisor.com':'Tripadvisor'};
function sourceLabel(s){
  try{
    const h=new URL(s.url).hostname.replace(/^www\./,'');
    for(const k in SITE)if(h===k||h.endsWith('.'+k))return SITE[k];
    return s.label||h;
  }catch(e){return s.label||'אתר'}
}
// Text to search for on a map. Only when the recommendation names a real venue/address (never for a general idea).
function navQuery(r){
  if(r.address)return r.address;
  if(r.venue)return r.venue+(r.location&&!r.venue.includes(r.location)?' '+r.location:'');
  return '';
}
function moreInfoUrl(r){
  const first=r.sources.find(s=>!/instagram|facebook|tiktok/.test(s.url));
  return first?first.url:'https://www.google.com/search?q='+encodeURIComponent((r.venue||r.name)+' '+(r.location||''));
}
// What "Create outing" pre-fills in the existing form
function toDraft(r){
  const place=clip(navQuery(r)?(r.venue||r.address):(r.name),60);
  return{kind:r.kind,place,description:clip(r.description,500),date:r.date};
}

window.AIOuting={suggest,buildContext,sourceLabel,navQuery,moreInfoUrl,toDraft,AIError,MSG};
})();
