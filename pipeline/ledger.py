"""Promise Ledger: what management said they would do vs what happened.

Primary sources only: concall transcripts (for promises and for what management
later reported) and the company's reported financials.

  Step 1  (cheap, per transcript, effort=low)   extract promises + reported actuals
  Step 2  (code)                                 chain the same promise across calls,
                                                 settle full-year growth/margin numbers arithmetically
  Step 3  (one call per company, default effort) judge the rest, with evidence

Each promise keeps the date it was said, so nobody is graded against later guidance.
"""
import re
import sys
import json
import pathlib
import datetime as dt
from concurrent.futures import ThreadPoolExecutor

import llm
import pdftext
import screener

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "ledger"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
CHUNK = 42000

EXTRACT_SYS = (
    "You analyse an earnings-call transcript of an Indian listed company. Use ONLY the transcript text. "
    "Never use outside knowledge. Quote exactly. Reply with JSON only."
)
EXTRACT_USER = """Company: {name}. Transcript part {part} of {parts}. Page markers look like [p12].

\"\"\"{body}\"\"\"

Extract two things said by MANAGEMENT (not analysts):

1. "promises": explicit forward-looking commitments an investor can later check. Only headline items:
   revenue/sales growth, margins, profit, capex, debt, capacity or project timelines, order inflow, volume growth,
   store/plant additions. Each needs a number or a deadline. Skip vague optimism. Max 8, most important first.
2. "reported": headline results management stated for the period just ended (growth, margins, capex spent, order inflow,
   milestones reached). Max 8.

Return JSON:
{{
 "call_date": "YYYY-MM-DD or null (date of this call, from the transcript)",
 "call_quarter": "e.g. Q2 FY27 (the quarter whose results are discussed) or null",
 "promises": [{{
   "metric": "revenue_growth|operating_margin|ebitda_margin|profit|capex|debt|capacity|order_inflow|volume_growth|timeline|other",
   "label": "max 9 words, e.g. 'FY27 revenue growth, constant currency'",
   "kind": "range|at_least|at_most|point|qualitative",
   "low": number or null, "high": number or null, "unit": "%|₹ crore|other|null",
   "period": "FY27 | Q3 FY27 | H2 FY27 | by Mar 2027 | medium term",
   "quote": "verbatim, max 40 words", "speaker": "name or role", "page": page number
 }}],
 "reported": [{{"label": "max 9 words", "value": "number with unit", "period": "Q2 FY27", "quote": "verbatim, max 30 words", "page": page number}}]
}}"""

JUDGE_SYS = (
    "You are a sceptical equity analyst checking whether management kept its word. Use ONLY the facts provided "
    "(promises, what management later reported, and the reported financial table). Never use outside knowledge. "
    "If the evidence is not in the facts, the status is PENDING or UNVERIFIED, never a guess. Reply with JSON only."
)
JUDGE_USER = """Company: {name}. Today is {today}.

PROMISES (chronological; each line of promises about the same target is already chained under one id):
{promises}

WHAT MANAGEMENT LATER REPORTED ON CALLS:
{reported}

REPORTED FINANCIALS (₹ crore, from the company's filed results):
{table}

For each promise id decide:
- KEPT: the period is over and the target was met (within the stated range, or better).
- MISSED: the period is over and the target was not met.
- REVISED: management itself changed the target before the period ended. Say in which direction.
- DROPPED: a dated commitment that later calls stopped mentioning, with the deadline now passed.
- PENDING: the period is not over. Say whether it is on track, behind, or unclear, from the latest evidence.
- UNVERIFIED: the period is over but the facts provided do not show the outcome.

Return JSON: {{"verdicts": [{{"id": "...", "status": "...", "actual": "the delivered figure or latest evidence, with period, or null",
 "evidence": "where that came from: 'Q4 FY26 call, p4' or 'reported financials FY26'",
 "tracking": "on_track|behind|ahead|unclear|null (PENDING only)",
 "verdict": "max 22 words, plain, for an investor"}}],
 "read": "max 30 words: what this record says about how much to trust this management's guidance"}}"""


def fy_of(period):
    m = re.search(r"FY\s?'?(\d{2,4})", period or "", re.I)
    if not m:
        return None
    y = int(m.group(1))
    return y if y > 100 else 2000 + y


def norm_period(p):
    p = (p or "").upper().replace("'", "").replace("FY 20", "FY").replace("FY20", "FY")
    p = re.sub(r"\s+", " ", p).strip()
    m = re.search(r"(Q[1-4]|H[12])?\s?FY\s?(\d{2})", p)
    return (f"{m.group(1) or ''} FY{m.group(2)}".strip()) if m else p[:24]


