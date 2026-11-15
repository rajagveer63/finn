"""LLM enrichment for the filings that earn it. Everything here is cached.

- results filings  -> headline numbers table (Revenue, EBITDA, PBT, PAT; QoQ and YoY),
                      cross-checked against screener's standardised quarterly table
- everything else  -> a real title, one-line "why it matters", materiality,
                      and for people changes a short bio taken from the filing itself
"""
import re
import datetime as dt
import llm
import pdftext

CATS = ["results", "M&A", "fund_raise", "management_change", "litigation", "insider_trading", "earnings_call",
        "investor_meetings", "credit_rating", "dividend", "bonus_split", "capex", "press_release",
        "postal_ballot", "agm_egm", "pledging", "unclassified"]

GENERIC_SYS = (
    "You read one stock-exchange filing by an Indian listed company and summarise it for a professional "
    "investor. Use ONLY the text provided. Never add outside knowledge. Reply with JSON only."
)
GENERIC_USER = """Company: {name} ({ticker}). Exchange subject: "{desc}". Exchange headline: "{text}".

Filing text (first pages):
\"\"\"{body}\"\"\"

Return JSON:
{{
 "category": one of {cats},
 "title": "max 12 words, plain English, the actual event (no 'intimation', no regulation numbers)",
 "summary": "max 28 words: what happened and the one fact an investor needs (amounts, dates, counterparties)",
 "key_figure": "the single most important number with unit, or null",
 "materiality": "high" | "medium" | "low",
 "person": null, or for a person joining/leaving/being re-appointed:
   {{"name": "...", "role": "...", "action": "appointed|resigned|retired|reappointed|deceased|other",
     "seniority": "top" (CEO, MD, CFO, Chair, whole-time director) | "board" (other directors) | "other",
     "effective": "date or null", "bio": "max 35 words on their background, from this document only, or null"}}
}}
materiality: high = could move the stock or change the thesis; medium = worth knowing; low = routine or promotional."""

RESULTS_SYS = (
    "You extract headline numbers from an Indian company's quarterly results table. Use ONLY the text "
    "provided. Copy numbers exactly as printed. If a number is not present, use null. Reply with JSON only."
)
RESULTS_USER = """Company: {name} ({ticker}). Prefer the CONSOLIDATED statement; use standalone only if no consolidated table is present.

Text:
\"\"\"{body}\"\"\"

The statement has columns for the latest quarter, the preceding quarter, and the same quarter of the previous year.
Return JSON:
{{
 "basis": "consolidated" | "standalone",
 "unit": "crore" | "lakh" | "million" | "billion",
 "periods": ["latest quarter end date", "preceding quarter end date", "year-ago quarter end date"],
 "revenue": [latest, preceding, year_ago],          // Revenue from operations (for banks/lenders: total income)
 // all values are plain JSON numbers without commas, exactly three per list, in the column order above
 "other_income": [..3..],
 "finance_costs": [..3..],
 "depreciation": [..3..],
 "pbt": [..3..],                                     // Profit before tax (after exceptional items)
 "pat": [..3..]                                      // Profit after tax / net profit for the period
}}"""

_UNIT = {"crore": 1.0, "lakh": 0.01, "million": 0.1, "billion": 100.0}


def _f(x):
    """'1,23,456.7' or '(1,234)' or 1234 -> float; anything else -> None."""
    if isinstance(x, (int, float)):
        return float(x)
    if not isinstance(x, str):
        return None
    s = x.replace(",", "").replace("₹", "").strip()
    neg = s.startswith("(") and s.endswith(")")
    try:
        return -float(s.strip("()")) if neg else float(s)
    except ValueError:
        return None


def _page_score(p):
    """How likely is this page to be the statement of quarterly results?"""
    head = p[:700].lower()
    low = p.lower()
    if len(re.findall(r"\d[\d,]{2,}", p)) < 40:
        return -9
    s = 0
    s += 3 if re.search(r"revenue from operations|interest earned|income from operations", low) else 0
    s += 2 if re.search(r"before (income )?tax", low) else 0
    s += 2 if re.search(r"earnings? per (equity )?share", low) else 0
    s += 2 if re.search(r"quarter ended|three months ended", low) else 0
    s += 1 if re.search(r"tax expense|income tax expense", low) else 0
    s += 1 if re.search(r"finance costs?|interest expended", low) else 0
    s += 2 if "consolidated" in head else 0
    s -= 2 if "standalone" in head and "consolidated" not in head else 0
    s -= 3 if re.search(r"segment (revenue|results|information|reporting)", head) else 0
    s -= 4 if re.search(r"cash flows?|assets and liabilities|balance sheet", head) else 0
    return s


def _pct(a, b):
    return round(100 * (a / b - 1), 1) if a is not None and b not in (None, 0) and b > 0 else None


