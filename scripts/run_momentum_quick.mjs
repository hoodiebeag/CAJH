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
    permutations: 100,
    bootstrapIterations: 200,
    seed: 20260806,
    minAssets: 8,
    recentHoldoutDates: 4
  };

  const result = runSealedMomentumPanelStudy(series, params);
  fs.mkdirSync('.assistant_snapshots', { recursive: true });
  fs.writeFileSync('.assistant_snapshots/momentum_run.json', JSON.stringify(result, null, 2));
  console.log('saved .assistant_snapshots/momentum_run.json');
})();
