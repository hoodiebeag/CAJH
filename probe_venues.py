# Diagnostic only -- fetches nothing useful, just reports which venues this machine can reach.
# Run this in Colab and paste the whole output back.
#
# The previous script reported "none (no perp listed)" for every failure mode, which conflated
# "this symbol has no perpetual" with "the exchange refused the connection". This separates them
# by printing the actual HTTP status.
import urllib.request, urllib.error, json, socket

TESTS = [
    ("binance spot     ", "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=2"),
    ("binance futures  ", "https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=2"),
    ("binance vision   ", "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=2"),
    ("kraken futures   ", "https://futures.kraken.com/derivatives/api/v4/historicalfundingrates?symbol=PF_XBTUSD"),
    ("kraken spot      ", "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440"),
    ("bybit            ", "https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=2"),
    ("okx              ", "https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=2"),
    ("coinbase         ", "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"),
]

socket.setdefaulttimeout(20)
for name, url in TESTS:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as r:
            body = r.read(300).decode("utf-8", "replace")
            print(f"{name} HTTP {r.status}  OK   {body[:110]}")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read(200).decode("utf-8", "replace").replace("\n", " ")
        except Exception:
            pass
        # 451 = geo-blocked, 403 = refused, 400/404 = bad symbol (which would mean the host IS reachable)
        print(f"{name} HTTP {e.code}  FAIL {detail[:110]}")
    except Exception as e:
        print(f"{name} ----      FAIL {type(e).__name__}: {str(e)[:90]}")

print("\nWhat the codes mean:")
print("  200        reachable, usable")
print("  451 / 403  the exchange is refusing this machine's region -- not a script bug")
print("  400 / 404  host reachable, symbol name wrong -- fixable, and good news")
