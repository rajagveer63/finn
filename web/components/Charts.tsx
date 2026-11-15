"use client";
import { useRef, useState } from "react";

/** Finger or mouse position -> nearest data index. One hook for every chart. */
function useScrub(n: number, x0: number, x1: number, W: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [i, setI] = useState<number | null>(null);
  const at = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || n < 2) return;
    const x = ((clientX - r.left) / r.width) * W;
    setI(Math.max(0, Math.min(n - 1, Math.round(((x - x0) / (x1 - x0)) * (n - 1)))));
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => at(e.clientX),
    onPointerMove: (e: React.PointerEvent) => at(e.clientX),
    onPointerLeave: () => setI(null),
  };
  return { ref, i, handlers };
}

const monthYear = (d: string) => new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

// ------------------------------------------------------------ P/E band

export function PEBand({ points, median, plus1, minus1, current }: {
  points: { d: string; pe: number }[]; median: number; plus1: number; minus1: number; current: number | null;
}) {
  const W = 340, H = 168, L = 30, R = 8, T = 10, B = 22;
  const { ref, i, handlers } = useScrub(points.length, L, W - R, W);
  if (points.length < 8) return <p className="text-[13px] text-muted">Not enough earnings history to draw a band.</p>;

  const vals = points.map((p) => p.pe);
  const hasLow = minus1 > 0;
  const rawMax = Math.max(...vals);
  const hi = Math.min(rawMax, Math.max(plus1 * 1.25, (current ?? 0) * 1.15)) * 1.04;   // outlier years would flatten the chart
  const lo = Math.max(0, Math.min(...vals, hasLow ? minus1 : median) * 0.92);
  const clipped = rawMax > hi;
  const x = (k: number) => L + (k / (points.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (Math.min(v, hi) - lo) / (hi - lo)) * (H - T - B);
  const path = points.map((p, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(p.pe).toFixed(1)}`).join("");
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));
  const sel = i ?? points.length - 1;
  const p = points[sel];
  const years = points.reduce<number[]>((a, pt, k) => (k && pt.d.slice(0, 4) !== points[k - 1].d.slice(0, 4) ? [...a, k] : a), []);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] text-muted">{i == null ? "Now" : monthYear(p.d)}</span>
        <span className="num text-[13px] font-semibold">{p.pe.toFixed(1)}×</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y select-none" role="img"
        aria-label={`Price to earnings over five years. Now ${current ?? p.pe}, median ${median}, usual range ${minus1} to ${plus1}.`} {...handlers}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={L - 5} y={y(t) + 3} textAnchor="end" fontSize="9.5" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {years.map((k) => (
          <text key={k} x={x(k)} y={H - 6} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{points[k].d.slice(0, 4)}</text>
        ))}
        <rect x={L} width={W - L - R} y={y(Math.min(plus1, hi))} height={Math.max(0, y(hasLow ? Math.max(minus1, lo) : lo) - y(Math.min(plus1, hi)))}
          fill="var(--s1)" opacity="0.13" />
        <line x1={L} x2={W - R} y1={y(median)} y2={y(median)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={W - R - 2} y={y(median) - 4} textAnchor="end" fontSize="9.5" fill="var(--muted)">median {median.toFixed(1)}</text>
        <path d={path} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {i != null && <line x1={x(sel)} x2={x(sel)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" />}
        <circle cx={x(sel)} cy={y(p.pe)} r="4.5" fill="var(--s1)" stroke="var(--surface)" strokeWidth="2" />
      </svg>
      <p className="mt-1 text-[11.5px] leading-snug text-muted">
        Shaded: the usual range, one standard deviation either side of the 5-year median
        ({hasLow ? minus1.toFixed(1) : "0"}–{plus1.toFixed(1)}×).{clipped ? ` Peaks above ${hi.toFixed(0)}× are clipped.` : ""} Drag to read any week.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ shareholding

const OWN: [string, string, string][] = [
  ["promoter", "Promoters", "var(--s1)"], ["fii", "FIIs", "var(--s2)"], ["dii", "DIIs", "var(--s3)"], ["public", "Public & others", "var(--s4)"],
];

export function Ownership({ quarters, series, table = true }: { quarters: string[]; series: Record<string, (number | null)[]>; table?: boolean }) {
  const W = 340, H = 150, L = 4, R = 4, T = 6, B = 18;
  const n = quarters.length;
  const { ref, i, handlers } = useScrub(n, L, W - R, W);
  const rows = OWN.filter(([k]) => series[k]?.some((v) => (v ?? 0) > 0)).map(([k, label, color]) => ({
    k, label, color,
    v: quarters.map((_, q) => (series[k]?.[q] ?? 0) + (k === "public" ? series.government?.[q] ?? 0 : 0)),
  }));
  if (n < 2 || !rows.length) return <p className="text-[13px] text-muted">No shareholding history.</p>;
  const x = (q: number) => L + (q / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const total = quarters.map((_, q) => rows.reduce((s, r) => s + r.v[q], 0) || 100);
  let base = quarters.map(() => 0);
  const areas = rows.map((r) => {
    const top = base.map((b, q) => b + (r.v[q] / total[q]) * 100);
    const d = `M${top.map((v, q) => `${x(q).toFixed(1)},${y(v).toFixed(1)}`).join("L")}L${[...base].map((v, q) => `${x(q).toFixed(1)},${y(v).toFixed(1)}`).reverse().join("L")}Z`;
    base = top;
    return { ...r, d };
  });
  const sel = i ?? n - 1;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] text-muted">{quarters[sel]}{i == null ? " (latest)" : ""}</span>
        <span className="text-[11.5px] text-muted">change vs prior quarter</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y select-none" role="img" aria-label="Shareholding pattern by quarter" {...handlers}>
        {areas.map((a) => <path key={a.k} d={a.d} fill={a.color} stroke="var(--surface)" strokeWidth="2" strokeLinejoin="round" />)}
        <line x1={x(sel)} x2={x(sel)} y1={T} y2={H - B} stroke="var(--ink)" strokeWidth="1" opacity={i == null ? 0 : 0.7} />
        <text x={L} y={H - 4} fontSize="9.5" fill="var(--muted)">{quarters[0]}</text>
        <text x={W - R} y={H - 4} textAnchor="end" fontSize="9.5" fill="var(--muted)">{quarters[n - 1]}</text>
      </svg>
      {table && <table className="mt-1 w-full text-[13px]">
        <tbody>
          {[...rows].map((r) => {
            const d = sel > 0 ? r.v[sel] - r.v[sel - 1] : null;
            return (
              <tr key={r.k} className="border-t border-line">
                <td className="py-1.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: r.color }} />{r.label}</td>
                <td className="num py-1.5 text-right">{r.v[sel].toFixed(2)}%</td>
                <td className={`num w-[84px] py-1.5 text-right ${d == null || Math.abs(d) < 0.005 ? "text-muted" : d > 0 ? "text-good" : "text-bad"}`}>
                  {d == null ? "–" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(2)} pp`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>}
    </div>
  );
}

