"""Deterministic company metrics from screener tables + Yahoo prices. No LLM."""
import bisect
import statistics
import datetime as dt

MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def _period_end(label):
    """'Sep 2026' -> date(2026, 9, 30)."""
    try:
        mon, year = label.split()
        m, y = MONTHS[mon], int(year)
    except (ValueError, KeyError):
        return None
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    return nxt - dt.timedelta(days=1)


def _row(table, *names):
    for n in names:
        v = (table or {}).get("rows", {}).get(n)
        if v:
            return v
    return None


def _last(v):
    return next((x for x in reversed(v or []) if x is not None), None)


def _cagr(series, years):
    s = [x for x in series if x is not None]
    if len(s) <= years or s[-1 - years] in (None, 0) or s[-1 - years] <= 0 or s[-1] <= 0:
        return None
    return round(100 * ((s[-1] / s[-1 - years]) ** (1 / years) - 1), 1)


def _range_pos(value, series):
    """Where `value` sits in its own history: percentile 0-100, plus min/median/max."""
    s = sorted(x for x in series if x is not None)
    if value is None or len(s) < 4:
        return None
    return {"pctile": round(100 * bisect.bisect_left(s, value) / len(s)), "min": round(s[0], 1),
            "median": round(statistics.median(s), 1), "max": round(s[-1], 1)}


def pe_band(company, prices):
    """Weekly P/E over ~5 years = close / trailing EPS known at that date.

    Trailing EPS uses the sum of the last 4 quarterly EPS where the quarterly table
    reaches (about 2.5 years), and annual EPS before that. Each figure is assumed to
    become public 45 days (quarter) or 60 days (year) after period end.
    """
    q, a = company.get("quarters"), company.get("annual")
    steps = []                                       # (effective_date, ttm_eps)
    a_eps = _row(a, "EPS in Rs")
    if a and a_eps:
        for label, eps in zip(a["cols"], a_eps):
            end = _period_end(label)
            if end and eps is not None:
                steps.append((end + dt.timedelta(days=60), eps))
    q_eps = _row(q, "EPS in Rs")
    if q and q_eps:
        for i in range(3, len(q["cols"])):
            window = q_eps[i - 3:i + 1]
            end = _period_end(q["cols"][i])
            if end and all(x is not None for x in window):
                steps.append((end + dt.timedelta(days=45), round(sum(window), 2)))
    steps.sort()
    if not steps or not prices:
        return None
    dates = [s[0] for s in steps]
    pts = []
    for r in prices[::5]:                            # weekly sample keeps the payload small
        d = dt.date.fromisoformat(r["d"])
        i = bisect.bisect_right(dates, d) - 1
        if i < 0:
            continue
        eps = steps[i][1]
        if eps and eps > 0:
            pe = r["c"] / eps
            if 0 < pe < 400:
                pts.append({"d": r["d"], "pe": round(pe, 1)})
    if len(pts) < 30:
        return None
    vals = [p["pe"] for p in pts]
    med, sd = statistics.median(vals), statistics.pstdev(vals)
    return {"points": pts, "median": round(med, 1), "plus1": round(med + sd, 1), "minus1": round(max(med - sd, 0), 1)}


