import crypto from "crypto";
import axios from "axios";

// Toggle between demo and live
const USE_DEMO = process.env.KRAKEN_DEMO_API_KEY ? true : false;
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
function signRequest(endpoint, nonce, postData = "") {
  const message = postData + nonce + endpoint;
  const secretDecoded = Buffer.from(API_SECRET, "base64");
  const hash = crypto.createHash("sha256").update(message).digest();
  return crypto.createHmac("sha512", secretDecoded).update(hash).digest("base64");
}

// Make authenticated Kraken Futures API request
async function krakenFuturesRequest(method, endpoint, params = {}) {
  const nonce = Date.now().toString();
  const postData = method === "POST" ? new URLSearchParams(params).toString() : "";
  const queryString = method === "GET" && Object.keys(params).length > 0
    ? "?" + new URLSearchParams(params).toString()
    : "";
  const signEndpoint = endpoint + queryString;
  const signature = signRequest(signEndpoint, nonce, postData);

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

    console.log(`Futures API response (${endpoint}):`, JSON.stringify(response.data));

    if (response.data.result !== "success" && response.data.error) {
      throw new Error(`Kraken Futures error: ${response.data.error}`);
    }

    return response.data;
  } catch (error) {
    console.error(`Kraken Futures API error (${endpoint}):`, error.response?.data || error.message);
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
  console.log("Accounts:", JSON.stringify(data.accounts));
  const cash = data.accounts?.cash || data.accounts?.fi_xbtusd || Object.values(data.accounts || {})[0];
  const balance = parseFloat(cash?.balances?.available || cash?.available || 0);
  console.log(`Available balance: $${balance}`);
  return balance;
}

// Get current price for a contract
export async function getCurrentPrice(symbol) {
  const contract = symbolToContract(symbol);
  const data = await krakenFuturesRequest("GET", "/tickers");
  const ticker = data.tickers?.find(t => t.symbol === contract);
  return ticker?.last || ticker?.markPrice || null;
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
  const size = Math.floor((tradeCapital * leverage) / priceForCalc);

  console.log(`Trade: balance=$${balance}, capital=$${tradeCapital}, leverage=${leverage}x, size=${size}, contract=${contract}`);

  if (size < 1) {
    throw new Error(`Position size too small: $${tradeCapital.toFixed(2)} at ${leverage}x = ${size} contracts`);
  }

  const side = direction.toLowerCase() === "long" ? "buy" : "sell";
  const closeSide = side === "buy" ? "sell" : "buy";

  // Place entry order
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