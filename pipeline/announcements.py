"""NSE corporate announcements feed -> normalised rows.

NSE's public JSON endpoint needs a browser-like session (cookies from the
filings page first). One session is reused for the whole portfolio.
"""
import time
import datetime as dt
import requests

PAGE = "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
API = "https://www.nseindia.com/api/corporate-announcements"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


class NSE:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update(HEADERS)
        self._warm()

    def _warm(self):
        self.s.get(PAGE, timeout=25)

    def announcements(self, symbol, start: dt.date, end: dt.date):
        params = {
            "index": "equities",
            "symbol": symbol,
            "from_date": start.strftime("%d-%m-%Y"),
            "to_date": end.strftime("%d-%m-%Y"),
        }
        last = None
        for _ in range(3):
            r = self.s.get(API, params=params, headers={"Referer": PAGE}, timeout=25)
            last = r.status_code
            if r.status_code == 200 and "json" in r.headers.get("content-type", ""):
                return [_normalise(x) for x in r.json()]
            time.sleep(1.5)
            self._warm()
        raise RuntimeError(f"NSE announcements for {symbol}: HTTP {last}")


def _normalise(x):
    ts = x.get("sort_date") or ""
    return {
        "id": str(x.get("seq_id")),
        "ticker": x.get("symbol"),
        "ts": ts.replace(" ", "T") + "+05:30" if ts else None,
        "nse_desc": (x.get("desc") or "").strip(),
        "text": " ".join((x.get("attchmntText") or "").split()),
        "pdf": x.get("attchmntFile"),
        "has_xbrl": bool(x.get("hasXbrl")),
    }


if __name__ == "__main__":
    import sys
    rows = NSE().announcements(sys.argv[1], dt.date.today() - dt.timedelta(days=int(sys.argv[2]) if len(sys.argv) > 2 else 90), dt.date.today())
    print(len(rows), "rows")
    for r in rows:
        print(r["ts"][:16], "|", r["nse_desc"][:40], "|", r["text"][:110])
