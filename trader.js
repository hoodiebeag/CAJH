import Kraken from "kraken-api";

const client = new Kraken(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_API_SECRET
);

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

// Map symbol to Kraken pair
function symbolToPair(symbol) {
  const pairMap = {
    BTC: "BTC/USD",
    ETH: "ETH/USD",
    SOL: "SOL/USD",
    BNB: "BNB/USD",
    TAO: "TAO/USD",
    XRP: "XRP/USD",
    ADA: "ADA/USD",
    DOGE: "DOGE/USD",
    AVAX: "AVAX/USD",
    LINK: "LINK/USD",
    LTC: "LTC/USD",
    DOT: "DOT/USD"
  };
  return pairMap[symbol.toUpperCase()] || `${symbol.toUpperCase()}/USD`;
}

// Get available USD balance
export async function getAccountBalance() {
  const response = await client.api("Balance");
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

// Place a margin trade
export async function placeTrade({ symbol, direction, entry, stopLoss, takeProfit1, takeProfit2, conviction }) {
  const pair = symbolToPair(symbol);
  const leverage = getLeverage(conviction);
  const sizePct = getPositionSizePct(conviction);

  const balance = await getAccountBalance();
  const tradeCapital = balance * sizePct;
  const currentPrice = await getCurrentPrice(symbol);
  const priceForCalc = entry || currentPrice;
  const volume = ((tradeCapital * leverage) / priceForCalc).toFixed(8);

  console.log(`Trade: balance=$${balance}, capital=$${tradeCapital}, leverage=${leverage}x, volume=${volume}, pair=${pair}`);

  if (parseFloat(volume) <= 0) {
    throw new Error(`Position size too small: $${tradeCapital.toFixed(2)} at ${leverage}x = ${volume}`);
  }

  const type = direction.toLowerCase() === "long" ? "buy" : "sell";
  const isMarket = !entry;

  // Place entry order (market or limit)
  const orderParams = {
    pair,
    type,
    ordertype: isMarket ? "market" : "limit",
    volume,
    leverage: leverage.toString()
  };

  if (!isMarket) {
    orderParams.price = entry.toString();
  }

  console.log("Placing order:", JSON.stringify(orderParams));
  const entryOrder = await client.api("AddOrder", orderParams);
  console.log("Entry order response:", JSON.stringify(entryOrder));
  const txid = entryOrder.result?.txid?.[0];

  return {
    txid,
    symbol,
    pair,
    direction,
    entry: entry || currentPrice,
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