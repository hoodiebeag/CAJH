import fs from 'fs';
import path from 'path';

const out = path.join(process.cwd(), '.assistant_snapshots', 'keepalive.log');
fs.mkdirSync(path.dirname(out), { recursive: true });

function heartbeat() {
  const ts = new Date().toISOString();
  const line = `${ts} KEEPALIVE\n`;
  try { fs.appendFileSync(out, line); } catch (e) { /* ignore write errors */ }
  console.log(line.trim());
}

heartbeat();
setInterval(heartbeat, 10 * 60 * 1000);

// prevent exit
process.stdin.resume();
