"use client";
import { useMemo, useState } from "react";
import { ALERT_CATS, buildBrief, DEFAULT_RULES, sentence, type Filing, type Holding, type Ledger, type Meta, type Move, type Rules as RulesT } from "@/lib/finn";
import { Card, Section } from "./ui";

type Props = {
  rules: RulesT; onRules: (r: RulesT) => void; feed: Filing[]; moves: Record<string, Move[]>; holdings: Holding[];
  ledgers: Record<string, Ledger>; meta: Meta | null; now: number;
};

export default function Rules({ rules, onRules, feed, moves, holdings, ledgers, meta, now }: Props) {
  const [toast, setToast] = useState<string | null>(null);
  const names = useMemo(() => Object.fromEntries(holdings.map((h) => [h.ticker, h.name])), [holdings]);
  const b30 = useMemo(() => buildBrief(feed, moves, holdings, ledgers, rules, 30, now), [feed, moves, holdings, ledgers, rules, now]);
  const alerts = b30.top.length, moveHits = [...b30.top, ...b30.notable].filter((i) => i.kind === "move").length;
  const ownHits = b30.notable.filter((i) => i.kind === "ownership").length, peHits = b30.notable.filter((i) => i.kind === "valuation").length;
  const set = (p: Partial<RulesT>) => onRules({ ...rules, ...p });

  async function test() {
    const top = b30.top[0] ?? b30.notable[0];
    const body = top ? sentence(top, names) : "Nothing has crossed your rules in the last 30 days.";
    setToast(body);
    setTimeout(() => setToast(null), 9000);
    try {
      if (!("Notification" in window)) return;
      const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (perm === "granted") new Notification("FINN alert", { body, icon: "/icon.svg" });
    } catch { /* phones without page notifications still get the in-app alert */ }
  }

  return (
    <div>
      <Card hero>
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">With these rules</p>
        <p className="mt-1 text-[24px] font-semibold leading-tight"><span className="num">{alerts}</span> alerts in the last 30 days</p>
        <p className="text-[13px] text-muted">
          {moveHits} price or volume · {ownHits} ownership · {peHits} valuation · {b30.routine.length} routine filings kept out of your way
        </p>
        <p className="mt-2 text-[12px] leading-snug text-muted">Move a slider and this number changes at once: the rules run on your phone, against the same filings and prices.</p>
      </Card>

      <Section title="Price and volume">
        <Card>
          <Slider label="Volume spike" value={rules.volx} min={1.5} max={6} step={0.5} fmt={(v) => `${v}× the 20-day average`} onChange={(v) => set({ volx: v })} />
          <Slider label="Daily price move" value={rules.pct} min={2} max={12} step={0.5} fmt={(v) => `± ${v}%`} onChange={(v) => set({ pct: v })} />
          <p className="text-[11.5px] leading-snug text-muted">Either one puts the move in your brief; both together makes it an alert. Special trading sessions are ignored.</p>
        </Card>
      </Section>

      <Section title="Ownership and valuation">
        <Card>
          <Slider label="FII holding change in a quarter" value={rules.fii} min={0.5} max={5} step={0.25} fmt={(v) => `± ${v} pp`} onChange={(v) => set({ fii: v })} />
          <Toggle label="Promoter stake falls" hint="Any fall of 0.5 pp or more in a quarter" on={rules.promoterAny} onChange={(v) => set({ promoterAny: v })} />
          <Toggle label="P/E leaves its usual range" hint="Outside one standard deviation of its 5-year median" on={rules.peBand} onChange={(v) => set({ peBand: v })} />
        </Card>
      </Section>

      <Section title="Filings that alert you">
        <Card>
          {ALERT_CATS.map(([k, label]) => (
            <Toggle key={k} label={label} on={rules.cats[k] !== false} onChange={(v) => set({ cats: { ...rules.cats, [k]: v } })} />
          ))}
          <p className="mt-1 text-[11.5px] leading-snug text-muted">Switched off types still appear under “Worth a line”. A cut or missed promise always alerts.</p>
        </Card>
      </Section>

      <div className="mt-4 flex gap-2">
        <button onClick={test} className="h-11 flex-1 rounded-xl bg-ink text-[14px] font-semibold text-bg">Send a test alert</button>
        <button onClick={() => onRules(DEFAULT_RULES)} className="h-11 rounded-xl border border-line bg-surface px-4 text-[14px] font-semibold text-muted">Reset</button>
      </div>
      {toast && (
        <div role="status" className="rise fixed inset-x-3 top-3 z-50 mx-auto max-w-[460px] rounded-2xl bg-ink p-3.5 text-bg shadow-lg">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide opacity-70">FINN alert</p>
          <p className="mt-0.5 text-[13.5px] leading-snug">{toast}</p>
        </div>
      )}

      {meta && (
        <Section title="What this cost to run">
          <Card>
            <div className="grid grid-cols-3 gap-3">
              <Stat v={String(meta.filings)} label={`filings read, ${meta.window_days} days`} />
              <Stat v={meta.classified_by_rules_pct == null ? "–" : `${meta.classified_by_rules_pct}%`} label="sorted by rules, no model" />
              <Stat v={String(meta.llm_read)} label="filings a model read" />
            </div>
            <p className="mt-2.5 text-[12px] leading-snug text-muted">
              {meta.llm_usage_total.calls} model calls in total, {(meta.llm_usage_total.prompt_tokens / 1000).toFixed(0)}k tokens in and{" "}
              {(meta.llm_usage_total.completion_tokens / 1000).toFixed(0)}k out, on <span className="num">{meta.model}</span>. Routine filings never reach a
              model, results numbers are cross-checked against the reported tables, and the spoken brief is built from templates, so it costs nothing.
            </p>
          </Card>
        </Section>
      )}

      <Section title="Your portfolio" count={holdings.length}>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {holdings.map((h) => (
            <div key={h.ticker} className="flex items-baseline gap-2 border-b border-line px-4 py-2 last:border-0">
              <span className="num w-[92px] shrink-0 text-[12px] font-semibold text-muted">{h.ticker}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{h.name.replace(/ (Ltd|Limited)\.?$/i, "")}</span>
              <span className="shrink-0 text-[11.5px] text-muted">{h.sector}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="mb-3 block">
      <span className="flex items-baseline justify-between">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="num text-[13px] font-semibold">{fmt(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 h-8 w-full" />
    </label>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex min-h-11 w-full items-center justify-between gap-3 py-1.5 text-left">
      <span>
        <span className="block text-[14px] font-medium">{label}</span>
        {hint && <span className="block text-[11.5px] text-muted">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`} aria-hidden>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Stat({ v, label }: { v: string; label: string }) {
  return (
    <div>
      <p className="num text-[18px] font-semibold leading-tight">{v}</p>
      <p className="mt-0.5 text-[11.5px] leading-tight text-muted">{label}</p>
    </div>
  );
}