def extract_call(name, call):
    try:
        pages = pdftext.pages(call["url"])
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"[:120], **call}
    if not pages:
        return {"error": "no text layer", **call}
    text = "".join(f" [p{i + 1}] {p}" for i, p in enumerate(pages))
    chunks = [text[i:i + CHUNK] for i in range(0, len(text), CHUNK - 1500)]
    out = {"promises": [], "reported": [], "call_date": None, "call_quarter": None, **call, "pages": len(pages)}
    for i, c in enumerate(chunks):
        r = llm.chat_json(EXTRACT_SYS, EXTRACT_USER.format(name=name, part=i + 1, parts=len(chunks), body=c),
                          effort="low", max_tokens=2600, tag=f"ledger-extract:{call['url'][-28:]}:{i}")
        if not r:
            continue
        out["call_date"] = out["call_date"] or r.get("call_date")
        out["call_quarter"] = out["call_quarter"] or r.get("call_quarter")
        out["promises"] += [p for p in r.get("promises") or [] if isinstance(p, dict) and p.get("quote")]
        out["reported"] += [p for p in r.get("reported") or [] if isinstance(p, dict) and p.get("value")]
    return out


def financial_table(c):
    """Compact reported numbers the judge may rely on, plus a dict for arithmetic checks."""
    a, q = c.get("annual") or {}, c.get("quarters") or {}
    lines, facts = [], {}

    def row(t, *names):
        for n in names:
            if t.get("rows", {}).get(n):
                return t["rows"][n]
        return [None] * len(t.get("cols", []))
    sales, op, dep, np_ = row(a, "Sales", "Revenue"), row(a, "Operating Profit", "Financing Profit"), row(a, "Depreciation"), row(a, "Net Profit")
    cols = a.get("cols", [])
    for i, col in enumerate(cols):
        if col == "TTM" or i == 0 or sales[i] is None or not sales[i - 1]:
            continue
        m = re.search(r"(\d{4})", col)
        if not m:
            continue
        fy = int(m.group(1))
        g = round(100 * (sales[i] / sales[i - 1] - 1), 1)
        ebitda_m = round(100 * op[i] / sales[i], 1) if op[i] is not None else None
        ebit_m = round(100 * (op[i] - (dep[i] or 0)) / sales[i], 1) if op[i] is not None else None
        pg = round(100 * (np_[i] / np_[i - 1] - 1), 1) if np_[i] is not None and np_[i - 1] else None
        facts[fy] = {"revenue_growth": g, "ebitda_margin": ebitda_m, "operating_margin": ebit_m, "profit_growth": pg}
        if i >= len(cols) - 5:
            lines.append(f"FY{fy % 100}: revenue {sales[i]:.0f} (growth {g}% in ₹), EBITDA margin {ebitda_m}%, EBIT margin {ebit_m}%, net profit {np_[i]:.0f} (growth {pg}%)")
    qs, qo, qd, qn = row(q, "Sales", "Revenue"), row(q, "Operating Profit", "Financing Profit"), row(q, "Depreciation"), row(q, "Net Profit")
    qc = q.get("cols", [])
    for i in range(max(4, len(qc) - 6), len(qc)):
        if qs[i] is None or not qs[i - 4]:
            continue
        yoy = round(100 * (qs[i] / qs[i - 4] - 1), 1)
        em = round(100 * (qo[i] - (qd[i] or 0)) / qs[i], 1) if qo[i] is not None else None
        lines.append(f"Quarter ended {qc[i]}: revenue {qs[i]:.0f} (YoY {yoy}% in ₹), EBIT margin {em}%, net profit {qn[i]:.0f}")
    return "\n".join(lines), facts


def chain(calls):
    """Group the same target (metric + period) across calls into one promise line."""
    lines = {}
    for call in calls:
        for p in call["promises"]:
            key = (p.get("metric") or "other", norm_period(p.get("period")))
            if key[0] in ("other", "timeline", "capacity"):
                key = key + (re.sub(r"[^a-z]", "", (p.get("label") or "").lower())[:18],)
            entry = {"said_on": call.get("call_date"), "call": call.get("call_quarter") or call["period"], "low": p.get("low"),
                     "high": p.get("high"), "unit": p.get("unit"), "kind": p.get("kind"), "quote": p.get("quote"),
                     "speaker": p.get("speaker"), "page": p.get("page"), "url": call["url"], "label": p.get("label")}
            lines.setdefault(key, {"metric": key[0], "period": norm_period(p.get("period")), "history": []})["history"].append(entry)
    out = []
    for i, (key, line) in enumerate(sorted(lines.items(), key=lambda kv: (kv[1]["history"][0]["said_on"] or "", kv[0][0]))):
        h = sorted(line["history"], key=lambda e: e["said_on"] or "")
        dedup = [h[0]]
        for e in h[1:]:
            if e["said_on"] != dedup[-1]["said_on"]:
                dedup.append(e)
        line.update(id=f"p{i + 1}", history=dedup, label=dedup[-1]["label"] or dedup[0]["label"], first_said=dedup[0]["said_on"])
        out.append(line)
    return out


