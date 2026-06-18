import crypto from "crypto";
import axios from "axios";

// Toggle between demo and live
const USE_DEMO = !!process.env.KRAKEN_DEMO_API_KEY;
const BASE_URL = USE_DEMO
  ? "https://demo-futures.kraken.com/derivatives/api/v3"
  : "https://futures.kraken.com/derivatives/api/v3";

const API_KEY = USE_DEMO
  ? process.env.KRAKEN_DEMO_API_KEY
  : process.env.KRAKEN_FUTURES_API_KEY;

const API_SECRET = USE_DEMO
  ? process.env.KRAKEN_DEMO_API_SECRET
  : process.env.KRAKEN_FUTURES_API_SECRET;

console.log(`Using ${USE_DEMO ? "DEMO" : "LIVE"} Kraken Futures API`);
console.log("API Key loaded:", API_KEY ? `${API_KEY.slice(0, 6)}...` : "MISSING");

// Sign Kraken Futures API request
// endpointPath for signing starts with /api/v3 (NOT /derivatives/api/v3)
// Order: postData + nonce + endpointPath → SHA256 → HMAC-SHA512
function signRequest(endpointPath, nonce, postData = "") {
  const message = postData + nonce + endpointPath;
  const secretDecoded = Buffer.from(API_SECRET, "base64");
  const hash = crypto.createHash("sha256").update(message).digest();
  return crypto.createHmac("sha512", secretDecoded).update(hash).digest("base64");
}

// Make authenticated Kraken Futures API request
async function krakenFuturesRequest(method, endpoint, params = {}) {
  const nonce = Date.now().toString();
  const postData = method === "POST" ? new URLSearchParams(params).toString() : "";

  // The signing path uses /api/v3/... not /derivatives/api/v3/...
  const signPath = `/api/v3${endpoint}`;
  const queryString = method === "GET" && Object.keys(params).length > 0
    ? "?" + new URLSearchParams(params).toString()
    : "";
  const signature = signRequest(signPath + queryString, nonce, postData);

  try {
    const response = await axios({
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        "APIKey": API_KEY,
        "Nonce": nonce,
        "Authent": signature,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      data: method === "POST" ? postData : undefined,
      params: method === "GET" ? params : undefined,
      timeout: 10000
    });

    console.log(`Futures API (${endpoint}):`, JSON.stringify(response.data).slice(0, 200));

    if (response.data.result === "error") {
      throw new Error(`Kraken Futures error: ${response.data.error}`);
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(`Kraken Futures error (${endpoint}):`, JSON.stringify(error.response.data));
    } else {
      console.error(`Kraken Futures error (${endpoint}):`, error.message);
    }
    throw error;
  }
}

// Leverage scale by conviction
function getLeverage(conviction) {
  if (conviction >= 10) return 10;
  if (conviction >= 9) return 7;
  if (conviction >= 8) return 5;
  if (conviction >= 7) return 3;
  return 2;
}

// Position size by conviction
function getPositionSizePct(conviction) {
  if (conviction >= 10) return 0.15;
  if (conviction >= 9) return 0.12;
  if (conviction >= 8) return 0.09;
  if (conviction >= 7) return 0.07;
  return 0.05;
}

// Map symbol to Kraken Futures perpetual contract
function symbolToContract(symbol) {
  const contractMap = {
    BTC: "PF_XBTUSD",
    ETH: "PF_ETHUSD",
    SOL: "PF_SOLUSD",
    XRP: "PF_XRPUSD",
    ADA: "PF_ADAUSD",
    DOGE: "PF_DOGEUSD",
    LTC: "PF_LTCUSD",
    LINK: "PF_LINKUSD",
    AVAX: "PF_AVAXUSD",
    BNB: "PF_BNBUSD",
    TAO: "PF_TAOUSD"
  };
  return contractMap[symbol.toUpperCase()] || `PF_${symbol.toUpperCase()}USD`;
}

