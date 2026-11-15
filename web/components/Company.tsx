"use client";
import { useEffect, useState } from "react";
import { cr, num, type Ledger } from "@/lib/finn";
import { Card, Delta, Section, SourceLink } from "./ui";
import { Bars, Ownership, PEBand } from "./Charts";

type Range = { pctile: number; min: number; median: number; max: number } | null;
type Cite = { point: string; quote?: string | null; source?: string | null; url?: string | null; page?: number | null };
export type CompanyT = {
  ticker: string; name: string; about?: string; basis?: string; sector?: string; in_portfolio?: boolean; as_of?: string;
  top_ratios: Record<string, number | number[] | null>;
  metrics: {
    is_financial: boolean;
    trajectory: { years: string[]; sales: number[]; net_profit: number[]; opm: (number | null)[]; sales_cagr_3y: number | null; sales_cagr_5y: number | null; profit_cagr_3y: number | null; profit_cagr_5y: number | null };
    snapshot: { revenue_ttm: number | null; op_profit_ttm: number | null; pat_ttm: number | null; opm: number | null; net_margin: number | null; market_cap: number | null; price: number | null };
    balance_sheet: { periods: string[]; borrowings: number[]; net_worth: number[]; debt_to_equity: (number | null)[]; debtor_days: (number | null)[]; cash_conversion_cycle: (number | null)[]; ratio_years: string[] };
    cash_quality: { by_year: { year: string; cfo: number; pat: number; ratio: number | null }[]; cfo_to_pat_3y: number | null; cfo_to_pat_5y: number | null; fcf: number[]; fcf_years: string[] };
    valuation: { pe: number | null; pe_range: Range; pb: number | null; ev_ebitda: number | null; ev_note?: string; roce: number | null; roce_range: Range; roe: number | null; roe_range: Range; dividend_yield: number | null;
      pe_band?: { points: { d: string; pe: number }[]; median: number; plus1: number; minus1: number } | null };
    ownership: { quarters: string[]; series: Record<string, (number | null)[]>; latest: Record<string, number | null>; change_1q: Record<string, number | null>; change_window: Record<string, number | null>; has_promoter: boolean };
  };
  documents: { annual_reports?: { year: number | string; url: string }[]; concalls?: { period: string; url?: string; transcript?: string }[] };
  research?: { note?: string; summary?: string; how_it_makes_money?: string; bull?: Cite[]; bear?: Cite[]; watch?: Cite[]; sources?: string[]; as_of?: string } | null;
};

type State = { s: "loading" } | { s: "ready"; c: CompanyT; ledger: Ledger | null } | { s: "building"; msg: string } | { s: "none"; msg: string };

