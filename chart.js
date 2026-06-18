import { createCanvas } from "canvas";

const COLORS = {
  background: "#0d1117",
  grid: "#21262d",
  text: "#8b949e",
  textBright: "#e6edf3",
  bullish: "#26a69a",
  bearish: "#ef5350",
  ema20: "#f6c90e",
  ema50: "#7c4dff",
  volume: "#30363d",
  volumeBull: "rgba(38, 166, 154, 0.4)",
  volumeBear: "rgba(239, 83, 80, 0.4)"
};

// Calculate EMA
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const ema = [];
  let prevEma = null;

  for (let i = 0; i < data.length; i++) {
    const price = parseFloat(data[i].close);
    if (i < period - 1) {
      ema.push(null);
      continue;
    }
    if (prevEma === null) {
      // Seed with SMA
      const sum = data.slice(0, period).reduce((acc, c) => acc + parseFloat(c.close), 0);
      prevEma = sum / period;
      ema.push(prevEma);
    } else {
      prevEma = price * k + prevEma * (1 - k);
      ema.push(prevEma);
    }
  }
  return ema;
}

export function generateChartImage(candles, symbol, interval) {
  const width = 900;
  const height = 520;
  const paddingLeft = 75;
  const paddingRight = 20;
  const paddingTop = 45;
  const paddingBottom = 100; // extra space for volume
  const volumeHeight = 80;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const volumeY = paddingTop + chartHeight + 10;

  // Limit to last 100 candles for clarity
  const displayCandles = candles.slice(-100);

  const highs = displayCandles.map(c => parseFloat(c.high));
  const lows = displayCandles.map(c => parseFloat(c.low));
  const volumes = displayCandles.map(c => parseFloat(c.volume || 0));
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = maxPrice - minPrice || 1;
  const maxVolume = Math.max(...volumes) || 1;

  const candleWidth = Math.max(2, Math.floor(chartWidth / displayCandles.length) - 1);

  const priceToY = (price) =>
    paddingTop + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

  const indexToX = (i) =>
    paddingLeft + (i * chartWidth) / displayCandles.length + candleWidth / 2;

  // Grid lines and price labels
  const gridLines = 6;
  for (let i = 0; i <= gridLines; i++) {
    const y = paddingTop + (chartHeight / gridLines) * i;
    const price = maxPrice - (priceRange / gridLines) * i;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(width - paddingRight, y);
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(price.toFixed(2), paddingLeft - 5, y + 4);
  }

  // Volume bars
  displayCandles.forEach((candle, i) => {
    const x = indexToX(i);
    const open = parseFloat(candle.open);
    const close = parseFloat(candle.close);
    const vol = parseFloat(candle.volume || 0);
    const isBullish = close >= open;
    const barHeight = (vol / maxVolume) * volumeHeight;

    ctx.fillStyle = isBullish ? COLORS.volumeBull : COLORS.volumeBear;
    ctx.fillRect(x - candleWidth / 2, volumeY + volumeHeight - barHeight, candleWidth, barHeight);
  });

  // Volume label
  ctx.fillStyle = COLORS.text;
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.fillText("VOL", paddingLeft, volumeY + 10);

  // EMA lines
  const ema20 = calculateEMA(displayCandles, 20);
  const ema50 = calculateEMA(displayCandles, 50);

  const drawEMA = (emaData, color, label) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    emaData.forEach((val, i) => {
      if (val === null) return;
      const x = indexToX(i);
      const y = priceToY(val);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  drawEMA(ema20, COLORS.ema20, "EMA20");
  drawEMA(ema50, COLORS.ema50, "EMA50");

  // Candles
  displayCandles.forEach((candle, i) => {
    const x = indexToX(i);
    const open = parseFloat(candle.open);
    const close = parseFloat(candle.close);
    const high = parseFloat(candle.high);
    const low = parseFloat(candle.low);
    const isBullish = close >= open;

    ctx.strokeStyle = isBullish ? COLORS.bullish : COLORS.bearish;
    ctx.fillStyle = isBullish ? COLORS.bullish : COLORS.bearish;

    // Wick
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, priceToY(high));
    ctx.lineTo(x, priceToY(low));
    ctx.stroke();

    // Body
    const bodyTop = priceToY(Math.max(open, close));
    const bodyBottom = priceToY(Math.min(open, close));
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  });

  // Title bar
  ctx.fillStyle = COLORS.textBright;
  ctx.font = "bold 15px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${symbol}/USD`, paddingLeft, 28);

  ctx.fillStyle = COLORS.text;
  ctx.font = "13px monospace";
  ctx.fillText(`${interval}`, paddingLeft + 100, 28);

  // Latest price
  const latestClose = parseFloat(displayCandles[displayCandles.length - 1].close);
  const prevClose = parseFloat(displayCandles[displayCandles.length - 2]?.close || latestClose);
  const change = ((latestClose - prevClose) / prevClose * 100).toFixed(2);
  const changeColor = latestClose >= prevClose ? COLORS.bullish : COLORS.bearish;

  ctx.fillStyle = COLORS.textBright;
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`$${latestClose.toLocaleString()}`, width - paddingRight, 28);

  ctx.fillStyle = changeColor;
  ctx.font = "12px monospace";
  ctx.fillText(`${change >= 0 ? "+" : ""}${change}%`, width - paddingRight, 44);

  // EMA legend
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.ema20;
  ctx.fillText("EMA20", paddingLeft + 140, 28);
  ctx.fillStyle = COLORS.ema50;
  ctx.fillText("EMA50", paddingLeft + 210, 28);

  return canvas.toBuffer("image/png");
}