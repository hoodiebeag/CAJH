# Paste this into a single Google Colab cell and run it. Browser only -- no machine, no install,
# no API key. Both endpoints are public. It ends by downloading crypto-pull.tar.gz to your device,
# which you can then upload to the Claude session.
#
# This exists because the research container's egress policy denies exchange hosts at the gateway,
# so the two datasets below have never been tested. Colab has its own network and is not affected.
#
# funding/  -- carry, the only untested return mechanism left that does not need short access.
#              Everything measured so far is a transform of price; funding is a payment stream.
# candles-long/ -- daily bars back to 2017. Our sample starts 2023-01 and contains NO momentum
#              crash. Momentum does not die by decaying, it dies in a violent reversal after a
#              bottom. This puts the 2018 collapse and the 2022 unwind in sample, and it could
#              take our surviving result down. That is why it is worth pulling.

import os, csv, time, json, tarfile, urllib.request, urllib.error

FAPI = "https://fapi.binance.com/fapi/v1"     # USD-M perpetuals: funding history
SPOT = "https://api.binance.com/api/v3"       # spot: daily candles back to 2017
START = 1483228800000                          # 2017-01-01, ms

# Our bundle uses Kraken tickers; Binance quotes USDT. XBT is Kraken's name for BTC and POL is the
# post-rebrand MATIC. Everything else is a straight XXXUSD -> XXXUSDT swap.
KRAKEN = ["ADA","ALGO","APT","ATOM","AVAX","BCH","DOGE","DOT","EOS","ETC","ETH","FIL","INJ",
          "LINK","LTC","NEAR","POL","SOL","SUI","TAO","TIA","TRX","UNI","XBT","XLM","XMR",
          "XRP","XTZ","ZEC"]
to_binance = lambda k: ("BTC" if k == "XBT" else k) + "USDT"

def get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None                    # symbol not listed here; not an error to retry
            time.sleep(2 ** attempt)
        except Exception:
            time.sleep(2 ** attempt)
    return None

def page_all(url, limit, time_of):
    """Both endpoints cap a response and ignore anything past it, so ONE call silently returns a
    prefix of the range asked for. Paging until the page stops advancing is what makes the pull
    complete rather than merely successful."""
    out, frm = [], START
    while True:
        page = get(f"{url}&startTime={frm}&limit={limit}")
        if not page:
            break
        out.extend(page)
        last = time_of(page[-1])
        if len(page) < limit or last <= frm:
            break
        frm = last + 1
        time.sleep(0.12)
    return out

os.makedirs("funding", exist_ok=True)
os.makedirs("candles-long", exist_ok=True)
have_funding = 0

for k in KRAKEN:
    sym = to_binance(k)

    f = page_all(f"{FAPI}/fundingRate?symbol={sym}", 1000, lambda r: r["fundingTime"])
    if f:
        have_funding += 1
        with open(f"funding/{k}USD.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["symbol", "fundingTime", "fundingRate", "markPrice"])
            for r in f:
                w.writerow([k + "USD", r["fundingTime"], r["fundingRate"], r.get("markPrice", "")])
        fnote = f"{len(f)} from {time.strftime('%Y-%m-%d', time.gmtime(f[0]['fundingTime']/1000))}"
    else:
        fnote = "none (no perp listed)"

    c = page_all(f"{SPOT}/klines?symbol={sym}&interval=1d", 1000, lambda r: r[0])
    if c:
        with open(f"candles-long/{k}USD.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["time", "open", "high", "low", "close", "volume"])
            # Seconds not milliseconds, to match the existing bundle format exactly.
            for r in c:
                w.writerow([r[0] // 1000, r[1], r[2], r[3], r[4], r[5]])
        cnote = f"{len(c)} from {time.strftime('%Y-%m-%d', time.gmtime(c[0][0]/1000))}"
    else:
        cnote = "none"

    print(f"{k:<6} {sym:<10} funding: {fnote:<30} candles: {cnote}")

with tarfile.open("crypto-pull.tar.gz", "w:gz") as t:
    t.add("funding"); t.add("candles-long")

print(f"\n{have_funding}/{len(KRAKEN)} symbols have funding history.")
print("Gaps are expected -- XMR perps were delisted and the newer names list late. A symbol with")
print("no perp is a symbol that cannot carry, which is itself part of the answer. Send everything.")
print(f"\ncrypto-pull.tar.gz written: {os.path.getsize('crypto-pull.tar.gz')/1e6:.1f} MB")
try:
    from google.colab import files
    files.download("crypto-pull.tar.gz")
except Exception:
    print("Not on Colab -- the tarball is in the working directory.")
