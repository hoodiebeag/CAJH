"""
sp500-pointintime.py -- build a survivorship-free S&P 500 bundle, for free, from a Colab cell.

WHY THIS EXISTS. The first equities bundle was thirty symbols chosen by hand, and the
matched-geometry null showed its $15,873 was the universe rather than the strategy: a random entry
with the same exits earned 0.5751R against 0.5814R, p=0.47. The obvious fix was point-in-time index
data, which is normally sold (Norgate, Sharadar, CRSP). It does not have to be. The S&P 500's
membership changes are public, so the index as it stood on a past date can be RECONSTRUCTED:
take today's members, then walk the change log backwards, discarding everything added since the
date and restoring everything removed.

WHAT THAT BUYS. The reconstructed list contains the companies that failed -- SVB and First Republic
in 2023, Bed Bath & Beyond, and roughly sixty others deleted since -- which is exactly the
population a trend gate exists to avoid and exactly what a hand-picked list of today's winners
cannot contain. It is the universe that tests EQUITIES-LAGGARD-EXCESS-2026-09.

WHAT IT DOES NOT BUY, stated because a free substitute should not be sold as the paid thing.
Wikipedia's change table is not a guaranteed-complete corporate-actions record, and Yahoo does not
serve history for every delisted ticker. Both leave residual survivorship. So the script MEASURES
the residue: manifest.json records every symbol that could not be downloaded and the percentage it
represents. A few percent is noise; a large fraction means the bundle is still biased and the
result should be reported as such rather than quietly used.

Prices are RAW, auto_adjust=False. Adjustment rewrites historical price levels and therefore
historical stop distances, and stop distance is the variable this whole project turns on.
"""

# Paste into one Colab cell (hosted runtime) and run. ~5 minutes.
!pip -q install yfinance
import pandas as pd, yfinance as yf, os, tarfile, json, datetime

AS_OF = "2023-01-01"

# 1. Current members + the change log, straight from Wikipedia.
tables = pd.read_html("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
current = set(tables[0]["Symbol"].astype(str).str.strip())
chg = tables[1].copy()
chg.columns = ["_".join(str(x) for x in c) if isinstance(c, tuple) else str(c) for c in chg.columns]
date_col  = [c for c in chg.columns if "Date"    in c][0]
added_col = [c for c in chg.columns if "Added"   in c and "Ticker" in c][0]
rmvd_col  = [c for c in chg.columns if "Removed" in c and "Ticker" in c][0]
chg[date_col] = pd.to_datetime(chg[date_col], errors="coerce")
chg = chg.dropna(subset=[date_col]).sort_values(date_col, ascending=False)

# 2. Rewind to AS_OF: undo each change newest-first.
members = set(current)
for _, r in chg[chg[date_col] >= AS_OF].iterrows():
    a, d = str(r[added_col]).strip(), str(r[rmvd_col]).strip()
    if a and a.lower() != "nan": members.discard(a)   # added after AS_OF -> was not a member
    if d and d.lower() != "nan": members.add(d)       # removed after AS_OF -> was a member
members = sorted(s.replace(".", "-") for s in members if s and s.lower() != "nan")
print(f"S&P 500 membership reconstructed as of {AS_OF}: {len(members)} symbols")
print(f"  of which no longer in the index today: {len([m for m in members if m not in current])}")

# 3. Download. Track what Yahoo will not serve -- that is the residual bias, and it gets measured.
os.makedirs("candle-bundle/1440", exist_ok=True)
got, missing = [], []
for i in range(0, len(members), 50):
    batch = members[i:i+50]
    data = yf.download(batch, start=AS_OF, auto_adjust=False, progress=False,
                       group_by="ticker", threads=True)
    for s in batch:
        try:
            df = data[s].dropna(subset=["Open","High","Low","Close"])
        except Exception:
            missing.append(s); continue
        if len(df) < 120:
            missing.append(s); continue
        out = df[["Open","High","Low","Close","Volume"]].copy()
        out.columns = ["open","high","low","close","volume"]
        out.insert(0, "time", df.index.astype("int64") // 10**9)
        out.to_csv(f"candle-bundle/1440/{s}.csv", index=False)
        got.append(s)
    print(f"  {i+len(batch)}/{len(members)}  kept {len(got)}  missing {len(missing)}")

# 4. The manifest is part of the deliverable: it is what makes the bias measurable.
manifest = {
    "asOf": AS_OF, "rule": "S&P 500 membership on AS_OF, reconstructed from Wikipedia's change log",
    "reconstructedCount": len(members), "downloaded": len(got),
    "missing": missing, "missingPct": round(100*len(missing)/len(members), 1),
    "noLongerInIndexToday": sorted(m for m in members if m not in current),
    "builtAt": datetime.datetime.utcnow().isoformat() + "Z",
}
json.dump(manifest, open("candle-bundle/manifest.json","w"), indent=1)
print(f"\nmissing {len(missing)}/{len(members)} ({manifest['missingPct']}%) — send this number, it bounds the residual bias")

with tarfile.open("sp500.tar.gz","w:gz") as t: t.add("candle-bundle")
from google.colab import files; files.download("sp500.tar.gz")
