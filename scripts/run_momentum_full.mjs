import fs from "fs";
import { STABLE_13, runSealedMomentumPanelStudy } from "../momentum.mjs";
import { loadResearchCandles } from "../researchlab.mjs";
import { symbolToKrakenId } from "../researchlib.mjs";

(async () => {
  const universe = STABLE_13;
  const series = new Map();
  for (const s of universe) {
    const pair = symbolToKrakenId(s);
    try {
      const candles = loadResearchCandles(pair, 1440);
      series.set(s, candles);
    } catch (err) {
      console.error('skip', s, err.message);
    }
  }

  const params = {
    primaryUniverse: [...universe],
    permutations: 2000,
    bootstrapIterations: 2000,
    seed: 20260806,
    minAssets: 8,
    recentHoldoutDates: 4
  };

  console.log('starting high-fidelity momentum run', params);
  const result = runSealedMomentumPanelStudy(series, params);
  fs.mkdirSync('.assistant_snapshots', { recursive: true });
  const file = '.assistant_snapshots/momentum_full_run.json';
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log('saved', file);
})();
