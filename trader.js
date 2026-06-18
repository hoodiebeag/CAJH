import Kraken from "kraken-api";

const client = new Kraken(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_API_SECRET
);

// Leverage scale by conviction (max 5x for US spot margin)
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

// Map symbol to Kraken pair (try both formats)
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

// Validate order without placing it
export async function validateTrade({ symbol, direction, entry, conviction }) {
  const pair = symbolToPair(symbol);
  const leverage = getLeverage(conviction);
  const sizePct = getPositionSizePct(conviction);
  const balance = await getAccountBalance();
  const tradeCapital = balance * sizePct;
  const currentPrice = await getCurrentPrice(symbol);
  const priceForCalc = entry || currentPrice;
  const volume = ((tradeCapital * leverage) / priceForCalc).toFixed(8);
  const type = direction.toLowerCase() === "long" ? "buy" : "sell";

  const orderParams = {
    pair,
    type,
    ordertype: entry ? "limit" : "market",
    volume,
    leverage: leverage.toString(),
    validate: true // dry run - no real order placed
  };

  if (entry) orderParams.price = entry.toString();

  console.log("Validating order:", JSON.stringify(orderParams));
  const response = await client.api("AddOrder", orderParams);
  console.log("Validation response:", JSON.stringify(response));
  return response;
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
  const closeType = type === "buy" ? "sell" : "buy";
  const isMarket = !entry;

  const orderParams = {
    pair,
    type,
    ordertype: isMarket ? "market" : "limit",
    volume,
    leverage: leverage.toString()
  };

  if (!isMarket) orderParams.price = entry.toString();

  console.log("Placing order:", JSON.stringify(orderParams));
  const entryOrder = await client.api("AddOrder", orderParams);
  console.log("Entry order response:", JSON.stringify(entryOrder));
  const txid = entryOrder.result?.txid?.[0];

  // Place stop loss
  if (stopLoss > 0) {
    await client.api("AddOrder", {
      pair,
      type: closeType,
      ordertype: "stop-loss",
      price: stopLoss.toString(),
      volume,
      leverage: leverage.toString()
    });
  }

  // Place take profit 1 (half size)
  if (takeProfit1 > 0) {
    const tp1Volume = (parseFloat(volume) / 2).toFixed(8);
    await client.api("AddOrder", {
      pair,
      type: closeType,
      ordertype: "take-profit",
      price: takeProfit1.toString(),
      volume: tp1Volume,
      leverage: leverage.toString()
    });

    // Take profit 2 (remaining)
    const tp2Volume = (parseFloat(volume) - parseFloat(tp1Volume)).toFixed(8);
    if (takeProfit2 > 0 && parseFloat(tp2Volume) > 0) {
      await client.api("AddOrder", {
        pair,
        type: closeType,
        ordertype: "take-profit",
        price: takeProfit2.toString(),
        volume: tp2Volume,
        leverage: leverage.toString()
      });
    }
  }

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