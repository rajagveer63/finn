"""Pull: research any NSE company from primary sources only.

    python pipeline/research.py TCS TRENT           # build and add to the "researched on request" list

Writes web/public/data/company/{T}.json (with a `research` block), ledger/{T}.json and adhoc.json.
Every bull / bear / watch point must carry a verbatim quote from a transcript page; a point whose
quote cannot be found on that page is dropped, so nothing reaches the screen without a source.
"""
import datetime as dt
import json
import re
import sys

import ledger
import llm
import metrics
import pdftext
import prices
import screener
from build import DATA, IST, read, write, log, build_company
from config import PORTFOLIO

SYS = """You are a buy-side analyst writing for an Indian retail investor. You may use ONLY the transcript pages given.
Never use outside knowledge, news, or numbers that are not on these pages. Return JSON:
{"summary": "2 sentences: what the company does and where it stands now",
 "how_it_makes_money": "1-2 sentences on segments / revenue mix, as stated",
 "bull": [{"point": "...", "quote": "verbatim words from the page, 8-30 words", "page": n}],   // 2-3 items
 "bear": [same shape],                                                                          // 2-3 items: risks management admitted or analysts pressed on
 "watch": [same shape]}                                                                         // 1-2 items: what next quarter will reveal
Quotes must be copied exactly from the page text. Plain words, no hype."""


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def grounded(points, pages, url, label):
    """Keep a point only if its quote really is on the page it cites (or an adjacent one)."""
    out = []
    for p in points or []:
        if not isinstance(p, dict) or not p.get("point") or not p.get("quote"):
            continue
        q = _norm(p["quote"])[:120]
        pg = p.get("page") if isinstance(p.get("page"), int) else None
        cands = [pg - 1, pg - 2, pg] if pg else range(len(pages))
        hit = next((i for i in cands if 0 <= i < len(pages) and q[:60] in _norm(pages[i])), None)
        if hit is None:
            hit = next((i for i in range(len(pages)) if q[:60] in _norm(pages[i])), None)
        if hit is None:
            log(f"   dropped ungrounded point: {p['point'][:60]}")
            continue
        out.append({"point": p["point"], "quote": p["quote"], "page": hit + 1, "url": url, "source": label})
    return out


def snapshot(c):
    for call in c["documents"]["concalls"][:3]:
        url = call.get("transcript") or call.get("url")
        if not url:
            continue
        try:
            pages = pdftext.pages(url)
        except Exception as e:  # noqa: BLE001
            log("   transcript unreadable:", e)
            continue
        if len(pages) < 4:
            continue
        body = "\n".join(f"--- page {i + 1} ---\n{t}" for i, t in enumerate(pages))[:60000]
        out = llm.chat_json(SYS, f"Company: {c['name']}\nEarnings call: {call['period']}\n\n{body}",
                            effort="low", max_tokens=2500, tag=f"research:{c['name'][:20]}")
        if not out:
            continue
        label = f"Earnings call, {call['period']}"
        return {
            "summary": out.get("summary"), "how_it_makes_money": out.get("how_it_makes_money"),
            "bull": grounded(out.get("bull"), pages, url, label), "bear": grounded(out.get("bear"), pages, url, label),
            "watch": grounded(out.get("watch"), pages, url, label),
            "sources": [label], "as_of": dt.datetime.now(IST).isoformat(timespec="seconds"),
        }
    return from_annual_report(c)


