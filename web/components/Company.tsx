"use client";
import { useEffect, useState } from "react";
import { cr, num, type Ledger } from "@/lib/finn";
import { Avatar, Card, Change, Delta, Section, Segmented, SourceLink } from "./ui";
import { Bars, Donut, Ownership, PEBand } from "./Charts";

type Range = { pctile: number; min: number; median: number; max: number } | null;
type Cite = { point: string; quote?: string | null; source?: string | null; url?: string | null; page?: number | null };
export type Research = { note?: string; summary?: string | null; how_it_makes_money?: string | null; bull?: Cite[]; bear?: Cite[]; watch?: Cite[]; sources?: string[]; as_of?: string };
export type CompanyT = {
  ticker: string; name: string; about?: string | null; basis?: string; sector?: string | null; in_portfolio?: boolean; as_of?: string; live?: boolean;
  top_ratios: Record<string, number | number[] | null>;
  metrics: {
    is_financial: boolean;
    trajectory: { years: string[]; sales: (number | null)[]; net_profit: (number | null)[]; opm: (number | null)[]; sales_cagr_3y: number | null; sales_cagr_5y: number | null; profit_cagr_3y: number | null; profit_cagr_5y: number | null };
    snapshot: { revenue_ttm: number | null; op_profit_ttm: number | null; pat_ttm: number | null; opm: number | null; net_margin: number | null; market_cap: number | null; price: number | null };
    balance_sheet: { periods: string[]; borrowings: (number | null)[]; net_worth: (number | null)[]; debt_to_equity: (number | null)[]; debtor_days: (number | null)[]; cash_conversion_cycle: (number | null)[]; ratio_years: string[] };
    cash_quality: { by_year: { year: string; cfo: number | null; pat: number | null; ratio: number | null }[]; cfo_to_pat_3y: number | null; cfo_to_pat_5y: number | null; fcf: (number | null)[]; fcf_years: string[] };
    valuation: { pe: number | null; pe_range: Range; pb: number | null; ev_ebitda: number | null; ev_note?: string; roce: number | null; roce_range: Range; roe: number | null; roe_range: Range; dividend_yield: number | null;
      pe_band?: { points: { d: string; pe: number }[]; median: number; plus1: number; minus1: number } | null };
    ownership: { quarters: string[]; series: Record<string, (number | null)[]>; latest: Record<string, number | null>; change_1q: Record<string, number | null>; change_window: Record<string, number | null>; has_promoter: boolean } | null;
  };
  documents: { annual_reports?: { year: number | string; url: string }[]; concalls?: { period: string; url?: string; transcript?: string }[] };
  research?: Research | null;
};

type Load = { s: "loading" } | { s: "ready"; c: CompanyT } | { s: "none"; msg: string };
type Snap = { s: "idle" | "loading" } | { s: "ready"; r: Research } | { s: "failed"; msg: string };

const isJson = (r: Response) => r.ok && (r.headers.get("content-type") ?? "").includes("json");
const NAV: [string, string][] = [["ov", "Overview"], ["debate", "Debate"], ["val", "Valuation"], ["own", "Owners"], ["fin", "Numbers"], ["src", "Sources"]];

