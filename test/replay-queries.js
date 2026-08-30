/* Replay real (anonymous) user queries through the actual page and report
 * what each one answered. Input: a JSON array of query strings (file path in
 * argv[2]). Output: JSON lines {q, reply, n, top} on stdout.
 * Used by the daily query-review loop; safe, read-only.
 */
'use strict';
const fs = require('fs');
const { boot } = require('./_boot.js');

const queries = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const env = boot();
const BPG = env.BPG;

const out = [];
for (const q of queries) {
  let r;
  try { r = BPG.answer(String(q)); } catch (e) { r = { reply: 'THREW: ' + e.message, results: [] }; }
  out.push({
    q: String(q),
    reply: String(r.reply || '').slice(0, 200),
    n: (r.results || []).length,
    top: (r.results || []).slice(0, 3).map(e => e.t + ' @ ' + e.c)
  });
}
console.log(JSON.stringify(out));
