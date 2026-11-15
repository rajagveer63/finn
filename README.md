# FINN

**What changed in your portfolio, and whether management kept its word.**

A mobile-first investor agent built for the ENAM "FINN" AI Engineer build challenge. Open it on a phone.

| Tab | What it does |
|---|---|
| **Brief** (Push, digest) | Filings and price moves for an 18-company portfolio, for the last 24h / 7d / 30d / 90d. Ranked by how surprising they are, not just by filing type. One card per story (follow-ups fold under the latest update). Routine filings are collapsed into one row. A 40-second spoken brief reads the top items, and each spoken line jumps to its card. |
| **Ledger** | The Promise Ledger. Every number management promised on its last six earnings calls, with the date and page it was said, what happened, and whether it was **kept, missed, revised or dropped**. Built for Infosys, HCLTech, L&T and Polycab, plus every company researched on demand. |
| **Research** (Pull) | Any NSE symbol. Valuation against the company's own five years (P/E, P/B, EV/EBITDA, ROCE, ROE, dividend yield, P/E band chart), shareholding over 12 quarters, revenue and profit trajectory, cash quality, and a bull / bear / watch list in which **every point carries a verbatim quote and page from a transcript**. |
| **Rules** (Push, alerts) | Thresholds you set on the phone: volume spike (×20-day average), daily price move (±%), FII change, promoter selling, P/E leaving its band, and which filing types alert you. The alert count for the last 30 days updates as you drag. "Send a test alert" fires a real notification. |

## Data: three sources, all primary

| Source | Used for |
|---|---|
| NSE corporate announcements (`nseindia.com/api/corporate-announcements`) and the filing PDFs | The Push feed; results tables; management-change bios read from the filing itself |
| Yahoo Finance via `yfinance` (end of day, `.NS`) | Price, volume, unusual moves, 5-year P/E band |
| screener.in company pages | Reported financials, ratios, shareholding, and the links to annual reports and earnings-call transcripts (hosted by BSE/NSE) |

Research never uses news, broker notes, or the model's memory of a company. Bull/bear points whose quote cannot be found on the cited transcript page are dropped before they are saved (`pipeline/research.py: grounded`).

## Architecture

```
GitHub Actions (cron, every 30 min on market days)          Vercel (Next.js 16, static + one API route)
  pipeline/build.py                                            web/  reads web/public/data/*.json
    prices.py      yfinance EOD                                      Brief / Ledger / Research / Rules
    screener.py    fundamentals + document links                     ranking + thresholds run on the phone
    announcements  NSE filings                                       (rules live in localStorage)
    classify.py    regex rules -> 17 categories, 3 tiers           /api/research?ticker=X
    enrich.py      LLM only where rules are unsure                    -> serves repo JSON if it exists
    metrics.py     valuation, ownership, cash quality                -> else starts research.yml (workflow_dispatch)
  pipeline/ledger.py    promises from transcripts + judge
  pipeline/research.py  any ticker: fundamentals + ledger + grounded snapshot
  -> commits web/public/data/*.json  ------------------------------>  redeploy
```

No database: the pipeline commits JSON, and the app reads static files. This makes the data diffable in git history and free to host.

## LLM use, and what it costs

- One model (`glm-5.3-flash` on an OpenAI-compatible endpoint), two effort settings: `low` for extraction, default for the ledger verdicts.
- **74% of filings are classified by rules, with no model call.** Of 681 filings in 90 days, 176 were read by a model. Routine filings never reach a model.
- Results numbers extracted by the model are **cross-checked against screener's reported table** (revenue and PAT within 3%). If they disagree, the reported table is shown with a note.
- Numeric guidance (FY revenue growth, margins) is judged by **arithmetic on reported financials** where possible, not by the model.
- Every call is cached on disk by prompt hash (`data/cache/llm/`), so reruns only pay for new filings.
- The spoken brief is built from templates and read by the phone's speech engine, so it costs nothing.
- Usage is shown in the app (Rules → What this cost to run).

## Run it locally

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # (bin/pip on mac/linux)
cp .env.example .env            # LLM_BASE_URL, LLM_API_KEY
python pipeline/build.py        # whole portfolio, ~2-3 minutes
python pipeline/ledger.py INFY  # one promise ledger
python pipeline/research.py TCS # research any NSE ticker
cd web && npm install && npm run dev
```

Deploy: import the repo in Vercel with **root directory `web`**. For on-demand research of new tickers, set `GH_DISPATCH_TOKEN` (a fine-grained token with Actions: write on this repo) in Vercel, and `LLM_BASE_URL` / `LLM_API_KEY` as GitHub Actions secrets.

## Known limits

- NSE often blocks cloud IP ranges. If the scheduled job cannot reach NSE, the feed keeps its last good data and the header shows when it last synced.
- Researching a new ticker takes 2-4 minutes the first time (it reads six transcripts); after that it loads instantly.
- Alerts are in-app and browser notifications while the app is open. Background Web Push was cut for time.
- Not investment advice.

See `docs/design.md` for the design decisions.
