"""Rule-based classifier for exchange filings. No LLM.

Maps NSE's own subject line + headline onto ENAM's 17 categories, then assigns
a tier:  1 = read now, 2 = worth a line, 3 = routine (collapsed in the UI).
Category only sets the starting tier; `surprise` rules move it (a rating
"reaffirmed" is routine, a downgrade is not).

`confident=False` marks rows the rules could not place; only those go to the LLM.
"""
import re

TIER = {
    "results": 1, "M&A": 1, "fund_raise": 1, "management_change": 1, "litigation": 1,
    "credit_rating": 1, "pledging": 1,
    "capex": 2, "insider_trading": 2, "press_release": 2, "dividend": 2, "bonus_split": 2,
    "earnings_call": 2,
    "investor_meetings": 3, "postal_ballot": 3, "agm_egm": 3, "unclassified": 3,
}

LABEL = {
    "results": "Results", "M&A": "M&A", "fund_raise": "Fund raise", "management_change": "Management",
    "litigation": "Legal / regulatory", "credit_rating": "Credit rating", "pledging": "Pledge",
    "capex": "Capex", "insider_trading": "Insider trade", "press_release": "Company update",
    "dividend": "Dividend", "bonus_split": "Bonus / split", "earnings_call": "Earnings call",
    "investor_meetings": "Investor meeting", "postal_ballot": "Postal ballot", "agm_egm": "AGM / EGM",
    "unclassified": "Routine",
}


def _has(pattern, text):
    return re.search(pattern, text, re.I) is not None


def clean_title(text):
    """Strip the exchange boilerplate so the headline reads as a one-liner."""
    t = re.sub(r"^.{0,80}?\b(has|have)\s+(informed|submitted|intimated)\s+(to\s+)?(the\s+)?Exchange,?\s*(a copy\s+)?(regarding|about|that|on|of)?\s*", "", text, flags=re.I)
    t = re.sub(r"^(a |the )?press release dated .{0,40}?titled\s*", "", t, flags=re.I)
    t = t.replace("''", "'").strip(" '\"“”.")
    return (t[:1].upper() + t[1:]) if t else text


