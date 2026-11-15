// Live research for any NSE company, run inside the Vercel function.
// TypeScript port of pipeline/screener.py + pipeline/metrics.py (same numbers, same shapes),
// plus a grounded snapshot read from the latest earnings-call transcript or annual report.
import * as cheerio from "cheerio";

const UA = { "user-agent": "Mozilla/5.0 (FINN research prototype)" };
type Table = { cols: string[]; rows: Record<string, (number | null)[]> } | null;
type Px = { d: string; c: number }[];

const num = (t: string): number | null => {
  const s = t.replace(/[,%₹]|Cr\./g, "").trim();
  if (!s || s === "-" || s === "--") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function table($: cheerio.CheerioAPI, id: string): Table {
  const tb = $(`#${id} table`).first();
  if (!tb.length) return null;
  const cols = tb.find("thead th").map((_, th) => $(th).text().trim()).get().slice(1);
  const rows: Record<string, (number | null)[]> = {};
  tb.find("tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 2) return;
    const label = $(tds[0]).text().replace(/\s+/g, " ").trim().replace(/\s*\+$/, "").trim();
    if (label === "Raw PDF") return;
    rows[label.split(" Share of")[0]] = tds.slice(1).map((_, td) => num($(td).text())).get();
  });
  return cols.length ? { cols, rows } : null;
}

async function page(ticker: string, consolidated: boolean) {
  const r = await fetch(`https://www.screener.in/company/${encodeURIComponent(ticker)}/${consolidated ? "consolidated/" : ""}`, { headers: UA, cache: "no-store" });
  if (r.status === 404) throw new Error("not-found");
  if (!r.ok) throw new Error(`screener ${r.status}`);
  return cheerio.load(await r.text());
}

export async function screener(ticker: string) {
  let $ = await page(ticker, true), basis = "consolidated";
  const q0 = table($, "quarters");
  if (!q0 || !(q0.rows["Net Profit"] ?? []).some((v) => v != null)) { $ = await page(ticker, false); basis = "standalone"; }
  const top_ratios: Record<string, number | number[] | null> = {};
  $("#top-ratios li").each((_, li) => {
    const name = $(li).find(".name").text().trim();
    const nums = $(li).find(".number").map((_, n) => num($(n).text())).get();
    if (name && nums.length) top_ratios[name] = nums.length === 1 ? nums[0] : nums;
  });
  const annual_reports: { year: number; url: string }[] = [];
  $(".documents.annual-reports a").each((_, a) => {
    const m = $(a).text().match(/(20\d\d)/); const href = $(a).attr("href");
    if (m && href) annual_reports.push({ year: Number(m[1]), url: href });
  });
  const concalls: { period: string; url: string }[] = [];
  $(".documents.concalls li").each((_, li) => {
    const period = ($(li).text().match(/[A-Z][a-z]{2}\s+20\d\d/) ?? [])[0];
    const link = $(li).find("a").filter((_, a) => $(a).text().trim() === "Transcript").attr("href");
    if (period && link) concalls.push({ period: period.replace(/\s+/g, " "), url: link });
  });
  const quarters = table($, "quarters");
  return {
    ticker, basis, name: $("h1").first().text().trim() || ticker,
    about: $(".company-profile .about").text().replace(/\s+/g, " ").replace(/\s*\[\d+\]/g, "").trim() || null,
    sector: $("#peers a[href*='/market/']").last().text().trim() || null,
    top_ratios, quarters, annual: table($, "profit-loss"), balance_sheet: table($, "balance-sheet"),
    cash_flow: table($, "cash-flow"), ratios: table($, "ratios"), shareholding: table($, "shareholding"),
    documents: { annual_reports, concalls },
    is_financial: "Financing Profit" in (quarters?.rows ?? {}),
  };
}
export type Raw = Awaited<ReturnType<typeof screener>>;

