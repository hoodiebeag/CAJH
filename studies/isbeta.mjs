/**
 * isbeta.mjs — Is the simple daily strategy an edge, or just long exposure?
 *
 * The strategy is positive exactly in the years the market was up and negative in the
 * year it was down, which is the signature of beta. This isolates the entry: same
 * daily bars, same MA20 trend gate, same 3-ATR stop and 3R target, but entries placed
 * at RANDOM bars that pass the gate. If random-in-an-uptrend performs like the swing
 * trigger, the trigger contributes nothing and the trend gate is the entire strategy.
 */
import "dotenv/config";
import { loadCandles } from "../data.js";
import { backtestMultiTF } from "../backtest.js";
import { atr } from "../features.js";
import { loadWatchlist, symbolToKrakenId, ts, stat } from "../researchlib.mjs";

const syms=loadWatchlist();
const FEE=0.004,SLIP=0.0005,K=3,TP=3;

const WINDOWS=[["2023",ts("2023-01-01"),ts("2024-01-01")],["2024",ts("2024-01-01"),ts("2025-01-01")],
               ["2025-26",ts("2025-01-01"),ts("2027-01-01")],["ALL",0,ts("2027-01-01")]];
const SIMPLE={entryTf:"1d",entryMode:"anticipate",trendGate:true,trendGateMode:"ma",trendMa:20,
  stopMode:"atr",atrStopK:K,alignMode:"none",chopFilter:false,requireHigherLow:false,
  lockBreakeven:false,minStopPct:null,maxStopPct:null,tpR:TP};

// Random entries, but only on bars where the same MA20 gate is satisfied.
function randomGated(candles,count,seed){
  const H=candles.map(c=>+c.high),L=candles.map(c=>+c.low),C=candles.map(c=>+c.close);
  const ok=[]; let sum=0;
  for(let i=0;i<C.length;i++){ sum+=C[i]; if(i>=20) sum-=C[i-20];
    if(i>=19 && C[i]>sum/20 && i>20 && i<C.length-60) ok.push(i); }
  if(!ok.length) return [];
  let s=seed; const rnd=()=>(s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff;
  const out=[];
  for(let t=0;t<count;t++){
    const i=ok[Math.floor(rnd()*ok.length)];
    const a=atr(H,L,C,i-1,14); if(!a) continue;
    const entry=C[i],stop=entry-K*a,risk=entry-stop,tp=entry+TP*risk;
    let r=null;
    for(let j=i+1;j<Math.min(C.length,i+100);j++){
      if(L[j]<=stop){r=-1-(FEE+SLIP)*(entry+stop)/risk;break;}
      if(H[j]>=tp){r=TP-(FEE+SLIP)*(entry+tp)/risk;break;}
    }
    if(r==null){const px=C[Math.min(C.length-1,i+100)];r=(px-entry)/risk-(FEE+SLIP)*(entry+px)/risk;}
    out.push(r);
  }
  return out;
}
const data=syms.map(s=>({sym:s,candles:loadCandles(symbolToKrakenId(s),1440).slice(0,-1)})).filter(d=>d.candles.length>120);
console.log(`\n=== Entry vs random-in-uptrend — ${data.length} pairs, daily ===\n`);
console.log("window     swing entry              random (same gate)       difference");
console.log("-".repeat(78));
for(const [label,from,to] of WINDOWS){
  const real=[],rand=[];
  data.forEach((d,idx)=>{
    const candles=d.candles.filter(c=>{const t=+c.time;return t>=from&&t<to;});
    if(candles.length<60) return;
    const r=backtestMultiTF({series:[{label:"1d",mins:1440,candles}]},SIMPLE);
    real.push(...(r.results||[]));
    rand.push(...randomGated(candles,r.trades,9871+idx));
  });
  const a=stat(real),b=stat(rand);
  const diff=a.mean-b.mean, se=Math.sqrt(a.se**2+b.se**2);
  console.log(`${label.padEnd(10)} ${String(a.n).padStart(4)}t ${(a.mean>=0?"+":"")+a.mean.toFixed(3)} ±${a.ci.toFixed(3)}   `+
    `${String(b.n).padStart(4)}t ${(b.mean>=0?"+":"")+b.mean.toFixed(3)} ±${b.ci.toFixed(3)}   `+
    `${(diff>=0?"+":"")+diff.toFixed(3)} ±${(1.96*se).toFixed(3)} ${Math.abs(diff)<1.96*se?"(same)":diff>0?"(entry helps)":"(entry hurts)"}`);
}
console.log("");
