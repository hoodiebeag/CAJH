# DERIVATIVES POSITIONING from data.binance.vision. Paste into one Colab cell.
#
# Your probe confirmed daily `metrics` archives return 200 back to at least 2021-06, on the same
# non-geo-blocked host that served the funding data. Each file holds five-minute snapshots of open
# interest, top-trader long/short ratios, and taker buy/sell volume for one symbol-day.
#
# These are DAILY files, so this walks ~1,350 days x 29 symbols. It downsamples each day to ONE row
# in the browser before writing, so the tarball stays small -- the raw five-minute data would be
# ~400x larger and is not needed by an analysis that ranks on a daily bar.
#
# The analysis it feeds is already written and pre-registered (positioning-run.mjs), with three
# signals, their directions, a family of 18, and its kill conditions all fixed before this script
# was run. Nothing about this pull can influence what that analysis does.
#
# Expect 30-60 minutes. It probes first and never hides an HTTP status.
import os, csv, io, time, zipfile, tarfile, socket, urllib.request, urllib.error
from datetime import date, timedelta

BASE = "https://data.binance.vision/data/futures/um/daily/metrics"
OUT  = "positioning"
START = date(2022, 1, 1)          # comfortably before the 2023-01 study window
END   = date.today() - timedelta(days=2)
socket.setdefaulttimeout(45)

SYMBOLS = ["ADA","ALGO","APT","ATOM","AVAX","BCH","DOGE","DOT","EOS","ETC","ETH","FIL","INJ",
           "LINK","LTC","NEAR","POL","SOL","SUI","TAO","TIA","TRX","UNI","XBT","XLM","XMR",
           "XRP","XTZ","ZEC"]
base = lambda s: "BTC" if s == "XBT" else s
# Parsed by NAME below, never by position: Binance has changed column order between eras of these
# archives, and a positional parser would silently read the long/short ratio as open interest.
WANT = ["sum_open_interest", "sum_open_interest_value", "count_toptrader_long_short_ratio",
        "sum_toptrader_long_short_ratio", "count_long_short_ratio", "sum_taker_long_short_vol_ratio"]

def fetch(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req) as r:
                return r.read(), None
        except urllib.error.HTTPError as e:
            if e.code == 404: return None, "404"
            if e.code in (403, 451): return None, f"HTTP {e.code} BLOCKED"
            if attempt == 2: return None, f"HTTP {e.code}"
            time.sleep(2 ** attempt)
        except Exception as e:
            if attempt == 2: return None, type(e).__name__
            time.sleep(2 ** attempt)
    return None, "retries exhausted"

def day_row(blob):
    """One day of five-minute snapshots -> one daily row: the LAST reading of each column.
    Last, not mean: open interest is a level and the analysis ranks on the end-of-day state.
    Returns (create_time, {col: value}) or None."""
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for nm in z.namelist():
            if not nm.endswith(".csv"): continue
            lines = z.read(nm).decode("utf-8", "replace").splitlines()
            if len(lines) < 2: return None
            head = [h.strip() for h in lines[0].split(",")]
            if "create_time" not in head: return None
            ti = head.index("create_time")
            idx = {c: head.index(c) for c in WANT if c in head}
            if not idx: return None
            for line in reversed(lines[1:]):            # last non-empty row of the day
                p = line.split(",")
                if len(p) <= ti or not p[ti].strip(): continue
                vals = {}
                for c, i in idx.items():
                    try: vals[c] = float(p[i])
                    except (ValueError, IndexError): pass
                if vals: return p[ti].strip(), vals
    return None

probe = f"{BASE}/BTCUSDT/BTCUSDT-metrics-2025-01-02.zip"
blob, note = fetch(probe)
print(f"probe -> {'OK ' + str(len(blob)) + ' bytes' if blob else 'FAILED: ' + str(note)}")
if not blob:
    print("Path wrong or host refusing. Paste this back rather than letting it grind for an hour.")
    raise SystemExit(0)
d = day_row(blob)
print(f"  columns found: {sorted(d[1].keys()) if d else 'NONE -- schema differs, paste this back'}\n")
if not d: raise SystemExit(0)

os.makedirs(OUT, exist_ok=True)
DAYS = [START + timedelta(days=i) for i in range((END - START).days + 1)]
blocked_syms, consecutive_blocked = [], 0
for s in SYMBOLS:
    sym, rows, misses, blocked = base(s) + "USDT", [], 0, False
    for dt in DAYS:
        blob, note = fetch(f"{BASE}/{sym}/{sym}-metrics-{dt.isoformat()}.zip")
        if blob:
            r = day_row(blob)
            if r: rows.append(r)
            misses = 0
        else:
            if note and "BLOCKED" in note: blocked = True; break
            misses += 1
            if rows and misses >= 45: break        # delisted, or the archive stops here
        time.sleep(0.03)
    if blocked:
        # The probe proved the host answers, so a refusal here is symbol-specific. Do not throw away
        # 28 good symbols for one bad one; only a run of them means the host has turned us away.
        blocked_syms.append(s); consecutive_blocked += 1
        print(f"{s:<5} refused -- skipping")
        if consecutive_blocked >= 5:
            print("\nFive refusals in a row: the host has stopped serving this machine. Stopping.")
            break
        continue
    consecutive_blocked = 0
    if rows:
        cols = sorted({c for _, v in rows for c in v})
        with open(f"{OUT}/{s}USD.csv", "w", newline="") as fh:
            w = csv.writer(fh); w.writerow(["create_time"] + cols)
            for t, v in rows: w.writerow([t] + [v.get(c, "") for c in cols])
        print(f"{s:<5} {len(rows):>5} days  {rows[0][0][:10]}..{rows[-1][0][:10]}")
    else:
        print(f"{s:<5} no metrics archives")

with tarfile.open("positioning.tar.gz", "w:gz") as t: t.add(OUT)
n = len(os.listdir(OUT))
print(f"\n{n}/{len(SYMBOLS)} symbols written.")
if blocked_syms: print(f"refused by the host: {' '.join(blocked_syms)}")
print(f"positioning.tar.gz  {os.path.getsize('positioning.tar.gz')/1e6:.1f} MB")
try:
    from google.colab import files; files.download("positioning.tar.gz")
except Exception:
    print("(not on Colab -- tarball is in the working directory)")
