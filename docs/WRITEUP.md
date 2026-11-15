Subject: IIT Delhi – AI Engineer - 2027

Hello,

My FINN submission:

- Prototype (open on a phone): <VERCEL_URL>
- Code: https://github.com/rajagveer63/finn
- AI build history: <LINK_OR_ATTACHMENT>

**What I built**
FINN answers two questions for an investor: what changed in my portfolio, and is management doing what it said it would.
- Brief (Push): filings and unusual price moves for an 18-company portfolio, for the last 24h / 7d / 30d / 90d. Items are ranked by surprise, not just by filing type. Follow-ups fold into one story, and routine filings collapse into a single row. A 40-second spoken brief reads the top items.
- Rules (Push alerts): thresholds set on the phone (volume × 20-day average, price ±%, FII change, promoter selling, P/E leaving its 5-year band, and which filing types alert). The 30-day alert count updates as you drag.
- Promise Ledger: every target management gave on its last six earnings calls, with the date, page and quote, marked kept, missed, revised or dropped. Example: Infosys cut its FY27 revenue guidance twice (1.5–3.5% → 1.5–3% → 1–2%). L&T missed its FY26 15% revenue guidance (11.8%) after reaffirming it four times.
- Research (Pull): any NSE symbol. Valuation against the company's own five years (P/E band chart, P/B, EV/EBITDA, ROCE, ROE, yield), 12 quarters of shareholding, trajectory, cash quality, and bull / bear / watch points. Each point carries a verbatim quote from a transcript or annual report. Ad-hoc companies: TCS, Asian Paints, Trent, KEI.

**Key decisions and trade-offs**
- Grounding is enforced in code, not just asked for in the prompt. A research point whose quote is not on the page it cites is dropped. Model-extracted results are kept only if revenue and PAT match the reported table within 3%; otherwise the table is shown. Margin and growth guidance is judged by arithmetic on reported numbers where possible.
- Rules first, model second. 74% of filings are classified by regex. Of 681 filings over 90 days, 176 reached a model. All calls are cached by prompt hash, and the spoken brief is built from templates, so it costs nothing. One small model at two effort settings; the cost is shown in the app.
- No database. A scheduled GitHub Action writes JSON into the repo and the app reads static files. It is cheap, diffable and fast on a phone. The cost is that new data needs a redeploy, and research on a new ticker takes 2–4 minutes the first time.
- Ranking and alert thresholds run on the phone, so changing a rule needs no server and no account.

**What I left out on purpose**
Background Web Push (alerts work in-app and as browser notifications while the app is open); user accounts and a server-side portfolio; BSE as a separate feed (its API refused automated access; NSE covers the portfolio); a promise ledger for all 18 holdings (built for 4, plus every company researched on demand); intraday prices.

**Where I'd take it next**
Background push with a quiet-hours digest; a ledger for every holding, refreshed the day each transcript lands; cross-company reads (e.g. every IT company cutting guidance in the same quarter); scoring each management team's guidance accuracy over several years, so "they said 15%" can be discounted by their own track record.

Known limit: NSE often blocks cloud IP ranges. If the scheduled job cannot reach NSE, the app keeps its last good data and shows when it last synced.

Thank you,
<NAME>
