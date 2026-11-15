"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildBrief, headline, sentence, when, day, num, type BriefItem, type Filing, type Holding, type Ledger,
  type LedgerEvent, type Move, type ResultsCard, type Rules,
} from "@/lib/finn";
import { Avatar, Card, Change, Delta, Pill, Section, Segmented, SourceLink, Ticker } from "./ui";

const WINDOWS: [number, string][] = [[1, "24h"], [7, "7 days"], [30, "30 days"], [90, "90 days"]];
const LONG: Record<number, string> = { 1: "24 hours", 7: "7 days", 30: "30 days", 90: "90 days" };
const short = (n: string) => n.replace(/ (Ltd|Limited)\.?$/i, "");

type Props = {
  feed: Filing[]; moves: Record<string, Move[]>; holdings: Holding[]; ledgers: Record<string, Ledger>;
  rules: Rules; now: number; onCompany: (t: string) => void; onLedger: (t: string) => void;
};

export default function Brief({ feed, moves, holdings, ledgers, rules, now, onCompany, onLedger }: Props) {
  const [days, setDays] = useState(7);
  const [showRoutine, setShowRoutine] = useState(false);
  const names = useMemo(() => Object.fromEntries(holdings.map((h) => [h.ticker, h.name])), [holdings]);
  const brief = useMemo(() => buildBrief(feed, moves, holdings, ledgers, rules, days, now), [feed, moves, holdings, ledgers, rules, days, now]);
  const label = LONG[days];
  const hour = Number(new Date(now).toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const lines = useMemo(() => {
    const spoken = [...brief.top.slice(0, 5), ...(brief.top.length < 3 ? brief.notable.slice(0, 3 - brief.top.length) : [])];
    const n = brief.top.length;
    const intro = n
      ? `${hello}. In the last ${label}, ${n} ${n === 1 ? "thing needs" : "things need"} your attention. ${brief.routine.length} filings were routine.`
      : `${hello}. Nothing in the last ${label} needs your attention. ${brief.routine.length} filings were routine.`;
    return [
      { id: null as string | null, text: intro },
      ...spoken.map((it) => ({ id: it.id as string | null, text: sentence(it, names) })),
      ...(brief.notable.length ? [{ id: "notable" as string | null, text: `${brief.notable.length} more are worth a line. That is your brief.` }] : []),
    ];
  }, [brief, names, label, hello]);

  const jump = (id: string | null) => {
    if (!id) return;
    document.getElementById(id === "notable" ? "sec-notable" : `card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const lastMaterial = useMemo(() => feed.find((f) => f.tier === 1), [feed]);
  const movers = useMemo(() => [...holdings].filter((h) => h.pct != null).sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!)), [holdings]);
  const up = holdings.filter((h) => (h.pct ?? 0) > 0).length, down = holdings.filter((h) => (h.pct ?? 0) < 0).length;

  return (
    <div>
      <section className="hero rise rounded-[22px] p-4 shadow-lg">
        <p className="text-[13px] font-medium opacity-75">{hello}</p>
        <h2 className="mt-0.5 text-[23px] font-bold leading-tight">
          {brief.top.length ? <>{brief.top.length} {brief.top.length === 1 ? "thing needs" : "things need"} you</> : "A quiet stretch"}
          <span className="opacity-60"> · {label}</span>
        </h2>
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11.5px] font-semibold">
          <span className="rounded-full bg-white/15 px-2.5 py-1">{brief.notable.length} worth a line</span>
          <span className="rounded-full bg-white/15 px-2.5 py-1">{brief.routine.length} routine, hidden</span>
          <span className="rounded-full bg-white/15 px-2.5 py-1">{up} up · {down} down</span>
        </div>
        <AudioBrief lines={lines} onJump={jump} />
      </section>

      <div className="no-bar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Portfolio moves, last session">
        {movers.map((h) => (
          <button key={h.ticker} onClick={() => onCompany(h.ticker)} className="card tap flex shrink-0 items-center gap-2 rounded-2xl py-2 pl-2 pr-3">
            <Avatar t={h.ticker} name={h.name} size={28} />
            <span className="text-left">
              <span className="num block text-[11.5px] font-bold">{h.ticker}</span>
              <Delta v={h.pct} className="text-[12px] font-semibold" />
            </span>
          </button>
        ))}
      </div>

      <div className="sticky top-[54px] z-20 -mx-4 mt-2 bg-bg/90 px-4 py-2 backdrop-blur">
        <Segmented label="Time window" value={days} onChange={setDays} options={WINDOWS} />
      </div>

      {brief.top.length === 0 && brief.notable.length === 0 && (
        <Card className="mt-3">
          <p className="text-[16px] font-bold">Quiet {label}.</p>
          <p className="mt-1 text-[13.5px] leading-snug text-muted">
            Nothing material was filed and no holding crossed your alert rules.
            {lastMaterial && <> Last material item: {short(names[lastMaterial.ticker] ?? lastMaterial.ticker)}, {lastMaterial.title.toLowerCase()} ({when(lastMaterial.ts, now)}).</>}
          </p>
          {days < 7 && <button onClick={() => setDays(7)} className="mt-3 h-10 rounded-xl bg-ink px-4 text-[13px] font-semibold text-bg">Show the last 7 days</button>}
        </Card>
      )}

      {brief.top.length > 0 && (
        <Section title="Needs attention" count={brief.top.length}>
          {brief.top.map((it) => <ItemCard key={it.id} it={it} names={names} now={now} ledgers={ledgers} rules={rules} onCompany={onCompany} onLedger={onLedger} />)}
        </Section>
      )}

      {brief.notable.length > 0 && (
        <Section title="Worth a line" count={brief.notable.length} id="sec-notable">
          <div className="card overflow-hidden">
            {brief.notable.slice(0, 40).map((it) => <Row key={it.id} it={it} names={names} now={now} rules={rules} onCompany={onCompany} />)}
          </div>
        </Section>
      )}

      {brief.routine.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowRoutine((s) => !s)} aria-expanded={showRoutine}
            className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sunk text-muted" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">{brief.routine.length} routine filings</span>
              <span className="block truncate text-[12px] text-muted">{routineMix(brief.routine)}</span>
            </span>
            <span className="text-[13px] font-semibold text-accent">{showRoutine ? "Hide" : "Show"}</span>
          </button>
          {showRoutine && (
            <div className="card mt-2 overflow-hidden">
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
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ");
}

// ---------------------------------------------------------------- audio brief

function AudioBrief({ lines, onJump }: { lines: { id: string | null; text: string }[]; onJump: (id: string | null) => void }) {
  const [idx, setIdx] = useState(-1);
  const [supported, setSupported] = useState(true);
  const [open, setOpen] = useState(false);
  const run = useRef(0);
  const secs = Math.round(lines.reduce((s, l) => s + l.text.split(/\s+/).length, 0) / 2.7);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => { run.current++; if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, []);
  useEffect(() => { stop(); // the script changed: never read a stale brief
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="mt-4 rounded-2xl bg-black/20 p-3">
      <div className="flex items-center gap-3">
        <button onClick={() => (playing ? stop() : play(0))} aria-label={playing ? "Stop the spoken brief" : "Play the spoken brief"} disabled={!supported}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[#0f3d3e] shadow disabled:opacity-40">
          {playing
            ? <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight">{playing ? `Playing · ${idx + 1} of ${lines.length}` : "Listen to your brief"}</p>
          <p className="truncate text-[12px] opacity-70">{supported ? (playing ? lines[idx]?.text : `About ${secs} seconds`) : "This browser cannot speak."}</p>
        </div>
        <span className={`eq ${playing ? "on" : ""} opacity-70`} aria-hidden><span /><span /><span /><span /><span /></span>
      </div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 text-[12px] font-semibold opacity-80">{open ? "Hide script" : "Read the script"}</button>
      {open && (
        <ol className="mt-1.5 flex flex-col gap-0.5">
          {lines.map((l, i) => (
            <li key={i}>
              <button onClick={() => { onJump(l.id); play(i); }}
                className={`w-full rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug ${idx === i ? "bg-white/15 font-medium" : "opacity-80"}`}>{l.text}</button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- cards

type ItemProps = {
  it: BriefItem; names: Record<string, string>; now: number; ledgers: Record<string, Ledger>;
  rules: Rules; onCompany: (t: string) => void; onLedger: (t: string) => void;
};

function Head({ it, name, now, pill, tone }: { it: BriefItem; name: string; now: number; pill: string; tone: "bad" | "good" | "warn" | "idle" | "accent" }) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <Avatar t={it.ticker} name={name} size={34} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold leading-tight">{name}</p>
        <p className="text-[11.5px] text-muted" title={day(it.ts)}><span className="num">{it.ticker}</span> · {when(it.ts, now)}</p>
      </div>
      <Pill tone={tone}>{pill}</Pill>
    </div>
  );
}

function ItemCard({ it, names, now, ledgers, rules, onCompany, onLedger }: ItemProps) {
  const [open, setOpen] = useState(false);
  const name = short(names[it.ticker] ?? it.ticker);

  if (it.kind === "move") {
    const m = it.move;
    return (
      <Card id={`card-${it.id}`} tone="warn">
        <Head it={it} name={name} now={now} pill="Unusual move" tone="warn" />
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Price, day"><Delta v={m.pct} /></Stat>
          <Stat label="vs 20-day volume"><span className="num">{m.volx ? `${m.volx.toFixed(1)}×` : "–"}</span></Stat>
          <Stat label="Close"><span className="num">₹{num(m.c, 1)}</span></Stat>
        </div>
        <p className="mt-2.5 text-[13px] leading-snug text-muted">
          {it.trigger ? <>Same day as: <span className="text-ink">{it.trigger.title}</span>. </> : "No filing explains it. "}
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
    <Card id={`card-${it.id}`} tone={tone}>
      <Head it={it} name={name} now={now} pill={bad ? (bad.type === "cut" ? "Guidance cut" : `Promise ${bad.type}`) : f.label} tone={tone} />
      <h3 className="text-[16px] font-bold leading-snug">{headline(name, f.title).replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `), "")}</h3>

      {ev && <EventLine ev={ev} onLedger={() => onLedger(it.ticker)} />}
      {f.card?.type === "results" && <ResultsTable card={f.card} />}
      {f.card?.type !== "results" && f.summary && <p className="mt-1.5 text-[13.5px] leading-snug text-muted">{f.summary}</p>}
      {f.card?.type === "person" && f.card.bio && (
        <div className="mt-3 rounded-xl bg-sunk p-3">
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-muted">Who is {f.card.name.split(" ").slice(-1)[0]}?</p>
          <p className="mt-1 text-[13.5px] leading-snug">{f.card.bio}</p>
          <p className="mt-1 text-[11px] text-muted">From the filing itself{f.card.effective ? ` · effective ${f.card.effective}` : ""}</p>
        </div>
      )}

      {it.earlier.length > 0 && (
        <div className="mt-2.5">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-h-8 text-[13px] font-semibold text-accent">
            {open ? "Hide" : "Show"} {it.earlier.length} earlier {it.earlier.length === 1 ? "update" : "updates"}
          </button>
          {open && (
            <ol className="mt-1 border-l-2 border-line pl-3">
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
    <button onClick={onLedger} className={`tap mt-3 block w-full rounded-xl p-3 text-left ${bad ? "bg-bad-soft" : "bg-good-soft"}`}>
      <span className={`block text-[11.5px] font-bold uppercase tracking-wide ${bad ? "text-bad" : "text-good"}`}>
        {ev.type === "cut" ? "Management cut its own target" : ev.type === "raised" ? "Management raised its own target" : `Promise ${ev.type}`}
      </span>
      <span className="mt-0.5 block text-[14px] font-semibold leading-snug">{ev.label}</span>
      <span className="num mt-1 block text-[17px] font-bold">{ev.from ?? "–"} <span className="text-muted">→</span> {ev.to ?? "–"}</span>
      {ev.quote && <span className="mt-1 block text-[12.5px] italic leading-snug text-muted">“{ev.quote}”{ev.page ? ` (p. ${ev.page})` : ""}</span>}
    </button>
  );
}

function ResultsTable({ card }: { card: ResultsCard }) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl bg-sunk">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted">
            <th className="px-3 pb-1 pt-2 text-left font-semibold">{card.quarter}</th>
            <th className="px-1 pb-1 pt-2 text-right font-semibold">₹ cr</th>
            <th className="px-1 pb-1 pt-2 text-right font-semibold">QoQ</th>
            <th className="px-3 pb-1 pt-2 text-right font-semibold">YoY</th>
          </tr>
        </thead>
        <tbody>
          {card.rows.map((r) => (
            <tr key={r.metric} className="border-t border-line">
              <td className="px-3 py-1.5 font-semibold">{r.metric}</td>
              <td className="num px-1 py-1.5 text-right">{num(r.value, 0)}</td>
              <td className="px-1 py-1.5 text-right"><Delta v={r.qoq} /></td>
              <td className="px-3 py-1.5 text-right"><Delta v={r.yoy} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-3 py-1.5 text-[11px] leading-snug text-muted">
        {card.verified && <span className="font-semibold text-good">✓ Checked against reported table. </span>}
        Source: {card.source}{card.note ? `; ${card.note}` : ""}.
      </p>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-sunk px-2.5 py-2">
      <div className="text-[17px] font-bold leading-tight">{children}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}

function Actions({ pdf, related, onCompany, onLedger }: { pdf?: string; related?: { title: string; pdf: string }[]; onCompany: () => void; onLedger?: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {pdf && <SourceLink href={pdf}>Filing</SourceLink>}
      {related?.slice(0, 2).map((r) => <SourceLink key={r.pdf} href={r.pdf}>{/present/i.test(r.title) ? "Deck" : /press/i.test(r.title) ? "Press release" : "Related"}</SourceLink>)}
      <span className="ml-auto flex gap-3">
        {onLedger && <button onClick={onLedger} className="min-h-8 text-[13px] font-semibold text-accent">Ledger</button>}
        <button onClick={onCompany} className="min-h-8 text-[13px] font-semibold text-accent">Research →</button>
      </span>
    </div>
  );
}

function Row({ it, names, now, rules, onCompany }: { it: BriefItem; names: Record<string, string>; now: number; rules: Rules; onCompany: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  let title = "", sub: string | null = null, pill = "", pdf: string | undefined;
  if (it.kind === "filing") {
    title = it.filing.title; sub = it.filing.summary ?? null; pill = it.filing.label; pdf = it.filing.pdf;
    if (it.earlier.length) pill += ` · +${it.earlier.length}`;
  } else if (it.kind === "move") {
    const m = it.move;
    title = `${(m.pct ?? 0) >= 0 ? "Up" : "Down"} ${Math.abs(m.pct ?? 0).toFixed(1)}%${m.volx ? ` on ${m.volx.toFixed(1)}× volume` : ""}`;
    sub = it.trigger ? `Same day as: ${it.trigger.title}` : `No filing explains it. Your rule: volume ≥ ${rules.volx}× or price ± ${rules.pct}%.`;
    pill = "Price move"; pdf = it.trigger?.pdf;
  } else if (it.kind === "ownership") {
    title = it.lines.join(", "); sub = `Shareholding for the ${it.quarter} quarter, against your ${rules.fii} pp rule.`; pill = "Ownership";
  } else {
    title = `P/E ${it.pe.toFixed(1)}, ${it.side} its 5-year band (${it.band.toFixed(1)})`;
    sub = "Valuation against the stock's own history. Open Research for the band chart."; pill = "Valuation";
  }
  return (
    <div id={`card-${it.id}`} className="scroll-mt-32 border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-3.5 py-3 text-left">
        <Avatar t={it.ticker} name={names[it.ticker]} size={30} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[13.5px] font-medium leading-snug ${open ? "" : "line-clamp-2"}`}>{title}</span>
          <span className="mt-0.5 block text-[11.5px] text-muted"><span className="num font-semibold">{it.ticker}</span> · {pill} · {when(it.ts, now)}</span>
        </span>
        <span className={`mt-1 text-muted transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>›</span>
      </button>
      {open && (
        <div className="pb-3 pl-[56px] pr-3.5">
          {sub && <p className="text-[13px] leading-snug text-muted">{sub}</p>}
          <div className="mt-2 flex items-center gap-3">
            {pdf && <SourceLink href={pdf}>Filing</SourceLink>}
            <button onClick={() => onCompany(it.ticker)} className="min-h-8 text-[13px] font-semibold text-accent">Research →</button>
          </div>
        </div>
      )}
    </div>
  );
}

export { Change };