// ------------------------------------------------------------ year bars

export function Bars({ labels, values, unit = "₹ cr" }: { labels: string[]; values: (number | null)[]; unit?: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const n = values.length;
  const max = Math.max(...values.map((v) => v ?? 0), 1), min = Math.min(...values.map((v) => v ?? 0), 0);
  const W = 160, H = 64, gap = 2, bw = (W - gap * (n - 1)) / n;
  const zero = H * (max / (max - min));
  const k = sel ?? n - 1;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${labels[0]} to ${labels[n - 1]}`}>
        {values.map((v, q) => {
          const h = Math.max(1, (Math.abs(v ?? 0) / (max - min)) * H);
          return (
            <g key={q} onPointerEnter={() => setSel(q)} onPointerDown={() => setSel(q)} onPointerLeave={() => setSel(null)}>
              <rect x={q * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
              <rect x={q * (bw + gap)} y={(v ?? 0) >= 0 ? zero - h : zero} width={bw} height={h} rx="1.5"
                fill={(v ?? 0) < 0 ? "var(--bad)" : "var(--s1)"} opacity={q === k ? 1 : 0.45} />
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[11.5px] text-muted">
        {labels[k]?.replace("Mar ", "FY")}: <span className="num text-ink">{values[k] == null ? "–" : Math.round(values[k]!).toLocaleString("en-IN")}</span> {unit}
      </p>
    </div>
  );
}

// ------------------------------------------------------------ shareholding donut

export function Donut({ latest, change, quarter }: { latest: Record<string, number | null>; change: Record<string, number | null>; quarter: string }) {
  const [hi, setHi] = useState<string | null>(null);
  const parts = OWN.map(([k, label, color]) => ({
    k, label, color,
    v: (latest[k] ?? 0) + (k === "public" ? latest.government ?? 0 : 0),
    d: k === "public" && change.government != null && change.public != null ? change.public + change.government : change[k],
  })).filter((p) => p.v > 0.005);
  const total = parts.reduce((s, p) => s + p.v, 0) || 100;
  const R = 70, r = 46, C = 90, gap = 0.012;
  let a0 = -Math.PI / 2;
  const arcs = parts.map((p) => {
    const sweep = (p.v / total) * Math.PI * 2;
    const s = a0 + (parts.length > 1 ? gap : 0), e = a0 + sweep - (parts.length > 1 ? gap : 0);
    a0 += sweep;
    const big = e - s > Math.PI ? 1 : 0;
    const pt = (rad: number, ang: number) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;
    return { ...p, d: `M${pt(R, s)}A${R},${R} 0 ${big} 1 ${pt(R, e)}L${pt(r, e)}A${r},${r} 0 ${big} 0 ${pt(r, s)}Z`, delta: p.d };
  });
  const focus = arcs.find((a) => a.k === hi) ?? arcs[0];
  if (!focus) return <p className="text-[13px] text-muted">No shareholding data.</p>;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 180 180" className="w-[46%] max-w-[180px] shrink-0" role="img"
        aria-label={`Shareholding, ${quarter}: ${arcs.map((a) => `${a.label} ${a.v.toFixed(1)}%`).join(", ")}`}>
        {arcs.map((a) => (
          <path key={a.k} d={a.d} fill={a.color} opacity={hi && hi !== a.k ? 0.35 : 1}
            onPointerEnter={() => setHi(a.k)} onPointerDown={() => setHi(a.k)} onPointerLeave={() => setHi(null)} />
        ))}
        <text x={C} y={C - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)" className="num">{focus.v.toFixed(1)}%</text>
        <text x={C} y={C + 15} textAnchor="middle" fontSize="11" fill="var(--muted)">{focus.label}</text>
      </svg>
      <ul className="min-w-0 flex-1">
        {arcs.map((a) => (
          <li key={a.k}>
            <button onClick={() => setHi(hi === a.k ? null : a.k)} className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left ${hi === a.k ? "bg-sunk" : ""}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{a.label}</span>
              <span className="num text-[13px] font-semibold">{a.v.toFixed(1)}%</span>
              <span className={`num w-[52px] text-right text-[11.5px] ${a.delta == null || Math.abs(a.delta) < 0.005 ? "text-muted" : a.delta > 0 ? "text-good" : "text-bad"}`}>
                {a.delta == null ? "–" : `${a.delta > 0 ? "+" : a.delta < 0 ? "−" : ""}${Math.abs(a.delta).toFixed(2)}`}
              </span>
            </button>
          </li>
        ))}
        <li className="px-1.5 pt-1 text-[11px] text-muted">{quarter} · change in pp vs last quarter</li>
      </ul>
    </div>
  );
}
