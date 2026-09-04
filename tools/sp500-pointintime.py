"""
sp500-pointintime.py -- reconstruct an S&P 500 universe as of a past date, for free, from Colab.

WHY. The first equities bundle was thirty symbols chosen by hand, and the matched-geometry null
showed its $15,873 was the universe rather than the strategy: a random entry with the same exits
earned 0.5751R against 0.5814R, p=0.47. Split by outcome, the strategy was WORSE than random on
the ten best performers and better on the ten worst. That is the registered hypothesis
EQUITIES-LAGGARD-EXCESS-2026-09: the value is in declining to hold falling names, and a universe
of survivors cannot test it because it contains almost nothing that fell.

WHAT THIS PRODUCES, and the honest split between its two halves.

  MECHANICAL, and trustworthy. Wikipedia's constituents table carries a "Date added" column, so
  every current member that JOINED after the as-of date can be removed by rule. That strips out
  the sixty-odd companies which entered the index because they did well -- a large part of the
  bias -- with no judgement involved.

  SUPPLIED, and weak. The names that LEFT the index are not recoverable from that page: it used
  to carry a "Selected changes" table and no longer does (checked 2026-09-04, the page returns
  two tables and the second is a navbox). So DEPARTED is written out by hand. It is incomplete,
  and its incompleteness IS the residual survivorship bias. The manifest reports how many of them
  resolved, which bounds what got in; it cannot bound what was never listed.

So this is better than a hand-picked basket of winners and worse than a vendor's point-in-time
file. Results from it must be labelled that way rather than called survivorship-free.

Prices are raw, auto_adjust=False. Adjustment rewrites historical price levels and therefore
historical stop distances, and stop distance is the variable this whole project turns on.

Every step prints [0]..[7]; a run that stops names the step it stopped on.
"""

# Paste into a Colab cell. Prints [0]..[7]; send the last line if it stops.
import sys, subprocess
def step(n, what): print(f"[{n}] {what}", flush=True)
step(0, f"python {sys.version.split()[0]} starting")
try: import yfinance
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "yfinance"], check=True)
import pandas as pd, yfinance as yf, requests, io, os, tarfile, json, datetime
step(1, f"imports ok — pandas {pd.__version__}, yfinance {yf.__version__}")

AS_OF = "2023-01-01"

# --- Half one, MECHANICAL: current members, minus everything added after AS_OF. ----------------
# The page's "Selected changes" table is gone, but the constituents table carries "Date added",
# which is all that is needed to strip out names that were not members on AS_OF.
resp = requests.get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
                    headers={"User-Agent": "Mozilla/5.0 (research script)"}, timeout=30)
resp.raise_for_status()
tbl = pd.read_html(io.StringIO(resp.text))[0]
step(2, f"{len(tbl)} current constituents fetched")

tbl["added"] = pd.to_datetime(tbl["Date added"], errors="coerce")
# A missing date means a long-standing member: keep it. Only a date AFTER AS_OF disqualifies.
held_on_asof = tbl[~(tbl["added"] >= AS_OF)]["Symbol"].astype(str).str.strip().tolist()
dropped = len(tbl) - len(held_on_asof)
step(3, f"{len(held_on_asof)} were members on {AS_OF}; dropped {dropped} added since")

# --- Half two, SUPPLIED: names that have LEFT the index since AS_OF. ---------------------------
# These cannot be recovered from the page any more, so they are listed explicitly. This list is
# assembled from recall, is certainly incomplete, and its incompleteness IS the residual
# survivorship bias — which is why the manifest reports how many of them resolved.
DEPARTED = """SIVB SBNY FRC ATVI DISH LUMN AAP PXD MRO CTLT HES ILMN ETSY BIO CZR
              SEDG VFC WHR ZION PARA WBA XRAY QRVO MKTX FMC CE BEN IVZ AMTM DXC
              NCLH ALK RE PEAK SEE""".split()
step(4, f"{len(DEPARTED)} departed names to attempt")

SYMS = sorted(set([s.replace(".", "-") for s in held_on_asof] + DEPARTED))
step(4, f"{len(SYMS)} symbols total to download")

# --- Download ----------------------------------------------------------------------------------
os.makedirs("candle-bundle/1440", exist_ok=True)
got, missing = [], []
for i in range(0, len(SYMS), 40):
    batch = SYMS[i:i+40]
    try:
        data = yf.download(batch, start=AS_OF, auto_adjust=False, progress=False,
                           group_by="ticker", threads=True)
    except Exception as e:
        print(f"    batch {i} failed: {e}", flush=True); missing += batch; continue
    for s in batch:
        try:
            df = data[s] if isinstance(data.columns, pd.MultiIndex) else data
            df = df.dropna(subset=["Open","High","Low","Close"])
        except Exception:
            missing.append(s); continue
        if len(df) < 120: missing.append(s); continue
        out = df[["Open","High","Low","Close","Volume"]].copy()
        out.columns = ["open","high","low","close","volume"]
        out.insert(0, "time", df.index.astype("int64") // 10**9)
        out.to_csv(f"candle-bundle/1440/{s}.csv", index=False)
        got.append(s)
    print(f"    {min(i+40,len(SYMS))}/{len(SYMS)}  kept {len(got)}  missing {len(missing)}", flush=True)

departed_got = [s for s in DEPARTED if s in got]
manifest = {
  "asOf": AS_OF,
  "rule": "current S&P 500 minus everything added after AS_OF (mechanical, from Wikipedia's "
          "Date-added column), plus a hand-supplied list of names that have since departed",
  "mechanicalMembers": len(held_on_asof), "droppedAsAddedLater": dropped,
  "departedAttempted": len(DEPARTED), "departedRecovered": len(departed_got),
  "departedRecoveredList": departed_got,
  "downloaded": len(got), "missing": missing,
  "missingPct": round(100*len(missing)/max(len(SYMS),1), 1),
  "caveat": "The departed list is from recall and is incomplete; that incompleteness is the "
            "residual survivorship bias and is NOT measured by this script.",
  "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
json.dump(manifest, open("candle-bundle/manifest.json","w"), indent=1)
step(6, f"DONE — kept {len(got)}, of which {len(departed_got)}/{len(DEPARTED)} are departed names; "
        f"missing {len(missing)} ({manifest['missingPct']}%)")
with tarfile.open("sp500.tar.gz","w:gz") as t: t.add("candle-bundle")
step(7, "wrote sp500.tar.gz")
try:
    from google.colab import files; files.download("sp500.tar.gz")
except Exception as e:
    print(f"    auto-download unavailable ({e}) — grab sp500.tar.gz from the file browser", flush=True)