CORE = ("revenue_growth", "operating_margin", "ebitda_margin", "profit", "capex", "debt", "order_inflow", "volume_growth")


def select(lines, cap=14):
    """Headline, checkable promises only: a number or a dated milestone. The rest is colour."""
    def numeric(ln):
        return any(e.get("low") is not None or e.get("high") is not None for e in ln["history"])

    def dated(ln):
        return bool(re.search(r"FY\d{2}|20\d{2}|Q[1-4]|H[12]", ln["period"]))
    core = [ln for ln in lines if ln["metric"] in CORE and numeric(ln) and dated(ln)]
    miles = [ln for ln in lines if ln["metric"] in ("capacity", "timeline") and dated(ln) and (numeric(ln) or len(ln["history"]) > 1)]
    core.sort(key=lambda ln: (CORE.index(ln["metric"]), -len(ln["history"])))
    miles.sort(key=lambda ln: ln["first_said"] or "", reverse=True)
    keep = core[:cap - 3] + miles[:max(3, cap - len(core[:cap - 3]))]
    keep = keep[:cap]
    for i, ln in enumerate(sorted(keep, key=lambda ln: ln["first_said"] or "")):
        ln["id"] = f"p{i + 1}"
    return keep


def _mid(e):
    lo, hi = e.get("low"), e.get("high")
    vals = [v for v in (lo, hi) if v is not None]
    return sum(vals) / len(vals) if vals else None


def revisions(line):
    """Each time management moved its own target: direction, from, to, with the quote."""
    out, h = [], line["history"]
    for a, b in zip(h, h[1:]):
        ta, tb = fmt_target(a), fmt_target(b)
        if ta and tb and ta != tb:
            ma, mb = _mid(a), _mid(b)
            direction = "changed" if ma is None or mb is None or ma == mb else ("raised" if mb > ma else "cut")
            out.append({"date": b["said_on"], "direction": direction, "from": ta, "to": tb, "quote": b["quote"],
                        "page": b["page"], "url": b["url"], "call": b["call"]})
    return out


def fmt_target(e):
    lo, hi, u = e.get("low"), e.get("high"), (e.get("unit") or "")
    u = "" if u in ("null", "other", None) else u
    if lo is not None and hi is not None and lo != hi:
        return f"{lo:g}–{hi:g}{u}"
    if e.get("kind") == "at_least" and lo is not None:
        return f"≥{lo:g}{u}"
    if e.get("kind") == "at_most" and (hi is not None or lo is not None):
        return f"≤{(hi if hi is not None else lo):g}{u}"
    v = lo if lo is not None else hi
    return f"{v:g}{u}" if v is not None else None


def arithmetic_check(line, facts, today):
    """Full-year growth and margin targets, once the year is over, are settled by arithmetic."""
    if line["metric"] not in ("revenue_growth", "operating_margin", "ebitda_margin"):
        return None
    if not re.fullmatch(r"FY\d{2}", line["period"]):
        return None
    fy = fy_of(line["period"])
    if not fy or dt.date(fy, 5, 31) > today or fy not in facts:
        return None
    said = " ".join((e.get("quote") or "") + " " + (e.get("label") or "") for e in line["history"]).lower()
    if line["metric"] == "revenue_growth" and re.search(r"constant currency|cc|dollar|usd", said):
        return None                      # reported table is in rupees: different basis, leave it to call evidence
    actual = facts[fy].get(line["metric"])
    last = line["history"][-1]
    lo, hi = last.get("low"), last.get("high")
    if actual is None or (lo is None and hi is None) or (last.get("unit") or "%") != "%":
        return None
    floor = lo if lo is not None else hi
    kept = actual >= floor - 0.05 if last.get("kind") != "at_most" else actual <= (hi if hi is not None else lo) + 0.05
    return {"status": "KEPT" if kept else "MISSED", "actual_value": actual}


