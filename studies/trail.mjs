/**
 * trail.mjs — Remove the take-profit ceiling; let runners run behind a trailing stop.
 *
 * Same minimal daily strategy (MA20 gate, ATR stop), but the fixed R target is replaced
 * by a generous ATR trailing stop, so a trade exits only when the trend actually turns.
 * The trade-off is explicit: no ceiling means the occasional very large winner, but
 * every winner gives back `trail` ATRs at the end, and the win rate falls.
 */
import "dotenv/config";
import { loadCandles } from "../data.js";
import { backtestMultiTF } from "../backtest.js";
import { loadWatchlist, symbolToKrakenId, ts, stat } from "../researchlib.mjs";

const syms=loadWatchlist();
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
    console.log(`  ${name.padEnd(30)} ${String(s.n).padStart(5)}   ${(s.mean>=0?"+":"")+s.mean.toFixed(3)} ±${s.ci.toFixed(3)}   `+
      `${(s.wr*100).toFixed(0).padStart(3)}%   ${(s.total>=0?"+":"")+s.total.toFixed(0).padStart(4)}R   ${s.best.toFixed(1)}R`);
  }
  console.log("");
}
