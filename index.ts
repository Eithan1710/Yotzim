// Supabase Edge Function: ai-suggest
// Deploy:  supabase functions deploy ai-suggest --no-verify-jwt
// (--no-verify-jwt because the new sb_publishable_ keys are not JWTs; access is limited by APP_PUBLIC_KEY,
//  ALLOWED_ORIGINS and the rate limit below.)
// Secrets: GROQ_API_KEY (required) · APP_PUBLIC_KEY · ALLOWED_ORIGINS · TAVILY_API_KEY (optional) · GROQ_MODEL · GROQ_RESEARCH_MODEL
import { gatherEvidence } from "./sources.ts";
import { buildDetailsPrompt, buildUserPrompt, DETAILS_SYSTEM_PROMPT, KINDS, SYSTEM_PROMPT } from "./prompt.ts";

const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://eithan1710.github.io,capacitor://localhost,https://localhost,http://localhost").split(",").map((s) => s.trim());
// llama-3.3-70b-versatile was deprecated by Groq on 2026-08-16 — openai/gpt-oss-120b is the default now
const MODEL = Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b";
const HEBREW = /[\u0590-\u05FF]/;

/* ---------- tiny per-instance rate limit (best effort) ---------- */
const hits = new Map<string, number[]>();
function limited(ip: string, max = 8) {
  const now = Date.now(), win = 10 * 60_000;
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < win)) hits.delete(k);
  return arr.length > max;
}