def from_annual_report(c):
    """Some companies (Trent, for one) hold no earnings calls. Read the annual report's own
    Management Discussion & Analysis instead, with the same quote check."""
    for ar in c["documents"]["annual_reports"][:1]:
        try:
            pages = pdftext.pages(ar["url"])
        except Exception as e:  # noqa: BLE001
            log("   annual report unreadable:", e)
            return None
        if not pages:
            return None
        start = next((i for i, t in enumerate(pages) if i > 3 and re.search(r"management\s+discussion\s+(and|&)\s+analysis", t[:600], re.I)), None)
        if start is None:
            start = next((i for i, t in enumerate(pages) if re.search(r"chairman'?s?\s+(message|letter|statement)", t[:400], re.I)), 2)
        window = list(range(start, min(len(pages), start + 22)))
        body = "\n".join(f"--- page {i + 1} ---\n{pages[i]}" for i in window)[:60000]
        sys_ = SYS.replace("transcript pages", "annual report pages").replace("analysts pressed on", "the report itself flags")
        out = llm.chat_json(sys_, f"Company: {c['name']}\nAnnual report {ar['year']}\n\n{body}",
                            effort="low", max_tokens=2500, tag=f"research-ar:{c['name'][:20]}")
        if not out:
            return None
        label = f"Annual report {ar['year']}"
        return {
            "summary": out.get("summary"), "how_it_makes_money": out.get("how_it_makes_money"),
            "bull": grounded(out.get("bull"), pages, ar["url"], label), "bear": grounded(out.get("bear"), pages, ar["url"], label),
            "watch": grounded(out.get("watch"), pages, ar["url"], label),
            "sources": [label], "note": "This company does not hold earnings calls; read from its annual report instead.",
            "as_of": dt.datetime.now(IST).isoformat(timespec="seconds"),
        }
    return None


def run(ticker):
    ticker = ticker.upper().removesuffix(".NS")
    log(f"== {ticker}")
    px = prices.history([ticker]).get(ticker, [])
    raw, doc = build_company(ticker, {"in_portfolio": ticker in {p["ticker"] for p in PORTFOLIO}, "ledger": True}, px)
    try:
        doc["research"] = snapshot(raw)
    except Exception as e:  # noqa: BLE001
        log("   snapshot failed:", e)
        doc["research"] = None
    write(DATA / "company" / f"{ticker}.json", doc)
    try:
        lg = ledger.build(ticker)
        if lg.get("promises"):
            write(DATA / "ledger" / f"{ticker}.json", lg)
            doc["ledger"] = True
        else:
            doc["ledger"] = False
    except Exception as e:  # noqa: BLE001
        log("   ledger failed:", e)
        doc["ledger"] = False
    write(DATA / "company" / f"{ticker}.json", doc)

    mv = (prices.moves(px) or [{}])[-1] if px else {}
    own = doc["metrics"].get("ownership") or {}
    band = doc["metrics"]["valuation"].get("pe_band") or {}
    row = {"ticker": ticker, "name": doc["name"], "sector": (raw.get("sector") or "Researched"), "size": "",
           "ledger": doc["ledger"], "price": mv.get("c"), "pct": mv.get("pct"), "volx": mv.get("volx"), "as_of": mv.get("d"),
           "pe": doc["top_ratios"].get("Stock P/E"), "mcap": doc["top_ratios"].get("Market Cap"),
           "is_financial": doc["metrics"].get("is_financial"), "own_quarter": (own.get("quarters") or [None])[-1],
           "own_chg": own.get("change_1q"), "own_latest": own.get("latest"), "has_promoter": own.get("has_promoter"),
           "pe_median": band.get("median"), "pe_plus1": band.get("plus1"), "pe_minus1": band.get("minus1")}
    if row["ticker"] not in {p["ticker"] for p in PORTFOLIO}:
        idx = [r for r in read(DATA / "adhoc.json", []) if r["ticker"] != ticker]
        write(DATA / "adhoc.json", [row] + idx)
    log(f"   done: research={'yes' if doc['research'] else 'no'} ledger={doc['ledger']}")


if __name__ == "__main__":
    for t in sys.argv[1:]:
        try:
            run(t)
        except Exception as e:  # noqa: BLE001
            log(f"   FAILED {t}: {e}")
            sys.exit(1) if len(sys.argv) == 2 else None
    log("llm usage:", json.dumps(llm.USAGE))
