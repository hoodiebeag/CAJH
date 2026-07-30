/**
 * trail.mjs — Remove the take-profit ceiling; let runners run behind a trailing stop.
 *
 * Same minimal daily strategy (MA20 gate, ATR stop), but the fixed R target is replaced
 * by a generous ATR trailing stop, so a trade exits only when the trend actually turns.
 * The trade-off is explicit: no ceiling means the occasional very large winner, but
 * every winner gives back `trail` ATRs at the end, and the win rate falls.
 */
import "dotenv/config";
import { loadCandles } from "./data.js";
import { backtestMultiTF } from "./backtest.js";
import { symbolToKrakenId, loadConfig } from "./storage.js";

const watch=(process.env.WATCHLIST||"").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
const syms=watch.length?watch:(loadConfig().watchlist||[]).map(a=>a.symbol);
const ts=d=>Date.parse(d+"T00:00:00Z")/1000;
const W=[["2023",ts("2023-01-01"),ts("2024-01-01")],["2024",ts("2024-01-01"),ts("2025-01-01")],
         ["2025-26 bear",ts("2025-01-01"),ts("2027-01-01")],["ALL",0,ts("2027-01-01")]];
const BASE={entryTf:"1d",entryMode:"anticipate",trendGate:true,trendGateMode:"ma",trendMa:20,
  stopMode:"atr",atrStopK:3,alignMode:"none",chopFilter:false,requireHigherLow:false,
  lockBreakeven:false,minStopPct:null,maxStopPct:null,maxHold:400};

// tpR 99 = no reachable ceiling. trailR/trailStartR are in R (R = 3 ATR here).
const MODELS=[
  ["fixed 3R target (base)", {tpR:3}],
  ["no ceiling, trail 1R",   {tpR:99,trailR:1,trailStartR:1}],
  ["no ceiling, trail 2R",   {tpR:99,trailR:2,trailStartR:1}],
  ["no ceiling, trail 3R",   {tpR:99,trailR:3,trailStartR:1}],
  ["no ceiling, trail 2R after 2R",{tpR:99,trailR:2,trailStartR:2}],
  ["half@2R + trail 2R",     {tpR:99,trailR:2,trailStartR:1,partialAtR:2,partialFrac:0.5}],
];
const data=syms.map(s=>({sym:s,c:loadCandles(symbolToKrakenId(s),1440).slice(0,-1)})).filter(d=>d.c.length>120);
const stat=a=>{const n=a.length,m=n?a.reduce((x,y)=>x+y,0)/n:0;
  const sd=n>1?Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(n-1)):0;
  return{n,m,ci:n?1.96*sd/Math.sqrt(n):0,tot:m*n,wr:n?a.filter(x=>x>0).length/n:0,best:n?Math.max(...a):0};};

console.log(`\n=== No take-profit ceiling + trailing stop — ${data.length} pairs, daily ===\n`);
for(const [label,from,to] of W){
  console.log(`--- ${label} ---`);
  console.log("  exit model                     trades   net R/t          win%   total R   biggest win");
  for(const [name,extra] of MODELS){
    const all=[];
    for(const d of data){
      const c=d.c.filter(b=>{const t=+b.time;return t>=from&&t<to;});
      if(c.length<60) continue;
      all.push(...(backtestMultiTF({series:[{label:"1d",mins:1440,candles:c}]},{...BASE,...extra}).results||[]));
    }
    const s=stat(all);
    console.log(`  ${name.padEnd(30)} ${String(s.n).padStart(5)}   ${(s.m>=0?"+":"")+s.m.toFixed(3)} ±${s.ci.toFixed(3)}   `+
      `${(s.wr*100).toFixed(0).padStart(3)}%   ${(s.tot>=0?"+":"")+s.tot.toFixed(0).padStart(4)}R   ${s.best.toFixed(1)}R`);
  }
  console.log("");
}