export default function Company({ ticker, ledger, onBack, onLedger }: { ticker: string; ledger: Ledger | null; onBack: () => void; onLedger: (t: string, l?: Ledger) => void }) {
  const [st, setSt] = useState<State>({ s: "loading" });
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const local = await fetch(`/data/company/${ticker}.json`, { cache: "no-cache" });
        if (local.ok && (local.headers.get("content-type") ?? "").includes("json")) {
          const c = await local.json();
          let lg = ledger;
          if (!lg) { const r = await fetch(`/data/ledger/${ticker}.json`); if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) lg = await r.json(); }
          if (!dead) setSt({ s: "ready", c, ledger: lg });
          return;
        }
        // not in the nightly build: ask the research agent for it
        const r = await fetch(`/api/research?ticker=${encodeURIComponent(ticker)}${tries === 0 ? "&start=1" : ""}`);
        const j = await r.json().catch(() => ({}));
        if (dead) return;
        if (r.ok && j.company) setSt({ s: "ready", c: j.company, ledger: j.ledger ?? null });
        else if (r.status === 202) {
          setSt({ s: "building", msg: j.message ?? "Reading the annual report and the last six earnings calls." });
          timer = setTimeout(() => setTries((n) => n + 1), 12000);
        } else setSt({ s: "none", msg: j.message ?? `Could not research ${ticker}. Check that it is an NSE symbol.` });
      } catch {
        if (!dead) setSt({ s: "none", msg: "Could not load this company. Check your connection and try again." });
      }
    })();
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [ticker, tries]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = <button onClick={onBack} className="mb-2 min-h-10 text-[13.5px] font-medium text-accent">← All companies</button>;
  if (st.s === "loading") return <div>{back}<Card><p className="text-[14px] text-muted">Loading {ticker}…</p></Card></div>;
  if (st.s === "building") return (
    <div>{back}
      <Card hero>
        <p className="text-[15px] font-semibold">Researching {ticker}</p>
        <p className="mt-1 text-[13.5px] leading-snug text-muted">{st.msg} This takes two to four minutes the first time, then it is instant. This page refreshes itself.</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunk"><div className="h-full w-1/3 animate-pulse rounded-full bg-accent" /></div>
      </Card>
    </div>
  );
  if (st.s === "none") return <div>{back}<Card><p className="text-[14px]">{st.msg}</p></Card></div>;

  const { c } = st, lg = st.ledger, m = c.metrics, v = m.valuation, snap = m.snapshot, tr = m.trajectory, bs = m.balance_sheet, cq = m.cash_quality;
  const last = <T,>(a: T[] | undefined) => (a && a.length ? a[a.length - 1] : null);
  const hl = c.top_ratios["High / Low"] as number[] | undefined;
  const R = c.research;

  return (
    <div>
      {back}
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[19px] font-semibold leading-tight">{c.name.replace(/ (Ltd|Limited)\.?$/i, "")}</h2>
          <span className="num shrink-0 text-[17px] font-semibold">₹{num(snap.price, 1)}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-muted">
          <span className="num">{c.ticker}</span>{c.sector ? ` · ${c.sector}` : ""} · {cr(snap.market_cap)}{hl ? ` · 52w ₹${num(hl[1], 0)}–${num(hl[0], 0)}` : ""}
        </p>
        {(R?.summary || c.about) && <p className="mt-2 text-[14px] leading-snug">{(R?.summary || c.about || "").replace(/\s*\[\d+\]/g, "")}</p>}
        {R?.how_it_makes_money && <p className="mt-2 text-[13.5px] leading-snug text-muted">{R.how_it_makes_money}</p>}
        <p className="mt-2 text-[11.5px] text-muted">
          {R?.note ? `${R.note} ` : ""}{R?.summary ? `Read from: ${(R.sources ?? []).join(", ") || "primary filings"}.` : "Description from screener.in."} Financials are {c.basis ?? "consolidated"}.
        </p>
      </Card>

      {lg && (
        <button onClick={() => onLedger(c.ticker, lg)} className="mt-2.5 block w-full rounded-2xl border border-ink/70 bg-surface p-4 text-left">
          <span className="block text-[12px] font-semibold uppercase tracking-wide text-muted">Promise ledger</span>
          <span className="mt-0.5 block text-[16px] font-semibold">
            <span className="num">{lg.score.kept}</span> of <span className="num">{lg.score.settled}</span> due promises kept · {lg.score.revised} revised · {lg.score.pending} open
          </span>
          {lg.read && <span className="mt-1 block text-[13.5px] leading-snug text-muted">{lg.read}</span>}
          <span className="mt-1.5 block text-[13px] font-medium text-accent">See every promise with its quote →</span>
        </button>
      )}

      {R && (R.bull?.length || R.bear?.length) ? (
        <Section title="The debate">
          <CiteList title="What could go right" tone="good" items={R.bull ?? []} />
          <CiteList title="What could go wrong" tone="bad" items={R.bear ?? []} />
          {R.watch?.length ? <CiteList title="What to watch next" tone="idle" items={R.watch} /> : null}
        </Section>
      ) : null}

      <Section title="Valuation">
        <Card>
          <div className="grid grid-cols-3 gap-x-3 gap-y-3.5">
            <Ratio label="P/E" v={v.pe} suffix="×" range={v.pe_range} low="cheap" />
            <Ratio label="P/B" v={v.pb} suffix="×" />
            <Ratio label="EV/EBITDA" v={v.ev_ebitda} suffix="×" na={m.is_financial ? "n/a for lenders" : undefined} />
            <Ratio label="ROCE" v={v.roce} suffix="%" range={v.roce_range} na={m.is_financial ? "n/a for lenders" : undefined} />
            <Ratio label="ROE" v={v.roe} suffix="%" range={v.roe_range} />
            <Ratio label="Div. yield" v={v.dividend_yield} suffix="%" />
          </div>
          {!m.is_financial && v.ev_note && <p className="mt-2.5 text-[11.5px] text-muted">{v.ev_note}.</p>}
        </Card>
        {v.pe_band && v.pe_band.points?.length > 0 && (
          <Card>
            <h3 className="mb-1.5 text-[14px] font-semibold">P/E against its own 5 years</h3>
            <PEBand points={v.pe_band.points} median={v.pe_band.median} plus1={v.pe_band.plus1} minus1={v.pe_band.minus1} current={v.pe} />
          </Card>
        )}
      </Section>

      <Section title="Who owns it">
        <Card>
          <Ownership quarters={m.ownership.quarters} series={m.ownership.series} />
          <p className="mt-2 text-[11.5px] leading-snug text-muted">
            Over {m.ownership.quarters.length} quarters:{" "}
            {(["promoter", "fii", "dii"] as const).filter((k) => m.ownership.change_window?.[k] != null && (k !== "promoter" || m.ownership.has_promoter))
              .map((k) => `${k === "promoter" ? "promoters" : k.toUpperCase() + "s"} ${fmtpp(m.ownership.change_window[k]!)}`).join(", ")}.
            {!m.ownership.has_promoter ? " No promoter group." : ""}
          </p>
        </Card>
      </Section>

      <Section title="The business in numbers">
        <Card>
          <div className="grid grid-cols-3 gap-3">
            <Fig label="Revenue, TTM" v={cr(snap.revenue_ttm)} />
            <Fig label={m.is_financial ? "Financing margin" : "Operating margin"} v={snap.opm == null ? "–" : `${snap.opm}%`} />
            <Fig label="Net profit, TTM" v={cr(snap.pat_ttm)} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 text-[12px] font-semibold">Revenue</p>
              <Bars labels={tr.years} values={tr.sales} />
              <p className="text-[11.5px] text-muted">3y <Delta v={tr.sales_cagr_3y} /> · 5y <Delta v={tr.sales_cagr_5y} /> a year</p>
            </div>
            <div>
              <p className="mb-1 text-[12px] font-semibold">Net profit</p>
              <Bars labels={tr.years} values={tr.net_profit} />
              <p className="text-[11.5px] text-muted">3y <Delta v={tr.profit_cagr_3y} /> · 5y <Delta v={tr.profit_cagr_5y} /> a year</p>
            </div>
          </div>
        </Card>
        <Card>
          <h3 className="mb-2 text-[14px] font-semibold">Is the profit real cash?</h3>
          <div className="grid grid-cols-3 gap-3">
            <Fig label="Cash flow ÷ profit, 3y" v={cq.cfo_to_pat_3y == null ? "–" : `${cq.cfo_to_pat_3y.toFixed(2)}×`}
              tone={m.is_financial || cq.cfo_to_pat_3y == null ? undefined : cq.cfo_to_pat_3y >= 0.9 ? "good" : cq.cfo_to_pat_3y < 0.6 ? "bad" : "warn"} />
            <Fig label={`Debt ÷ equity, ${last(bs.periods) ?? ""}`} v={last(bs.debt_to_equity) == null ? "–" : `${last(bs.debt_to_equity)}×`} />
            <Fig label="Debtor days" v={last(bs.debtor_days) == null ? "–" : `${Math.round(last(bs.debtor_days)!)}`} />
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-muted">
            {m.is_financial
              ? "For a lender, operating cash flow moves with loan growth, so this ratio says little; read asset quality in the filings instead."
              : "Above 1× means the business collected more cash than the profit it reported. Well below 1× for years is the classic warning."}
            {" "}Free cash flow last year: {cr(last(cq.fcf))}.
          </p>
        </Card>
      </Section>

      <Section title="Primary sources">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {(c.documents.annual_reports ?? []).slice(0, 3).map((d) => <Doc key={d.url} label={`Annual report ${d.year}`} url={d.url} />)}
          {(c.documents.concalls ?? []).filter((d) => d.url || d.transcript).slice(0, 6).map((d) => <Doc key={d.period} label={`Earnings call, ${d.period}`} url={(d.url || d.transcript)!} />)}
        </div>
        <p className="px-1 text-[11.5px] leading-snug text-muted">
          Numbers: screener.in (company filings). Prices: Yahoo Finance, end of day. Promises and quotes: the transcripts above. Nothing here comes from
          news, brokers or social media.
        </p>
      </Section>
    </div>
  );
}

