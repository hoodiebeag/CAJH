# BULK FUNDING from data.binance.vision. Paste into one Colab cell and run.
#
# Why this host: your probe showed fapi.binance.com returns 451 from a US machine while
# data-api.binance.vision returns 200. Binance publishes monthly funding-rate archives on that same
# non-geo-blocked domain, reaching back to the launch of each perpetual -- 2019-2020 for the majors.
#
# Why it matters: the funding already pulled covers 25.2% (Kraken) and 4.4% (OKX) of the price
# window, against a pre-registered 80% screen, so the carry analysis correctly scored NOTHING. It is
# not a negative result, it is an untested one. Five or six years of history clears the screen and
# turns 15 rebalance periods into 60+.
#
# The analysis it feeds is already written, pre-registered and validated against synthetic data. It
# will run unchanged. Nothing about this pull can influence what that analysis does.
#
# Runtime is longer than the earlier scripts -- roughly 2,000 small files -- so expect 10-20 minutes.
# It prints progress per symbol and NEVER hides an HTTP status.
import os, csv, io, time, json, zipfile, tarfile, socket, urllib.request, urllib.error

BASE = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
OUT  = "funding-binance"
socket.setdefaulttimeout(45)

SYMBOLS = ["ADA","ALGO","APT","ATOM","AVAX","BCH","DOGE","DOT","EOS","ETC","ETH","FIL","INJ",
           "LINK","LTC","NEAR","POL","SOL","SUI","TAO","TIA","TRX","UNI","XBT","XLM","XMR",
           "XRP","XTZ","ZEC"]
base = lambda s: "BTC" if s == "XBT" else s

# Binance USD-M futures launched 2019-09. Walking from 2019-01 costs a few 404s and guarantees the
# start is found from the data rather than assumed.
MONTHS = [f"{y}-{m:02d}" for y in range(2019, 2027) for m in range(1, 13)]
MONTHS = [m for m in MONTHS if m <= time.strftime("%Y-%m")]

def fetch(url):
    """(bytes, note). The status is always returned, never swallowed -- v1 of this pull reported
    'no perp listed' for a total geo-block and cost a whole round trip to diagnose."""
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req) as r:
                return r.read(), None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, "404"                     # month not published: normal before listing
            if e.code in (403, 451):
                return None, f"HTTP {e.code} BLOCKED"  # fatal for this host, reported loudly
            if attempt == 2:
                return None, f"HTTP {e.code}"
            time.sleep(2 ** attempt)
        except Exception as e:
            if attempt == 2:
                return None, f"{type(e).__name__}"
            time.sleep(2 ** attempt)
    return None, "retries exhausted"

def rows_from_zip(blob):
    """Binance funding CSVs are calc_time,funding_interval_hours,last_funding_rate. Older files
    have no header row; newer ones do. Detect rather than assume -- guessing wrong silently drops
    a row or ingests the header as data."""
    out = []
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for name in z.namelist():
            if not name.endswith(".csv"):
                continue
            for line in z.read(name).decode("utf-8", "replace").splitlines():
                parts = line.split(",")
                if len(parts) < 3:
                    continue
                try:
                    t, rate = int(parts[0]), float(parts[2])
                except ValueError:
                    continue                            # the header line, or a malformed row
                out.append((t, rate))
    return out

# --- probe first, so a wrong path or a blocked host is reported in seconds rather than after 2000
# --- requests. v1 failed for 29 symbols in a row before anyone could see why.
probe_url = f"{BASE}/BTCUSDT/BTCUSDT-fundingRate-2024-01.zip"
blob, note = fetch(probe_url)
print(f"probe {probe_url}\n  -> {'OK ' + str(len(blob)) + ' bytes' if blob else 'FAILED: ' + str(note)}")
if not blob:
    print("\nThe archive path is wrong or the host is refusing this machine. Nothing else will work.")
    print("Paste this output back rather than letting it grind through 2,000 requests.")
    raise SystemExit(0)
print(f"  parsed {len(rows_from_zip(blob))} rows from the probe month\n")

os.makedirs(OUT, exist_ok=True)
summary, blocked_syms, consecutive_blocked = [], [], 0
for s in SYMBOLS:
    sym, rows, misses, blocked = base(s) + "USDT", [], 0, False
    for mo in MONTHS:
        blob, note = fetch(f"{BASE}/{sym}/{sym}-fundingRate-{mo}.zip")
        if blob:
            rows += rows_from_zip(blob)
            misses = 0
        else:
            if note and "BLOCKED" in note:
                blocked = True
                break
            misses += 1
            # 12 consecutive absent months after data has started means the perp was delisted.
            # Before any data has started they are simply months before listing.
            if rows and misses >= 12:
                break
        time.sleep(0.05)
    if blocked:
        # The probe already proved the host answers this machine, so a 451 here is specific to one
        # symbol, not a host-wide refusal. Aborting the whole run on it would throw away 28 good
        # symbols for one bad one. Only a RUN of them means the host has turned us away mid-pull.
        blocked_syms.append(s)
        consecutive_blocked += 1
        print(f"{s:<5} refused (HTTP 403/451) -- skipping this symbol")
        if consecutive_blocked >= 5:
            print("\nFive symbols refused in a row: the host has stopped serving this machine.")
            print("Stopping rather than grinding through the rest. Send what was written so far.")
            break
        continue
    consecutive_blocked = 0
    rows = sorted(set(rows))
    if rows:
        with open(f"{OUT}/{s}USD.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["symbol", "fundingTime", "fundingRate"])
            for t, r in rows:
                w.writerow([s + "USD", t, r])
        span = f"{time.strftime('%Y-%m', time.gmtime(rows[0][0]/1000))}..{time.strftime('%Y-%m', time.gmtime(rows[-1][0]/1000))}"
        print(f"{s:<5} {len(rows):>6} rows  {span}")
        summary.append((s, len(rows), span))
    else:
        print(f"{s:<5} no funding archives (no perpetual on this venue)")

with tarfile.open("funding-binance.tar.gz", "w:gz") as t:
    t.add(OUT)
print(f"\n{len(summary)}/{len(SYMBOLS)} symbols have funding history.")
if blocked_syms:
    print(f"refused by the host: {' '.join(blocked_syms)}")
if summary:
    print(f"earliest month across all symbols: {min(x[2].split('..')[0] for x in summary)}")
print(f"funding-binance.tar.gz  {os.path.getsize('funding-binance.tar.gz')/1e6:.1f} MB")
print("Send it whole, gaps included. A symbol with no perpetual cannot carry, which is part of the")
print("answer rather than a hole in it.")
try:
    from google.colab import files; files.download("funding-binance.tar.gz")
except Exception:
    print("(not on Colab -- tarball is in the working directory)")
