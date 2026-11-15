# ENAM submission checklist

Source: "FINN: Financial Investment Agent - AI Engineer Build Challenge" (released 8 Nov 2026).

## How to submit

- **Email to:** assessment@enam.com
- **Subject line, exactly:** `IIT Delhi – AI Engineer - 2027`
- **Deadline:** 15 November 2026 (the brief gives no hour)
- Links and attachments go in that one email. The writeup goes in the email body.

## The four things the email must contain

1. **The mobile-first prototype.** "A deployed link, Expo/TestFlight, or responsive web; however you ship it, make it easy for us to try on a phone."
   - Ours: a Vercel URL. Must open on a phone with no login.
2. **The GitHub repository.**
   - Ours: public repo link. No secrets committed.
3. **Your AI build history.** "The coding-agent and LLM conversations you used while building (e.g. Claude Code, Cursor, or ChatGPT exports / share links). We want to see how you work with the tools, not just the finished code."
   - Ours: Claude Code session exports, with the API key redacted.
4. **A short writeup, in the covering email.** It must cover four points:
   - what you built
   - the key decisions and trade-offs
   - what you deliberately left out
   - where you'd take it next

## What the prototype itself must show

- [ ] Mock portfolio of **15 to 20** NSE/BSE-listed companies, mixed sectors and sizes
- [ ] **3 to 5** ad-hoc research companies, which can be outside the portfolio
- [ ] Research works on **any NSE ticker** where data exists ("We may point it at a company you didn't pick")
- [ ] Three data sources working: EOD price and volume, NSE/BSE announcements, annual reports + concall transcripts
- [ ] **Push, windowed digest:** default last 24 hours, user can pick the period, prioritised, routine items collapsed or hidden
- [ ] **Push, triggered alerts:** material announcement types, and unusual EOD moves (volume about 2× recent average, price beyond ±X%) with a **user-configurable threshold**
- [ ] **Pull:** on-demand company analysis grounded only in annual reports and transcripts. No broker notes, no news, no research reports, no model memory of the company
- [ ] Mobile-first throughout

## What they said they love (examples, not requirements)

- Management change: a short bio of the incoming person, not just "CFO resigned"
- Quarterly results: Revenue, EBITDA, PBT, PAT, this quarter vs last quarter (QoQ) and vs the same quarter last year (YoY)
- Numbers vs narrative: last four quarters, what management promised vs what was delivered. "The kind of thing we value most."
- Experimenting with the interaction model: "try more than the obvious"

## How they grade

- Creativity, product sense, judgment, architecture. **Not completeness.**
- "Thin-but-working beats broad-but-broken." "A demo that doesn't run is the worst outcome."
- "No AI slop": concise, beautifully presented, interactive. Density and design both count.
- **Bonus for efficiency:** cheap models for bulk work, a stronger model only where needed, caching, chunking. Doable on free tiers.
