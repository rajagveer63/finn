"use client";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_RULES, loadRules, saveRules, num, type Filing, type Holding, type Ledger as LedgerT, type Meta, type Move, type Rules as RulesT } from "@/lib/finn";
import Brief from "./Brief";
import Ledger from "./Ledger";
import Company from "./Company";
import Rules from "./Rules";
import { Card, Delta, Section } from "./ui";

type Tab = "brief" | "ledger" | "research" | "rules";
type Data = { feed: Filing[]; moves: Record<string, Move[]>; holdings: Holding[]; meta: Meta | null; ledgers: Record<string, LedgerT>; adhoc: Holding[] };

const get = async <T,>(url: string, fallback: T): Promise<T> => {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return fallback;
    return (await r.json()) as T;
  } catch { return fallback; }
};

export default function App() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("brief");
  const [company, setCompany] = useState<string | null>(null);
  const [ledgerTicker, setLedgerTicker] = useState<string | null>(null);
  const [rules, setRules] = useState<RulesT>(DEFAULT_RULES);
  const [now, setNow] = useState(0);   // read the clock after mount, never during prerender

  useEffect(() => {
    setRules(loadRules());
    setNow(Date.now());
    (async () => {
      const [feedRaw, moves, holdings, meta, adhoc] = await Promise.all([
        get<Filing[] | { items: Filing[] }>("/data/feed.json", []), get<Record<string, Move[]>>("/data/moves.json", {}),
        get<Holding[]>("/data/portfolio.json", []), get<Meta | null>("/data/meta.json", null), get<Holding[]>("/data/adhoc.json", []),
      ]);
      if (!holdings.length) { setFailed(true); return; }
      const feed = Array.isArray(feedRaw) ? feedRaw : feedRaw.items ?? [];
      const withLedger = [...holdings, ...adhoc].filter((h) => h.ledger);
      const ls = await Promise.all(withLedger.map((h) => get<LedgerT | null>(`/data/ledger/${h.ticker}.json`, null)));
      const ledgers: Record<string, LedgerT> = {};
      ls.forEach((l) => { if (l) ledgers[l.ticker] = l; });
      setData({ feed, moves, holdings, meta, ledgers, adhoc });
    })();
  }, []);

  // deep links: #ledger/INFY, #research/TCS, #rules. Back button works, links can be shared.
  useEffect(() => {
    const read = () => {
      const [t, k] = decodeURIComponent(location.hash.slice(1)).split("/");
      if (!["brief", "ledger", "research", "rules"].includes(t)) return;
      setTab(t as Tab);
      if (t === "research") setCompany(k ? k.toUpperCase() : null);
      if (t === "ledger" && k) setLedgerTicker(k.toUpperCase());
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    const h = `#${tab}${tab === "research" && company ? `/${company}` : tab === "ledger" && ledgerTicker ? `/${ledgerTicker}` : ""}`;
    if (location.hash !== h && !(tab === "brief" && !location.hash)) history.pushState(null, "", h);
  }, [tab, company, ledgerTicker]);

  const go = (t: Tab) => { setTab(t); window.scrollTo({ top: 0 }); };
  const openCompany = (t: string) => { setCompany(t.toUpperCase()); go("research"); };
  const openLedger = (t: string, l?: LedgerT) => {
    if (l && data && !data.ledgers[t]) setData({ ...data, ledgers: { ...data.ledgers, [t]: l } });
    setLedgerTicker(t); go("ledger");
  };
  const onRules = (r: RulesT) => { setRules(r); saveRules(r); };

  const synced = data?.meta?.generated_at
    ? new Date(data.meta.generated_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : null;

  return (
    <div className="mx-auto min-h-dvh max-w-[520px]">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[19px] font-bold tracking-tight">FINN</h1>
          <p className="text-[11.5px] text-muted">{synced ? `Filings synced ${synced} IST` : " "}</p>
        </div>
      </header>

      <main className="px-4 pb-28 pt-3">
        {failed && <Card><p className="text-[14px]">Could not load the portfolio data. Pull to refresh.</p></Card>}
        {(!data || !now) && !failed && <Skeleton />}
        {data && now > 0 && tab === "brief" && (
          <Brief feed={data.feed} moves={data.moves} holdings={data.holdings} ledgers={data.ledgers} rules={rules} now={now} onCompany={openCompany} onLedger={openLedger} />
        )}
        {data && now > 0 && tab === "ledger" && (
          <Ledger ledgers={data.ledgers} holdings={data.holdings} ticker={ledgerTicker} onTicker={setLedgerTicker} onCompany={openCompany} />
        )}
        {data && now > 0 && tab === "research" && (company
          ? <Company key={company} ticker={company} ledger={data.ledgers[company] ?? null} onBack={() => setCompany(null)} onLedger={openLedger} />
          : <Finder holdings={data.holdings} adhoc={data.adhoc} onOpen={openCompany} />)}
        {data && now > 0 && tab === "rules" && (
          <Rules rules={rules} onRules={onRules} feed={data.feed} moves={data.moves} holdings={data.holdings} ledgers={data.ledgers} meta={data.meta} now={now} />
        )}
        <p className="mt-8 px-1 text-center text-[11px] leading-snug text-muted">
          A research tool, not investment advice. Sources: NSE filings, company annual reports and earnings-call transcripts, screener.in, Yahoo Finance.
        </p>
      </main>

      <nav className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur" aria-label="Sections">
        <div className="mx-auto grid max-w-[520px] grid-cols-4">
          {([["brief", "Brief"], ["ledger", "Ledger"], ["research", "Research"], ["rules", "Rules"]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => { if (k === "research" && tab === "research") setCompany(null); go(k); }} aria-current={tab === k ? "page" : undefined}
              className={`flex h-14 flex-col items-center justify-center gap-1 text-[11.5px] font-semibold ${tab === k ? "text-ink" : "text-muted"}`}>
              <Icon name={k} on={tab === k} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Finder({ holdings, adhoc, onOpen }: { holdings: Holding[]; adhoc: Holding[]; onOpen: (t: string) => void }) {
  const [q, setQ] = useState("");
  const clean = q.trim().toUpperCase().replace(/\.NS$/, "");
  const all = useMemo(() => [...holdings, ...adhoc], [holdings, adhoc]);
  const hits = clean ? all.filter((h) => h.ticker.includes(clean) || h.name.toUpperCase().includes(clean)) : [];
  const valid = /^[A-Z0-9&-]{2,15}$/.test(clean);
  const row = (h: Holding) => (
    <button key={h.ticker} onClick={() => onOpen(h.ticker)} className="flex min-h-12 w-full items-center gap-2 border-b border-line px-4 py-2 text-left last:border-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{h.name.replace(/ (Ltd|Limited)\.?$/i, "")}</span>
        <span className="block text-[11.5px] text-muted"><span className="num">{h.ticker}</span> · {h.sector}{h.ledger ? " · ledger" : ""}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="num block text-[13.5px] font-semibold">{h.price == null ? "–" : `₹${num(h.price, 1)}`}</span>
        <span className="block text-[11.5px]">{h.pe ? <span className="num text-muted">P/E {h.pe.toFixed(1)} · </span> : null}<Delta v={h.pct} /></span>
      </span>
    </button>
  );
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); if (hits.length === 1) onOpen(hits[0].ticker); else if (valid) onOpen(clean); }}>
        <label className="block text-[13px] font-semibold" htmlFor="tk">Research any NSE company</label>
        <div className="mt-1.5 flex gap-2">
          <input id="tk" value={q} onChange={(e) => setQ(e.target.value)} placeholder="NSE symbol, e.g. TCS or TRENT" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent" />
          <button type="submit" disabled={!valid} className="h-12 rounded-xl bg-ink px-5 text-[14px] font-semibold text-bg disabled:opacity-40">Open</button>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
          Answers come only from annual reports, earnings-call transcripts and reported financials. A company outside the list below is researched on demand.
        </p>
      </form>
      {hits.length > 0 && <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">{hits.slice(0, 6).map(row)}</div>}
      {adhoc.length > 0 && <Section title="Researched on request" count={adhoc.length}><div className="overflow-hidden rounded-2xl border border-line bg-surface">{adhoc.map(row)}</div></Section>}
      <Section title="Your portfolio" count={holdings.length}><div className="overflow-hidden rounded-2xl border border-line bg-surface">{holdings.map(row)}</div></Section>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading">
      {[120, 44, 150, 150].map((h, i) => <div key={i} className="animate-pulse rounded-2xl bg-sunk" style={{ height: h }} />)}
    </div>
  );
}

function Icon({ name, on }: { name: Tab; on: boolean }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: on ? 2.2 : 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      {name === "brief" && <><path {...p} d="M4 6h16M4 12h16M4 18h10" /></>}
      {name === "ledger" && <><path {...p} d="M5 4h14v16H5z" /><path {...p} d="M9 9l2 2 4-4M9 16h6" /></>}
      {name === "research" && <><circle {...p} cx="11" cy="11" r="6.5" /><path {...p} d="M16 16l4.5 4.5" /></>}
      {name === "rules" && <><path {...p} d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle {...p} cx="16" cy="7" r="2" /><circle {...p} cx="8" cy="17" r="2" /></>}
    </svg>
  );
}
