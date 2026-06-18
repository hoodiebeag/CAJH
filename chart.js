import { createCanvas } from "canvas";
import { detectSwings, SWING_WINDOW } from "./strategy.js";

const COLORS = {
  background: "#0d1117",
  grid: "#21262d",
  text: "#8b949e",
  textBright: "#e6edf3",
  bullish: "#26a69a",
  bearish: "#ef5350",
  ema20: "#f6c90e",
  ema50: "#7c4dff",
  vwap: "#00bcd4",
  bbUpper: "#ff9800",
  bbLower: "#ff9800",
  bbMiddle: "#ff980066",
  rsiLine: "#e91e63",
  rsiOverbought: "#ef535066",
  rsiOversold: "#26a69a66",
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
    if (i < period - 1) { ema.push(null); continue; }
    if (prevEma === null) {
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

// Calculate Bollinger Bands
function calculateBollingerBands(data, period = 20, stdDev = 2) {
  const upper = [], middle = [], lower = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { upper.push(null); middle.push(null); lower.push(null); continue; }
    const slice = data.slice(i - period + 1, i + 1).map(c => parseFloat(c.close));
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    upper.push(mean + stdDev * std);
    middle.push(mean);
    lower.push(mean - stdDev * std);
  }
  return { upper, middle, lower };
}

// Calculate VWAP
function calculateVWAP(data) {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  return data.map(c => {
    const typicalPrice = (parseFloat(c.high) + parseFloat(c.low) + parseFloat(c.close)) / 3;
    const volume = parseFloat(c.volume) || 0;
    cumulativeTPV += typicalPrice * volume;
    cumulativeVolume += volume;
    return cumulativeVolume === 0 ? null : cumulativeTPV / cumulativeVolume;
  });
}

// Calculate RSI
function calculateRSI(data, period = 14) {
  const rsi = [];
  let avgGain = 0, avgLoss = 0;

  for (let i = 0; i < data.length; i++) {
    if (i === 0) { rsi.push(null); continue; }
    const change = parseFloat(data[i].close) - parseFloat(data[i - 1].close);
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);

    if (i < period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      rsi.push(null);
      continue;
    }

    if (i === period) {
      rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 0.001)));
      continue;
    }

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 0.001)));
  }
  return rsi;
}

// Detect order blocks (last significant bearish/bullish candle before a strong move)
function detectOrderBlocks(data, lookback = 20) {
  const blocks = [];
  for (let i = lookback; i < data.length - 3; i++) {
    const candle = data[i];
    const open = parseFloat(candle.open);
    const close = parseFloat(candle.close);
    const high = parseFloat(candle.high);
    const low = parseFloat(candle.low);
    const bodySize = Math.abs(close - open);
    const nextClose = parseFloat(data[i + 3].close);

    // Bullish order block: bearish candle followed by strong bullish move
    if (close < open && nextClose > high * 1.005) {
      blocks.push({ type: "bull", top: high, bottom: low, index: i });
    }
    // Bearish order block: bullish candle followed by strong bearish move
    if (close > open && nextClose < low * 0.995) {
      blocks.push({ type: "bear", top: high, bottom: low, index: i });
    }
  }
  return blocks.slice(-3); // only show last 3
}

// Detect Fair Value Gaps
function detectFVGs(data) {
  const fvgs = [];
  for (let i = 1; i < data.length - 1; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    const next = data[i + 1];

    // Bullish FVG: gap between prev high and next low
    if (parseFloat(next.low) > parseFloat(prev.high)) {
      fvgs.push({ type: "bull", top: parseFloat(next.low), bottom: parseFloat(prev.high), index: i });
    }
    // Bearish FVG: gap between next high and prev low
    if (parseFloat(next.high) < parseFloat(prev.low)) {
      fvgs.push({ type: "bear", top: parseFloat(prev.low), bottom: parseFloat(next.high), index: i });
    }
  }
  return fvgs.slice(-3); // only show last 3
}

