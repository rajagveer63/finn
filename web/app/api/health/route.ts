// Open /api/health on the deployment to see which outside service a live-research step cannot reach.
// Reports only yes/no and HTTP codes; never the key itself.
export const maxDuration = 30;
const UA = { "user-agent": "Mozilla/5.0 (FINN research prototype)" };

async function probe(url: string, init: RequestInit = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(12000) });
    return { ok: r.ok, status: r.status, type: r.headers.get("content-type"), ms: Date.now() - t0 };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.name : "error", ms: Date.now() - t0 }; }
}

export async function GET() {
  const base = (process.env.LLM_BASE_URL ?? "").replace(/\/$/, ""), key = process.env.LLM_API_KEY;
  const [screener, yahoo, bse, llm] = await Promise.all([
    probe("https://www.screener.in/company/TATASTEEL/consolidated/", { headers: UA }),
    probe("https://query1.finance.yahoo.com/v8/finance/chart/TATASTEEL.NS?range=5d&interval=1d", { headers: UA }),
    probe("https://www.bseindia.com/xml-data/corpfiling/AttachHis/7982fc61-7765-4981-ab3d-6aec36ba2137.pdf",
      { headers: { ...UA, accept: "application/pdf,*/*", referer: "https://www.bseindia.com/", range: "bytes=0-1023" } }),
    base && key
      ? probe(`${base}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: process.env.LLM_MODEL ?? "hyde/glm-5.3-flash", max_tokens: 5, messages: [{ role: "user", content: "ok" }] }) })
      : Promise.resolve({ ok: false, error: "LLM_BASE_URL / LLM_API_KEY not set" }),
  ]);
  return Response.json({ region: process.env.VERCEL_REGION ?? "local", llm_env_set: Boolean(base && key), screener, yahoo, bse_pdf: bse, llm },
    { headers: { "cache-control": "no-store" } });
}