// Get available account balance
export async function getAccountBalance() {
  const data = await krakenFuturesRequest("GET", "/accounts");
  const accounts = data.accounts || {};

  let balance = 0;

  // Prefer flex (multi-collateral) available margin — most accurate for PF_ contracts
  if (accounts.flex?.availableMargin) {
    balance = parseFloat(accounts.flex.availableMargin);
  }
  // Fall back to flex USD currency
  else if (accounts.flex?.currencies?.USD?.available) {
    balance = parseFloat(accounts.flex.currencies.USD.available);
  }
  // Fall back to cash USD balance
  else if (accounts.cash?.balances?.usd) {
    balance = parseFloat(accounts.cash.balances.usd);
  }

  console.log(`Available balance: $${balance}`);
  return balance;
}

// Get current price for a contract
export async function getCurrentPrice(symbol) {
  const contract = symbolToContract(symbol);
  const data = await krakenFuturesRequest("GET", "/tickers");
  const ticker = data.tickers?.find(t =>
    t.symbol?.toLowerCase() === contract.toLowerCase()
  );
  return parseFloat(ticker?.last || ticker?.markPrice || 0);
}

// Place a futures trade
export async function placeTrade({ symbol, direction, entry, stopLoss, takeProfit1, takeProfit2, conviction }) {
  const contract = symbolToContract(symbol);
  const leverage = getLeverage(conviction);
  const sizePct = getPositionSizePct(conviction);

  const balance = await getAccountBalance();
  const tradeCapital = balance * sizePct;
  const currentPrice = await getCurrentPrice(symbol);
  const priceForCalc = entry || currentPrice;

  // For PF_ perpetuals, size is in number of contracts (each contract = 1 unit of base asset)
  // Minimum size is 1 contract
  const size = Math.max(1, Math.floor((tradeCapital * leverage) / priceForCalc));

  console.log(`Trade: balance=$${balance}, capital=$${tradeCapital}, leverage=${leverage}x, price=$${priceForCalc}, size=${size}, contract=${contract}`);

  if (balance <= 0) {
    throw new Error(`No available balance in demo account. Fund the multi-collateral wallet first.`);
  }

  const side = direction.toLowerCase() === "long" ? "buy" : "sell";
  const closeSide = side === "buy" ? "sell" : "buy";

  // Place entry order (market or limit)
  const orderParams = {
    orderType: entry ? "lmt" : "mkt",
    symbol: contract,
    side,
    size: size.toString()
  };
  if (entry) orderParams.limitPrice = entry.toString();

  const entryOrder = await krakenFuturesRequest("POST", "/sendorder", orderParams);
  const orderId = entryOrder.sendStatus?.order_id;
  console.log("Entry order placed:", orderId);

  // Place stop loss
  if (stopLoss > 0) {
    await krakenFuturesRequest("POST", "/sendorder", {
      orderType: "stp",
      symbol: contract,
      side: closeSide,
      size: size.toString(),
      stopPrice: stopLoss.toString(),
      reduceOnly: "true"
    });
  }

  // Place take profit 1 (half size)
  if (takeProfit1 > 0) {
    const tp1Size = Math.max(1, Math.floor(size / 2));
    await krakenFuturesRequest("POST", "/sendorder", {
      orderType: "take_profit",
      symbol: contract,
      side: closeSide,
      size: tp1Size.toString(),
      limitPrice: takeProfit1.toString(),
      reduceOnly: "true"
    });

    // Take profit 2 (remaining)
    const tp2Size = size - tp1Size;
    if (takeProfit2 > 0 && tp2Size > 0) {
      await krakenFuturesRequest("POST", "/sendorder", {
        orderType: "take_profit",
        symbol: contract,
        side: closeSide,
        size: tp2Size.toString(),
        limitPrice: takeProfit2.toString(),
        reduceOnly: "true"
      });
    }
  }

  return {
    orderId,
    symbol,
    contract,
    direction,
    entry: entry || currentPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
    size,
    leverage,
    capital: tradeCapital,
    balance,
    conviction
  };
}

// Get open positions
export async function getOpenPositions() {
  try {
    const data = await krakenFuturesRequest("GET", "/openpositions");
    return data.openPositions || [];
  } catch (error) {
    console.error("Failed to get open positions:", error.message);
    return [];
  }
}