def classify(nse_desc, text, is_financial=False):
    d, t = nse_desc or "", text or ""
    both = f"{d} | {t}"
    sub, tier, cat, confident = None, None, None, True

    # --- routine paperwork first: these subjects are never material ---
    if _has(r"ESOP|ESOS|ESPS|trading window|certificate under SEBI|loss of share cert|duplicate share|"
            r"compliance certificate|regulation 74|regulation 40\(9\)|investor grievance|BRSR|"
            r"business responsibility|sustainability report|ESG rating|change in (RTA|registered office)|"
            r"secretarial compliance|shareholding pattern|corporate governance report|"
            r"statement of deviation|book closure|monitoring agency|stock options?|restricted stock|"
            r"submission of certificate|certificate obtained|registrar and share transfer|\bAOA\b|\bMOA\b|"
            r"articles of association|memorandum of association", both):
        cat = "unclassified"
    elif _has(r"newspaper (publication|advertis|clipping)", both):
        cat, sub, tier = ("results", "newspaper_ad", 3) if _has(r"result|financial", t) else ("unclassified", "newspaper_ad", 3)
    # --- earnings call vs investor meetings (NSE files both under one subject) ---
    elif _has(r"transcript|link of recording|audio recording|recording of (the )?(earnings|conference|analyst)|earnings (conference )?call", both):
        cat, sub = "earnings_call", ("transcript" if _has(r"transcript", t) else "recording" if _has(r"recording", t) else "notice")
        tier = 2 if sub == "transcript" else 3
    elif _has(r"analyst|institutional investor|investor(s)?\)? ?meet|investor conference|schedule of meet|con\. ?call", both):
        cat = "investor_meetings"
    # --- results ---
    elif _has(r"financial results?|unaudited .*(results|financial statements)|audited .*results|auditors? .*report.*quarter|"
              r"earnings presentation|investor presentation|results? presentation|report of auditors|"
              r"(to|will) (announce|consider|declare).{0,40}results", both):
        cat = "results"
        if _has(r"presentation", t):
            sub, tier = "presentation", 2
        elif _has(r"to (announce|consider|declare)|board meeting intimation|will be held|date of (the )?board", both):
            sub, tier = "date_notice", 3
        elif _has(r"auditor|condensed|interim .*financial statements", t) and not _has(r"outcome of board", d):
            sub, tier = "supporting_doc", 3
        else:
            sub = "filing"
    elif _has(r"board meeting intimation|intimation of board meeting", both):
        cat, sub = "results" if _has(r"result", t) else "unclassified", "date_notice"
        tier = 3
    # --- legal / regulatory ---
    elif _has(r"insolvency|NCLT|NCLAT|litigation|show cause|penalt|SEBI order|adjudicat|arbitration|"
              r"\bcourt\b|tribunal|tax demand|GST (demand|order)|demand order|income tax order|settlement order|"
              r"regulatory (action|order)|\bsearch (and|operation)|seizure|\bfraud|\bdefault(ed)?\b", both):
        cat = "litigation"
        if _has(r"tax demand|GST|income tax|demand order", both) and not _has(r"insolvency|NCLT|SEBI|fraud", both):
            tier = 2
    # --- people ---
    elif _has(r"change in (director|management|directorate|KMP|key managerial)|appoint|resign|cessation|"
              r"retire|step(s|ped)? down|demise|superannuat", both):
        if _has(r"auditor", t) and not _has(r"director|chief|CEO|CFO|officer", t):
            cat = "unclassified"
        else:
            cat = "management_change"
            if _has(r"company secretary|senior management|\bSMP\b|compliance officer", t) and not _has(r"\b(CEO|CFO|MD)\b|chief (executive|financial)|managing director|chair", t):
                tier = 2
    # --- capital & ownership ---
    elif _has(r"pledg|encumbr", both):
        cat = "pledging"
    elif _has(r"credit rating|\brating (action|update|rationale)|\b(CRISIL|ICRA|CareEdge|CARE Ratings|India Ratings)\b", both):
        cat = "credit_rating"
        if _has(r"reaffirm|re-affirm|affirm", t) and not _has(r"upgrad|downgrad|revis|outlook (changed|revised)|watch", t):
            tier, sub = 3, "reaffirmed"
        elif _has(r"upgrad|downgrad|revis|watch", t):
            sub = "changed"
        else:
            tier, sub = 2, "update"
    elif _has(r"acqui|merger|amalgamat|demerger|scheme of arrangement|joint venture|divest|stake (sale|purchase)|"
              r"slump sale|incorporation of|wholly.owned subsidiary|investment in .*subsidiar|takeover|open offer|"
              r"initial public offer|\bIPO\b|red herring|business transfer", both):
        cat = "M&A"
        if _has(r"acquisition of shares by|SAST|regulation 29|regulation 7", both):
            cat = "insider_trading"
    elif _has(r"insider trading|regulation 7\(2\)|SAST|regulation 29|PIT regulations|promoter (group )?(buy|sell|acquir|dispos)", both):
        cat = "insider_trading"
    elif _has(r"QIP|qualified institution|preferential|rights issue|buy.?back|commercial paper|"
              r"debenture|\bNCDs?\b|non.convertible|fund rais|raising of funds|\bbonds?\b|warrants|issue of securities|"
              r"allotment of (securities|equity shares on)", both):
        cat = "fund_raise"
        if _has(r"debenture|\bNCDs?\b|non.convertible|\bbonds?\b", t) and not _has(r"QIP|qualified|preferential|rights|buy.?back|warrant", t):
            # Debt is a lender's raw material: routine there, worth one line elsewhere.
            tier, sub = (3 if is_financial else 2), "debt"
        elif _has(r"commercial paper|redemption|interest payment|record date for", t):
            tier = 3
    elif _has(r"bonus|stock split|sub-?division of", both):
        cat = "bonus_split"
    elif _has(r"dividend|record date", both):
        cat = "dividend"
    elif _has(r"postal ballot", both):
        cat = "postal_ballot"
    elif _has(r"\bAGM\b|\bEGM\b|general meeting|shareholders? meeting|scrutini[sz]er|voting results", both):
        cat = "agm_egm"
    elif _has(r"capex|capacity (expansion|addition)|new (plant|facility|unit)|commission|greenfield|brownfield|"
              r"commercial production|expansion of", both):
        cat = "capex"
    elif _has(r"press release|order|contract|wins?|bags?|award|launch|partner|collaborat|agreement|clarification|"
              r"\bMoU\b|monthly (business )?update|sales (volume|update)|production update", both):
        cat = "press_release"
        if _has(r"prize|award(ed|s)? (by|to|for)|CSR|foundation|recogni[sz]ed|ranked|winners of", t):
            tier, sub = 3, "pr_fluff"
    else:
        cat, confident = "press_release", False  # generic "Updates": let the LLM look

    return {
        "category": cat,
        "label": LABEL[cat],
        "sub": sub,
        "tier": tier if tier is not None else TIER[cat],
        "confident": confident,
        "title": clean_title(t),
    }


if __name__ == "__main__":
    import sys, datetime as dt, collections
    from announcements import NSE
    nse, total, unsure = NSE(), 0, 0
    counts = collections.Counter()
    for sym in sys.argv[1:]:
        for r in nse.announcements(sym, dt.date.today() - dt.timedelta(days=90), dt.date.today()):
            c = classify(r["nse_desc"], r["text"])
            total += 1; unsure += not c["confident"]; counts[(c["tier"], c["category"])] += 1
            flag = " " if c["confident"] else "?"
            print(f"T{c['tier']}{flag} {c['category']:<18} {sym:<10} {r['ts'][:10]} | {c['title'][:95]}")
    print(f"\n{total} filings, {unsure} unsure ({100 * unsure // max(total, 1)}%)")
    for (tier, cat), n in sorted(counts.items()):
        print(f"  T{tier} {cat:<18} {n}")
