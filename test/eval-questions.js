/* Burner-question eval harness: runs ~200 realistic queries through the REAL
 * page (jsdom) via both the live filter and the Ask pipeline, and grades:
 *   PASS  expect-regex matched in results (or, with no expect, results > 0)
 *   MISS  expect-regex set but not matched
 *   EMPTY no expect set and zero results (soft: data may genuinely lack it)
 * Run:  node test/eval-questions.js [--fails]
 * This is an eval, not a deploy gate: it reports rates, exits 0 unless the
 * ground-truthed pass rate drops below 90% (that IS a regression).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { boot } = require('./_boot.js');

const manual = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'burner-questions-manual.json'), 'utf8'));
let auto = [];
try { auto = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'burner-questions-auto.json'), 'utf8')); } catch (e) {}
const QS = manual.concat(auto);

const env = boot();
const d = env.document, w = env.window, BPG = env.BPG;

function runFilter(q) {
  const el = d.getElementById('ask-q');
  el.value = q;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
  return { n: d.querySelectorAll('#list li').length, text: d.getElementById('list').textContent };
}

let pass = 0, miss = 0, empty = 0, gt = 0, gtPass = 0;
const failures = [];
for (const item of QS) {
  const f = runFilter(item.q);
  let a = null;
  try { a = BPG.answer(item.q); } catch (e) { a = { reply: 'THREW: ' + e.message, results: [] }; }
  const askN = (a && a.results && a.results.length) || 0;
  const hay = f.text + ' ' + ((a && a.reply) || '') + ' ' + JSON.stringify((a && a.results || []).slice(0, 8));
  if (item.expect) {
    gt++;
    if (new RegExp(item.expect, 'i').test(hay)) { pass++; gtPass++; }
    else { miss++; failures.push({ q: item.q, kind: item.kind, why: 'expected /' + item.expect + '/i, filter=' + f.n + ' ask=' + askN + ' reply="' + String(a && a.reply || '').slice(0, 90) + '"' }); }
  } else {
    if (f.n > 0 || askN > 0) pass++;
    else { empty++; failures.push({ q: item.q, kind: item.kind, why: 'zero results (no ground truth; data gap or search gap)' }); }
  }
}

console.log('eval: ' + QS.length + ' questions | pass ' + pass + ' | ground-truth miss ' + miss + ' | empty ' + empty);
console.log('ground-truthed pass rate: ' + gtPass + '/' + gt + ' (' + Math.round(100 * gtPass / Math.max(1, gt)) + '%)');
if (process.argv.includes('--fails') || failures.length) {
  failures.forEach(f => console.log('  [' + f.kind + '] "' + f.q + '" -> ' + f.why));
}
if (gt && gtPass / gt < 0.9) { console.error('EVAL REGRESSION: ground-truthed pass rate under 90%'); process.exit(1); }