def _quarter_end(filing_date):
    """Most recent quarter end on or before the filing date -> screener column label, e.g. 'Sep 2026'."""
    y, m = filing_date.year, filing_date.month
    q_m = ((m - 1) // 3) * 3          # last month of the previous calendar quarter
    if q_m == 0:
        y, q_m = y - 1, 12
    return dt.date(y, q_m, 1).strftime("%b %Y")


def screener_quarter(company, label):
    """Headline numbers for `label` from screener's standardised quarterly table (₹ crore)."""
    q = company.get("quarters") or {}
    cols, rows = q.get("cols", []), q.get("rows", {})
    if label not in cols:
        return None
    i = cols.index(label)
    if i < 4:
        return None
    fin = company.get("is_financial")
    idx = [i, i - 1, i - 4]

    def take(name):
        v = rows.get(name)
        return [v[j] if v else None for j in idx]
    return {
        "periods": [cols[j] for j in idx],
        "revenue": take("Revenue" if fin else "Sales"),
        "ebitda": None if fin else take("Operating Profit"),
        "pbt": take("Profit before tax"),
        "pat": take("Net Profit"),
    }


def _rows(d):
    out = []
    for key, name in (("revenue", "Revenue"), ("ebitda", "EBITDA"), ("pbt", "PBT"), ("pat", "PAT")):
        v = d.get(key)
        if not v or v[0] is None:
            continue
        out.append({"metric": name, "value": round(v[0], 1), "qoq": _pct(v[0], v[1]), "yoy": _pct(v[0], v[2])})
    return out


def results_card(item, company):
    """Numbers from the filing itself when it has a text layer; screener as cross-check or fallback."""
    label = _quarter_end(dt.date.fromisoformat(item["ts"][:10]))
    ref = screener_quarter(company, label)
    card = {"type": "results", "quarter": label, "source": None, "verified": None, "rows": [], "note": None}

    filing = None
    try:
        pages = pdftext.pages(item["pdf"])
    except Exception:
        pages = []
    # Pick the page that holds the statement of results, then send it with the page after it.
    best = max(range(len(pages)), key=lambda i: _page_score(pages[i]), default=None)
    if best is not None and _page_score(pages[best]) >= 6 and llm.available():
        body = "\n\n".join(pages[best:best + 2])[:12000]
        out = llm.chat_json(RESULTS_SYS, RESULTS_USER.format(name=company["name"], ticker=item["ticker"], body=body),
                            effort="low", max_tokens=1200, tag=f"results:{item['id']}")
        if out and isinstance(out.get("revenue"), list):
            k = _UNIT.get(str(out.get("unit", "crore")).lower(), 1.0)

            def arr(name):
                v = out.get(name)
                if not isinstance(v, list) or len(v) != 3:
                    return [None, None, None]
                return [None if _f(x) is None else _f(x) * k for x in v]
            rev, oi, fc, dep, pbt, pat = (arr(n) for n in ("revenue", "other_income", "finance_costs", "depreciation", "pbt", "pat"))
            ebitda = None
            if not company.get("is_financial") and all(x is not None for x in pbt + fc + dep):
                ebitda = [p + f + d - (o or 0) for p, f, d, o in zip(pbt, fc, dep, oi)]
            if rev[0] and pat[0] is not None:
                filing = {"revenue": rev, "ebitda": ebitda, "pbt": pbt, "pat": pat, "basis": out.get("basis")}

    def close(a, b, tol=0.03):
        return a is not None and b not in (None, 0) and abs(a / b - 1) < tol

    if filing and ref:
        # Trust the model's read of the filing only when it reconciles with the standardised table.
        card["verified"] = close(filing["revenue"][0], ref["revenue"][0]) and close(filing["pat"][0], ref["pat"][0])
    if filing and (card["verified"] or not ref):
        card["rows"] = _rows(filing)
        card["source"] = f"results filing ({filing.get('basis') or 'as reported'})"
        card["note"] = "reconciles with standardised financials" if card["verified"] else "not yet cross-checked"
        if not company.get("is_financial"):
            card["ebitda_def"] = "PBT + finance costs + depreciation − other income"
    elif ref:
        card["rows"] = _rows(ref)
        card["source"] = "standardised financials (screener.in)"
        card["note"] = ("filing is a scanned image" if not pages else
                        "filing read did not reconcile, so standardised figures are shown" if filing else
                        "filing table could not be read reliably, so standardised figures are shown")
        if not company.get("is_financial"):
            card["ebitda_def"] = "operating profit before other income"
    if company.get("is_financial"):
        card["note"] = ((card["note"] + "; ") if card["note"] else "") + "EBITDA is not meaningful for lenders"
    return card if card["rows"] else None


def generic(item, company):
    """Title, summary, materiality (and a person bio) from the first pages of the filing."""
    if not llm.available():
        return None
    try:
        pages = pdftext.pages(item["pdf"], max_pages=4)
    except Exception:
        pages = []
    body = "\n".join(pages)[:7000]
    if len(body) < 150:
        return None
    out = llm.chat_json(GENERIC_SYS, GENERIC_USER.format(name=company["name"], ticker=item["ticker"], desc=item["nse_desc"],
                                                         text=item["text"][:300], body=body, cats=CATS),
                        effort="low", max_tokens=700, tag=f"generic:{item['id']}")
    if not out or out.get("category") not in CATS:
        return None
    return out
