"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildBrief, headline, sentence, when, day, cr, num, type BriefItem, type Filing, type Holding, type Ledger,
  type LedgerEvent, type Move, type ResultsCard, type Rules,
} from "@/lib/finn";
import { Card, Delta, Pill, Section, SourceLink, Ticker } from "./ui";

const WINDOWS: [number, string, string][] = [[1, "24h", "24 hours"], [7, "7d", "7 days"], [30, "30d", "30 days"], [90, "90d", "90 days"]];

type Props = {
  feed: Filing[]; moves: Record<string, Move[]>; holdings: Holding[]; ledgers: Record<string, Ledger>;
  rules: Rules; now: number; onCompany: (t: string) => void; onLedger: (t: string) => void;
};

export default function Brief({ feed, moves, holdings, ledgers, rules, now, onCompany, onLedger }: Props) {
  const [days, setDays] = useState(7);
  const [showRoutine, setShowRoutine] = useState(false);
  const names = useMemo(() => Object.fromEntries(holdings.map((h) => [h.ticker, h.name])), [holdings]);
  const brief = useMemo(() => buildBrief(feed, moves, holdings, ledgers, rules, days, now), [feed, moves, holdings, ledgers, rules, days, now]);
  const label = WINDOWS.find((w) => w[0] === days)![2];

  const lines = useMemo(() => {
    const spoken = [...brief.top.slice(0, 5), ...(brief.top.length < 3 ? brief.notable.slice(0, 3 - brief.top.length) : [])];
    const hour = new Date(now).getHours();
    const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const n = brief.top.length;
    const intro = n
      ? `${hello}. In the last ${label}, ${n} ${n === 1 ? "thing needs" : "things need"} your attention. ${brief.routine.length} filings are routine.`
      : `${hello}. Nothing in the last ${label} needs your attention. ${brief.routine.length} filings are routine.`;
    return [
      { id: null as string | null, text: intro },
      ...spoken.map((it) => ({ id: it.id as string | null, text: sentence(it, names) })),
      ...(brief.notable.length ? [{ id: "notable" as string | null, text: `${brief.notable.length} more are worth a line. That is your brief.` }] : []),
    ];
  }, [brief, names, label, now]);

  const jump = (id: string | null) => {
    if (!id) return;
    const el = document.getElementById(id === "notable" ? "sec-notable" : `card-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const lastMaterial = useMemo(() => feed.find((f) => f.tier === 1), [feed]);

  return (
    <div>
      <AudioBrief lines={lines} onJump={jump} />

      <div className="mt-4 grid grid-cols-4 rounded-xl border border-line bg-sunk p-1" role="tablist" aria-label="Time window">
        {WINDOWS.map(([d, short]) => (
          <button
            key={d}
            role="tab"
            aria-selected={days === d}
            onClick={() => setDays(d)}
            className={`h-9 rounded-lg text-[13px] font-semibold transition-colors ${days === d ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          >
            {short}
          </button>
        ))}
      </div>

      {brief.top.length === 0 && brief.notable.length === 0 && (
        <Card>
          <p className="text-[15px] font-semibold">Quiet {label}.</p>
          <p className="mt-1 text-[13.5px] text-muted">
            Nothing material was filed and no holding crossed your thresholds.
            {lastMaterial && <> Last material item: {names[lastMaterial.ticker] ?? lastMaterial.ticker}, {lastMaterial.title.toLowerCase()} ({when(lastMaterial.ts, now)}).</>}
          </p>
          {days < 7 && (
            <button onClick={() => setDays(7)} className="mt-3 h-10 rounded-lg bg-ink px-4 text-[13px] font-semibold text-bg">
              Show the last 7 days
            </button>
          )}
        </Card>
      )}

      {brief.top.length > 0 && (
        <Section title="Needs attention" count={brief.top.length}>
          {brief.top.map((it, i) => (
            <ItemCard key={it.id} it={it} hero={i === 0} names={names} now={now} ledgers={ledgers} rules={rules} onCompany={onCompany} onLedger={onLedger} />
          ))}
        </Section>
      )}

      {brief.notable.length > 0 && (
        <div id="sec-notable" className="scroll-mt-28">
          <Section title="Worth a line" count={brief.notable.length}>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              {brief.notable.slice(0, 40).map((it) => (
                <Row key={it.id} it={it} names={names} now={now} rules={rules} onCompany={onCompany} />
              ))}
            </div>
          </Section>
        </div>
      )}

      {brief.routine.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowRoutine((s) => !s)}
            aria-expanded={showRoutine}
            className="flex w-full items-center justify-between rounded-2xl border border-dashed border-line px-4 py-3 text-left"
          >
            <span>
              <span className="block text-[14px] font-semibold text-muted">{brief.routine.length} routine filings, hidden</span>
              <span className="block text-[12.5px] text-muted">{routineMix(brief.routine)}</span>
            </span>
            <span className="text-muted" aria-hidden>{showRoutine ? "−" : "+"}</span>
          </button>
          {showRoutine && (
            <div className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
              {brief.routine.slice(0, 80).map((f) => (
                <a key={f.id} href={f.pdf} target="_blank" rel="noreferrer" className="flex items-baseline gap-2 border-b border-line px-4 py-2.5 last:border-0">
                  <Ticker t={f.ticker} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{f.title}</span>
                  <span className="shrink-0 text-[11.5px] text-muted">{when(f.ts, now)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function routineMix(items: Filing[]) {
  const c: Record<string, number> = {};
  for (const f of items) c[f.label] = (c[f.label] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ");
}

// ---------------------------------------------------------------- audio brief

function AudioBrief({ lines, onJump }: { lines: { id: string | null; text: string }[]; onJump: (id: string | null) => void }) {
  const [idx, setIdx] = useState(-1);
  const [supported, setSupported] = useState(true);
  const run = useRef(0);
  const secs = Math.round(lines.reduce((s, l) => s + l.text.split(/\s+/).length, 0) / 2.7);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => { run.current++; if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, []);
  useEffect(() => { stop(); /* the script changed: never read a stale brief */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  function speak(i: number, token: number) {
    if (token !== run.current) return;
    if (i >= lines.length) { setIdx(-1); return; }
    const u = new SpeechSynthesisUtterance(lines[i].text);
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang.startsWith("en-GB")) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    u.lang = u.voice?.lang ?? "en-IN";
    u.rate = 1.03;
    u.onend = () => speak(i + 1, token);
    u.onerror = () => { if (token === run.current) setIdx(-1); };
    setIdx(i);
    if (i > 0) onJump(lines[i].id);
    window.speechSynthesis.speak(u);
  }
  function play(from = 0) {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const token = ++run.current;
    setTimeout(() => speak(from, token), 60);      // Safari needs a beat after cancel()
  }
  function stop() {
    run.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setIdx(-1);
  }
  const playing = idx >= 0;

  return (
    <section className="rounded-2xl bg-ink p-4 text-bg">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (playing ? stop() : play(0))}
          aria-label={playing ? "Stop the spoken brief" : "Play the spoken brief"}
          disabled={!supported}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-bg text-ink disabled:opacity-40"
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight">Your brief</p>
          <p className="text-[12.5px] opacity-70">
            {supported ? `About ${secs} seconds. Tap a line to hear it and jump to it.` : "This browser cannot speak. The brief is below."}
          </p>
        </div>
        <span className={`eq ${playing ? "on" : ""} opacity-80`} aria-hidden><span /><span /><span /><span /></span>
      </div>
      <ol className="mt-3 flex flex-col gap-1">
        {lines.map((l, i) => (
          <li key={i}>
            <button
              onClick={() => { onJump(l.id); play(i); }}
              className={`w-full rounded-lg px-2 py-1.5 text-left text-[13.5px] leading-snug transition-colors ${idx === i ? "bg-bg/15 font-medium" : "opacity-80"}`}
            >
              {l.text}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- cards

type ItemProps = {
  it: BriefItem; hero?: boolean; names: Record<string, string>; now: number; ledgers: Record<string, Ledger>;
  rules: Rules; onCompany: (t: string) => void; onLedger: (t: string) => void;
};

function Head({ it, names, now, pill, tone }: { it: BriefItem; names: Record<string, string>; now: number; pill: string; tone: "bad" | "good" | "warn" | "idle" | "accent" }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <Ticker t={it.ticker} />
      <Pill tone={tone}>{pill}</Pill>
      <span className="ml-auto shrink-0 text-[11.5px] text-muted" title={day(it.ts)}>{when(it.ts, now)}</span>
    </div>
  );
}

function ItemCard({ it, hero, names, now, ledgers, rules, onCompany, onLedger }: ItemProps) {
  const [open, setOpen] = useState(false);
  const name = (names[it.ticker] ?? it.ticker).replace(/ (Ltd|Limited)\.?$/i, "");

  if (it.kind === "move") {
    const m = it.move;
    return (
      <Card id={`card-${it.id}`}>
        <Head it={it} names={names} now={now} pill="Unusual move" tone="warn" />
        <h3 className="text-[15.5px] font-semibold leading-snug">{name}</h3>
        <div className="mt-2 flex gap-6">
          <Stat label="Price, day"><Delta v={m.pct} /></Stat>
          <Stat label="Volume vs 20-day"><span className="num">{m.volx ? `${m.volx.toFixed(1)}×` : "–"}</span></Stat>
          <Stat label="Close"><span className="num">₹{num(m.c, 2)}</span></Stat>
        </div>
        <p className="mt-2 text-[13px] text-muted">
          {it.trigger ? <>Same day as: <span className="text-ink">{it.trigger.title}</span></> : "No filing explains it."}{" "}
          Your rule: volume ≥ {rules.volx}× or price ± {rules.pct}%.
        </p>
        <Actions onCompany={() => onCompany(it.ticker)} pdf={it.trigger?.pdf} />
      </Card>
    );
  }
  if (it.kind === "ownership" || it.kind === "valuation") return null;

  const f = it.filing;
  const bad = it.events.find((e) => ["cut", "missed", "dropped"].includes(e.type));
  const ev = bad ?? it.events[0];
  const tone = bad ? "bad" : f.category === "litigation" ? "warn" : "accent";
  return (
    <Card id={`card-${it.id}`} hero={hero && !!bad}>
      <Head it={it} names={names} now={now} pill={bad ? (bad.type === "cut" ? "Guidance cut" : `Promise ${bad.type}`) : f.label} tone={tone} />
      <h3 className="text-[15.5px] font-semibold leading-snug">
        {headline(name, f.title)}
      </h3>

      {ev && <EventLine ev={ev} onLedger={() => onLedger(it.ticker)} />}
      {f.card?.type === "results" && <ResultsTable card={f.card} />}
      {f.card?.type !== "results" && f.summary && <p className="mt-1.5 text-[13.5px] leading-snug text-muted">{f.summary}</p>}
      {f.card?.type === "person" && f.card.bio && (
        <div className="mt-2.5 rounded-xl bg-sunk p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Who is {f.card.name.split(" ").slice(-1)[0]}?</p>
          <p className="mt-1 text-[13.5px] leading-snug">{f.card.bio}</p>
          <p className="mt-1 text-[11.5px] text-muted">From the filing itself{f.card.effective ? ` · effective ${f.card.effective}` : ""}</p>
        </div>
      )}

      {it.earlier.length > 0 && (
        <div className="mt-2.5">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-[13px] font-medium text-accent">
            {open ? "Hide" : "Show"} {it.earlier.length} earlier {it.earlier.length === 1 ? "update" : "updates"} in this story
          </button>
          {open && (
            <ol className="mt-2 border-l border-line pl-3">
              {it.earlier.map((e) => (
                <li key={e.id} className="mb-2 last:mb-0">
                  <a href={e.pdf} target="_blank" rel="noreferrer" className="block">
                    <span className="text-[11.5px] text-muted">{day(e.ts)}</span>
                    <span className="block text-[13px] leading-snug">{e.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <Actions onCompany={() => onCompany(it.ticker)} pdf={f.pdf} related={f.related} onLedger={ledgers[it.ticker] ? () => onLedger(it.ticker) : undefined} />
    </Card>
  );
}

function EventLine({ ev, onLedger }: { ev: LedgerEvent; onLedger: () => void }) {
  const bad = ["cut", "missed", "dropped"].includes(ev.type);
  return (
    <button onClick={onLedger} className={`mt-2 block w-full rounded-xl p-3 text-left ${bad ? "bg-bad-soft" : "bg-good-soft"}`}>
      <span className={`block text-[12px] font-semibold uppercase tracking-wide ${bad ? "text-bad" : "text-good"}`}>
        {ev.type === "cut" ? "Management cut its own target" : ev.type === "raised" ? "Management raised its own target" : `Promise ${ev.type}`}
      </span>
      <span className="mt-0.5 block text-[14px] font-medium leading-snug">{ev.label}</span>
      <span className="num mt-1 block text-[15px] font-semibold">
        {ev.from ?? "–"} <span className="text-muted">→</span> {ev.to ?? "–"}
      </span>
      {ev.quote && <span className="mt-1 block text-[12.5px] italic leading-snug text-muted">“{ev.quote}”{ev.page ? ` (transcript p. ${ev.page})` : ""}</span>}
    </button>
  );
}

function ResultsTable({ card }: { card: ResultsCard }) {
  return (
    <div className="mt-2.5">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-[11.5px] uppercase tracking-wide text-muted">
            <th className="pb-1 text-left font-medium">{card.quarter}</th>
            <th className="pb-1 text-right font-medium">₹ cr</th>
            <th className="pb-1 text-right font-medium">QoQ</th>
            <th className="pb-1 text-right font-medium">YoY</th>
          </tr>
        </thead>
        <tbody>
          {card.rows.map((r) => (
            <tr key={r.metric} className="border-t border-line">
              <td className="py-1.5 font-medium">{r.metric}</td>
              <td className="num py-1.5 text-right">{num(r.value, 0)}</td>
              <td className="py-1.5 text-right"><Delta v={r.qoq} /></td>
              <td className="py-1.5 text-right"><Delta v={r.yoy} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
        {card.verified && <span className="font-semibold text-good">Checked. </span>}
        Source: {card.source}{card.note ? `; ${card.note}` : ""}.{card.ebitda_def ? ` EBITDA = ${card.ebitda_def}.` : ""}
      </p>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[18px] font-semibold leading-tight">{children}</div>
      <div className="text-[11.5px] text-muted">{label}</div>
    </div>
  );
}

function Actions({ pdf, related, onCompany, onLedger }: { pdf?: string; related?: { title: string; pdf: string }[]; onCompany: () => void; onLedger?: () => void }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2">
      {pdf && <SourceLink href={pdf}>Filing</SourceLink>}
      {related?.slice(0, 2).map((r) => <SourceLink key={r.pdf} href={r.pdf}>{/present/i.test(r.title) ? "Presentation" : /press/i.test(r.title) ? "Press release" : "Related"}</SourceLink>)}
      <button onClick={onCompany} className="min-h-8 text-[13px] font-medium text-accent">Research</button>
      {onLedger && <button onClick={onLedger} className="min-h-8 text-[13px] font-medium text-accent">Ledger</button>}
    </div>
  );
}

function Row({ it, names, now, rules, onCompany }: { it: BriefItem; names: Record<string, string>; now: number; rules: Rules; onCompany: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  let title = "", sub: string | null = null, pill = "", pdf: string | undefined;
  if (it.kind === "filing") {
    title = it.filing.title; sub = it.filing.summary ?? null; pill = it.filing.label; pdf = it.filing.pdf;
    if (it.earlier.length) pill += ` +${it.earlier.length}`;
  } else if (it.kind === "move") {
    const m = it.move;
    title = `${(m.pct ?? 0) >= 0 ? "Up" : "Down"} ${Math.abs(m.pct ?? 0).toFixed(1)}%${m.volx ? ` on ${m.volx.toFixed(1)}× volume` : ""}`;
    sub = it.trigger ? `Same day as: ${it.trigger.title}` : `No filing explains it. Your rule: volume ≥ ${rules.volx}× or price ± ${rules.pct}%.`;
    pill = "Move"; pdf = it.trigger?.pdf;
  } else if (it.kind === "ownership") {
    title = it.lines.join(", "); sub = `Shareholding for the ${it.quarter} quarter, against your ${rules.fii} pp rule.`; pill = "Ownership";
  } else {
    title = `P/E ${it.pe.toFixed(1)}, ${it.side} its 5-year band (${it.band.toFixed(1)})`;
    sub = "Valuation against the stock's own history. Open Research for the band chart."; pill = "Valuation";
  }
  return (
    <div id={`card-${it.id}`} className="scroll-mt-28 border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-baseline gap-2 px-4 py-3 text-left">
        <span className="w-[86px] shrink-0"><Ticker t={it.ticker} /></span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[13.5px] leading-snug ${open ? "" : "line-clamp-2"}`}>{title}</span>
          <span className="mt-0.5 block text-[11.5px] text-muted">{pill} · {when(it.ts, now)}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 pl-[110px]">
          {sub && <p className="text-[13px] leading-snug text-muted">{sub}</p>}
          <div className="mt-1 flex gap-4">
            {pdf && <SourceLink href={pdf}>Filing</SourceLink>}
            <button onClick={() => onCompany(it.ticker)} className="min-h-8 text-[13px] font-medium text-accent">Research</button>
          </div>
        </div>
      )}
    </div>
  );
}

export { cr };