export default function Company({ ticker, ledger, dayPct, onBack, onLedger }: {
  ticker: string; ledger: Ledger | null; dayPct?: number | null; onBack: () => void; onLedger: (t: string, l?: Ledger) => void;
}) {
  const [st, setSt] = useState<Load>({ s: "loading" });
  const [lg, setLg] = useState<Ledger | null>(ledger);
  const [snap, setSnap] = useState<Snap>({ s: "idle" });
  const [try_, setTry] = useState(0);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        let c: CompanyT | null = null;
        const local = await fetch(`/data/company/${ticker}.json`, { cache: "no-cache" });
        if (isJson(local)) c = await local.json();
        else {
          const r = await fetch(`/api/company?ticker=${encodeURIComponent(ticker)}`);
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.company) { if (!dead) setSt({ s: "none", msg: j.message ?? `Could not load ${ticker}.` }); return; }
          c = j.company;
        }
        if (dead || !c) return;
        setSt({ s: "ready", c });
        if (!lg) fetch(`/data/ledger/${ticker}.json`).then((r) => (isJson(r) ? r.json() : null)).then((l) => { if (!dead && l) setLg(l); }).catch(() => {});
        if (c.research) { setSnap({ s: "ready", r: c.research }); return; }
        setSnap({ s: "loading" });
        const r = await fetch(`/api/snapshot?ticker=${encodeURIComponent(ticker)}`);
        const j = await r.json().catch(() => ({}));
        if (dead) return;
        setSnap(j.research ? { s: "ready", r: j.research } : { s: "failed", msg: j.reason ?? "Could not read the filings just now." });
      } catch {
        if (!dead) setSt({ s: "none", msg: "Could not load this company. Check your connection." });
      }
    })();
    return () => { dead = true; };
  }, [ticker, try_]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = (
    <button onClick={onBack} className="mb-3 inline-flex min-h-9 items-center gap-1 rounded-full bg-surface px-3 text-[13px] font-semibold text-ink shadow-sm ring-1 ring-line">
      <span aria-hidden>←</span> Companies
    </button>
  );
  if (st.s === "loading") return (
    <div>{back}
      <div className="hero shimmer h-[168px] rounded-[22px]" />
      <div className="mt-3 grid grid-cols-3 gap-2">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="shimmer h-[70px] rounded-2xl bg-sunk" />)}</div>
      <p className="mt-3 text-center text-[13px] text-muted">Reading {ticker}&apos;s reported financials…</p>
    </div>
  );
  if (st.s === "none") return (
    <div>{back}
      <Card><p className="text-[15px] font-semibold">Nothing found</p><p className="mt-1 text-[13.5px] text-muted">{st.msg}</p>
        <button onClick={() => setTry((n) => n + 1)} className="mt-3 h-10 rounded-xl bg-ink px-4 text-[13px] font-semibold text-bg">Try again</button></Card>
    </div>
  );

  const { c } = st, m = c.metrics, v = m.valuation, snapM = m.snapshot, tr = m.trajectory, bs = m.balance_sheet, cq = m.cash_quality;
  const lastOf = <T,>(a: T[] | undefined) => (a && a.length ? a[a.length - 1] : null);
  const hl = c.top_ratios["High / Low"] as number[] | undefined;
  const price = snapM.price;
  const pos = hl && price ? Math.max(0, Math.min(100, ((price - hl[1]) / (hl[0] - hl[1] || 1)) * 100)) : null;
  const R = snap.s === "ready" ? snap.r : null;
  const own = m.ownership;

  return (
    <div>
      {back}
      <section className="hero rise rounded-[22px] p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <Avatar t={c.ticker} name={c.name} size={44} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[19px] font-bold leading-tight">{c.name.replace(/ (Ltd|Limited)\.?$/i, "")}</h2>
            <p className="truncate text-[12px] opacity-75"><span className="num">{c.ticker}</span>{c.sector ? ` · ${c.sector}` : ""} · NSE</p>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="num text-[30px] font-bold leading-none">₹{num(price, 2)}</p>
            <p className="mt-1.5 text-[12px] opacity-75">Market cap {cr(snapM.market_cap)}</p>
          </div>
          {dayPct != null && <span className={`num rounded-lg px-2 py-1 text-[13px] font-bold ${dayPct >= 0 ? "bg-[#1f8f5f]" : "bg-[#b5382f]"}`}>{dayPct >= 0 ? "▲" : "▼"} {Math.abs(dayPct).toFixed(2)}%</span>}
        </div>
        {pos != null && hl && (
          <div className="mt-4">
            <div className="relative h-1.5 rounded-full bg-white/20">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/60" style={{ width: `${pos}%` }} />
              <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#0f3d3e]" style={{ left: `${pos}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] opacity-75"><span className="num">52w low ₹{num(hl[1], 0)}</span><span className="num">high ₹{num(hl[0], 0)}</span></div>
          </div>
        )}
      </section>

      <nav className="no-bar sticky top-[54px] z-20 -mx-4 mt-3 flex gap-1.5 overflow-x-auto bg-bg/90 px-4 py-2 backdrop-blur" aria-label="Sections">
        {NAV.map(([id, label]) => (
          <a key={id} href={`#c-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`c-${id}`)?.scrollIntoView({ behavior: "smooth" }); }}
            className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-muted ring-1 ring-line">{label}</a>
        ))}
      </nav>

      <Section title="Overview" id="c-ov">
        <Card>
          {(R?.summary || c.about) && <p className="text-[15px] leading-relaxed">{R?.summary || c.about}</p>}
          {R?.how_it_makes_money && (
            <div className="mt-3 rounded-xl bg-sunk p-3">
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-muted">How it makes money</p>
              <p className="mt-1 text-[13.5px] leading-snug">{R.how_it_makes_money}</p>
            </div>
          )}
          <p className="mt-3 text-[11.5px] text-muted">
            {R?.note ? `${R.note} ` : ""}{R?.summary ? `Read from: ${(R.sources ?? []).join(", ")}.` : "Description from screener.in."} Financials are {c.basis ?? "consolidated"}.
          </p>
        </Card>
        {lg ? (
          <button onClick={() => onLedger(c.ticker, lg)} className="card tap block w-full p-4 text-left">
            <span className="flex items-center justify-between">
              <span className="text-[12px] font-bold uppercase tracking-wide text-accent">Promise ledger</span>
              <span className="text-[13px] font-semibold text-accent">Open →</span>
            </span>
            <span className="mt-1 block text-[17px] font-bold"><span className="num">{lg.score.kept}</span> of <span className="num">{lg.score.settled}</span> due promises kept</span>
            <ScoreBar s={lg.score} />
            {lg.read && <span className="mt-2 block text-[13.5px] leading-snug text-muted">{lg.read}</span>}
          </button>
        ) : null}
      </Section>

      <Section title="The debate" id="c-debate">
        {snap.s === "loading" || snap.s === "idle" ? (
          <Card>
            <p className="text-[14px] font-semibold">Reading the latest earnings call…</p>
            <p className="mt-1 text-[12.5px] text-muted">Every point will quote the transcript, with its page. Takes about 10 seconds the first time.</p>
            <div className="mt-3 flex flex-col gap-2">{[0, 1, 2].map((i) => <div key={i} className="shimmer h-4 rounded bg-sunk" style={{ width: `${90 - i * 18}%` }} />)}</div>
          </Card>
        ) : snap.s === "failed" ? (
          <Card><p className="text-[14px]">{snap.msg}</p>
            <button onClick={() => setTry((n) => n + 1)} className="mt-2 min-h-9 text-[13px] font-semibold text-accent">Try again</button></Card>
        ) : (
          <>
            <CiteList title="What could go right" tone="good" items={R?.bull ?? []} />
            <CiteList title="What could go wrong" tone="bad" items={R?.bear ?? []} />
            <CiteList title="What to watch next" tone="accent" items={R?.watch ?? []} />
            {!R?.bull?.length && !R?.bear?.length && <Card><p className="text-[13.5px] text-muted">No point could be tied to a quote in the filing, so none is shown.</p></Card>}
          </>
        )}
      </Section>

      <Section title="Valuation" id="c-val">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="P/E" v={v.pe} suffix="×" range={v.pe_range} />
          <Tile label="P/B" v={v.pb} suffix="×" />
          <Tile label="EV/EBITDA" v={v.ev_ebitda} suffix="×" na={m.is_financial ? "n/a for lenders" : undefined} />
          <Tile label="ROCE" v={v.roce} suffix="%" range={v.roce_range} na={m.is_financial ? "n/a for lenders" : undefined} />
          <Tile label="ROE" v={v.roe} suffix="%" range={v.roe_range} />
          <Tile label="Div. yield" v={v.dividend_yield} suffix="%" />
        </div>
        {v.pe_band && v.pe_band.points?.length > 0 && (
          <Card>
            <h3 className="text-[15px] font-bold">P/E against its own 5 years</h3>
            <p className="mb-2 text-[12px] text-muted">{bandRead(v.pe, v.pe_band)}</p>
            <PEBand points={v.pe_band.points} median={v.pe_band.median} plus1={v.pe_band.plus1} minus1={v.pe_band.minus1} current={v.pe} />
          </Card>
        )}
        {!m.is_financial && v.ev_note && <p className="px-1 text-[11.5px] text-muted">{v.ev_note}.</p>}
      </Section>

      {own && <OwnersSection own={own} />}

      <Section title="The business in numbers" id="c-fin">
        <div className="grid grid-cols-3 gap-2">
          <Fig label="Revenue, TTM" v={cr(snapM.revenue_ttm)} />
          <Fig label={m.is_financial ? "Financing margin" : "Operating margin"} v={snapM.opm == null ? "–" : `${snapM.opm}%`} />
          <Fig label="Net profit, TTM" v={cr(snapM.pat_ttm)} />
        </div>
        <Card>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 text-[13px] font-bold">Revenue</p>
              <Bars labels={tr.years} values={tr.sales} />
              <p className="mt-0.5 text-[11.5px] text-muted">3y <Delta v={tr.sales_cagr_3y} /> · 5y <Delta v={tr.sales_cagr_5y} /> a yr</p>
            </div>
            <div>
              <p className="mb-1 text-[13px] font-bold">Net profit</p>
              <Bars labels={tr.years} values={tr.net_profit} />
              <p className="mt-0.5 text-[11.5px] text-muted">3y <Delta v={tr.profit_cagr_3y} /> · 5y <Delta v={tr.profit_cagr_5y} /> a yr</p>
            </div>
          </div>
        </Card>
        <Card>
          <h3 className="mb-2.5 text-[15px] font-bold">Is the profit real cash?</h3>
          <div className="grid grid-cols-3 gap-2">
            <Fig label="Cash ÷ profit, 3y" v={cq.cfo_to_pat_3y == null ? "–" : `${cq.cfo_to_pat_3y.toFixed(2)}×`}
              tone={m.is_financial || cq.cfo_to_pat_3y == null ? undefined : cq.cfo_to_pat_3y >= 0.9 ? "good" : cq.cfo_to_pat_3y < 0.6 ? "bad" : "warn"} />
            <Fig label={`Debt ÷ equity`} v={lastOf(bs.debt_to_equity) == null ? "–" : `${lastOf(bs.debt_to_equity)}×`} />
            <Fig label="Debtor days" v={lastOf(bs.debtor_days) == null ? "–" : `${Math.round(lastOf(bs.debtor_days)!)}`} />
          </div>
          <p className="mt-2.5 text-[12px] leading-snug text-muted">
            {m.is_financial
              ? "For a lender, operating cash flow moves with loan growth, so this ratio says little; read asset quality in the filings instead."
              : "Above 1× means the business collected more cash than the profit it reported. Well below 1× for years is the classic warning."}
            {" "}Free cash flow last year: {cr(lastOf(cq.fcf))}.
          </p>
        </Card>
      </Section>

      <Section title="Primary sources" id="c-src">
        <div className="card overflow-hidden">
          {(c.documents.annual_reports ?? []).slice(0, 3).map((d) => <Doc key={d.url} kind="Annual report" label={String(d.year)} url={d.url} />)}
          {(c.documents.concalls ?? []).filter((d) => d.url || d.transcript).slice(0, 6).map((d) => <Doc key={d.period} kind="Earnings call" label={d.period} url={(d.url || d.transcript)!} />)}
        </div>
        <p className="px-1 text-[11.5px] leading-snug text-muted">
          Numbers: screener.in (from company filings). Prices: Yahoo Finance, end of day. Quotes: the documents above. Nothing comes from news, brokers or social media.
        </p>
      </Section>
    </div>
  );
}

function OwnersSection({ own }: { own: NonNullable<CompanyT["metrics"]["ownership"]> }) {
  const [view, setView] = useState<"now" | "trend">("now");
  const w = own.change_window;
  return (
    <Section title="Who owns it" id="c-own">
      <Card>
        <div className="mb-3"><Segmented label="Shareholding view" value={view} onChange={setView} options={[["now", "Latest quarter"], ["trend", `${own.quarters.length}-quarter trend`]]} /></div>
        {view === "now"
          ? <Donut latest={own.latest} change={own.change_1q} quarter={own.quarters[own.quarters.length - 1] ?? ""} />
          : <Ownership quarters={own.quarters} series={own.series} table={false} />}
        <p className="mt-3 border-t border-line pt-2.5 text-[12px] leading-snug text-muted">
          Since {own.quarters[0]}:{" "}
          {(["promoter", "fii", "dii"] as const).filter((k) => w?.[k] != null && (k !== "promoter" || own.has_promoter))
            .map((k) => `${k === "promoter" ? "promoters" : k.toUpperCase() + "s"} ${w[k]! > 0 ? "+" : w[k]! < 0 ? "−" : ""}${Math.abs(w[k]!).toFixed(2)} pp`).join(" · ")}
          {!own.has_promoter ? ". No promoter group." : ""}
        </p>
      </Card>
    </Section>
  );
}

function bandRead(pe: number | null, b: { median: number; plus1: number; minus1: number }) {
  if (pe == null) return "No current P/E (losses or no earnings).";
  if (pe > b.plus1) return `At ${pe.toFixed(1)}× it trades above its usual range — the market expects more than it has historically.`;
  if (b.minus1 > 0 && pe < b.minus1) return `At ${pe.toFixed(1)}× it trades below its usual range — cheaper than its own history.`;
  return `At ${pe.toFixed(1)}× it sits inside its usual range (median ${b.median.toFixed(1)}×).`;
}

export function ScoreBar({ s }: { s: Ledger["score"] }) {
  const parts: [number, string, string][] = [[s.kept, "bg-good", "kept"], [s.missed + s.dropped, "bg-bad", "missed"], [s.revised, "bg-warn", "revised"], [s.pending, "bg-idle/40", "open"]];
  const tot = parts.reduce((a, p) => a + p[0], 0) || 1;
  return (
    <span className="mt-2.5 block">
      <span className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {parts.filter((p) => p[0] > 0).map(([n, cls, k]) => <span key={k} className={cls} style={{ width: `${(n / tot) * 100}%` }} />)}
      </span>
      <span className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
        {parts.map(([n, cls, k]) => <span key={k} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${cls}`} />{n} {k}</span>)}
      </span>
    </span>
  );
}

