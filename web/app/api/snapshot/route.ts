import { snapshot } from "@/lib/live";
export const maxDuration = 60;
const ok = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": s === 200 ? "public, s-maxage=86400, stale-while-revalidate=604800" : "no-store" } });

export async function GET(req: Request) {
  const t = (new URL(req.url).searchParams.get("ticker") ?? "").trim().toUpperCase().replace(/\.NS$/, "");
  if (!/^[A-Z0-9&-]{2,20}$/.test(t)) return ok({ message: "bad symbol" }, 400);
  try {
    const r = await snapshot(t);
    return ok(r, r.research ? 200 : 503);
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return ok({ research: null, reason: m === "no-llm" ? "The model key is not set on this deployment." : "Could not read the filings just now. Try again in a minute." }, 503);
  }
}
