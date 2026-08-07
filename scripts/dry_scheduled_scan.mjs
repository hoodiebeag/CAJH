import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cajh-scan-'));
process.env.DATA_DIR = tmp;

// Import after setting DATA_DIR so storage.js picks up the temp directory
const { runScanner } = await import('../scanner.js');
const { STABLE_13 } = await import('../momentum.mjs');
const { symbolToKrakenId } = await import('../storage.js');

const state = { watchlist: STABLE_13.map(s => ({ symbol: s, id: symbolToKrakenId(s) })) };

const outDir = path.join(process.cwd(), '.assistant_snapshots');
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, 'dry_scan.log');

const channel = {
  async send(msg) {
    try {
      fs.appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), msg: typeof msg === 'string' ? msg : (msg.content || msg) }) + '\n');
    } catch (e) { /* ignore */ }
    console.log('CHANNEL>', typeof msg === 'string' ? msg : (msg.content || JSON.stringify(msg)));
  }
};

(async () => {
  console.log('DATA_DIR for scan:', process.env.DATA_DIR);
  try {
    await runScanner(channel, state, true);
  } catch (err) {
    console.error('scan error', err.message);
  }

  // copy decision journal if present
  const dj = path.join(process.env.DATA_DIR, 'decision-journal.jsonl');
  if (fs.existsSync(dj)) {
    fs.copyFileSync(dj, path.join(outDir, 'decision-journal.dry.jsonl'));
    console.log('copied decision-journal to .assistant_snapshots/decision-journal.dry.jsonl');
  } else {
    console.log('no decision-journal created in DATA_DIR');
  }
})();
