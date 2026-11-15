"""Portfolio and demo configuration. The engine itself takes any NSE ticker."""

# 18 holdings: mixed sectors and sizes. `ledger` marks the companies whose
# management gives explicit numeric guidance, so the Promise Ledger goes deep there.
PORTFOLIO = [
    {"ticker": "RELIANCE", "sector": "Conglomerate", "size": "large"},
    {"ticker": "HDFCBANK", "sector": "Bank", "size": "large"},
    {"ticker": "BAJFINANCE", "sector": "NBFC", "size": "large"},
    {"ticker": "INFY", "sector": "IT services", "size": "large", "ledger": True},
    {"ticker": "HCLTECH", "sector": "IT services", "size": "large", "ledger": True},
    {"ticker": "PERSISTENT", "sector": "IT services", "size": "mid"},
    {"ticker": "TATAELXSI", "sector": "Engineering R&D", "size": "mid"},
    {"ticker": "LT", "sector": "Capital goods", "size": "large", "ledger": True},
    {"ticker": "POLYCAB", "sector": "Cables & wires", "size": "mid", "ledger": True},
    {"ticker": "DIXON", "sector": "Electronics manufacturing", "size": "mid"},
    {"ticker": "SUNPHARMA", "sector": "Pharma", "size": "large"},
    {"ticker": "MARUTI", "sector": "Auto", "size": "large"},
    {"ticker": "TITAN", "sector": "Consumer", "size": "large"},
    {"ticker": "ITC", "sector": "FMCG", "size": "large"},
    {"ticker": "BHARTIARTL", "sector": "Telecom", "size": "large"},
    {"ticker": "ULTRACEMCO", "sector": "Cement", "size": "large"},
    {"ticker": "PIIND", "sector": "Agrochemicals", "size": "mid"},
    {"ticker": "ZEEL", "sector": "Media", "size": "small"},
]

# Outside the portfolio: used to demo on-demand research.
ADHOC = ["TCS", "ASIANPAINT", "TRENT", "KEI"]

TICKERS = [c["ticker"] for c in PORTFOLIO]
