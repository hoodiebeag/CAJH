import crypto from "crypto";
import axios from "axios";

const API_KEY = process.env.KRAKEN_FUTURES_API_KEY;
const API_SECRET = process.env.KRAKEN_FUTURES_API_SECRET;
const BASE_URL = "https://futures.kraken.com/derivatives/api/v3";

// Leverage scale by conviction
function getLeverage(conviction) {
  if (conviction >= 10) return 10;
  if (conviction >= 9) return 7;
  if (conviction >= 8) return 5;
  if (conviction >= 7) return 3;
  return 2;
}

// Position size by conviction (% of available balance)
function getPositionSizePct(conviction) {
  if (conviction >= 10) return 0.15;
  if (conviction >= 9) return 0.12;
  if (conviction >= 8) return 0.09;
  if (conviction >= 7) return 0.07;
  return 0.05;
}

// Sign Kraken Futures API request (updated method post Feb 2024)
function signRequest(endpoint, nonce, postData = "") {
  // New method: hash the (postData + nonce + endpoint) string
  const message = postData + nonce + endpoint;
  const secretDecoded = Buffer.from(API_SECRET, "base64");
  const hash = crypto.createHash("sha256").update(message).digest();
  return crypto.createHmac("sha512", secretDecoded).update(hash).digest("base64");
}

// Make authenticated API request
async function krakenRequest(method, endpoint, params = {}) {
  const nonce = Date.now().toString();
  const postData = method === "POST" ? new URLSearchParams(params).toString() : "";
  const queryString = method === "GET" && Object.keys(params).length > 0
    ? "?" + new URLSearchParams(params).toString()
    : "";
  const signEndpoint = endpoint + queryString;
  const signature = signRequest(signEndpoint, nonce, postData);

  const headers = {
    "APIKey": API_KEY,
    "Nonce": nonce,
    "Authent": signature,
    "Content-Type": "application/x-www-form-urlencoded"
  };

  try {
    const response = await axios({
      method,
      url: `${BASE_URL}${endpoint}`,
      headers,
      data: method === "POST" ? postData : undefined,
      params: method === "GET" ? params : undefined,
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error(`Kraken API error (${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
}

// Get available account balance
export async function getAccountBalance() {
  const data = await krakenRequest("GET", "/accounts");
  console.log("Kraken accounts response:", JSON.stringify(data, null, 2));
  
  // Try different account structures
  const accounts = data.accounts || {};
  const account = accounts.fi_xbtusd || accounts.cash || accounts.flex || Object.values(accounts)[0];
  console.log("Account found:", JSON.stringify(account, null, 2));
  
  return account?.balances?.available || account?.available || 0;
}

// Map asset symbol to Kraken Futures contract
function symbolToContract(symbol) {
  const contractMap = {
    BTC: "PF_XBTUSD",
    ETH: "PF_ETHUSD",
    SOL: "PF_SOLUSD",
    BNB: "PF_BNBUSD",
    TAO: "PF_TAOUSD",
    XRP: "PF_XRPUSD",
    ADA: "PF_ADAUSD",
    DOGE: "PF_DOGEUSD",
    AVAX: "PF_AVAXUSD",
    LINK: "PF_LINKUSD"
  };
  return contractMap[symbol.toUpperCase()] || `PF_${symbol.toUpperCase()}USD`;
}

// Get current price for a contract
export async function getCurrentPrice(symbol) {
  const contract = symbolToContract(symbol);
  const data = await krakenRequest("GET", "/tickers");
  const ticker = data.tickers?.find(t => t.symbol === contract);
  return ticker?.last || null;
}

// Place a trade with limit entry, SL, and TP
export async function placeTrade({ symbol, direction, entry, stopLoss, takeProfit1, takeProfit2, conviction }) {
  const contract = symbolToContract(symbol);
  const leverage = getLeverage(conviction);
  const sizePct = getPositionSizePct(conviction);

  // Get available balance
  const balance = await getAccountBalance();
  console.log(`Available balance: $${balance}`);

  const tradeCapital = balance * sizePct;
  const size = Math.floor((tradeCapital * leverage) / entry);

  console.log(`Trade calc: balance=$${balance}, sizePct=${sizePct}, capital=$${tradeCapital}, leverage=${leverage}x, entry=$${entry}, size=${size} contracts`);

  if (size < 1) {
    throw new Error(`Position size too small: $${tradeCapital.toFixed(2)} capital at ${leverage}x = ${size} contracts`);
  }

  const side = direction.toLowerCase() === "long" ? "buy" : "sell";
  const closeSide = side === "buy" ? "sell" : "buy";

  console.log(`Placing ${side} order: ${size} contracts of ${contract} at $${entry}`);

  // Place limit entry order
  const entryOrder = await krakenRequest("POST", "/sendorder", {
    orderType: "lmt",
    symbol: contract,
    side,
    size,
    limitPrice: entry,
    reduceOnly: "false"
  });

  console.log("Entry order response:", JSON.stringify(entryOrder, null, 2));

  if (entryOrder.result !== "success") {
    throw new Error(`Entry order failed: ${JSON.stringify(entryOrder)}`);
  }

  const orderId = entryOrder.sendStatus?.order_id;

  // Place stop loss
  await krakenRequest("POST", "/sendorder", {
    orderType: "stp",
    symbol: contract,
    side: closeSide,
    size,
    stopPrice: stopLoss,
    reduceOnly: "true"
  });

  // Place take profit 1 (half size)
  const tp1Size = Math.max(1, Math.floor(size / 2));
  await krakenRequest("POST", "/sendorder", {
    orderType: "take_profit",
    symbol: contract,
    side: closeSide,
    size: tp1Size,
    limitPrice: takeProfit1,
    reduceOnly: "true"
  });

  // Place take profit 2 (remaining size)
  const tp2Size = size - tp1Size;
  if (tp2Size > 0) {
    await krakenRequest("POST", "/sendorder", {
      orderType: "take_profit",
      symbol: contract,
      side: closeSide,
      size: tp2Size,
      limitPrice: takeProfit2,
      reduceOnly: "true"
    });
  }

  return {
    orderId,
    symbol,
    contract,
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    size,
    leverage,
    capital: tradeCapital,
    conviction
  };
}

// Get open positions
export async function getOpenPositions() {
  const data = await krakenRequest("GET", "/openpositions");
  return data.openPositions || [];
}

// Get open orders
export async function getOpenOrders() {
  const data = await krakenRequest("GET", "/openorders");
  return data.openOrders || [];
}