/* ---------- input: rebuild a clean object; nothing else is ever forwarded to Groq ---------- */
const s = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const n = (v: unknown, a: number, b: number, d: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
function cleanInput(b: any) {
  const areas = (Array.isArray(b?.areas) ? b.areas : []).map((a: unknown) => s(a, 40)).filter(Boolean).slice(0, 4);
  if (!areas.length) return null;
  const history = (Array.isArray(b?.history) ? b.history : []).slice(0, 30).map((h: any) => ({
    status: h?.status === "planned" ? "planned" : "past",
    type: s(h?.type, 20), place: h?.place ? s(h.place, 60) : null, month: s(h?.month, 7),
    attended: n(h?.attended, 0, 200, 0),
    avg_rating: h?.avg_rating == null ? null : Math.min(5, Math.max(1, Number(h.avg_rating) || 0)) || null,
    ratings_count: n(h?.ratings_count, 0, 200, 0),
    feedback: (Array.isArray(h?.feedback) ? h.feedback : []).slice(0, 2).map((f: unknown) => s(f, 140)),
  }));
  const p = b?.preferences;
  const preferences = p && typeof p === "object" ? {
    members_with_preferences: n(p.members_with_preferences, 0, 200, 0),
    liked_tags: Object.fromEntries(Object.entries(p.liked_tags ?? {}).slice(0, 20).map(([k, v]) => [s(k, 30), n(v, 0, 200, 0)])),
    notes: (Array.isArray(p.notes) ? p.notes : []).slice(0, 8).map((x: unknown) => s(x, 200)),
  } : null;
  const type_stats = Object.fromEntries(Object.entries(b?.type_stats ?? {}).slice(0, 12).map(([k, v]: [string, any]) =>
    [s(k, 20), { count: n(v?.count, 0, 999, 0), avg_rating: v?.avg_rating == null ? null : Number(v.avg_rating) || null }]));
  return {
    areas, group_size: n(b?.group_size, 1, 60, 6), age: n(b?.age, 14, 80, 20), wish: s(b?.wish, 400),
    preferences, history, type_stats, total_past_outings: n(b?.total_past_outings, 0, 9999, 0),
  };
}

/* ---------- Groq ---------- */
async function groqJson(system: string, user: string, opts: { max?: number; timeout?: number } = {}) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(opts.timeout ?? 40_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("GROQ_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.4, max_tokens: opts.max ?? 3500, reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error("groq " + r.status);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "null");
}

/* ---------- date window: default = the near future; an explicit request in the wish is respected ---------- */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d: string, k: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const DEFAULT_DAYS = 14, MAX_SPAN_DAYS = 62, MAX_AHEAD_DAYS = 240;
type Win = { from: string; to: string; explicit: boolean };
const DATE_PROMPT = `Extract the period the user EXPLICITLY asks about in their request (Hebrew or English).
Return ONLY JSON: {"explicit": boolean, "from": "YYYY-MM-DD"|null, "to": "YYYY-MM-DD"|null}.
explicit=true only if the text names a date, a day, a weekend, a week, a month or another period ("next month", "this Friday", "October 15", "בחודש הבא", "בסוף השבוע").
Resolve relative expressions against "today". Otherwise explicit=false and both dates null. Never guess a period the user did not ask for.`;
async function resolveWindow(wish: string, today: string): Promise<Win> {
  const def: Win = { from: today, to: addDays(today, DEFAULT_DAYS), explicit: false };
  if (!wish) return def;
  try {
    const j = await groqJson(DATE_PROMPT, JSON.stringify({ today, wish }), { max: 600, timeout: 15_000 });
    if (!j?.explicit || !ISO.test(j?.from ?? "") || !ISO.test(j?.to ?? "")) return def;
    let from = j.from < today ? today : j.from, to = j.to;
    if (to < from || from > addDays(today, MAX_AHEAD_DAYS)) return def;
    if (to > addDays(from, MAX_SPAN_DAYS)) to = addDays(from, MAX_SPAN_DAYS);
    return { from, to, explicit: true };
  } catch { return def; }   // the date parse must never break the search: fall back to the default window
}

/* ---------- "More information": facts about ONE outing (never a redirect to the source site) ---------- */
function safeUrl(u: unknown): string | null {
  try {
    const x = new URL(String(u));
    const h = x.hostname.toLowerCase();
    if (!/^https?:$/.test(x.protocol) || h === "localhost" || h.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return null;
    return x.toString();
  } catch { return null; }
}
function pageToText(html: string): string {
  // schema.org Event data is the most reliable part of an event page: keep it first
  const ld: string[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: any) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== "object") return;
        const t = JSON.stringify(n["@type"] ?? "");
        if (/Event/i.test(t)) {
          ld.push(JSON.stringify({ name: n.name, startDate: n.startDate, endDate: n.endDate, location: n.location?.name ?? n.location,
            address: n.location?.address, organizer: n.organizer?.name ?? n.organizer, offers: n.offers, description: n.description }).slice(0, 1500));
        }
        if (n["@graph"]) walk(n["@graph"]);
      };
      walk(JSON.parse(m[1]));
    } catch { /* ignore broken JSON-LD */ }
  }
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
  return (ld.length ? "STRUCTURED EVENT DATA: " + ld.join(" | ") + "\n" : "") + body;
}
async function fetchPage(u: string): Promise<string> {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8_000), redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; YotzimBot/1.0)", Accept: "text/html,text/plain" } });
    if (!r.ok || !safeUrl(r.url) || !/text\/(html|plain)/.test(r.headers.get("content-type") ?? "")) return "";
    return pageToText((await r.text()).slice(0, 400_000)).slice(0, 6000);
  } catch { return ""; }
}
function cleanItem(b: any) {
  const it = b?.item;
  if (!it || typeof it !== "object") return null;
  const name = s(it.name, 90);
  if (!name) return null;
  const urls = [it.event_url, ...(Array.isArray(it.source_urls) ? it.source_urls : [])].map(safeUrl).filter(Boolean) as string[];
  return {
    ref: s(b?.ref, 40), item: {
      name, kind: s(it.kind, 20), type: s(it.type, 30), location: s(it.location, 80), venue: s(it.venue, 80), address: s(it.address, 120),
      description: s(it.description, 400), why_it_fits: s(it.why, 260), estimated_cost: s(it.cost, 50), age_fit: s(it.age, 80),
      date: ISO.test(it.date ?? "") ? it.date : null, time: /^\d{2}:\d{2}$/.test(it.time ?? "") ? it.time : null,
    }, urls: [...new Set(urls)].slice(0, 3),
  };
}
const list = (v: unknown, k: number, m: number) => (Array.isArray(v) ? v : []).map((x) => s(x, m)).filter(Boolean).slice(0, k);
function shapeDetails(j: any) {
  const UNK = ["meeting_point", "duration", "difficulty", "price", "organizer", "bring", "requirements", "instructions"];
  const d = {
    summary: s(j?.summary, 300), meeting_point: j?.meeting_point ? s(j.meeting_point, 160) : null,
    duration: j?.duration ? s(j.duration, 80) : null, difficulty: j?.difficulty ? s(j.difficulty, 80) : null,
    price: j?.price ? s(j.price, 100) : null, organizer: j?.organizer ? s(j.organizer, 100) : null,
    age_restriction: j?.age_restriction ? s(j.age_restriction, 100) : null,
    bring: list(j?.bring, 12, 80), requirements: list(j?.requirements, 8, 120), instructions: list(j?.instructions, 8, 160), extra: list(j?.extra, 6, 160),
  } as Record<string, any>;
  // "unknown" is derived from what is really empty, not trusted from the model
  d.unknown = UNK.filter((k) => Array.isArray(d[k]) ? d[k].length === 0 : !d[k]);
  return d;
}

