import Kraken from "kraken-api";

const client = new Kraken(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_API_SECRET
);

// Leverage scale by conviction
function getLeverage(conviction) {
  if (conviction >= 10) return 5;
  if (conviction >= 9) return 4;
  if (conviction >= 8) return 3;
  if (conviction >= 7) return 2;
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

// Map symbol to Kraken pair
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

// Get available USD balance
export async function getAccountBalance() {
  const response = await client.api("Balance");
  console.log("Balance response:", JSON.stringify(response.result));
  const balance = parseFloat(response.result?.ZUSD || response.result?.USD || 0);
  console.log(`Available balance: $${balance}`);
  return balance;
}

// Get current price
export async function getCurrentPrice(symbol) {
  const pair = symbolToPair(symbol);
  try {
    const response = await client.api("Ticker", { pair });
    const ticker = Object.values(response.result)[0];
    return parseFloat(ticker?.c?.[0] || 0);
  } catch (error) {
    console.error(`Failed to get price for ${symbol}:`, error.message);
    return null;
  }
}

// Place a margin trade (entry only for now, SL/TP added after fill)
export async function placeTrade({ symbol, direction, entry, stopLoss, takeProfit1, takeProfit2, conviction }) {
  const pair = symbolToPair(symbol);
  const leverage = getLeverage(conviction);
  const sizePct = getPositionSizePct(conviction);

  const balance = await getAccountBalance();
  const tradeCapital = balance * sizePct;
  const volume = ((tradeCapital * leverage) / entry).toFixed(8);

  console.log(`Trade: balance=$${balance}, capital=$${tradeCapital}, leverage=${leverage}x, volume=${volume}`);

  if (parseFloat(volume) <= 0) {
    throw new Error(`Position size too small: $${tradeCapital.toFixed(2)} at ${leverage}x = ${volume}`);
  }

  const type = direction.toLowerCase() === "long" ? "buy" : "sell";

  // Place entry limit order
  const entryOrder = await client.api("AddOrder", {
    pair,
    type,
    ordertype: "limit",
    price: entry.toString(),
    volume,
    leverage: leverage.toString()
  });

  console.log("Entry order placed:", JSON.stringify(entryOrder));
  const txid = entryOrder.result?.txid?.[0];

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
    const response = await client.api("OpenPositions");
    return Object.values(response.result || {});
  } catch (error) {
    console.error("Failed to get open positions:", error.message);
    return [];
  }
}