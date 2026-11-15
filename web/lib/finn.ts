// Shared types, formatting and the Brief ranking logic.
// Ranking runs on the phone so the investor's own thresholds apply instantly.

export type PersonCard = {
  type: "person"; name: string; role?: string | null; action?: string | null;
  seniority?: string | null; effective?: string | null; bio?: string | null;
};
export type ResultRow = { metric: string; value: number; qoq: number | null; yoy: number | null };
export type ResultsCard = {
  type: "results"; quarter: string; source: string | null; verified: boolean | null;
  rows: ResultRow[]; note: string | null; ebitda_def?: string;
};
export type Filing = {
  id: string; ticker: string; ts: string; nse_desc: string; text?: string; pdf: string;
  category: string; label: string; sub: string | null; tier: number; title: string; by: string;
  summary?: string | null; key_figure?: string | null; materiality?: string | null;
  card?: PersonCard | ResultsCard; thread?: string; related?: { title: string; pdf: string }[];
};
export type Holding = {
  ticker: string; name: string; sector: string; size: string; ledger: boolean;
  price: number | null; pct: number | null; volx: number | null; as_of: string | null;
  pe: number | null; mcap: number | null; is_financial?: boolean;
  own_quarter?: string | null; own_chg?: Record<string, number | null> | null;
  own_latest?: Record<string, number | null> | null; has_promoter?: boolean;
  pe_median?: number | null; pe_plus1?: number | null; pe_minus1?: number | null;
};
export type Move = { d: string; c: number; v: number; pct: number | null; volx: number | null; special: boolean };
export type LedgerEvent = {
  date: string; type: string; label: string; from: string | null; to: string | null;
  quote: string | null; page: number | null; url: string | null; promise: string;
};
export type Promise_ = {
  id: string; label: string; metric: string; period: string; target: string | null; first_target: string | null;
  revised: boolean; revisions: { date: string; direction: string; from: string; to: string; quote: string; page: number | null; url: string; call: string }[];
  net_direction: string | null; status: string; tracking: string | null; actual: string | null; evidence: string | null;
  verdict: string | null; decided_by: string; first_said: string | null;
  history: { said_on: string | null; call: string; target: string | null; quote: string; speaker: string | null; page: number | null; url: string }[];
};
export type Ledger = {
  ticker: string; name: string; read: string | null; events: LedgerEvent[];
  score: { kept: number; settled: number; missed: number; revised: number; dropped: number; pending: number; total: number };
  calls: { period: string; date: string | null; quarter: string | null; url: string; pages?: number; promises: number; error?: string | null }[];
  promises: Promise_[]; as_of: string;
};
export type Meta = {
  generated_at: string; window_days: number; filings: number; by_tier: Record<string, number>;
  classified_by_rules_pct: number | null; llm_read: number;
  llm_usage_total: { calls: number; prompt_tokens: number; completion_tokens: number }; model: string;
};

export type Rules = { volx: number; pct: number; fii: number; promoterAny: boolean; peBand: boolean; cats: Record<string, boolean> };
export const ALERT_CATS: [string, string][] = [
  ["results", "Results"], ["management_change", "Management change"], ["M&A", "M&A"], ["fund_raise", "Fund raise"],
  ["litigation", "Legal / regulatory"], ["credit_rating", "Rating change"], ["pledging", "Promoter pledge"],
];
export const DEFAULT_RULES: Rules = {
  volx: 2, pct: 5, fii: 1.5, promoterAny: true, peBand: true,
  cats: Object.fromEntries(ALERT_CATS.map(([k]) => [k, true])),
};
const KEY = "finn.rules.v1";
export function loadRules(): Rules {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_RULES, ...JSON.parse(raw), cats: { ...DEFAULT_RULES.cats, ...(JSON.parse(raw).cats || {}) } };
  } catch {}
  return DEFAULT_RULES;
}
export function saveRules(r: Rules) {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch {}
}

// ---------- formatting ----------
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
export const cr = (n: number | null | undefined) =>
  n == null ? "–" : n >= 100000 ? `₹${inr1.format(n / 100000)} lakh cr` : `₹${inr.format(n)} cr`;
export const num = (n: number | null | undefined, d = 1) => (n == null ? "–" : n.toLocaleString("en-IN", { maximumFractionDigits: d }));
export const pct = (n: number | null | undefined, d = 1) => (n == null ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`);
export const pp = (n: number | null | undefined) => (n == null ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)} pp`);
export const sign = (n: number | null | undefined) => (n == null || n === 0 ? "flat" : n > 0 ? "up" : "down");