/* ---------- output: keep only what the evidence supports ---------- */
function shape(raw: any, evidence: { url: string }[], today: string, win: Win) {
  const list = Array.isArray(raw?.recommendations) ? raw.recommendations : [];
  const out = list.map((r: any) => {
    const ids = [...new Set<number>((Array.isArray(r?.source_ids) ? r.source_ids : []).map((x: unknown) => Number(x)))]
      .filter((i) => Number.isInteger(i) && i >= 1 && i <= evidence.length) as number[];
    const sources = ids.slice(0, 5).map((i) => ({ url: evidence[i - 1].url }));
    const verified = sources.length > 0;
    const claimed = ISO.test(r?.event_date ?? "") ? r.event_date as string : null;
    // a dated event outside the window (or already over) is not a valid answer: it is dropped below, not just hidden
    const outOfWindow = !!claimed && (claimed < today || claimed < win.from || claimed > win.to);
    const date = claimed && !outOfWindow ? claimed : null;
    const time = date && /^([01]\d|2[0-3]):[0-5]\d$/.test(r?.event_time ?? "") ? r.event_time : null;
    const urlId = Number(r?.event_url_source_id);
    const eventUrl = verified && Number.isInteger(urlId) && ids.includes(urlId) ? evidence[urlId - 1].url : null;
    return {
      name: s(r?.name, 70), kind: KINDS.includes(r?.kind) ? r.kind : "other", type: s(r?.type, 30),
      location: s(r?.location, 80),
      // no evidence → no specific venue, address, price or date (a general idea only)
      venue_name: verified && r?.venue_name ? s(r.venue_name, 80) : null,
      address: verified && r?.address ? s(r.address, 120) : null,
      description: s(r?.description, 320), why_it_fits: s(r?.why_it_fits, 260),
      estimated_cost: verified && r?.estimated_cost ? s(r.estimated_cost, 50) : null,
      group_fit: r?.group_fit ? s(r.group_fit, 80) : null, age_fit: verified && r?.age_fit ? s(r.age_fit, 80) : null,
      social_level: r?.social_level == null ? null : n(r.social_level, 1, 5, 3),
      is_specific_event: !!r?.is_specific_event,
      event_date: verified ? date : null,
      event_time: verified ? time : null,
      event_url: eventUrl,
      confidence: Math.min(verified ? 1 : 0.4, Math.max(0, Number(r?.confidence) || 0)),
      sources, _drop: outOfWindow,
    };
  }).filter((r: any) => r.name && r.description && !r._drop);
  // soonest verified events first, then verified places, then general ideas; undated "events" last and capped
  const rank = (r: any) => r.event_date ? 0 : (r.is_specific_event ? 3 : (r.sources.length ? 1 : 2));
  out.sort((a: any, b: any) => rank(a) - rank(b) || (a.event_date && b.event_date ? a.event_date.localeCompare(b.event_date) : 0) || b.confidence - a.confidence);
  let undated = 0;
  const kept = out.filter((r: any) => !(r.is_specific_event && !r.event_date) || ++undated <= 2).map(({ _drop, ...r }: any) => r);
  return { intro: s(raw?.intro, 120), recommendations: kept.slice(0, 6) };
}
const hebrewOk = (o: { intro: string; recommendations: any[] }) =>
  HEBREW.test(o.intro || "א") && o.recommendations.every((r) => HEBREW.test(r.name) && HEBREW.test(r.description) && (!r.why_it_fits || HEBREW.test(r.why_it_fits)));

