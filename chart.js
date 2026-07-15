/**
 * chart.js — Renders clean candlestick charts: dark navy theme, green frame,
 * candles + volume, and white swing-fractal arrows labeled with the pivot price.
 * No moving averages / bands / RSI — pure price structure, matching the strategy.
 */

import { createCanvas, registerFont } from "canvas";
import { detectSwings, SWING_WINDOW } from "./strategy.js";
import { fileURLToPath } from "url";
import path from "path";
import * as logger from './logger.js';

// Bundle a font so chart text renders even when the host has no system fonts
// installed (minimal containers). Must run before any canvas is created.
const __dir = path.dirname(fileURLToPath(import.meta.url));
try { registerFont(path.join(__dir, "fonts", "DejaVuSans.ttf"),      { family: "cajh", weight: "normal" }); }
catch (e) { logger.error("[CHART] font register (regular) failed:", e.message); }
try { registerFont(path.join(__dir, "fonts", "DejaVuSans-Bold.ttf"), { family: "cajh", weight: "bold"   }); }
catch (e) { logger.error("[CHART] font register (bold) failed:", e.message); }

const COLORS = {
  bg:        "#0e1320",
  panel:     "#0e1320",
  frame:     "#3fb950",
  grid:      "#1b2233",
  axisText:  "#9aa4b2",
  title:     "#e6edf3",
  bullish:   "#26a69a",
  bearish:   "#ef5350",
  volBull:   "rgba(38,166,154,0.45)",
  volBear:   "rgba(239,83,80,0.45)",
  arrow:     "#ffffff",
  priceLine: "#ef5350",
  watermark: "rgba(63,185,80,0.45)"
};

const W = 1456, H = 980;
const PAD = { top: 70, right: 92, bottom: 130, left: 14 };
const CANDLE_COUNT = 110;
const MAX_ARROWS   = 7;