const fmtpp = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)} pp`;

function Ratio({ label, v, suffix, range, na, low }: { label: string; v: number | null; suffix: string; range?: Range; na?: string; low?: string }) {
  return (
    <div>
      <p className="text-[11.5px] text-muted">{label}</p>
      <p className="num text-[18px] font-semibold leading-tight">{v == null ? "–" : `${v.toFixed(1)}${suffix}`}</p>
      {v == null && na ? <p className="text-[11px] text-muted">{na}</p> : null}
      {v != null && range ? (
        <>
          <div className="relative mt-1 h-1 rounded-full bg-sunk" aria-hidden>
            <div className="absolute top-1/2 h-2.5 w-[3px] -translate-y-1/2 rounded-full bg-ink" style={{ left: `calc(${Math.max(0, Math.min(100, range.pctile))}% - 1.5px)` }} />
          </div>
          <p className="mt-0.5 text-[11px] leading-tight text-muted">
            {range.pctile <= 20 ? `near its 5y low${low ? "" : ""}` : range.pctile >= 80 ? "near its 5y high" : "mid-range"} · <span className="num">{range.min}–{range.max}</span>
          </p>
        </>
      ) : null}
    </div>
  );
}

function Fig({ label, v, tone }: { label: string; v: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div>
      <p className={`num text-[16px] font-semibold leading-tight ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{v}</p>
      <p className="mt-0.5 text-[11.5px] leading-tight text-muted">{label}</p>
    </div>
  );
}

function Doc({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-between border-b border-line px-4 py-2 last:border-0">
      <span className="text-[13.5px]">{label}</span>
      <span className="text-[13px] text-accent" aria-hidden>↗</span>
    </a>
  );
}

function CiteList({ title, tone, items }: { title: string; tone: "good" | "bad" | "idle"; items: Cite[] }) {
  if (!items.length) return null;
  return (
    <Card>
      <h3 className={`text-[12px] font-semibold uppercase tracking-wide ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-muted"}`}>{title}</h3>
      <ul className="mt-1.5 flex flex-col gap-3">
        {items.map((it, i) => (
          <li key={i}>
            <p className="text-[14px] leading-snug">{it.point}</p>
            {it.quote && <p className="mt-0.5 text-[12.5px] italic leading-snug text-muted">“{it.quote}”</p>}
            {it.url ? <SourceLink href={it.url}>{it.source ?? "Source"}{it.page ? `, p. ${it.page}` : ""}</SourceLink>
              : it.source ? <p className="text-[11.5px] text-muted">{it.source}</p> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
