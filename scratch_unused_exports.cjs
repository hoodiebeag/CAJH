const fs = require('fs');

const allFiles = fs.readFileSync('files.txt', 'utf8').trim().split('\n');
const allSrc = {};
for (const f of allFiles) allSrc[f] = fs.readFileSync(f, 'utf8');

const targetFiles = allFiles.filter(f => !/\.test\.mjs$/.test(f) && !/\.test\.js$/.test(f));

const exportRe = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)|export\s+const\s+([A-Za-z0-9_$]+)/g;

for (const f of targetFiles) {
  const src = allSrc[f];
  let m;
  exportRe.lastIndex = 0;
  while ((m = exportRe.exec(src))) {
    const name = m[1] || m[2];
    if (!name) continue;
    let elsewhereCount = 0;
    for (const [other, osrc] of Object.entries(allSrc)) {
      if (other === f) continue;
      const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b', 'g');
      const matches = osrc.match(re);
      if (matches) elsewhereCount += matches.length;
    }
    if (elsewhereCount === 0) {
      const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b', 'g');
      const selfMatches = (src.match(re) || []).length; // includes the declaration itself
      console.log(`${f}: ${name} — 0 elsewhere, ${selfMatches} self-occurrences (incl. decl)`);
    }
  }
}