export function generateChartImage(candles, symbol, interval) {
  const width = 1000;
  const rsiHeight = 100;
  const volumeHeight = 70;
  const paddingLeft = 80;
  const paddingRight = 20;
  const paddingTop = 50;
  const paddingBottom = 30;
  const gapBetween = 10;
  const totalHeight = paddingTop + 420 + gapBetween + volumeHeight + gapBetween + rsiHeight + paddingBottom;

  const canvas = createCanvas(width, totalHeight);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, totalHeight);

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = 420;
  const chartTop = paddingTop;
  const volumeTop = chartTop + chartHeight + gapBetween;
  const rsiTop = volumeTop + volumeHeight + gapBetween;

  // Limit to last 100 candles
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
    chartTop + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

  const indexToX = (i) =>
    paddingLeft + (i * chartWidth) / displayCandles.length + candleWidth / 2;

  // Calculate indicators
  const ema20 = calculateEMA(displayCandles, 20);
  const ema50 = calculateEMA(displayCandles, 50);
  const bb = calculateBollingerBands(displayCandles);
  const vwap = calculateVWAP(displayCandles);
  const rsi = calculateRSI(displayCandles);
  const orderBlocks = detectOrderBlocks(displayCandles);
  const fvgs = detectFVGs(displayCandles);

  // Grid lines
  const gridLines = 6;
  for (let i = 0; i <= gridLines; i++) {
    const y = chartTop + (chartHeight / gridLines) * i;
    const price = maxPrice - (priceRange / gridLines) * i;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(width - paddingRight, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(price.toFixed(2), paddingLeft - 5, y + 4);
  }

  // Draw FVGs
  fvgs.forEach(fvg => {
    const y1 = priceToY(fvg.top);
    const y2 = priceToY(fvg.bottom);
    ctx.fillStyle = fvg.type === "bull" ? "rgba(38,166,154,0.15)" : "rgba(239,83,80,0.15)";
    ctx.fillRect(paddingLeft, Math.min(y1, y2), chartWidth, Math.abs(y2 - y1));
  });

  // Draw Order Blocks
  orderBlocks.forEach(ob => {
    const y1 = priceToY(ob.top);
    const y2 = priceToY(ob.bottom);
    ctx.fillStyle = ob.type === "bull" ? "rgba(38,166,154,0.25)" : "rgba(239,83,80,0.25)";
    ctx.strokeStyle = ob.type === "bull" ? COLORS.bullish : COLORS.bearish;
    ctx.lineWidth = 1;
    ctx.fillRect(paddingLeft, Math.min(y1, y2), chartWidth, Math.abs(y2 - y1));
    ctx.strokeRect(paddingLeft, Math.min(y1, y2), chartWidth, Math.abs(y2 - y1));

    // Label
    ctx.fillStyle = ob.type === "bull" ? COLORS.bullish : COLORS.bearish;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText(ob.type === "bull" ? "OB↑" : "OB↓", paddingLeft + 2, Math.min(y1, y2) - 2);
  });

  // Bollinger Bands
  const drawLine = (dataArr, color, lineWidth = 1, dash = []) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    dataArr.forEach((val, i) => {
      if (val === null) return;
      const x = indexToX(i);
      const y = priceToY(val);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  drawLine(bb.upper, COLORS.bbUpper, 1, [4, 2]);
  drawLine(bb.lower, COLORS.bbLower, 1, [4, 2]);
  drawLine(bb.middle, COLORS.bbMiddle, 1, [2, 2]);

  // EMA lines
  drawLine(ema20, COLORS.ema20, 1.5);
  drawLine(ema50, COLORS.ema50, 1.5);

  // VWAP
  drawLine(vwap, COLORS.vwap, 2);

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
    ctx.lineWidth = 1;

    // Wick
    ctx.beginPath();
    ctx.moveTo(x, priceToY(high));
    ctx.lineTo(x, priceToY(low));
    ctx.stroke();

    // Body
    const bodyTop = priceToY(Math.max(open, close));
    const bodyBottom = priceToY(Math.min(open, close));
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, Math.max(1, bodyBottom - bodyTop));
  });

  // Swing-fractal arrows — the actual trade signals.
  // Green up-arrow under a confirmed swing low (buy); red down-arrow over a swing high (sell).
  detectSwings(displayCandles, SWING_WINDOW).forEach(p => {
    const x = indexToX(p.index);
    if (p.type === "low") {
      const y = priceToY(parseFloat(displayCandles[p.index].low)) + 6;
      ctx.fillStyle = COLORS.bullish;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 9); ctx.lineTo(x + 5, y + 9);
      ctx.closePath(); ctx.fill();
    } else {
      const y = priceToY(parseFloat(displayCandles[p.index].high)) - 6;
      ctx.fillStyle = COLORS.bearish;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 9); ctx.lineTo(x + 5, y - 9);
      ctx.closePath(); ctx.fill();
    }
  });

  // Volume bars
  displayCandles.forEach((candle, i) => {
    const x = indexToX(i);
    const open = parseFloat(candle.open);
    const close = parseFloat(candle.close);
    const vol = parseFloat(candle.volume || 0);
    const isBullish = close >= open;
    const barHeight = (vol / maxVolume) * volumeHeight;
    ctx.fillStyle = isBullish ? COLORS.volumeBull : COLORS.volumeBear;
    ctx.fillRect(x - candleWidth / 2, volumeTop + volumeHeight - barHeight, candleWidth, barHeight);
  });

  // Volume label
  ctx.fillStyle = COLORS.text;
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("VOLUME", paddingLeft, volumeTop + 10);

  // RSI panel
  ctx.fillStyle = COLORS.grid;
  ctx.fillRect(paddingLeft, rsiTop, chartWidth, rsiHeight);

  // RSI overbought/oversold zones
  const rsiToY = (val) => rsiTop + rsiHeight - (val / 100) * rsiHeight;
  ctx.fillStyle = COLORS.rsiOverbought;
  ctx.fillRect(paddingLeft, rsiToY(70), chartWidth, rsiToY(100) - rsiToY(70));
  ctx.fillStyle = COLORS.rsiOversold;
  ctx.fillRect(paddingLeft, rsiToY(30), chartWidth, rsiToY(0) - rsiToY(30));

  // RSI lines at 70 and 30
  [70, 50, 30].forEach(level => {
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, rsiToY(level));
    ctx.lineTo(width - paddingRight, rsiToY(level));
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText(level, paddingLeft - 3, rsiToY(level) + 3);
  });

  // RSI line
  ctx.strokeStyle = COLORS.rsiLine;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let rsiStarted = false;
  rsi.forEach((val, i) => {
    if (val === null) return;
    const x = indexToX(i);
    const y = rsiToY(val);
    if (!rsiStarted) { ctx.moveTo(x, y); rsiStarted = true; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // RSI label + current value
  const lastRsi = rsi.filter(v => v !== null).pop();
  ctx.fillStyle = COLORS.rsiLine;
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`RSI ${lastRsi ? lastRsi.toFixed(1) : ""}`, paddingLeft + 2, rsiTop + 10);

  // Title bar
  ctx.fillStyle = COLORS.textBright;
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${symbol}/USD`, paddingLeft, 30);

  ctx.fillStyle = COLORS.text;
  ctx.font = "12px monospace";
  ctx.fillText(interval, paddingLeft + 95, 30);

  // Latest price and change
  const latestClose = parseFloat(displayCandles[displayCandles.length - 1].close);
  const prevClose = parseFloat(displayCandles[displayCandles.length - 2]?.close || latestClose);
  const change = ((latestClose - prevClose) / prevClose * 100).toFixed(2);

  ctx.fillStyle = COLORS.textBright;
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`$${latestClose.toLocaleString()}`, width - paddingRight, 20);

  ctx.fillStyle = latestClose >= prevClose ? COLORS.bullish : COLORS.bearish;
  ctx.font = "11px monospace";
  ctx.fillText(`${change >= 0 ? "+" : ""}${change}%`, width - paddingRight, 35);

  // Legend
  const legend = [
    { label: "EMA20", color: COLORS.ema20 },
    { label: "EMA50", color: COLORS.ema50 },
    { label: "VWAP", color: COLORS.vwap },
    { label: "BB", color: COLORS.bbUpper },
  ];
  let legendX = paddingLeft + 140;
  legend.forEach(item => {
    ctx.fillStyle = item.color;
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(item.label, legendX, 30);
    legendX += ctx.measureText(item.label).width + 15;
  });

  return canvas.toBuffer("image/png");
}