import axios from "axios";

// Parse RSS feed manually (no external parser needed)
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/;
  const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;

  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const titleMatch = titleRegex.exec(itemXml);
    const dateMatch = pubDateRegex.exec(itemXml);

    const title = titleMatch ? (titleMatch[1] || titleMatch[2] || "").trim() : "";
    const pubDate = dateMatch ? dateMatch[1].trim() : "";

    if (title) items.push({ title, pubDate });
  }
  return items;
}

// Fetch latest crypto news from CoinDesk RSS (free, no API key)
export async function fetchNews(symbol) {
  try {
    const response = await axios.get("https://www.coindesk.com/arc/outboundfeeds/rss/", {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const items = parseRSS(response.data);

    // Filter for relevant news (match symbol or general crypto terms)
    const symbolMap = {
      BTC: ["bitcoin", "btc"],
      ETH: ["ethereum", "eth"],
      SOL: ["solana", "sol"],
      BNB: ["bnb", "binance"],
      TAO: ["bittensor", "tao"]
    };

    const keywords = symbolMap[symbol] || [symbol.toLowerCase()];
    const generalTerms = ["crypto", "market", "defi", "sec", "regulation", "fed", "interest rate"];

    const relevant = items.filter(item => {
      const lower = item.title.toLowerCase();
      return keywords.some(k => lower.includes(k)) || generalTerms.some(k => lower.includes(k));
    });

    // Return top 5 relevant headlines, fall back to top 5 general if none found
    const headlines = relevant.length > 0 ? relevant.slice(0, 5) : items.slice(0, 5);
    return headlines.map(h => h.title);

  } catch (error) {
    console.error(`Failed to fetch news for ${symbol}:`, error.message);
    return [];
  }
}
