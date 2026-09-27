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
    out.push({ title: clip(o.title, 120), url: o.url, snippet: clip(o.content ?? o.snippet ?? o.title, 600) });
  }
  for (const k of Object.keys(o)) if (typeof o[k] === "object") collect(o[k], out, depth + 1);
}

/* ---- Provider 1: openai/gpt-oss-120b with the built-in browser_search tool (needs only the Groq key) ----
   groq/compound and groq/compound-mini were decommissioned by Groq on 2026-09-21; there is no drop-in
   replacement model id, so this calls the underlying reasoning model directly with its own web tool. */
const groqBrowserSearch: Provider = {
  name: "groq-browser-search",
  enabled: () => !!Deno.env.get("GROQ_API_KEY"),
  async research(ctx, today) {
    const model = Deno.env.get("GROQ_RESEARCH_MODEL") ?? "openai/gpt-oss-120b";
    // one search per area, in parallel, so a big area doesn't drown a small one
    const one = async (area: string) => {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(70_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("GROQ_API_KEY")}` },
        body: JSON.stringify({
          model,
          reasoning_effort: "low",   // browser sessions get expensive fast at higher effort; low is plenty for this
          tool_choice: "required",
          tools: [{ type: "browser_search" }],
          citation_options: "enabled",
          messages: [
            {
              role: "system",
              content:
                "You are a research assistant. Use browser search (search in Hebrew and in English) to find CURRENT, real information. " +
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
      if (!r.ok) throw new Error(`${model} HTTP ${r.status}: ${clip(await r.text(), 300)}`);
      const j = await r.json();
      const msg = j?.choices?.[0]?.message;
      const content: string = typeof msg?.content === "string" ? msg.content : "";
      // Each url_citation annotation points at the exact span of the answer it backs — use that span as the snippet
      const found: Evidence[] = (Array.isArray(msg?.annotations) ? msg.annotations : [])
        .filter((a: any) => a?.type === "url_citation" && isHttp(a?.url_citation?.url))
        .map((a: any) => {
          const c = a.url_citation;
          const span = (typeof c.start_index === "number" && typeof c.end_index === "number")
            ? content.slice(c.start_index, c.end_index) : "";
          return { title: clip(c.title, 120), url: c.url as string, snippet: clip(span || content, 600) };
        });
      if (!found.length) collect(msg?.executed_tools, found);  // fall back to whatever shape the tool call actually returned
      if (!found.length) console.error(`research: ${model} returned no citations for "${area}"; tools used: ${msg?.executed_tools?.length ?? 0}`);
      return found;
    };
    const jobs = ctx.areas.slice(0, 3).map(async (area) => {
      try { return await one(area); }
      catch (e) { console.error("research failed:", e instanceof Error ? e.message : String(e)); return [] as Evidence[]; }
    });
    return (await Promise.all(jobs)).flat();
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

const PROVIDERS: Provider[] = [groqBrowserSearch, tavily];

export async function gatherEvidence(ctx: Ctx, today: string): Promise<{ evidence: Evidence[]; failed: number }> {
  const active = PROVIDERS.filter((p) => p.enabled());
  const results = await Promise.allSettled(active.map((p) => p.research(ctx, today)));
  const seen = new Set<string>();
  const evidence: Evidence[] = [];
  let failed = 0;
  for (const r of results) {
    if (r.status === "rejected") { failed++; console.error("provider failed:", String(r.reason)); continue; }
    for (const e of r.value) {
      const key = e.url.split("#")[0];
      if (seen.has(key) || !e.snippet) continue;
      seen.add(key);
      evidence.push(e);
    }
  }
  return { evidence: evidence.slice(0, 16), failed };
}
