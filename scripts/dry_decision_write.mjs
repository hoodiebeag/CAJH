import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cajh-dry-'));
process.env.DATA_DIR = dir;

const logger = await import('../logger.js');
const storage = await import('../storage.js');

console.log('DATA_DIR:', process.env.DATA_DIR);

const record = logger.recordDecision({
  symbol: 'DRYTEST',
  timeframe: '1h',
  taken: false,
  reason: 'dry-run persistence test',
  entry: 123,
  stop: 120,
  takeProfit: 130,
  risk: 3,
  regime: { '1h': 'bull' }
}, { sink: storage.appendDecisionEvent });

console.log('REC:', record);
const journal = storage.loadDecisionJournal({ limit: 10 });
console.log('JOURNAL LENGTH:', journal.length);
console.log('JOURNAL LAST:', JSON.stringify(journal.slice(-1), null, 2));
