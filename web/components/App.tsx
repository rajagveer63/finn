"use client";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_RULES, loadRules, saveRules, num, type Filing, type Holding, type Ledger as LedgerT, type Meta, type Move, type Rules as RulesT } from "@/lib/finn";
import Brief from "./Brief";
import Ledger from "./Ledger";
import Company from "./Company";
import Rules from "./Rules";
import { Avatar, Card, Change, Section } from "./ui";

type Tab = "brief" | "ledger" | "research" | "rules";
type Data = { feed: Filing[]; moves: Record<string, Move[]>; holdings: Holding[]; meta: Meta | null; ledgers: Record<string, LedgerT>; adhoc: Holding[] };

const get = async <T,>(url: string, fallback: T): Promise<T> => {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return fallback;
    return (await r.json()) as T;
  } catch { return fallback; }
};
const short = (n: string) => n.replace(/ (Ltd|Limited)\.?$/i, "");

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
      ls.forEach((l) => { if (l?.promises?.length) ledgers[l.ticker] = l; });
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
  const all = useMemo(() => (data ? [...data.holdings, ...data.adhoc] : []), [data]);

  const synced = data?.meta?.generated_at
    ? new Date(data.meta.generated_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : null;
  const ready = data && now > 0;

  return (
    <div className="mx-auto min-h-dvh max-w-[520px]">
      <header className="sticky top-0 z-30 bg-bg/85 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="hero grid h-8 w-8 place-items-center rounded-[10px] text-[15px] font-black" aria-hidden>F</span>
          <h1 className="text-[18px] font-extrabold tracking-tight">FINN</h1>
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-muted">
            {synced && <><span className="h-1.5 w-1.5 rounded-full bg-good" />Synced {synced}</>}
          </span>
        </div>
      </header>

      <main className="px-4 pb-28 pt-1">
        {failed && <Card><p className="text-[14px]">Could not load the portfolio data. Pull down to refresh.</p></Card>}
        {!ready && !failed && <Skeleton />}
        {ready && tab === "brief" && (
          <Brief feed={data.feed} moves={data.moves} holdings={data.holdings} ledgers={data.ledgers} rules={rules} now={now} onCompany={openCompany} onLedger={openLedger} />
        )}
        {ready && tab === "ledger" && (
          <Ledger ledgers={data.ledgers} holdings={data.holdings} ticker={ledgerTicker} onTicker={setLedgerTicker} onCompany={openCompany} />
        )}
        {ready && tab === "research" && (company
          ? <Company key={company} ticker={company} ledger={data.ledgers[company] ?? null} dayPct={all.find((h) => h.ticker === company)?.pct}
              onBack={() => setCompany(null)} onLedger={openLedger} />
          : <Finder holdings={data.holdings} adhoc={data.adhoc} onOpen={openCompany} />)}
        {ready && tab === "rules" && (
          <Rules rules={rules} onRules={onRules} feed={data.feed} moves={data.moves} holdings={data.holdings} ledgers={data.ledgers} meta={data.meta} now={now} />
        )}
        <p className="mt-10 px-2 text-center text-[11px] leading-snug text-muted">
          A research tool, not investment advice. Sources: NSE filings, annual reports and earnings-call transcripts, screener.in, Yahoo Finance.
        </p>
      </main>

      <nav className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-md" aria-label="Main">
        <div className="mx-auto grid max-w-[520px] grid-cols-4 px-2 py-1.5">
          {([["brief", "Brief"], ["ledger", "Ledger"], ["research", "Research"], ["rules", "Alerts"]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => { if (k === "research" && tab === "research") setCompany(null); go(k); }} aria-current={tab === k ? "page" : undefined}
              className="flex h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold">
              <span className={`grid h-7 w-14 place-items-center rounded-full transition-colors ${tab === k ? "bg-accent text-[#0b0d0a]" : "text-muted"}`}><Icon name={k} on={tab === k} /></span>
              <span className={tab === k ? "text-ink" : "text-muted"}>{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Finder({ holdings, adhoc, onOpen }: { holdings: Holding[]; adhoc: Holding[]; onOpen: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<{ ticker: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => [...holdings, ...adhoc], [holdings, adhoc]);
  const clean = q.trim();
  const local = clean ? all.filter((h) => h.ticker.includes(clean.toUpperCase()) || h.name.toUpperCase().includes(clean.toUpperCase())).slice(0, 5) : [];

  useEffect(() => {
    if (clean.length < 2) { setRemote([]); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(clean)}`);
        setRemote(r.ok ? await r.json() : []);
      } catch { setRemote([]); }
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [clean]);

  const known = new Set(local.map((h) => h.ticker));
  const extra = remote.filter((r) => !known.has(r.ticker));
  const submit = () => {
    const first = local[0]?.ticker ?? extra[0]?.ticker ?? (/^[A-Za-z0-9&-]{2,20}$/.test(clean) ? clean.toUpperCase() : null);
    if (first) onOpen(first);
  };

  const row = (h: Holding) => (
    <button key={h.ticker} onClick={() => onOpen(h.ticker)} className="tap flex min-h-[60px] w-full items-center gap-3 border-b border-line px-3.5 py-2 text-left last:border-0">
      <Avatar t={h.ticker} name={h.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold">{short(h.name)}</span>
        <span className="block truncate text-[11.5px] text-muted"><span className="num">{h.ticker}</span> · {h.sector}{h.ledger ? " · ledger" : ""}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="num block text-[14px] font-semibold">{h.price == null ? "–" : `₹${num(h.price, 1)}`}</span>
        <span className="mt-0.5 block"><Change v={h.pct} /></span>
      </span>
    </button>
  );

  return (
    <div>
      <section className="hero rise rounded-[28px] p-5">
        <h2 className="text-[21px] font-bold leading-tight">Research any NSE company</h2>
        <p className="mt-1 text-[13px] opacity-80">From annual reports, earnings-call transcripts and reported financials only.</p>
        <form className="relative mt-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8c93a1]" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or symbol, e.g. Tata Steel" autoCorrect="off" spellCheck={false} aria-label="Search companies"
            className="h-12 w-full rounded-2xl bg-[#0b0d0a] pl-11 pr-4 text-[16px] text-[#f4f5f7] outline-none placeholder:text-[#8c93a1] focus:ring-2 focus:ring-[#0b0d0a]/40" />
        </form>
      </section>

      {clean.length >= 2 && (
        <div className="card mt-3 overflow-hidden">
          {local.map(row)}
          {extra.map((r) => (
            <button key={r.ticker} onClick={() => onOpen(r.ticker)} className="tap flex min-h-[60px] w-full items-center gap-3 border-b border-line px-3.5 py-2 text-left last:border-0">
              <Avatar t={r.ticker} name={r.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">{short(r.name)}</span>
                <span className="block text-[11.5px] text-muted"><span className="num">{r.ticker}</span> · researched live</span>
              </span>
              <span className="text-[13px] font-semibold text-accent">Open →</span>
            </button>
          ))}
          {!local.length && !extra.length && <p className="px-4 py-3 text-[13px] text-muted">{busy ? "Searching…" : "No listed company matches. Try the NSE symbol."}</p>}
        </div>
      )}

      {adhoc.length > 0 && <Section title="Researched on request" count={adhoc.length}><div className="card overflow-hidden">{adhoc.map(row)}</div></Section>}
      <Section title="Your portfolio" count={holdings.length}><div className="card overflow-hidden">{holdings.map(row)}</div></Section>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      <div className="hero shimmer h-[150px] rounded-[28px]" />
      {[44, 150, 150].map((h, i) => <div key={i} className="shimmer rounded-2xl bg-sunk" style={{ height: h }} />)}
    </div>
  );
}

function Icon({ name, on }: { name: Tab; on: boolean }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: on ? 2.2 : 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden>
      {name === "brief" && <><path {...p} d="M5 5h14v14H5z" /><path {...p} d="M8 9h8M8 12.5h8M8 16h5" /></>}
      {name === "ledger" && <><path {...p} d="M6 3.5h12v17H6z" /><path {...p} d="M9 9l2 2 4-4M9 16h6" /></>}
      {name === "research" && <><circle {...p} cx="11" cy="11" r="6.5" /><path {...p} d="M16 16l4.5 4.5" /></>}
      {name === "rules" && <><path {...p} d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" /><path {...p} d="M10 20.5h4" /></>}
    </svg>
  );
}
