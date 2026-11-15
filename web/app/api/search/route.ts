import { search } from "@/lib/live";
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  if (q.length < 2) return Response.json([]);
  try {
    return new Response(JSON.stringify(await search(q)), { headers: { "content-type": "application/json", "cache-control": "public, s-maxage=86400" } });
  } catch { return Response.json([]); }
}
