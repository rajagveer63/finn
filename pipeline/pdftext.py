"""Download a filing PDF once and return its text per page. Scanned PDFs return []."""
import io
import hashlib
import pathlib
import requests
from pypdf import PdfReader

ROOT = pathlib.Path(__file__).resolve().parents[1]
STORE = ROOT / ".cache" / "pdf"          # raw PDFs: local only, not committed
TEXT = ROOT / ".cache" / "text"
STORE.mkdir(parents=True, exist_ok=True)
TEXT.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
    "Accept": "application/pdf,*/*",
}


def pages(url, max_pages=None):
    import json
    h = hashlib.sha256(url.encode()).hexdigest()[:24]
    tf = TEXT / f"{h}.json"
    if tf.exists():
        out = json.loads(tf.read_text(encoding="utf-8"))
        return out[:max_pages] if max_pages else out
    pf = STORE / f"{h}.pdf"
    if not pf.exists():
        ref = "https://www.bseindia.com/" if "bseindia" in url else "https://www.nseindia.com/"
        r = requests.get(url.split("#")[0], headers={**HEADERS, "Referer": ref}, timeout=90)
        r.raise_for_status()
        if not r.content.startswith(b"%PDF"):
            raise ValueError(f"not a PDF ({r.headers.get('content-type')})")
        pf.write_bytes(r.content)
    out = []
    try:
        reader = PdfReader(io.BytesIO(pf.read_bytes()))
        for p in reader.pages:
            try:
                out.append(" ".join((p.extract_text() or "").split()))
            except Exception:
                out.append("")
    except Exception:
        out = []
    if sum(len(x) for x in out) < 200:      # image-only scan
        out = []
    tf.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out[:max_pages] if max_pages else out


if __name__ == "__main__":
    import sys
    ps = pages(sys.argv[1])
    print(len(ps), "pages;", sum(len(x) for x in ps), "chars")
    for i, p in enumerate(ps[:3]):
        print(f"--- p{i + 1} ---", p[:500])
