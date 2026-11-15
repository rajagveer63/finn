"""End-of-day price and volume from Yahoo Finance (yfinance, .NS suffix)."""
import statistics
import yfinance as yf


def history(tickers, period="5y"):
    """-> {ticker: [{"d": "YYYY-MM-DD", "c": close, "v": volume}, ...]} oldest first."""
    df = yf.download([t + ".NS" for t in tickers], period=period, auto_adjust=False,
                     group_by="ticker", threads=True, progress=False)
    out = {}
    for t in tickers:
        try:
            sub = df[t + ".NS"][["Close", "Volume"]].dropna()
        except KeyError:
            continue
        rows = [{"d": idx.strftime("%Y-%m-%d"), "c": round(float(c), 2), "v": int(v)}
                for idx, (c, v) in zip(sub.index, sub.values) if c == c and v > 0]
        if rows:
            out[t] = rows
    return out


def moves(rows, keep=130, lookback=20):
    """Daily % move and volume multiple vs the prior `lookback` normal sessions.

    Special sessions (weekend dates such as Diwali Muhurat trading, or volume far
    below normal) are flagged and left out of the baseline, so they neither fire
    nor distort the "unusual volume" rule.
    """
    import datetime as dt
    out, normal = [], []
    for i, r in enumerate(rows):
        base = normal[-lookback:]
        avg = statistics.fmean(base) if len(base) >= 5 else None
        weekday = dt.date.fromisoformat(r["d"]).weekday()
        special = weekday >= 5 or (avg is not None and r["v"] < 0.2 * avg)
        prev = rows[i - 1]["c"] if i else None
        out.append({
            "d": r["d"], "c": r["c"], "v": r["v"],
            "pct": round(100 * (r["c"] / prev - 1), 2) if prev else None,
            "volx": round(r["v"] / avg, 2) if avg and not special else None,
            "special": special,
        })
        if not special:
            normal.append(r["v"])
    return out[-keep:]


if __name__ == "__main__":
    import sys
    h = history(sys.argv[1:] or ["INFY"], period="6mo")
    for t, rows in h.items():
        m = moves(rows)
        print(t, len(rows), "rows; last", m[-1])
        print("  unusual (>=2x or |pct|>=5):", [(x["d"], x["pct"], x["volx"]) for x in m if (x["volx"] or 0) >= 2 or abs(x["pct"] or 0) >= 5])
        print("  special sessions:", [x["d"] for x in m if x["special"]])
