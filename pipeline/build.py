"""Build the app's data: fundamentals, prices, classified + enriched filings.

    python pipeline/build.py                 # whole portfolio
    python pipeline/build.py --only INFY LT  # a subset (merges into existing files)
    python pipeline/build.py --no-llm        # rules only

Output is plain JSON under data/. The web app reads those files; the scheduled
job re-runs this and commits whatever changed.
"""
import sys
import json
import time
import pathlib
import argparse
import datetime as dt
from concurrent.futures import ThreadPoolExecutor

import llm
import prices
import enrich
import metrics
import screener
from classify import classify, LABEL, TIER
from announcements import NSE
from config import PORTFOLIO

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"      # served as static files by the web app
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
TOP_ROLES = ("top",)


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def read(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def log(*a):
    print(*a, flush=True)


def build_company(ticker, meta, px):
    c = screener.fetch(ticker)
    m = metrics.build(c, px)
    doc = {
        "ticker": ticker, "name": c["name"], "about": c.get("about"), "basis": c["basis"], "bse_code": c.get("bse_code"),
        "sector": meta.get("sector"), "size": meta.get("size"), "in_portfolio": meta.get("in_portfolio", False),
        "ledger": bool(meta.get("ledger")), "top_ratios": c["top_ratios"], "metrics": m,
        "quarters": c.get("quarters"),
        "documents": {"annual_reports": c["documents"]["annual_reports"][:4], "concalls": c["documents"]["concalls"][:8]},
        "as_of": dt.datetime.now(IST).isoformat(timespec="seconds"),
    }
    write(DATA / "company" / f"{ticker}.json", doc)
    return c, doc


def group_results(items):
    """Results day produces 3-5 filings. Keep one card, attach the rest as related links."""
    by_day = {}
    for it in items:
        if it["category"] == "results" and it["sub"] in ("filing", "presentation", "supporting_doc"):
            by_day.setdefault((it["ticker"], it["ts"][:10]), []).append(it)
    for group in by_day.values():
        filings = [g for g in group if g["sub"] == "filing"]
        if not filings:
            continue
        primary = next((g for g in filings if "board meeting" in g["nse_desc"].lower() or "financial result" in g["nse_desc"].lower()), filings[-1])
        primary["related"] = [{"title": g["title"][:80], "pdf": g["pdf"]} for g in group if g is not primary]
        for g in group:
            if g is not primary:
                g["folded"] = True
    return [it for it in items if not it.get("folded")]


def enrich_item(it, company, use_llm):
    try:
        if it["category"] == "results" and it["sub"] == "filing":
            card = enrich.results_card(it, company)
            if card:
                it["card"] = card
                it["title"] = f"{card['quarter']} quarter results"
                rev = next((r for r in card["rows"] if r["metric"] == "Revenue"), None)
                pat = next((r for r in card["rows"] if r["metric"] == "PAT"), None)
                bits = []
                if rev and rev["yoy"] is not None:
                    bits.append(f"Revenue {rev['yoy']:+.1f}% YoY")
                if pat and pat["yoy"] is not None:
                    bits.append(f"PAT {pat['yoy']:+.1f}% YoY")
                it["summary"] = ", ".join(bits) or None
            it["enriched"] = True
            return
        if not use_llm:
            return
        out = enrich.generic(it, company)
        it["enriched"] = True
        if not out:
            return
        it["by"] = "rules+llm" if it["confident"] else "llm"
        it["title"] = out.get("title") or it["title"]
        it["summary"] = out.get("summary")
        it["key_figure"] = out.get("key_figure")
        it["materiality"] = out.get("materiality")
        if not it["confident"]:
            it["category"] = out["category"]
            it["label"] = LABEL[out["category"]]
            it["tier"] = {"high": 1, "medium": 2, "low": 3}.get(out.get("materiality"), TIER[out["category"]])
        elif out.get("materiality") == "low" and it["tier"] < 3:
            it["tier"] += 1                                   # the document itself says this is minor
        elif out.get("materiality") == "high" and it["tier"] == 2:
            it["tier"] = 1
        p = out.get("person")
        if isinstance(p, dict) and p.get("name"):
            it["card"] = {"type": "person", **{k: p.get(k) for k in ("name", "role", "action", "seniority", "effective", "bio")}}
            if it["category"] == "management_change":
                it["tier"] = {"top": 1, "board": 2}.get(p.get("seniority"), 3)
                if p.get("action") == "reappointed":          # continuity is not news
                    it["tier"] = max(it["tier"], 2 if p.get("seniority") == "top" else 3)
            it["thread"] = f"{it['ticker']}:person:{p['name'].lower().replace('.', '').replace(' ', '')}"
        if not it.get("thread") and it["category"] in ("litigation", "M&A", "fund_raise", "credit_rating"):
            # Follow-ups on one story (an NCLT case, a QIP) collapse under the latest update.
            it["thread"] = f"{it['ticker']}:{it['category']}:{it.get('sub') or ''}"
    except Exception as e:                                    # one bad PDF must not sink the run
        it["enrich_error"] = f"{type(e).__name__}: {e}"[:160]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--enrich-days", type=int, default=45)
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--skip-fundamentals", action="store_true")
    args = ap.parse_args()

    t0 = time.time()
    metas = {c["ticker"]: {**c, "in_portfolio": True} for c in PORTFOLIO}
    tickers = [t for t in metas if not args.only or t in args.only]
    today = dt.datetime.now(IST).date()

    # 1. prices
    log(f"[prices] {len(tickers)} tickers")
    px = prices.history(tickers)
    all_moves = read(DATA / "moves.json", {})
    for t in tickers:
        if t in px:
            all_moves[t] = prices.moves(px[t])
    write(DATA / "moves.json", all_moves)

    # 2. fundamentals
    companies = {}
    for t in tickers:
        try:
            raw, _ = build_company(t, metas[t], px.get(t, []))
            companies[t] = raw
            log(f"[fundamentals] {t} ok ({raw['basis']})")
        except Exception as e:
            log(f"[fundamentals] {t} FAILED {type(e).__name__}: {e}")
        time.sleep(0.4)

    # 3. filings
    old = {it["id"]: it for it in read(DATA / "feed.json", {"items": []})["items"]}
    nse, items, fetched_ok = NSE(), [], []
    for t in tickers:
        try:
            rows = nse.announcements(t, today - dt.timedelta(days=args.days), today)
        except Exception as e:
            log(f"[filings] {t} FAILED {e}")
            continue
        fetched_ok.append(t)
        for r in rows:
            if not r["ts"] or not r["pdf"]:
                continue
            if r["id"] in old and old[r["id"]].get("enriched"):
                items.append(old[r["id"]])
                continue
            c = classify(r["nse_desc"], r["text"], companies.get(t, {}).get("is_financial", False))
            items.append({**r, **c, "by": "rules", "summary": None, "has_xbrl": r["has_xbrl"]})
        log(f"[filings] {t} {len(rows)}")
        time.sleep(0.3)
    items = group_results(items)

    def wants(it):
        if it.get("enriched") or it["ticker"] not in companies:
            return False
        age = (today - dt.date.fromisoformat(it["ts"][:10])).days
        if it["category"] == "results":
            return it["sub"] == "filing"
        if it["category"] in ("dividend", "earnings_call", "investor_meetings"):
            return False
        if it["tier"] == 1:
            return True
        return age <= args.enrich_days and (it["tier"] == 2 or not it["confident"])
    todo = [it for it in items if wants(it)]
    log(f"[enrich] {len(todo)} of {len(items)} filings need a read")
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(lambda it: enrich_item(it, companies[it["ticker"]], not args.no_llm), todo))

    # keep filings of tickers we did not touch this run
    untouched = [it for it in old.values() if it["ticker"] not in fetched_ok]
    items = sorted(items + untouched, key=lambda it: it["ts"], reverse=True)
    for it in items:
        it.pop("text", None) if it.get("summary") else None
    write(DATA / "feed.json", {"items": items})

    # 4. portfolio index + run metadata
    index = []
    for c in PORTFOLIO:
        doc = read(DATA / "company" / f"{c['ticker']}.json", None)
        mv = (all_moves.get(c["ticker"]) or [{}])[-1]
        if doc:
            own = doc["metrics"].get("ownership") or {}
            band = doc["metrics"]["valuation"].get("pe_band") or {}
            index.append({"ticker": c["ticker"], "name": doc["name"], "sector": c["sector"], "size": c["size"],
                          "ledger": bool(c.get("ledger")), "price": mv.get("c"), "pct": mv.get("pct"), "volx": mv.get("volx"),
                          "as_of": mv.get("d"), "pe": doc["top_ratios"].get("Stock P/E"), "mcap": doc["top_ratios"].get("Market Cap"),
                          "is_financial": doc["metrics"].get("is_financial"),
                          "own_quarter": (own.get("quarters") or [None])[-1], "own_chg": own.get("change_1q"),
                          "own_latest": own.get("latest"), "has_promoter": own.get("has_promoter"),
                          "pe_median": band.get("median"), "pe_plus1": band.get("plus1"), "pe_minus1": band.get("minus1")})
    write(DATA / "portfolio.json", index)

    usage = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0}
    for f in llm.CACHE.glob("*.json"):
        u = json.loads(f.read_text(encoding="utf-8")).get("usage") or {}
        usage["calls"] += 1
        usage["prompt_tokens"] += u.get("prompt_tokens", 0)
        usage["completion_tokens"] += u.get("completion_tokens", 0)
    n = len(items)
    by_rules = sum(1 for it in items if it.get("by") == "rules")
    write(DATA / "meta.json", {
        "generated_at": dt.datetime.now(IST).isoformat(timespec="seconds"),
        "window_days": args.days, "filings": n,
        "by_tier": {str(k): sum(1 for it in items if it["tier"] == k) for k in (1, 2, 3)},
        "classified_by_rules_pct": round(100 * by_rules / n) if n else None,
        "llm_read": n - by_rules, "llm_usage_total": usage, "llm_this_run": llm.USAGE, "model": llm.MODEL,
        "seconds": round(time.time() - t0),
    })
    log(f"[done] {n} filings, tiers {[sum(1 for it in items if it['tier'] == k) for k in (1, 2, 3)]}, "
        f"{by_rules} by rules alone, LLM this run {llm.USAGE}, {round(time.time() - t0)}s")


if __name__ == "__main__":
    main()
