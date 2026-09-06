# Diagnostic only. Fetches nothing useful -- reports which alternative data sources this machine can
# reach and HOW FAR BACK each one goes. Run in Colab, paste the whole output back. ~60 seconds.
#
# History depth is the question that actually decides things. The last round proved this: Kraken and
# OKX funding were both reachable and both useless, because one covered 25% of the study window and
# the other 4%, against a pre-registered 80% screen. Reachable is not the same as usable.
import urllib.request, urllib.error, json, socket, time

socket.setdefaulttimeout(25)

def probe(label, url, note=""):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as r:
            body = r.read(400).decode("utf-8", "replace").replace("\n", " ")
            print(f"{label:<34} {r.status}  OK   {body[:100]}")
            return True
    except urllib.error.HTTPError as e:
        detail = ""
        try: detail = e.read(150).decode("utf-8", "replace").replace("\n", " ")
        except Exception: pass
        print(f"{label:<34} {e.code}  FAIL {detail[:80]} {note}")
    except Exception as e:
        print(f"{label:<34} ---  FAIL {type(e).__name__}: {str(e)[:70]}")
    return False

print("=== 1. DERIVATIVES POSITIONING (Binance vision daily metrics) ===")
print("open interest, top-trader long/short ratio, taker buy/sell imbalance -- the strongest candidate")
V = "https://data.binance.vision/data/futures/um/daily/metrics/BTCUSDT"
for d in ["2026-09-01", "2025-01-02", "2024-01-02", "2023-06-01", "2023-01-03", "2022-06-01", "2021-06-01"]:
    probe(f"  metrics {d}", f"{V}/BTCUSDT-metrics-{d}.zip")
print("  ^ the EARLIEST date returning 200 is how far positioning history reaches.\n")

print("=== 2. ON-CHAIN (Coin Metrics community, free, no key) ===")
CM = "https://community-api.coinmetrics.io/v4"
probe("  asset list", f"{CM}/catalog/assets?pretty=false")
probe("  BTC active addresses 2018", f"{CM}/timeseries/asset-metrics?assets=btc&metrics=AdrActCnt&start_time=2018-01-01&end_time=2018-01-05&frequency=1d")
probe("  BTC exchange flows", f"{CM}/timeseries/asset-metrics?assets=btc&metrics=FlowInExNtv&start_time=2020-01-01&end_time=2020-01-05&frequency=1d")
probe("  multi-asset in one call", f"{CM}/timeseries/asset-metrics?assets=btc,eth,ada,sol,link&metrics=AdrActCnt&start_time=2023-01-01&end_time=2023-01-03&frequency=1d")
print("  ^ coverage matters more than depth here: a cross-section needs many assets, not deep BTC.\n")

print("=== 3. TAKER FLOW (Binance vision aggregated trades) ===")
probe("  aggTrades one day (SIZE!)",
      "https://data.binance.vision/data/futures/um/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2025-01-02.zip",
      "-- check the byte size in the response headers before considering this")

print("\n=== 4. OPTIONS (Deribit) -- expected to be BTC/ETH only ===")
probe("  deribit instruments", "https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false")
probe("  deribit currencies", "https://www.deribit.com/api/v2/public/get_currencies")

print("\n=== 5. NEWS -- expected to be shallow on free tiers ===")
probe("  cryptopanic", "https://cryptopanic.com/api/v1/posts/?public=true")
probe("  gdelt doc api", "https://api.gdeltproject.org/api/v2/doc/doc?query=bitcoin&mode=artlist&maxrecords=5&format=json")

print("\n=== 6. FALLBACK PRICE/MARKET (CoinGecko free) ===")
probe("  coingecko ping", "https://api.coingecko.com/api/v3/ping")

print("\nWhat to look for:")
print("  Section 1: the EARLIEST metrics date that returns 200. If it is 2023 or earlier, positioning")
print("             is testable over the same window as everything else in this project.")
print("  Section 2: whether the multi-asset call works and how many of our 29 assets exist.")
print("  Section 3: the file size. If one symbol-day is tens of MB, six years x 29 symbols is not")
print("             happening in a Colab session and this source is out on practical grounds.")
