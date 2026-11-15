// Pull for any NSE ticker.
// 1. If the research agent has already written this company to the repo, serve it (raw GitHub is fresher than this deploy).
// 2. Otherwise check the symbol is real, then start the `research` GitHub Action (python pipeline/research.py TICKER)
//    and answer 202. The phone polls; the action commits the JSON in ~2-4 minutes.
const REPO = process.env.GITHUB_REPO ?? "rajagveer63/finn";
const BRANCH = process.env.GITHUB_BRANCH ?? "main";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/web/public/data`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase().replace(/\.NS$/, "");
  if (!/^[A-Z0-9&-]{2,15}$/.test(ticker)) return json({ message: "That does not look like an NSE symbol." }, 400);

  const company = await fetch(`${RAW}/company/${encodeURIComponent(ticker)}.json?t=${Date.now()}`, { cache: "no-store" });
  if (company.ok) {
    const lg = await fetch(`${RAW}/ledger/${encodeURIComponent(ticker)}.json?t=${Date.now()}`, { cache: "no-store" });
    return json({ company: await company.json(), ledger: lg.ok ? await lg.json() : null });
  }
  if (url.searchParams.get("start") !== "1") return json({ message: "Still reading the filings." }, 202);

  const real = await fetch(`https://www.screener.in/company/${encodeURIComponent(ticker)}/`, {
    method: "GET", redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (FINN research prototype)" }, cache: "no-store",
  }).catch(() => null);
  if (!real || real.status === 404) return json({ message: `${ticker} is not a listed NSE company we can find.` }, 404);

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return json({ message: "On-demand research is switched off on this deployment (no GitHub token). The pre-built companies still work." }, 503);
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/research.yml/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify({ ref: BRANCH, inputs: { ticker } }),
    cache: "no-store",
  });
  if (r.status !== 204) return json({ message: `Could not start the research agent (GitHub ${r.status}).` }, 502);
  return json({ message: "Reading the latest earnings calls and reported financials." }, 202);
}