def build(ticker):
    c = screener.fetch(ticker)
    calls_meta = c["documents"]["concalls"][:6]
    with ThreadPoolExecutor(max_workers=3) as ex:
        calls = list(ex.map(lambda m: extract_call(c["name"], m), calls_meta))
    good = sorted([x for x in calls if not x.get("error") and x.get("call_date")], key=lambda x: x["call_date"])
    if not good:
        return {"ticker": ticker, "name": c["name"], "promises": [], "error": "no readable transcripts",
                "calls": [{"period": x["period"], "error": x.get("error")} for x in calls]}
    lines = select(chain(good))
    table, facts = financial_table(c)
    today = dt.datetime.now(IST).date()

    ptxt = []
    for ln in lines:
        steps = "; then ".join(f"{e['said_on']} ({e['call']}): {fmt_target(e) or 'no number'} — \"{e['quote']}\"" for e in ln["history"])
        ptxt.append(f"[{ln['id']}] {ln['label']} | target period {ln['period']} | {steps}")
    rtxt = [f"{x['call_date']} ({x.get('call_quarter')}), p{r.get('page')}: {r.get('label')} = {r.get('value')} [{r.get('period')}] — \"{r.get('quote')}\""
            for x in good for r in x["reported"]]
    judged = llm.chat_json(JUDGE_SYS, JUDGE_USER.format(name=c["name"], today=today.isoformat(), promises="\n".join(ptxt),
                                                        reported="\n".join(rtxt)[:14000], table=table),
                           effort=None, max_tokens=9000, tag=f"ledger-judge:{ticker}") or {}
    by_id = {v.get("id"): v for v in judged.get("verdicts") or [] if isinstance(v, dict)}

    promises = []
    for ln in lines:
        v = by_id.get(ln["id"], {})
        status = v.get("status") if v.get("status") in ("KEPT", "MISSED", "REVISED", "DROPPED", "PENDING", "UNVERIFIED") else "UNVERIFIED"
        hist = ln["history"]
        targets = [fmt_target(e) for e in hist]
        revised = len({t for t in targets if t}) > 1
        check = arithmetic_check(ln, facts, today)
        decided_by = "model, from call evidence"
        actual = v.get("actual")
        if check:
            decided_by = "arithmetic on reported financials"
            if check["status"] != status:
                status = check["status"]
            actual = f"{check['actual_value']}% in {ln['period']} (reported, ₹ terms)"
        revs = revisions(ln)
        promises.append({
            "id": ln["id"], "label": ln["label"], "metric": ln["metric"], "period": ln["period"],
            "target": targets[-1], "first_target": targets[0], "revised": revised, "revisions": revs,
            "net_direction": (revs[-1]["direction"] if len({r["direction"] for r in revs}) == 1 else "changed") if revs else None,
            "status": status, "tracking": v.get("tracking") if status == "PENDING" else None,
            "actual": actual, "evidence": v.get("evidence"), "verdict": v.get("verdict"), "decided_by": decided_by,
            "first_said": ln["first_said"],
            "history": [{"said_on": e["said_on"], "call": e["call"], "target": fmt_target(e), "quote": e["quote"],
                         "speaker": e["speaker"], "page": e["page"], "url": e["url"]} for e in hist],
        })
    settled = [p for p in promises if p["status"] in ("KEPT", "MISSED")]
    order = {"MISSED": 0, "DROPPED": 1, "REVISED": 2, "KEPT": 3, "PENDING": 4, "UNVERIFIED": 5}
    promises.sort(key=lambda p: (order[p["status"]], p["first_said"] or ""))
    events = [{"date": r["date"], "type": r["direction"], "label": p["label"], "from": r["from"], "to": r["to"],
               "quote": r["quote"], "page": r["page"], "url": r["url"], "promise": p["id"]}
              for p in promises for r in p["revisions"] if r["date"]]
    call_dates = sorted(x["call_date"] for x in good)
    for p in promises:
        if p["status"] in ("KEPT", "MISSED", "DROPPED"):
            fy = fy_of(p["period"])
            due = next((d for d in call_dates if fy and d >= f"{fy}-04-01"), None) if re.fullmatch(r"FY\d{2}", p["period"]) else None
            events.append({"date": due or call_dates[-1], "type": p["status"].lower(), "label": p["label"], "from": p["target"],
                           "to": p["actual"], "quote": p["verdict"], "page": None, "url": None, "promise": p["id"]})
    events.sort(key=lambda e: e["date"], reverse=True)
    return {
        "ticker": ticker, "name": c["name"], "read": judged.get("read"), "events": events,
        "score": {"kept": sum(p["status"] == "KEPT" for p in promises), "settled": len(settled),
                  "missed": sum(p["status"] == "MISSED" for p in promises), "revised": sum(p["revised"] for p in promises),
                  "dropped": sum(p["status"] == "DROPPED" for p in promises), "pending": sum(p["status"] == "PENDING" for p in promises),
                  "total": len(promises)},
        "calls": [{"period": x["period"], "date": x.get("call_date"), "quarter": x.get("call_quarter"), "url": x["url"],
                   "pages": x.get("pages"), "promises": len(x.get("promises", [])), "error": x.get("error")} for x in calls],
        "promises": promises,
        "as_of": dt.datetime.now(IST).isoformat(timespec="seconds"),
    }


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for t in sys.argv[1:]:
        d = build(t.upper())
        (OUT / f"{t.upper()}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(t, d.get("score"), "| calls:", [(c["period"], c["promises"], c.get("error")) for c in d["calls"]], "| LLM", llm.USAGE, flush=True)
