"use client";
import type { ReactNode } from "react";

export const STATUS: Record<string, { label: string; cls: string }> = {
  KEPT: { label: "Kept", cls: "bg-good-soft text-good" },
  MISSED: { label: "Missed", cls: "bg-bad-soft text-bad" },
  REVISED: { label: "Revised", cls: "bg-warn-soft text-warn" },
  DROPPED: { label: "Dropped", cls: "bg-bad-soft text-bad" },
  PENDING: { label: "Open", cls: "bg-idle-soft text-idle" },
  UNVERIFIED: { label: "No evidence yet", cls: "bg-idle-soft text-idle" },
};

export function Pill({ children, tone = "idle" }: { children: ReactNode; tone?: "bad" | "good" | "warn" | "idle" | "accent" }) {
  const cls = {
    bad: "bg-bad-soft text-bad", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn",
    idle: "bg-idle-soft text-idle", accent: "bg-accent-soft text-accent",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-semibold leading-none ${cls}`}>{children}</span>;
}

export function Card({ children, hero = false, id, tone, className = "" }: { children: ReactNode; hero?: boolean; id?: string; tone?: "bad" | "warn" | "good" | "accent"; className?: string }) {
  const stripe = tone ? { bad: "before:bg-bad", warn: "before:bg-warn", good: "before:bg-good", accent: "before:bg-accent" }[tone] : "";
  return (
    <section
      id={id}
      className={`card rise relative scroll-mt-32 overflow-hidden p-4 ${hero ? "ring-1 ring-ink/10" : ""} ${tone ? `before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${stripe}` : ""} ${className}`}
    >
      {children}
    </section>
  );
}

export function Delta({ v, suffix = "%", className = "" }: { v: number | null | undefined; suffix?: string; className?: string }) {
  if (v == null) return <span className={`num text-muted ${className}`}>–</span>;
  const cls = v > 0 ? "text-good" : v < 0 ? "text-bad" : "text-muted";
  return <span className={`num ${cls} ${className}`}>{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v).toFixed(1)}{suffix}</span>;
}

/** Day change as a filled chip: green up, red down. */
export function Change({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="num rounded-md bg-sunk px-1.5 py-0.5 text-[12px] text-muted">–</span>;
  const cls = v > 0 ? "bg-good-soft text-good" : v < 0 ? "bg-bad-soft text-bad" : "bg-sunk text-muted";
  return <span className={`num rounded-md px-1.5 py-0.5 text-[12px] font-semibold ${cls}`}>{v > 0 ? "▲" : v < 0 ? "▼" : ""} {Math.abs(v).toFixed(2)}%</span>;
}

export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-[12px] font-semibold text-accent">
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden><path d="M4 2h5l3 3v9H4z M9 2v3h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      {children}
    </a>
  );
}

export function Ticker({ t }: { t: string }) {
  return <span className="num text-[11.5px] font-semibold tracking-tight text-muted">{t}</span>;
}

const AV = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "#8a63d2", "#d1497b", "#2f9fb3", "#6f8a2e"];
/** Company mark: initials on a colour fixed by the ticker, so a company always looks the same. */
export function Avatar({ t, name, size = 36 }: { t: string; name?: string; size?: number }) {
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const words = (name ?? t).replace(/ (Ltd|Limited|India|Industries)\.?/gi, "").split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  const ini = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? t).slice(0, 2)).toUpperCase();
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-xl font-bold text-white"
      style={{ width: size, height: size, background: AV[h % AV.length], fontSize: size * 0.36 }}>{ini}</span>
  );
}

export function Section({ title, count, children, id, action }: { title: string; count?: number | string; children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <div className="mt-7 scroll-mt-32" id={id}>
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        {count != null && <span className="num rounded-full bg-sunk px-2 py-0.5 text-[11.5px] font-semibold text-muted">{count}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="grid rounded-xl bg-sunk p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }} role="tablist" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={`h-9 rounded-lg text-[13px] font-semibold transition-all ${value === v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>{l}</button>
      ))}
    </div>
  );
}
