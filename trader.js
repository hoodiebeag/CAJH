import crypto from "crypto";
import axios from "axios";

const API_KEY = process.env.KRAKEN_API_KEY;
const API_SECRET = process.env.KRAKEN_API_SECRET;
console.log("API Key loaded:", API_KEY ? `${API_KEY.slice(0, 6)}...` : "MISSING");
console.log("API Secret loaded:", API_SECRET ? `${API_SECRET.slice(0, 6)}...` : "MISSING");
const BASE_URL = "https://api.kraken.com";

// Leverage scale by conviction
function getLeverage(conviction) {
  if (conviction >= 10) return 5;
  if (conviction >= 9) return 4;
  if (conviction >= 8) return 3;
  if (conviction >= 7) return 2;
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

// Sign Kraken Spot API request
function signRequest(urlPath, postData, nonce) {
  const message = urlPath + crypto.createHash("sha256")
    .update(nonce + postData)
    .digest();
  return crypto.createHmac("sha512", Buffer.from(API_SECRET, "base64"))
    .update(message)
    .digest("base64");
}

// Make authenticated Kraken Spot API request
async function krakenRequest(endpoint, params = {}) {
  const nonce = Date.now().toString();
  params.nonce = nonce;
  const postData = new URLSearchParams(params).toString();
  const signature = signRequest(endpoint, postData, nonce);

  const headers = {
    "API-Key": API_KEY,
    "API-Sign": signature,
    "Content-Type": "application/x-www-form-urlencoded"
  };

  try {
    const response = await axios.post(`${BASE_URL}${endpoint}`, postData, {
      headers,
      timeout: 10000
    });

    if (response.data.error && response.data.error.length > 0) {
      throw new Error(`Kraken error: ${response.data.error.join(", ")}`);
    }

    return response.data.result;
  } catch (error) {
    console.error(`Kraken API error (${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
}

// Get available USD balance
export async function getAccountBalance() {
  const result = await krakenRequest("/0/private/Balance");
  console.log("Kraken balance response:", JSON.stringify(result, null, 2));

  // Look for USD, ZUSD, or USDT balance
  const balance = parseFloat(
    result.ZUSD || result.USD || result.USDT || result.USDC || 0
  );
  console.log(`Available balance: $${balance}`);
  return balance;
}

// Map symbol to Kraken spot margin pair
function symbolToPair(symbol) {
  const pairMap = {
    BTC: "XBTUSD",
    ETH: "ETHUSD",
    SOL: "SOLUSD",
    BNB: "BNBUSD",
    TAO: "TAOUSD",
    XRP: "XRPUSD",
    ADA: "ADAUSD",
    DOGE: "DOGEUSD",
    AVAX: "AVAXUSD",
    LINK: "LINKUSD",
    LTC: "LTCUSD",
    DOT: "DOTUSD"
  };
  return pairMap[symbol.toUpperCase()] || `${symbol.toUpperCase()}USD`;
}

// Get current price
export async function getCurrentPrice(symbol) {
  const pair = symbolToPair(symbol);
  try {
    const response = await axios.get(`${BASE_URL}/0/public/Ticker?pair=${pair}`);
    const ticker = Object.values(response.data.result)[0];
    return parseFloat(ticker?.c?.[0] || 0);
  } catch (error) {
    console.error(`Failed to get price for ${symbol}:`, error.message);
    return null;
  }
}

// Place a margin trade with limit entry, SL, and TP
export async function placeTrade({ symbol, direction, entry, stopLoss, takeProfit1, takeProfit2, conviction }) {
  const pair = symbolToPair(symbol);
  const leverage = getLeverage(conviction);
  const sizePct = getPositionSizePct(conviction);

  // Get available balance
  const balance = await getAccountBalance();
  const tradeCapital = balance * sizePct;
  const volume = ((tradeCapital * leverage) / entry).toFixed(8);

  console.log(`Trade calc: balance=$${balance}, sizePct=${sizePct}, capital=$${tradeCapital}, leverage=${leverage}x, entry=$${entry}, volume=${volume}`);

  if (parseFloat(volume) <= 0) {
    throw new Error(`Position size too small: $${tradeCapital.toFixed(2)} capital at ${leverage}x = ${volume}`);
  }

  const type = direction.toLowerCase() === "long" ? "buy" : "sell";
  const closeType = type === "buy" ? "sell" : "buy";

  console.log(`Placing ${type} margin order: ${volume} ${symbol} at $${entry}`);

  // Place limit entry order
  const entryOrder = await krakenRequest("/0/private/AddOrder", {
    pair,
    type,
    ordertype: "limit",
    price: entry.toString(),
    volume,
    leverage: leverage.toString(),
    oflags: "post" // post-only limit order
  });

  console.log("Entry order:", JSON.stringify(entryOrder, null, 2));
  const txid = entryOrder.txid?.[0];

  // Place stop loss
  await krakenRequest("/0/private/AddOrder", {
    pair,
    type: closeType,
    ordertype: "stop-loss",
    price: stopLoss.toString(),
    volume,
    leverage: leverage.toString(),
    reduce_only: "true"
  });

  // Place take profit 1 (half size)
  const tp1Volume = (parseFloat(volume) / 2).toFixed(8);
  await krakenRequest("/0/private/AddOrder", {
    pair,
    type: closeType,
    ordertype: "take-profit",
    price: takeProfit1.toString(),
    volume: tp1Volume,
    leverage: leverage.toString(),
    reduce_only: "true"
  });

  // Place take profit 2 (remaining size)
  const tp2Volume = (parseFloat(volume) - parseFloat(tp1Volume)).toFixed(8);
  if (parseFloat(tp2Volume) > 0) {
    await krakenRequest("/0/private/AddOrder", {
      pair,
      type: closeType,
      ordertype: "take-profit",
      price: takeProfit2.toString(),
      volume: tp2Volume,
      leverage: leverage.toString(),
      reduce_only: "true"
    });
  }

  return {
    txid,
    symbol,
    pair,
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    volume: parseFloat(volume),
    leverage,
    capital: tradeCapital,
    balance,
    conviction
  };
}

// Get open positions
export async function getOpenPositions() {
  try {
    const result = await krakenRequest("/0/private/OpenPositions");
    return Object.values(result || {});
  } catch (error) {
    console.error("Failed to get open positions:", error.message);
    return [];
  }
}