function Tile({ label, v, suffix, range, na }: { label: string; v: number | null; suffix: string; range?: Range; na?: string }) {
  const where = range ? (range.pctile <= 20 ? "near 5y low" : range.pctile >= 80 ? "near 5y high" : "mid-range") : null;
  return (
    <div className="card rounded-2xl p-3">
      <p className="text-[11.5px] font-medium text-muted">{label}</p>
      <p className="num mt-0.5 text-[19px] font-bold leading-tight">{v == null ? "–" : `${v.toFixed(1)}${suffix}`}</p>
      {v == null && na ? <p className="text-[10.5px] text-muted">{na}</p> : null}
      {v != null && range ? (
        <>
          <div className="relative mt-2 h-1 rounded-full bg-sunk" aria-hidden>
            <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface" style={{ left: `${Math.max(4, Math.min(96, range.pctile))}%` }} />
          </div>
          <p className="mt-1 text-[10.5px] leading-tight text-muted">{where}</p>
        </>
      ) : null}
    </div>
  );
}

function Fig({ label, v, tone }: { label: string; v: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-2xl bg-sunk p-3">
      <p className={`num text-[15px] font-bold leading-tight ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{v}</p>
      <p className="mt-1 text-[11px] leading-tight text-muted">{label}</p>
    </div>
  );
}

function Doc({ kind, label, url }: { kind: string; label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex min-h-12 items-center gap-3 border-b border-line px-4 py-2 last:border-0">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4z M9 2v3h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </span>
      <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold">{kind}</span><span className="block text-[12px] text-muted">{label}</span></span>
      <span className="text-[13px] text-muted" aria-hidden>↗</span>
    </a>
  );
}

function CiteList({ title, tone, items }: { title: string; tone: "good" | "bad" | "accent"; items: Cite[] }) {
  if (!items.length) return null;
  const color = { good: "text-good", bad: "text-bad", accent: "text-accent" }[tone];
  const dot = { good: "bg-good", bad: "bg-bad", accent: "bg-accent" }[tone];
  return (
    <Card tone={tone}>
      <h3 className={`text-[12px] font-bold uppercase tracking-wide ${color}`}>{title}</h3>
      <ul className="mt-2 flex flex-col gap-3.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5">
            <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold leading-snug">{it.point}</p>
              {it.quote && <p className="mt-1 border-l-2 border-line pl-2.5 text-[12.5px] italic leading-snug text-muted">“{it.quote}”</p>}
              {it.url ? <div className="mt-1.5"><SourceLink href={it.url}>{it.source ?? "Source"}{it.page ? `, p. ${it.page}` : ""}</SourceLink></div>
                : it.source ? <p className="text-[11.5px] text-muted">{it.source}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export { Change };
