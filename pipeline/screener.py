"""screener.in company page -> structured dict.

One HTTP request per company gives the headline ratios, the standardised
financial tables, shareholding, and links to the primary documents
(annual reports + concall transcripts). No LLM involved.
"""
import re
import requests
from bs4 import BeautifulSoup

UA = {"User-Agent": "Mozilla/5.0 (FINN research prototype)"}
TABLES = {
    "quarters": "quarters",
    "profit-loss": "annual",
    "balance-sheet": "balance_sheet",
    "cash-flow": "cash_flow",
    "ratios": "ratios",
    "shareholding": "shareholding",
}


def _num(text):
    t = text.replace(",", "").replace("%", "").replace("₹", "").replace("Cr.", "").strip()
    if t in ("", "-", "--"):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _label(text):
    return re.sub(r"\s*\+$", "", " ".join(text.split())).strip()


def _table(section):
    tb = section.select_one("table") if section else None
    if not tb:
        return None
    cols = [th.get_text(strip=True) for th in tb.select("thead th")][1:]
    rows = {}
    for tr in tb.select("tbody tr"):
        tds = tr.select("td")
        if len(tds) < 2:
            continue
        label = _label(tds[0].get_text(" ", strip=True))
        if label == "Raw PDF":
            rows["_pdf"] = [(td.select_one("a") or {}).get("href") if td.select_one("a") else None for td in tds[1:]]
            continue
        rows[label.split(" Share of")[0]] = [_num(td.get_text(strip=True)) for td in tds[1:]]
    return {"cols": cols, "rows": rows} if cols else None


def _get(ticker, consolidated):
    url = f"https://www.screener.in/company/{ticker}/" + ("consolidated/" if consolidated else "")
    r = requests.get(url, headers=UA, timeout=30)
    if r.status_code == 404:
        raise LookupError(f"{ticker}: not found on screener.in")
    r.raise_for_status()
    return BeautifulSoup(r.text, "lxml")


def fetch(ticker):
    ticker = ticker.upper().strip()
    soup, basis = _get(ticker, True), "consolidated"
    q = _table(soup.select_one("#quarters"))
    if not q or not any(v is not None for v in q["rows"].get("Net Profit", [])):
        soup, basis = _get(ticker, False), "standalone"

    out = {"ticker": ticker, "basis": basis, "source": "screener.in"}
    h1 = soup.select_one("h1")
    out["name"] = h1.get_text(strip=True) if h1 else ticker
    about = soup.select_one(".company-profile .about")
    out["about"] = " ".join(about.get_text(" ", strip=True).split()) if about else None

    out["bse_code"] = None
    link = soup.find("a", href=re.compile(r"bseindia\.com/stock-share-price/"))
    if link:
        m = re.search(r"/(\d{6})/?$", link["href"])
        out["bse_code"] = m.group(1) if m else None

    ratios = {}
    for li in soup.select("#top-ratios li"):
        name = li.select_one(".name")
        nums = [_num(n.get_text(strip=True)) for n in li.select(".number")]
        if name and nums:
            ratios[name.get_text(strip=True)] = nums[0] if len(nums) == 1 else nums
    out["top_ratios"] = ratios

    for sec_id, key in TABLES.items():
        out[key] = _table(soup.select_one(f"#{sec_id}"))

    docs = {"annual_reports": [], "concalls": [], "credit_ratings": []}
    for a in soup.select(".documents.annual-reports a"):
        title = " ".join(a.get_text(" ", strip=True).split())
        m = re.search(r"(20\d\d)", title)
        if m and a.get("href"):
            docs["annual_reports"].append({"year": int(m.group(1)), "url": a["href"]})
    for li in soup.select(".documents.concalls li"):
        period = li.find(string=re.compile(r"[A-Z][a-z]{2}\s+20\d\d"))
        link = next((a["href"] for a in li.select("a") if a.get_text(strip=True) == "Transcript" and a.get("href")), None)
        if period and link:
            docs["concalls"].append({"period": " ".join(period.split()), "url": link})
    for a in soup.select(".documents.credit-ratings a"):
        docs["credit_ratings"].append({"title": " ".join(a.get_text(" ", strip=True).split()), "url": a.get("href")})
    out["documents"] = docs

    out["is_financial"] = "Financing Profit" in (out["quarters"] or {}).get("rows", {})
    return out


if __name__ == "__main__":
    import json, sys
    d = fetch(sys.argv[1])
    print(json.dumps({k: d[k] for k in ("ticker", "name", "basis", "bse_code", "top_ratios", "is_financial")}, ensure_ascii=False))
    print("quarters:", d["quarters"]["cols"][-3:], list(d["quarters"]["rows"])[:12])
    print("docs:", len(d["documents"]["annual_reports"]), "ARs,", len(d["documents"]["concalls"]), "transcripts;", d["documents"]["concalls"][:2])