def build(company, prices):
    q, a, bs, cf, rt, sh = (company.get(k) for k in ("quarters", "annual", "balance_sheet", "cash_flow", "ratios", "shareholding"))
    tr = company.get("top_ratios", {})
    fin = company.get("is_financial")
    price = prices[-1]["c"] if prices else tr.get("Current Price")
    mcap = tr.get("Market Cap")
    out = {"is_financial": fin}

    # ---- trajectory (annual) ----
    sales = _row(a, "Sales", "Revenue")
    op = _row(a, "Operating Profit", "Financing Profit")
    np_ = _row(a, "Net Profit")
    opm = _row(a, "OPM %", "Financing Margin %")
    years = a["cols"] if a else []
    has_ttm = bool(years) and years[-1] == "TTM"
    fy = slice(0, -1) if has_ttm else slice(None)
    out["trajectory"] = {
        "years": years[-11:], "sales": (sales or [])[-11:], "op_profit": (op or [])[-11:],
        "net_profit": (np_ or [])[-11:], "opm": (opm or [])[-11:],
        "sales_cagr_3y": _cagr((sales or [])[fy], 3), "sales_cagr_5y": _cagr((sales or [])[fy], 5),
        "profit_cagr_3y": _cagr((np_ or [])[fy], 3), "profit_cagr_5y": _cagr((np_ or [])[fy], 5),
    }

    # ---- snapshot ----
    ttm_sales, ttm_np, ttm_op = _last(sales), _last(np_), _last(op)
    out["snapshot"] = {
        "revenue_ttm": ttm_sales, "op_profit_ttm": ttm_op, "pat_ttm": ttm_np,
        "opm": _last(opm), "net_margin": round(100 * ttm_np / ttm_sales, 1) if ttm_sales and ttm_np is not None else None,
        "market_cap": mcap, "price": price,
    }

    # ---- balance sheet ----
    eq, res, bor = _row(bs, "Equity Capital"), _row(bs, "Reserves"), _row(bs, "Borrowings", "Borrowing")
    net_worth = [(e or 0) + (r or 0) if e is not None and r is not None else None for e, r in zip(eq or [], res or [])]
    de = [round(b / n, 2) if b is not None and n else None for b, n in zip(bor or [], net_worth)]
    out["balance_sheet"] = {
        "periods": (bs["cols"] if bs else [])[-6:], "borrowings": (bor or [])[-6:], "net_worth": net_worth[-6:],
        "debt_to_equity": de[-6:],
        "debtor_days": (_row(rt, "Debtor Days") or [])[-6:], "cash_conversion_cycle": (_row(rt, "Cash Conversion Cycle") or [])[-6:],
        "ratio_years": (rt["cols"] if rt else [])[-6:],
    }

    # ---- cash quality ----
    cfo, fcf = _row(cf, "Cash from Operating Activity"), _row(cf, "Free Cash Flow")
    cf_years = cf["cols"] if cf else []
    np_by_year = dict(zip(years, np_ or []))
    conv = [{"year": y, "cfo": c, "pat": np_by_year.get(y),
             "ratio": round(c / np_by_year[y], 2) if c is not None and np_by_year.get(y) and np_by_year[y] > 0 else None}
            for y, c in zip(cf_years, cfo or [])][-6:]

    def cum(n):
        rows = [r for r in conv[-n:] if r["cfo"] is not None and r["pat"]]
        return round(sum(r["cfo"] for r in rows) / sum(r["pat"] for r in rows), 2) if len(rows) == n and sum(r["pat"] for r in rows) > 0 else None
    out["cash_quality"] = {"by_year": conv, "cfo_to_pat_3y": cum(3), "cfo_to_pat_5y": cum(5), "fcf": (fcf or [])[-6:], "fcf_years": cf_years[-6:]}

    # ---- valuation ----
    band = pe_band(company, prices)
    pe = tr.get("Stock P/E")
    book = tr.get("Book Value")
    roce_hist = [x for x in (_row(rt, "ROCE %") or []) if x is not None]
    roe_hist = [round(100 * n / w, 1) if n is not None and w else None
                for n, w in zip((np_ or [])[fy][-len(net_worth):], net_worth[-len((np_ or [])[fy]):])] if net_worth and np_ else []
    latest_bor = _last(bor)
    ev = (mcap + latest_bor) if mcap and latest_bor is not None else None
    out["valuation"] = {
        "pe": pe, "pe_range": _range_pos(pe, [p["pe"] for p in band["points"]]) if band else None,
        "pb": round(price / book, 1) if price and book else None,
        "ev_ebitda": None if fin or not ev or not ttm_op or ttm_op <= 0 else round(ev / ttm_op, 1),
        "ev_note": "EV = market cap + borrowings; cash is not netted off",
        "roce": None if fin else tr.get("ROCE"), "roce_range": None if fin else _range_pos(tr.get("ROCE"), roce_hist[-6:]),
        "roe": tr.get("ROE"), "roe_range": _range_pos(tr.get("ROE"), [x for x in roe_hist if x is not None][-6:]),
        "dividend_yield": tr.get("Dividend Yield"),
        "pe_band": band,
    }

    # ---- ownership ----
    if sh:
        rows = {}
        for key, names in (("promoter", ("Promoters",)), ("fii", ("FIIs",)), ("dii", ("DIIs",)), ("government", ("Government",)), ("public", ("Public",))):
            v = _row(sh, *names)
            if v:
                rows[key] = v

        def chg(v, n):
            s = [x for x in v if x is not None]
            return round(s[-1] - s[-1 - n], 2) if len(s) > n else None
        out["ownership"] = {
            "quarters": sh["cols"], "series": rows,
            "latest": {k: _last(v) for k, v in rows.items()},
            "change_1q": {k: chg(v, 1) for k, v in rows.items()},
            "change_window": {k: chg(v, len([x for x in v if x is not None]) - 1) for k, v in rows.items()},
            "has_promoter": bool(rows.get("promoter")) and (_last(rows["promoter"]) or 0) > 0,
        }
    else:
        out["ownership"] = None
    return out