export async function yahoo(ticker: string): Promise<Px> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.NS?range=5y&interval=1d`, { headers: UA, cache: "no-store" });
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [], cl: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
    return ts.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: cl[i] as number })).filter((p) => p.c != null && p.c > 0);
  } catch { return []; }
}

// ------------------------------------------------------------ metrics (port of metrics.py)
const MON: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const periodEnd = (l: string) => { const [m, y] = l.split(" "); return MON[m] && Number(y) ? new Date(Date.UTC(Number(y), MON[m], 0)) : null; };
const row = (t: Table, ...names: string[]) => { for (const n of names) { const v = t?.rows?.[n]; if (v?.length) return v; } return null; };
const last = (v: (number | null)[] | null | undefined) => { for (let i = (v?.length ?? 0) - 1; i >= 0; i--) if (v![i] != null) return v![i]; return null; };
const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100;
function cagr(series: (number | null)[], years: number) {
  const s = series.filter((x): x is number => x != null);
  if (s.length <= years || s[s.length - 1 - years] <= 0 || s[s.length - 1] <= 0) return null;
  return r1(100 * ((s[s.length - 1] / s[s.length - 1 - years]) ** (1 / years) - 1));
}
const median = (s: number[]) => { const a = [...s].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function rangePos(value: number | null | undefined, series: (number | null)[]) {
  const s = series.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (value == null || s.length < 4) return null;
  return { pctile: Math.round((100 * s.filter((x) => x < value).length) / s.length), min: r1(s[0]), median: r1(median(s)), max: r1(s[s.length - 1]) };
}
function peBand(c: Raw, px: Px) {
  const steps: [number, number][] = [];
  const aEps = row(c.annual, "EPS in Rs"), qEps = row(c.quarters, "EPS in Rs");
  c.annual?.cols.forEach((l, i) => { const e = periodEnd(l), v = aEps?.[i]; if (e && v != null) steps.push([e.getTime() + 60 * 864e5, v]); });
  if (c.quarters && qEps) for (let i = 3; i < c.quarters.cols.length; i++) {
    const w = qEps.slice(i - 3, i + 1), e = periodEnd(c.quarters.cols[i]);
    if (e && w.every((x) => x != null)) steps.push([e.getTime() + 45 * 864e5, r2(w.reduce((s, x) => s + x!, 0))]);
  }
  steps.sort((a, b) => a[0] - b[0]);
  if (!steps.length || !px.length) return null;
  const points: { d: string; pe: number }[] = [];
  for (let k = 0; k < px.length; k += 5) {
    const t = new Date(px[k].d).getTime();
    let i = -1; for (let j = 0; j < steps.length && steps[j][0] <= t; j++) i = j;
    if (i < 0) continue;
    const eps = steps[i][1];
    if (eps > 0) { const pe = px[k].c / eps; if (pe > 0 && pe < 400) points.push({ d: px[k].d, pe: r1(pe) }); }
  }
  if (points.length < 30) return null;
  const vals = points.map((p) => p.pe), med = median(vals), mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  return { points, median: r1(med), plus1: r1(med + sd), minus1: r1(Math.max(med - sd, 0)) };
}

export function metrics(c: Raw, px: Px) {
  const { annual: a, balance_sheet: bs, cash_flow: cf, ratios: rt, shareholding: sh } = c;
  const tr = c.top_ratios as Record<string, number | null>, fin = c.is_financial;
  const price = px.length ? px[px.length - 1].c : tr["Current Price"], mcap = tr["Market Cap"];
  const sales = row(a, "Sales", "Revenue") ?? [], op = row(a, "Operating Profit", "Financing Profit") ?? [], np = row(a, "Net Profit") ?? [];
  const opm = row(a, "OPM %", "Financing Margin %") ?? [];
  const years = a?.cols ?? [], fyEnd = years[years.length - 1] === "TTM" ? -1 : undefined;
  const eq = row(bs, "Equity Capital") ?? [], res = row(bs, "Reserves") ?? [], bor = row(bs, "Borrowings", "Borrowing") ?? [];
  const nw = eq.map((e, i) => (e != null && res[i] != null ? e + res[i]! : null));
  const de = bor.map((b, i) => (b != null && nw[i] ? r2(b / nw[i]!) : null));
  const cfo = row(cf, "Cash from Operating Activity") ?? [], fcf = row(cf, "Free Cash Flow") ?? [], cfYears = cf?.cols ?? [];
  const npBy = Object.fromEntries(years.map((y, i) => [y, np[i]]));
  const conv = cfYears.map((y, i) => ({ year: y, cfo: cfo[i], pat: npBy[y] ?? null, ratio: cfo[i] != null && npBy[y] && npBy[y]! > 0 ? r2(cfo[i]! / npBy[y]!) : null })).slice(-6);
  const cum = (n: number) => { const rs = conv.slice(-n).filter((r) => r.cfo != null && r.pat); const p = rs.reduce((s, r) => s + r.pat!, 0); return rs.length === n && p > 0 ? r2(rs.reduce((s, r) => s + r.cfo!, 0) / p) : null; };
  const band = peBand(c, px), pe = tr["Stock P/E"], book = tr["Book Value"];
  const latestBor = last(bor), ttmOp = last(op), ev = mcap && latestBor != null ? mcap + latestBor : null;
  const npFy = np.slice(0, fyEnd);
  const roeHist = nw.map((w, i) => { const n = npFy[npFy.length - nw.length + i]; return n != null && w ? r1((100 * n) / w) : null; });
  let ownership = null;
  if (sh) {
    const rows: Record<string, (number | null)[]> = {};
    for (const [k, n] of [["promoter", "Promoters"], ["fii", "FIIs"], ["dii", "DIIs"], ["government", "Government"], ["public", "Public"]]) { const v = row(sh, n); if (v) rows[k] = v; }
    const chg = (v: (number | null)[], n: number) => { const s = v.filter((x): x is number => x != null); return s.length > n ? r2(s[s.length - 1] - s[s.length - 1 - n]) : null; };
    const map = (f: (v: (number | null)[]) => number | null) => Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, f(v)]));
    ownership = { quarters: sh.cols, series: rows, latest: map(last), change_1q: map((v) => chg(v, 1)),
      change_window: map((v) => chg(v, v.filter((x) => x != null).length - 1)), has_promoter: (last(rows.promoter) ?? 0) > 0 };
  }
  return {
    is_financial: fin,
    trajectory: { years: years.slice(-11), sales: sales.slice(-11), op_profit: op.slice(-11), net_profit: np.slice(-11), opm: opm.slice(-11),
      sales_cagr_3y: cagr(sales.slice(0, fyEnd), 3), sales_cagr_5y: cagr(sales.slice(0, fyEnd), 5), profit_cagr_3y: cagr(npFy, 3), profit_cagr_5y: cagr(npFy, 5) },
    snapshot: { revenue_ttm: last(sales), op_profit_ttm: ttmOp, pat_ttm: last(np), opm: last(opm),
      net_margin: last(sales) && last(np) != null ? r1((100 * last(np)!) / last(sales)!) : null, market_cap: mcap, price },
    balance_sheet: { periods: (bs?.cols ?? []).slice(-6), borrowings: bor.slice(-6), net_worth: nw.slice(-6), debt_to_equity: de.slice(-6),
      debtor_days: (row(rt, "Debtor Days") ?? []).slice(-6), cash_conversion_cycle: (row(rt, "Cash Conversion Cycle") ?? []).slice(-6), ratio_years: (rt?.cols ?? []).slice(-6) },
    cash_quality: { by_year: conv, cfo_to_pat_3y: cum(3), cfo_to_pat_5y: cum(5), fcf: fcf.slice(-6), fcf_years: cfYears.slice(-6) },
    valuation: { pe, pe_range: band ? rangePos(pe, band.points.map((p) => p.pe)) : null, pb: price && book ? r1(price / book) : null,
      ev_ebitda: fin || !ev || !ttmOp || ttmOp <= 0 ? null : r1(ev / ttmOp), ev_note: "EV = market cap + borrowings; cash is not netted off",
      roce: fin ? null : tr["ROCE"], roce_range: fin ? null : rangePos(tr["ROCE"], (row(rt, "ROCE %") ?? []).slice(-6)),
      roe: tr["ROE"], roe_range: rangePos(tr["ROE"], roeHist.slice(-6)), dividend_yield: tr["Dividend Yield"], pe_band: band },
    ownership,
  };
}

export async function company(ticker: string) {
  const [c, px] = await Promise.all([screener(ticker), yahoo(ticker)]);
  return {
    ticker, name: c.name, about: c.about, basis: c.basis, sector: c.sector, in_portfolio: false, live: true,
    top_ratios: c.top_ratios, metrics: metrics(c, px),
    documents: { annual_reports: c.documents.annual_reports.slice(0, 4), concalls: c.documents.concalls.slice(0, 8) },
    as_of: new Date().toISOString(),
  };
}

// ------------------------------------------------------------ grounded snapshot
const SYS = `You are a buy-side analyst writing for an Indian retail investor. You may use ONLY the document pages given.
Never use outside knowledge, news, or numbers that are not on these pages. Return JSON:
{"summary": "2 sentences: what the company does and where it stands now",
 "how_it_makes_money": "1-2 sentences on segments / revenue mix, as stated",
 "bull": [{"point": "...", "quote": "verbatim words from the page, 8-30 words", "page": n}],
 "bear": [same shape],
 "watch": [same shape]}