/* ---------- handler ---------- */
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  };
  const send = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return send(405, { ok: false, error: "groq" });
  const pk = Deno.env.get("APP_PUBLIC_KEY");
  if ((pk && req.headers.get("apikey") !== pk) || (origin && !ORIGINS.includes(origin))) return send(403, { ok: false, error: "groq" });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return send(429, { ok: false, error: "rate" });
  if (!Deno.env.get("GROQ_API_KEY")) return send(500, { ok: false, error: "groq" });

  let body: any;
  try { body = await req.json(); } catch { return send(400, { ok: false, error: "groq" }); }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

  // "More information" about one selected outing: the app sends that outing's own data; the answer is about it only
  if (body?.action === "details") {
    if (limited(ip + ":d", 12)) return send(429, { ok: false, error: "rate" });
    const d = cleanItem(body);
    if (!d) return send(400, { ok: false, error: "no_info" });
    try {
      const pages = (await Promise.all(d.urls.map(async (url) => ({ url, text: await fetchPage(url) })))).filter((p) => p.text);
      const details = shapeDetails(await groqJson(DETAILS_SYSTEM_PROMPT, buildDetailsPrompt(d.item, pages), { max: 1800, timeout: 30_000 }));
      if (!details.summary || !HEBREW.test(details.summary)) return send(200, { ok: false, error: "groq" });
      return send(200, { ok: true, ref: d.ref, details, pagesRead: pages.length });
    } catch (e) {
      console.error("ai details failed:", e instanceof Error ? e.message : "unknown");
      return send(200, { ok: false, error: "groq" });
    }
  }

  const ctx = cleanInput(body);
  if (!ctx) return send(400, { ok: false, error: "no_info" });
  try {
    const prefTags = Object.keys(ctx.preferences?.liked_tags ?? {}).slice(0, 6);
    const win = await resolveWindow(ctx.wish, today);
    (ctx as any).date_window = win;
    const { evidence } = await gatherEvidence({ areas: ctx.areas, group_size: ctx.group_size, age: ctx.age, wish: ctx.wish, prefTags, from: win.from, to: win.to }, today);
    // no evidence is not fatal: the model may then only give general, unverified ideas (the app labels them)

    let result = shape(await groqJson(SYSTEM_PROMPT, buildUserPrompt(ctx, evidence, today)), evidence, today, win);
    if (result.recommendations.length && !hebrewOk(result)) {
      result = shape(await groqJson(SYSTEM_PROMPT, buildUserPrompt(ctx, evidence, today, true)), evidence, today, win);
    }
    if (!result.recommendations.length || !hebrewOk(result)) {
      return send(200, { ok: false, error: result.recommendations.length ? "groq" : (evidence.length ? "no_info" : "research") });
    }
    return send(200, { ok: true, researchOk: evidence.length > 0, window: win, ...result });
  } catch (e) {
    console.error("ai-suggest failed:", e instanceof Error ? e.message : "unknown"); // never returned to the client
    return send(200, { ok: false, error: "groq" });
  }
});