function fmtPrice(p) {
  const d = p < 1 ? 5 : p < 100 ? 3 : 2;
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function niceStep(range, target = 6) {
  const raw  = range / target;
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function fmtTime(unixSec, interval) {
  const d = new Date(unixSec * 1000);
  if (interval === "4h") {
    return d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function generateChartImage(candles, symbol, interval) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const display = candles.slice(-CANDLE_COUNT).map(c => ({
    time:   parseInt(c.time),
    open:   parseFloat(c.open),
    high:   parseFloat(c.high),
    low:    parseFloat(c.low),
    close:  parseFloat(c.close),
    volume: parseFloat(c.volume)
  }));

  // Background + green frame
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = COLORS.frame;
  ctx.lineWidth = 3;
  roundRect(ctx, 6, 6, W - 12, H - 12, 18);
  ctx.stroke();

  const plotLeft   = PAD.left + 6;
  const plotRight  = W - PAD.right;
  const plotTop    = PAD.top;
  const plotW      = plotRight - plotLeft;
  const volH       = 90;
  const plotBottom = H - PAD.bottom;
  const priceH     = (plotBottom - plotTop) - volH - 20;
  const priceTop   = plotTop;
  const priceBot   = priceTop + priceH;

  // Price range with padding
  let minP = Math.min(...display.map(c => c.low));
  let maxP = Math.max(...display.map(c => c.high));
  const pad = (maxP - minP) * 0.08 || maxP * 0.01;
  minP -= pad; maxP += pad;
  const priceToY = p => priceBot - ((p - minP) / (maxP - minP)) * priceH;

  const n = display.length;
  const slot = plotW / n;
  const bodyW = Math.max(2, slot * 0.62);
  const indexToX = i => plotLeft + i * slot + slot / 2;

  // Title
  ctx.fillStyle = COLORS.title;
  ctx.font = "bold 26px cajh";
  ctx.textAlign = "left";
  ctx.fillText(`${symbol}USD · ${interval} · KRAKEN`, plotLeft + 10, 44);

  // Horizontal gridlines + price labels
  const step = niceStep(maxP - minP);
  ctx.textAlign = "left";
  ctx.font = "16px cajh";
  const firstLine = Math.ceil(minP / step) * step;
  for (let p = firstLine; p < maxP; p += step) {
    const y = priceToY(p);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotLeft, y); ctx.lineTo(plotRight, y); ctx.stroke();
    ctx.fillStyle = COLORS.axisText;
    ctx.fillText(fmtPrice(p), plotRight + 10, y + 5);
  }

  // Candles
  display.forEach((c, i) => {
    const x = indexToX(i);
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? COLORS.bullish : COLORS.bearish;
    ctx.fillStyle   = up ? COLORS.bullish : COLORS.bearish;
    ctx.lineWidth = 1.5;
    // wick
    ctx.beginPath();
    ctx.moveTo(x, priceToY(c.high));
    ctx.lineTo(x, priceToY(c.low));
    ctx.stroke();
    // body
    const yO = priceToY(c.open), yC = priceToY(c.close);
    const top = Math.min(yO, yC);
    const hgt = Math.max(1, Math.abs(yC - yO));
    ctx.fillRect(x - bodyW / 2, top, bodyW, hgt);
  });

  // Current price line + tag
  const last = display[n - 1].close;
  const ly = priceToY(last);
  ctx.strokeStyle = COLORS.priceLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(plotLeft, ly); ctx.lineTo(plotRight, ly); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.priceLine;
  ctx.fillRect(plotRight, ly - 13, PAD.right - 6, 26);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px cajh";
  ctx.textAlign = "left";
  ctx.fillText(fmtPrice(last), plotRight + 8, ly + 5);

  // Swing-fractal arrows (white), labeled with the pivot price. Most recent few only.
  const pivots = detectSwings(display, SWING_WINDOW).slice(-MAX_ARROWS);
  ctx.fillStyle = COLORS.arrow;
  ctx.strokeStyle = COLORS.arrow;
  ctx.font = "15px cajh";
  ctx.textAlign = "center";
  pivots.forEach(p => {
    const x = indexToX(p.index);
    if (p.type === "high") {
      const yTip = priceToY(p.price) - 10;     // above the high, pointing down
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, yTip - 16); ctx.lineTo(x, yTip - 4); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, yTip); ctx.lineTo(x - 5, yTip - 7); ctx.lineTo(x + 5, yTip - 7);
      ctx.closePath(); ctx.fill();
      ctx.fillText(fmtPrice(p.price), x, yTip - 22);
    } else {
      const yTip = priceToY(p.price) + 10;     // below the low, pointing up
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, yTip + 16); ctx.lineTo(x, yTip + 4); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, yTip); ctx.lineTo(x - 5, yTip + 7); ctx.lineTo(x + 5, yTip + 7);
      ctx.closePath(); ctx.fill();
      ctx.fillText(fmtPrice(p.price), x, yTip + 30);
    }
  });

  // Volume panel
  const volTop = priceBot + 20;
  const maxVol = Math.max(...display.map(c => c.volume)) || 1;
  display.forEach((c, i) => {
    const x = indexToX(i);
    const up = c.close >= c.open;
    ctx.fillStyle = up ? COLORS.volBull : COLORS.volBear;
    const h = (c.volume / maxVol) * volH;
    ctx.fillRect(x - bodyW / 2, volTop + (volH - h), bodyW, h);
  });

  // Time axis labels
  ctx.fillStyle = COLORS.axisText;
  ctx.font = "15px cajh";
  ctx.textAlign = "center";
  const labelEvery = Math.floor(n / 6);
  for (let i = 0; i < n; i += labelEvery) {
    ctx.fillText(fmtTime(display[i].time, interval), indexToX(i), H - PAD.bottom + volH + 50);
  }

  // Watermark
  ctx.fillStyle = COLORS.watermark;
  ctx.font = "bold 18px cajh";
  ctx.textAlign = "left";
  ctx.fillText("cajh", plotLeft + 10, H - 30);

  return canvas.toBuffer("image/png");
}