bull: 2-3 items. bear: 2-3 risks management admitted or analysts pressed on. watch: 1-2 things next quarter will reveal.
Quotes must be copied exactly from the page text. Plain words, no hype.`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
type Pt = { point?: string; quote?: string; page?: number };

function grounded(points: Pt[] | undefined, pages: string[], offset: number, url: string, source: string) {
  const out: { point: string; quote: string; page: number; url: string; source: string }[] = [];
  const normed = pages.map(norm);
  for (const p of points ?? []) {
    if (!p?.point || !p?.quote) continue;
    const q = norm(p.quote).slice(0, 60);
    if (q.length < 20) continue;
    const hit = normed.findIndex((t) => t.includes(q));
    if (hit < 0) continue;                                            // not on any page: dropped
    out.push({ point: p.point, quote: p.quote, page: hit + 1 + offset, url, source });
  }
  return out;
}

async function pdfPages(url: string, maxPages: number, from = 0): Promise<string[]> {
  const r = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok || !(r.headers.get("content-type") ?? "").includes("pdf")) throw new Error(`pdf ${r.status}`);
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await r.arrayBuffer()));
  const out: string[] = [];
  for (let i = from + 1; i <= Math.min(pdf.numPages, from + maxPages); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return out;
}

async function llm(user: string) {
  const base = (process.env.LLM_BASE_URL ?? "").replace(/\/$/, ""), key = process.env.LLM_API_KEY;
  if (!base || !key) throw new Error("no-llm");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, signal: AbortSignal.timeout(40000),
    body: JSON.stringify({ model: process.env.LLM_MODEL ?? "hyde/glm-5.3-flash", reasoning_effort: "low", response_format: { type: "json_object" },
      max_tokens: 2500, messages: [{ role: "system", content: SYS }, { role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`llm ${r.status}`);
  const j = await r.json();
  const txt: string = j.choices?.[0]?.message?.content ?? "";
  return { out: JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)), usage: j.usage };
}

export async function snapshot(ticker: string) {
  const c = await screener(ticker);
  let pages: string[] = [], url = "", source = "", offset = 0, note: string | undefined;
  for (const call of c.documents.concalls.slice(0, 2)) {
    try { pages = await pdfPages(call.url, 40); url = call.url; source = `Earnings call, ${call.period}`; if (pages.join("").length > 4000) break; } catch { /* try the next one */ }
  }
  if (pages.join("").length < 4000) {
    const ar = c.documents.annual_reports[0];
    if (!ar) return { research: null, reason: "No earnings-call transcript or annual report is listed for this company." };
    try {
      // annual reports run to 300+ pages: read a window where MD&A usually sits
      const first = await pdfPages(ar.url, 70);
      const start = first.findIndex((t, i) => i > 3 && /management\s+discussion\s+(and|&)\s+analysis/i.test(t.slice(0, 800)));
      offset = Math.max(0, start >= 0 ? start : 2);
      pages = first.slice(offset, offset + 22); url = ar.url; source = `Annual report ${ar.year}`;
      note = c.documents.concalls.length ? "The latest transcripts could not be read, so this comes from the annual report." : "This company does not publish earnings-call transcripts; read from its annual report instead.";
    } catch {
      return { research: null, reason: "The exchange's document server did not answer. Try again in a minute." };
    }
  }
  const body = pages.map((t, i) => `--- page ${i + 1 + offset} ---\n${t}`).join("\n").slice(0, 60000);
  const { out, usage } = await llm(`Company: ${c.name}\nDocument: ${source}\n\n${body}`);
  // the model cites absolute page numbers; grounding searches the window we sent it
  return {
    research: {
      summary: out.summary ?? null, how_it_makes_money: out.how_it_makes_money ?? null, note,
      bull: grounded(out.bull, pages, offset, url, source), bear: grounded(out.bear, pages, offset, url, source),
      watch: grounded(out.watch, pages, offset, url, source), sources: [source], as_of: new Date().toISOString(),
    },
    usage,
  };
}

export async function search(q: string) {
  const r = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(q)}&v=3&fts=1`, { headers: UA, cache: "no-store" });
  if (!r.ok) return [];
  const j: { name: string; url: string; id: number | null }[] = await r.json();
  return j.filter((x) => x.id && /^\/company\/[A-Z0-9&-]+\//.test(x.url) && !/\(Merged\)|Partly Paid/i.test(x.name))
    .map((x) => ({ ticker: x.url.split("/")[2], name: x.name })).filter((x) => !/^\d+$/.test(x.ticker)).slice(0, 6);
}
