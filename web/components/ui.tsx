"use client";
import type { ReactNode } from "react";

export const STATUS: Record<string, { label: string; cls: string }> = {
  KEPT: { label: "Kept", cls: "bg-good-soft text-good" },
  MISSED: { label: "Missed", cls: "bg-bad-soft text-bad" },
  REVISED: { label: "Revised", cls: "bg-warn-soft text-warn" },
  DROPPED: { label: "Dropped", cls: "bg-bad-soft text-bad" },
  PENDING: { label: "Pending", cls: "bg-idle-soft text-idle" },
  UNVERIFIED: { label: "No evidence yet", cls: "bg-idle-soft text-idle" },
};

export function Pill({ children, tone = "idle" }: { children: ReactNode; tone?: "bad" | "good" | "warn" | "idle" | "accent" }) {
  const cls = {
    bad: "bg-bad-soft text-bad", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn",
    idle: "bg-idle-soft text-idle", accent: "bg-accent-soft text-accent",
  }[tone];
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none ${cls}`}>{children}</span>;
}

export function Card({ children, hero = false, id, onClick }: { children: ReactNode; hero?: boolean; id?: string; onClick?: () => void }) {
  return (
    <section
      id={id}
      onClick={onClick}
      className={`rise scroll-mt-28 rounded-2xl border bg-surface p-4 ${hero ? "border-ink/70 shadow-[0_1px_0_0_var(--ink)]" : "border-line"}`}
    >
      {children}
    </section>
  );
}

export function Delta({ v, suffix = "%" }: { v: number | null | undefined; suffix?: string }) {
  if (v == null) return <span className="num text-muted">–</span>;
  const cls = v > 0 ? "text-good" : v < 0 ? "text-bad" : "text-muted";
  return (
    <span className={`num ${cls}`}>
      {v > 0 ? "+" : v < 0 ? "−" : ""}
      {Math.abs(v).toFixed(1)}
      {suffix}
    </span>
  );
}

export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex min-h-8 items-center gap-1 text-[13px] font-medium text-accent underline decoration-accent/30 underline-offset-2"
    >
      {children}
      <span aria-hidden>↗</span>
    </a>
  );
}

export function Ticker({ t }: { t: string }) {
  return <span className="num text-[12px] font-semibold tracking-tight text-muted">{t}</span>;
}

export function Section({ title, count, children }: { title: string; count?: number | string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {count != null && <span className="num text-[12px] text-muted">{count}</span>}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}