export function when(ts: string, now: number) {
  const t = new Date(ts).getTime();
  const h = (now - t) / 36e5;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  if (h < 48) return "yesterday";
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}
export const day = (ts: string) =>
  new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

// ---------- the Brief ----------
export type BriefItem =
  | { kind: "filing"; id: string; ticker: string; ts: string; tier: number; score: number; filing: Filing; earlier: Filing[]; events: LedgerEvent[] }
  | { kind: "move"; id: string; ticker: string; ts: string; tier: number; score: number; move: Move; trigger: Filing | null }
  | { kind: "ownership"; id: string; ticker: string; ts: string; tier: number; score: number; quarter: string; lines: string[] }
  | { kind: "valuation"; id: string; ticker: string; ts: string; tier: number; score: number; pe: number; band: number; side: "above" | "below" };

const BAD = new Set(["cut", "missed", "dropped"]);

export function buildBrief(
  feed: Filing[], moves: Record<string, Move[]>, holdings: Holding[], ledgers: Record<string, Ledger>,
  rules: Rules, days: number, now: number,
) {
  const cutoff = now - days * 864e5;
  const inWin = feed.filter((f) => new Date(f.ts).getTime() >= cutoff);
  const routine = inWin.filter((f) => f.tier >= 3);
  const live = inWin.filter((f) => f.tier < 3);

  // 1. one card per story: follow-ups fold under the latest update
  const heads = new Map<string, { head: Filing; earlier: Filing[] }>();
  for (const f of live) {                       // feed is newest first
    const key = f.thread ?? (f.card?.type === "person" && f.card.name ? `person-${f.ticker}-${f.card.name.toLowerCase()}` : f.id);
    const g = heads.get(key);
    if (g) g.earlier.push(f); else heads.set(key, { head: f, earlier: [] });
  }

  const items: BriefItem[] = [];
  for (const { head, earlier } of heads.values()) {
    let tier = Math.min(head.tier, ...earlier.map((e) => e.tier));
    if (tier === 1 && rules.cats[head.category] === false) tier = 2;      // a type this investor muted
    const d0 = new Date(head.ts.slice(0, 10)).getTime();
    const events = head.card?.type === "results"
      ? (ledgers[head.ticker]?.events ?? []).filter((e) => {
          const dd = (new Date(e.date).getTime() - d0) / 864e5;
          return dd >= -1 && dd <= 10;
        })
      : [];
    const bad = events.some((e) => BAD.has(e.type));
    if (bad) tier = 1;
    const recency = Math.max(0, 30 - (now - new Date(head.ts).getTime()) / 864e5);
    const score = (4 - tier) * 100 + (bad ? 160 : events.length ? 40 : 0) + (head.card?.type === "results" ? 15 : 0) +
      (head.materiality === "high" ? 25 : 0) + recency;
    items.push({ kind: "filing", id: head.id, ticker: head.ticker, ts: head.ts, tier, score, filing: head, earlier, events });
  }

  // 2. unusual end-of-day moves, by the investor's own definition of unusual
  for (const h of holdings) {
    for (const m of moves[h.ticker] ?? []) {
      const ts = `${m.d}T15:30:00+05:30`;
      if (new Date(ts).getTime() < cutoff || m.special) continue;
      const volHit = (m.volx ?? 0) >= rules.volx, pxHit = Math.abs(m.pct ?? 0) >= rules.pct;
      if (!volHit && !pxHit) continue;
      const prev = new Date(new Date(m.d).getTime() - 864e5).toISOString().slice(0, 10);
      const trigger = feed.find((f) => f.ticker === h.ticker && f.tier <= 2 && (f.ts.slice(0, 10) === m.d || f.ts.slice(0, 10) === prev)) ?? null;
      const tier = volHit && pxHit ? 1 : 2;
      const recency = Math.max(0, 30 - (now - new Date(ts).getTime()) / 864e5);
      items.push({
        kind: "move", id: `mv-${h.ticker}-${m.d}`, ticker: h.ticker, ts, tier, trigger, move: m,
        score: (4 - tier) * 100 + Math.min(40, Math.abs(m.pct ?? 0) * 3 + (m.volx ?? 0) * 4) + recency - (trigger ? 30 : 0),
      });
    }
  }

  // 3. slow signals (quarterly ownership, valuation vs own history): only in wider windows
  if (days >= 30) {
    for (const h of holdings) {
      const c = h.own_chg ?? {};
      const lines: string[] = [];
      if (c.fii != null && Math.abs(c.fii) >= rules.fii) lines.push(`FIIs ${c.fii > 0 ? "added" : "cut"} ${Math.abs(c.fii).toFixed(2)} pp`);
      if (rules.promoterAny && h.has_promoter && c.promoter != null && c.promoter <= -0.5) lines.push(`Promoters down ${Math.abs(c.promoter).toFixed(2)} pp`);
      if (lines.length) {
        const ts = new Date(now - 20 * 864e5).toISOString();
        items.push({ kind: "ownership", id: `own-${h.ticker}`, ticker: h.ticker, ts, tier: 2, score: 215, quarter: h.own_quarter ?? "", lines });
      }
      if (rules.peBand && h.pe && h.pe_plus1 && h.pe_minus1 && h.pe_minus1 > 0) {
        const side = h.pe > h.pe_plus1 ? "above" : h.pe < h.pe_minus1 ? "below" : null;
        if (side) items.push({
          kind: "valuation", id: `pe-${h.ticker}`, ticker: h.ticker, ts: new Date(now).toISOString(), tier: 2, score: 205,
          pe: h.pe, band: side === "above" ? h.pe_plus1 : h.pe_minus1, side,
        });
      }
    }
  }

  items.sort((a, b) => b.score - a.score);
  return { top: items.filter((i) => i.tier === 1), notable: items.filter((i) => i.tier === 2), routine };
}

