# Paste into one Google Colab cell and run. Replaces the earlier script, which pointed at Binance
# hosts that return 451 from a US-based machine.
#
# Routes chosen from an actual reachability probe rather than assumption:
#   candles  -> data-api.binance.vision   (same kline API as api.binance.com, not geo-blocked)
#   funding  -> Kraken Futures AND OKX    (both reachable; pulled independently, then compared)
#
# Two funding sources on purpose. Kraken is the bundle's own venue so its rates need no cross-venue
# mapping, but the probe suggests its history may be short. OKX likely goes deeper and is a genuine
# independent measurement of the same quantity. Where they overlap they must agree; if they do not,
# that disagreement is itself the finding and is worth more than either series alone.
#
# Unlike v1 this NEVER hides an HTTP status. v1 printed "none (no perp listed)" for both "this
# symbol has no perpetual" and "the exchange refused us", which is how a total geo-block came back
# looking like 29 missing symbols.
import os, csv, time, json, tarfile, socket, urllib.request, urllib.error

VISION = "https://data-api.binance.vision/api/v3"
KRAKEN = "https://futures.kraken.com/derivatives/api/v4"
OKX    = "https://www.okx.com/api/v5"
START_MS = 1483228800000                       # 2017-01-01
socket.setdefaulttimeout(30)

# Bundle tickers are Kraken spot names. XBT is BTC everywhere else; POL is the post-rebrand MATIC.
SYMBOLS = ["ADA","ALGO","APT","ATOM","AVAX","BCH","DOGE","DOT","EOS","ETC","ETH","FIL","INJ",
           "LINK","LTC","NEAR","POL","SOL","SUI","TAO","TIA","TRX","UNI","XBT","XLM","XMR",
           "XRP","XTZ","ZEC"]
base = lambda s: "BTC" if s == "XBT" else s

def get(url):
    """Returns (data, note). note is None on success, else a human-readable reason. The status code
    is never swallowed -- that was v1's defect and it cost a whole round trip to diagnose."""
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req) as r:
                return json.load(r), None
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None, f"HTTP {e.code} (symbol not listed here)"
            if e.code in (403, 451):
                return None, f"HTTP {e.code} (venue refuses this region)"
            if attempt == 3:
                return None, f"HTTP {e.code} after 4 tries"
            time.sleep(2 ** attempt)
        except Exception as e:
            if attempt == 3:
                return None, f"{type(e).__name__}: {str(e)[:60]}"
            time.sleep(2 ** attempt)
    return None, "exhausted retries"

def write_csv(path, header, rows):
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(header); w.writerows(rows)

def span(ms_list):
    if not ms_list: return "-"
    f = lambda m: time.strftime("%Y-%m", time.gmtime(m / 1000))
    return f"{f(min(ms_list))}..{f(max(ms_list))}"

for d in ("candles-long", "funding-kraken", "funding-okx"):
    os.makedirs(d, exist_ok=True)
report = []

for s in SYMBOLS:
    row = {"sym": s}

    # --- daily candles, paged. The endpoint caps each response and ignores the rest of the range,
    # so one call returns a PREFIX and looks successful. Page until it stops advancing.
    rows, frm = [], START_MS
    while True:
        page, note = get(f"{VISION}/klines?symbol={base(s)}USDT&interval=1d&startTime={frm}&limit=1000")
        if not page:
            if not rows: row["candles"] = note or "empty"
            break
        rows += page
        if len(page) < 1000 or page[-1][0] <= frm: break
        frm = page[-1][0] + 1
        time.sleep(0.1)
    if rows:
        write_csv(f"candles-long/{s}USD.csv", ["time","open","high","low","close","volume"],
                  [[r[0] // 1000, r[1], r[2], r[3], r[4], r[5]] for r in rows])   # seconds, to match the bundle
        row["candles"] = f"{len(rows)} {span([r[0] for r in rows])}"

    # --- Kraken Futures funding: one call returns the whole history for the instrument.
    data, note = get(f"{KRAKEN}/historicalfundingrates?symbol=PF_{s}USD")
    rates = (data or {}).get("rates") or []
    if rates:
        ms = [int(time.mktime(time.strptime(r["timestamp"], "%Y-%m-%dT%H:%M:%SZ"))) * 1000 for r in rates]
        write_csv(f"funding-kraken/{s}USD.csv", ["symbol","fundingTime","fundingRate"],
                  [[s + "USD", m, r.get("relativeFundingRate", r.get("fundingRate"))] for m, r in zip(ms, rates)])
        row["kraken"] = f"{len(rates)} {span(ms)}"
    else:
        row["kraken"] = note or "no PF_ instrument"

    # --- OKX funding: 100 per page, walking backwards via `after` (returns rows older than it).
    out, after = [], None
    while True:
        u = f"{OKX}/public/funding-rate-history?instId={base(s)}-USDT-SWAP&limit=100"
        if after: u += f"&after={after}"
        data, note = get(u)
        page = (data or {}).get("data") or []
        if not page:
            if not out: row["okx"] = note or "no swap listed"
            break
        out += page
        oldest = min(int(r["fundingTime"]) for r in page)
        if len(page) < 100 or oldest <= START_MS: break
        after = oldest
        time.sleep(0.15)
    if out:
        write_csv(f"funding-okx/{s}USD.csv", ["symbol","fundingTime","fundingRate"],
                  [[s + "USD", r["fundingTime"], r["fundingRate"]] for r in out])
        row["okx"] = f"{len(out)} {span([int(r['fundingTime']) for r in out])}"

    report.append(row)
    print(f"{s:<5} candles {str(row.get('candles','-')):<24} "
          f"kraken {str(row.get('kraken','-')):<26} okx {row.get('okx','-')}")

with tarfile.open("crypto-pull.tar.gz", "w:gz") as t:
    for d in ("candles-long", "funding-kraken", "funding-okx"): t.add(d)

ok = lambda k: sum(1 for r in report if r.get(k, "").split(" ")[0].isdigit())
print(f"\ncandles {ok('candles')}/{len(SYMBOLS)}   kraken funding {ok('kraken')}/{len(SYMBOLS)}   "
      f"okx funding {ok('okx')}/{len(SYMBOLS)}")
print(f"crypto-pull.tar.gz  {os.path.getsize('crypto-pull.tar.gz')/1e6:.1f} MB")
print("Send it whole, gaps included. A symbol with no perpetual is a symbol that cannot carry,")
print("which is part of the answer rather than a hole in it.")
try:
    from google.colab import files; files.download("crypto-pull.tar.gz")
except Exception:
    print("(not on Colab -- tarball is in the working directory)")
