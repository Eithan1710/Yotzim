// Research layer. Each provider turns a request into "evidence": real pages (title, url, snippet) found by a
// search engine. Add a new source by writing one more Provider and putting it in PROVIDERS.
// Nothing here logs in to, or scrapes around the restrictions of, Instagram / Facebook: those pages only appear
// if a normal public search engine returns them.

export type Ctx = { areas: string[]; group_size: number; age: number; wish: string; prefTags: string[] };
export type Evidence = { title: string; url: string; snippet: string };
export interface Provider {
  name: string;
  enabled(): boolean;
  research(ctx: Ctx, today: string): Promise<Evidence[]>;
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const isHttp = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

// Walks any JSON and collects {url,title,content} objects: Groq's executed_tools shape can change between versions.
function collect(node: unknown, out: Evidence[], depth = 0) {
  if (!node || depth > 8 || out.length > 60) return;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out, depth + 1)); return; }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (isHttp(o.url) && (o.title || o.content || o.snippet)) {
    out.push({ title: clip(o.title, 120), url: o.url, snippet: clip(o.content ?? o.snippet, 600) });
  }
  for (const k of Object.keys(o)) if (typeof o[k] === "object") collect(o[k], out, depth + 1);
}

/* ---- Provider 1: Groq Compound (built-in web search; needs only the Groq key) ---- */
const groqCompound: Provider = {
  name: "groq-compound",
  enabled: () => !!Deno.env.get("GROQ_API_KEY"),
  async research(ctx, today) {
    const model = Deno.env.get("GROQ_RESEARCH_MODEL") ?? "groq/compound";
    // one search per area, in parallel, so a big area doesn't drown a small one
    const jobs = ctx.areas.slice(0, 3).map(async (area) => {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(70_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("GROQ_API_KEY")}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are a research assistant. Use web search (search in Hebrew and in English) to find CURRENT, real information. " +
                "Only report what you actually found. Never guess. Keep the final answer to a short list.",
            },
            {
              role: "user",
              content:
                `Today is ${today}. Find what is happening now or in the next 3 weeks and which places are currently popular in ${area}, Israel, ` +
                `for a group of ${ctx.group_size} people around age ${ctx.age}. What they want: "${ctx.wish || "a fun social outing"}". ` +
                (ctx.prefTags.length ? `They like: ${ctx.prefTags.join(", ")}. ` : "") +
                "Look at event listings, venue and restaurant/bar websites, local articles, Reddit threads and any public social pages that a normal web search returns. " +
                "Note the crowd/age, atmosphere and anything about opening days or prices, only if a page says so.",
            },
          ],
        }),
      });
      if (!r.ok) throw new Error("compound " + r.status);
      const j = await r.json();
      const found: Evidence[] = [];
      collect(j?.choices?.[0]?.message?.executed_tools, found);
      return found;
    });
    const settled = await Promise.allSettled(jobs);
    return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  },
};

/* ---- Provider 2 (optional): Tavily search API. Set TAVILY_API_KEY to enable ---- */
const tavily: Provider = {
  name: "tavily",
  enabled: () => !!Deno.env.get("TAVILY_API_KEY"),
  async research(ctx) {
    const qs = ctx.areas.slice(0, 3).flatMap((a) => [
      `${a} events this week ${ctx.wish}`.trim(),
      `${a} popular bars clubs beach young crowd`,
    ]);
    const res = await Promise.allSettled(qs.map(async (query) => {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("TAVILY_API_KEY")}` },
        body: JSON.stringify({ query, max_results: 6, search_depth: "basic" }),
      });
      if (!r.ok) throw new Error("tavily " + r.status);
      const j = await r.json();
      return (j.results ?? []).filter((x: any) => isHttp(x.url)).map((x: any) =>
        ({ title: clip(x.title, 120), url: x.url as string, snippet: clip(x.content, 600) }));
    }));
    return res.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  },
};

const PROVIDERS: Provider[] = [groqCompound, tavily];

export async function gatherEvidence(ctx: Ctx, today: string): Promise<{ evidence: Evidence[]; failed: number }> {
  const active = PROVIDERS.filter((p) => p.enabled());
  const results = await Promise.allSettled(active.map((p) => p.research(ctx, today)));
  const seen = new Set<string>();
  const evidence: Evidence[] = [];
  let failed = 0;
  for (const r of results) {
    if (r.status === "rejected") { failed++; continue; }
    for (const e of r.value) {
      const key = e.url.split("#")[0];
      if (seen.has(key) || !e.snippet) continue;
      seen.add(key);
      evidence.push(e);
    }
  }
  return { evidence: evidence.slice(0, 16), failed };
}
