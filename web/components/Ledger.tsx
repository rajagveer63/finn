"use client";
import { useMemo, useState } from "react";
import { day, type Holding, type Ledger as LedgerT, type Promise_ } from "@/lib/finn";
import { Avatar, Card, Section, SourceLink, STATUS } from "./ui";
import { ScoreBar } from "./Company";

type Props = { ledgers: Record<string, LedgerT>; holdings: Holding[]; ticker: string | null; onTicker: (t: string) => void; onCompany: (t: string) => void };

const tgt = (t: string | null) => (t == null ? "–" : t.replace(/\d{4,}/g, (d) => Number(d).toLocaleString("en-IN")));
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const short = (n: string) => n.replace(/ (Ltd|Limited)\.?$/i, "");
const GROUPS: [string, string[], string][] = [
  ["Changed or broken", ["MISSED", "DROPPED", "REVISED"], "Targets management moved, missed or stopped mentioning."],
  ["Kept", ["KEPT"], "Came due and was delivered."],
  ["Still open", ["PENDING", "UNVERIFIED"], "Not due yet. Tracking is from the latest call."],
];

/** The same promise repeated on several calls is one line with a longer history, not five lines. */
function merge(ps: Promise_[]): Promise_[] {
  const out = new Map<string, Promise_>();
  for (const p of ps) {
    const fam = /margin/.test(p.metric) ? "margin" : p.metric;
    const key = [p.status, p.period, fam, (p.target ?? "").replace(/[^\d.–-]/g, "")].join("|");
    const have = out.get(key);
    if (!have) { out.set(key, { ...p, history: [...p.history] }); continue; }
    const seen = new Set(have.history.map((h) => h.call + h.quote));
    have.history = [...have.history, ...p.history.filter((h) => !seen.has(h.call + h.quote))]
      .sort((a, b) => (a.said_on ?? "").localeCompare(b.said_on ?? ""));
    if ((p.first_said ?? "9") < (have.first_said ?? "9")) have.first_said = p.first_said;
  }
  return [...out.values()];
}