/** "Company: title", unless the title already names the company. Keeps the title's own capitals. */
export function headline(name: string, title: string) {
  const first = name.split(" ")[0].toLowerCase();
  const t = title.charAt(0).toUpperCase() + title.slice(1);
  return title.toLowerCase().includes(first) ? t : `${name}: ${t}`;
}

/** One spoken sentence per item. Built from templates: the audio brief costs nothing to make. */
export function sentence(it: BriefItem, names: Record<string, string>): string {
  const n = (names[it.ticker] ?? it.ticker).replace(/ (Ltd|Limited)\.?$/i, "");
  if (it.kind === "move") {
    const m = it.move;
    const dir = (m.pct ?? 0) >= 0 ? "rose" : "fell";
    const vol = m.volx ? ` on ${m.volx.toFixed(1)} times normal volume` : "";
    return `${n} ${dir} ${Math.abs(m.pct ?? 0).toFixed(1)} percent${vol}${it.trigger ? `, the day of: ${it.trigger.title}` : ", with no filing to explain it"}.`;
  }
  if (it.kind === "ownership") return `${n}: ${it.lines.join(" and ")} in the ${it.quarter} quarter.`;
  if (it.kind === "valuation") return `${n} trades at ${it.pe.toFixed(0)} times earnings, ${it.side} its usual five year range.`;
  const f = it.filing;
  const ev = it.events.find((e) => BAD.has(e.type)) ?? it.events[0];
  if (f.card?.type === "results") {
    const r = f.card.rows;
    const rev = r.find((x) => x.metric === "Revenue"), pat = r.find((x) => x.metric === "PAT");
    const nums = [rev?.yoy != null ? `revenue ${rev.yoy >= 0 ? "up" : "down"} ${Math.abs(rev.yoy).toFixed(0)} percent` : "",
      pat?.yoy != null ? `profit ${pat.yoy >= 0 ? "up" : "down"} ${Math.abs(pat.yoy).toFixed(0)} percent` : ""].filter(Boolean).join(", ");
    const lead = ev
      ? ev.type === "cut" || ev.type === "raised"
        ? `${n} ${ev.type} its own guidance. ${ev.label}: from ${ev.from} to ${ev.to}.`
        : `${n}: a promise came due. ${ev.label}: ${ev.type}.`
      : `${n} reported results.`;
    return `${lead} ${nums ? `Year on year, ${nums}.` : ""}`.replace(/–/g, " to ");
  }
  if (f.card?.type === "person") return `${headline(n, f.title)}.`;
  return `${headline(n, f.title)}${it.earlier.length ? `. ${it.earlier.length} earlier updates on this.` : "."}`;
}
