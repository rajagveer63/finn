import { company } from "@/lib/live";
export const maxDuration = 30;
const ok = (b: unknown, s = 200, cache = "public, s-maxage=21600, stale-while-revalidate=86400") =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": s === 200 ? cache : "no-store" } });

export async function GET(req: Request) {
  const t = (new URL(req.url).searchParams.get("ticker") ?? "").trim().toUpperCase().replace(/\.NS$/, "");
  if (!/^[A-Z0-9&-]{2,20}$/.test(t)) return ok({ message: "That does not look like an NSE symbol." }, 400);
  try { return ok({ company: await company(t) }); }
  catch (e) {
    const nf = e instanceof Error && e.message === "not-found";
    return ok({ message: nf ? `${t} is not a listed company we can find. Try searching by name.` : "screener.in did not answer. Try again in a minute." }, nf ? 404 : 502);
  }
}