export default function Ledger({ ledgers, holdings, ticker, onTicker, onCompany }: Props) {
  const tickers = Object.keys(ledgers);
  const t = ticker && ledgers[ticker] ? ticker : tickers[0];
  const L = ledgers[t];
  const promises = useMemo(() => (L ? merge(L.promises) : []), [L]);
  if (!L) return <Card><p className="text-[14px] text-muted">No ledger has been built yet.</p></Card>;

  const cnt = (...st: string[]) => promises.filter((p) => st.includes(p.status)).length;
  const s = { ...L.score, kept: cnt("KEPT"), missed: cnt("MISSED"), dropped: cnt("DROPPED"), settled: cnt("KEPT", "MISSED"), pending: cnt("PENDING", "UNVERIFIED"), revised: promises.filter((p) => p.revised).length, total: promises.length };
  const callsOk = L.calls.filter((c) => !c.error);
  const without = holdings.filter((h) => !ledgers[h.ticker]).length;

  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Company">
        {tickers.map((k) => (
          <button key={k} role="tab" aria-selected={k === t} onClick={() => onTicker(k)}
            className={`flex h-10 shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-[13px] font-semibold ${k === t ? "border-transparent bg-ink text-bg" : "border-line bg-surface text-muted"}`}>
            <Avatar t={k} name={ledgers[k].name} size={30} />
            {short(ledgers[k].name)}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <section className="hero rise rounded-[28px] p-5">
          <div className="flex items-center gap-3">
            <Avatar t={t} name={L.name} size={40} />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-wide opacity-75">Did management keep its word?</p>
              <p className="truncate text-[15px] font-bold">{short(L.name)}</p>
            </div>
          </div>
          <p className="mt-3 text-[30px] font-bold leading-none">
            <span className="num">{s.kept}</span> <span className="text-[18px] font-semibold opacity-75">of</span> <span className="num">{s.settled}</span>
            <span className="text-[18px] font-semibold opacity-75"> due promises kept</span>
          </p>
          <div className="[&_.text-muted]:text-black/60"><ScoreBar s={s} /></div>
          {L.read && <p className="mt-3 rounded-2xl bg-black/10 p-3 text-[14px] leading-snug">{L.read}</p>}
        </section>
        <Card className="mt-3">
          <p className="text-[12px] leading-snug text-muted">
            Built from {callsOk.length} earnings-call transcripts ({callsOk[callsOk.length - 1]?.quarter} to {callsOk[0]?.quarter}). Every line is a
            quote with its date and page. Numeric targets are checked by arithmetic on reported financials where possible; the rest are judged
            by the model from later calls and marked so.
          </p>
          <button onClick={() => onCompany(t)} className="mt-1 min-h-8 text-[13px] font-medium text-accent">Open {short(L.name)} research</button>
        </Card>
      </div>

      {GROUPS.map(([title, statuses, hint]) => {
        const rows = promises.filter((p) => statuses.includes(p.status));
        if (!rows.length) return null;
        return (
          <Section key={title} title={title} count={rows.length}>
            <p className="-mt-1 px-1 text-[12px] text-muted">{hint}</p>
            {rows.map((p) => <PromiseCard key={p.id} p={p} />)}
          </Section>
        );
      })}

      <Section title="Calls read" count={L.calls.length}>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {L.calls.map((c) => (
            <a key={c.url} href={c.url} target="_blank" rel="noreferrer" className="flex items-baseline gap-2 border-b border-line px-4 py-2.5 last:border-0">
              <span className="num w-[68px] shrink-0 text-[12.5px] font-semibold">{c.quarter ?? c.period}</span>
              <span className="min-w-0 flex-1 text-[13px] text-muted">
                {c.error ? "Could not be read (not a text PDF)" : `${c.date ? day(c.date) : c.period} · ${c.pages ?? "?"} pages · ${c.promises} statements`}
              </span>
              <span className="text-[13px] text-accent" aria-hidden>↗</span>
            </a>
          ))}
        </div>
      </Section>

      {without > 0 && (
        <p className="mt-4 px-1 text-[12px] leading-snug text-muted">
          The ledger is built for {tickers.length} companies. The other {without} holdings show filings, valuation and ownership; a ledger is
          built for any company you open in Research.
        </p>
      )}
    </div>
  );
}

function PromiseCard({ p }: { p: Promise_ }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[p.status] ?? STATUS.PENDING;
  const moved = p.revised && p.first_target && p.first_target !== p.target;
  const track = p.status === "PENDING" && p.tracking && p.tracking !== "unclear" ? p.tracking.replace(/_/g, " ") : null;
  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug">{cap(p.label)}</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            {p.period}{p.first_said ? ` · first said ${day(p.first_said)}` : ""}{p.history.length > 1 ? ` · repeated on ${p.history.length} calls` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold leading-none ${st.cls}`}>
          {p.status === "REVISED" && p.net_direction ? (p.net_direction === "cut" ? "Cut" : "Raised") : st.label}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11.5px] text-muted">{moved ? "Promised, then now" : "Promised"}</p>
          <p className="num text-[15px] font-semibold leading-snug">
            {moved ? <>{tgt(p.first_target)} <span className="text-muted">→</span> {tgt(p.target)}</> : tgt(p.target)}
          </p>
        </div>
        <div>
          <p className="text-[11.5px] text-muted">{p.status === "PENDING" || p.status === "UNVERIFIED" ? "So far" : "What happened"}</p>
          <p className="text-[13px] leading-snug">{p.actual || "Nothing reported yet"}</p>
        </div>
      </div>

      {p.verdict && <p className="mt-2 text-[13px] leading-snug text-muted">{p.verdict}</p>}
      <p className="mt-1.5 text-[11.5px] text-muted">
        {track ? `Tracking: ${track} · ` : ""}Decided by {p.decided_by}
      </p>

      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 min-h-8 text-[13px] font-medium text-accent">
        {open ? "Hide" : "Show"} what was said ({p.history.length})
      </button>
      {open && (
        <ol className="mt-1 border-l-2 border-line pl-3">
          {p.history.map((h, i) => (
            <li key={i} className="mb-3 last:mb-0">
              <p className="text-[11.5px] text-muted">
                {h.call}{h.said_on ? ` · ${day(h.said_on)}` : ""}{h.speaker ? ` · ${h.speaker}` : ""}
                {h.target ? <> · <span className="num text-ink">{h.target}</span></> : null}
              </p>
              <p className="mt-0.5 text-[13px] italic leading-snug">“{h.quote}”</p>
              <SourceLink href={h.url}>Transcript{h.page ? `, p. ${h.page}` : ""}</SourceLink>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
