#!/usr/bin/env node
/* Unified test runner for the Better Playa Guide website.
 * Runs the client suite, the API contract suite, and, when present, Fable's
 * deep retrieval suite (api/_retrieval.test.js). Any failure fails the run.
 *
 * Run: npm test   (or node test/run-all.js)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const suites = [
  path.join(repoRoot, 'test', 'client.test.js'),
  path.join(repoRoot, 'test', 'api-contract.test.js'),
  path.join(repoRoot, 'test', 'list-sync.test.js'),
  path.join(repoRoot, 'test', 'pdf-ics.test.js'),
  path.join(repoRoot, 'test', 'search.test.js'),
  path.join(repoRoot, 'test', 'rate-limit.test.js')
];
const retrieval = path.join(repoRoot, 'api', '_retrieval.test.js');
if (fs.existsSync(retrieval)) suites.push(retrieval);
else console.log('note: api/_retrieval.test.js not present yet, skipping the deep retrieval suite');

let failed = [];
for (const suite of suites) {
  const name = path.relative(repoRoot, suite);
  console.log('\n=== ' + name + ' ===');
  const r = spawnSync(process.execPath, [suite], { stdio: 'inherit', cwd: repoRoot });
  if (r.status !== 0) failed.push(name);
}

console.log('');
if (failed.length) {
  console.error('TEST RUN FAILED. Failing suites: ' + failed.join(', '));
  process.exit(1);
}
console.log('All suites green (' + suites.length + ' suites).');
