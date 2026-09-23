// Supabase Edge Function: ai-suggest
// Deploy:  supabase functions deploy ai-suggest --no-verify-jwt
// (--no-verify-jwt because the new sb_publishable_ keys are not JWTs; access is limited by APP_PUBLIC_KEY,
//  ALLOWED_ORIGINS and the rate limit below.)
// Secrets: GROQ_API_KEY (required) · APP_PUBLIC_KEY · ALLOWED_ORIGINS · TAVILY_API_KEY (optional) · GROQ_MODEL · GROQ_RESEARCH_MODEL
import { gatherEvidence } from "./sources.ts";
import { buildUserPrompt, KINDS, SYSTEM_PROMPT } from "./prompt.ts";

const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://eithan1710.github.io,capacitor://localhost,https://localhost,http://localhost").split(",").map((s) => s.trim());
const MODEL = Deno.env.get("GROQ_MODEL") ?? "llama-3.3-70b-versatile";
const HEBREW = /[\u0590-\u05FF]/;

/* ---------- tiny per-instance rate limit (best effort) ---------- */
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), win = 10 * 60_000, max = 8;
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
async function groqJson(system: string, user: string) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(40_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("GROQ_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.4, max_tokens: 3500,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error("groq " + r.status);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "null");
}

/* ---------- output: keep only what the evidence supports ---------- */
function shape(raw: any, evidence: { url: string }[], today: string) {
  const list = Array.isArray(raw?.recommendations) ? raw.recommendations : [];
  const max = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
  const out = list.map((r: any) => {
    const ids = [...new Set((Array.isArray(r?.source_ids) ? r.source_ids : []).map((x: unknown) => Number(x)))]
      .filter((i) => Number.isInteger(i) && i >= 1 && i <= evidence.length) as number[];
    const sources = ids.slice(0, 5).map((i) => ({ url: evidence[i - 1].url }));
    const verified = sources.length > 0;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r?.event_date ?? "") && r.event_date >= today && r.event_date <= max ? r.event_date : null;
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
      event_date: verified ? date : null,
      confidence: Math.min(verified ? 1 : 0.4, Math.max(0, Number(r?.confidence) || 0)),
      sources,
    };
  }).filter((r: any) => r.name && r.description);
  out.sort((a: any, b: any) => (b.sources.length > 0 ? 1 : 0) - (a.sources.length > 0 ? 1 : 0) || b.confidence - a.confidence);
  return { intro: s(raw?.intro, 120), recommendations: out.slice(0, 6) };
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
  const ctx = cleanInput(body);
  if (!ctx) return send(400, { ok: false, error: "no_info" });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  try {
    const prefTags = Object.keys(ctx.preferences?.liked_tags ?? {}).slice(0, 6);
    const { evidence } = await gatherEvidence({ areas: ctx.areas, group_size: ctx.group_size, age: ctx.age, wish: ctx.wish, prefTags }, today);
    // no evidence is not fatal: the model may then only give general, unverified ideas (the app labels them)

    let result = shape(await groqJson(SYSTEM_PROMPT, buildUserPrompt(ctx, evidence, today)), evidence, today);
    if (result.recommendations.length && !hebrewOk(result)) {
      result = shape(await groqJson(SYSTEM_PROMPT, buildUserPrompt(ctx, evidence, today, true)), evidence, today);
    }
    if (!result.recommendations.length || !hebrewOk(result)) {
      return send(200, { ok: false, error: result.recommendations.length ? "groq" : (evidence.length ? "no_info" : "research") });
    }
    return send(200, { ok: true, researchOk: evidence.length > 0, ...result });
  } catch (e) {
    console.error("ai-suggest failed:", e instanceof Error ? e.message : "unknown"); // never returned to the client
    return send(200, { ok: false, error: "groq" });
  }
});
