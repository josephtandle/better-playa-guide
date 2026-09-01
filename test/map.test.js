#!/usr/bin/env node
/* Map page contract tests: boots the REAL map.html + data.js + guide.js +
 * map.js in jsdom and exercises the potty layer, anchors, and GPS plumbing. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const repoRoot = path.resolve(__dirname, '..');
let passed = 0; const failures = [];
function ok(c, name){ if (c) passed++; else failures.push(name); }

const HTML = fs.readFileSync(path.join(repoRoot, 'guide', 'map.html'), 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '');
const DATA = fs.readFileSync(path.join(repoRoot, 'guide', 'data.js'), 'utf8');
const GUIDE = fs.readFileSync(path.join(repoRoot, 'guide', 'guide.js'), 'utf8');
const MAPJS = fs.readFileSync(path.join(repoRoot, 'guide', 'map.js'), 'utf8');

function bootMap(url){
  const dom = new JSDOM(HTML, { url: url || 'https://musecafe.vip/guide/map', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (!w.matchMedia) w.matchMedia = function(){ return { matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }; };
  w.eval(DATA);
  w.eval(MAPJS);   /* real load order: map.js defines window.initMap, guide.js calls it */
  w.eval(GUIDE);
  if (w.document.readyState === 'loading') w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return { w, d: w.document };
}

(function(){
  const { w, d } = bootMap();
  ok(!!w.__BPG_MAP, 'map initialises on the real map page');
  ok(w.__BPG_MAP.pottyCount() === 45, 'all 45 official toilet banks are drawn (' + w.__BPG_MAP.pottyCount() + ')');
  const labels = w.__BPG_MAP.anchorLabels();
  ok(labels.length >= 6, 'at least 6 anchor labels survive declutter (' + labels.length + ')');
  ok(labels.indexOf('Muse Cafe') !== -1, 'Muse Cafe is an anchor');
  ok(labels.indexOf('Center Camp') === -1, 'Center Camp anchor removed (GIS landmark already labels it, was double-printing)');
  /* potty layer hidden until toggled */
  const pg = d.querySelectorAll('svg g g')[0];
  ok(d.getElementById('map-potty-btn') && d.getElementById('map-gps-btn'), 'potty + GPS buttons exist in the chrome');
  const before = d.querySelector('svg').innerHTML.indexOf('display="none"') !== -1;
  ok(before, 'potty layer starts hidden');
  w.__BPG_MAP.setPotty(true);
  ok(d.getElementById('map-potty-btn').classList.contains('solid'), 'toggling potty mode lights the button');
  /* declutter really prevents overlap: no two kept label boxes intersect */
  const texts = [];
  d.querySelectorAll('svg g g text').forEach(function(t){ texts.push({ x:+t.getAttribute('x'), y:+t.getAttribute('y'), n:t.textContent }); });
  let overlap = false;
  for (let i=0;i<texts.length;i++) for (let j=i+1;j<texts.length;j++){
    const a=texts[i], b=texts[j];
    const wA=a.n.length*165, wB=b.n.length*165;
    if (Math.abs(a.y-b.y) < 340 && Math.abs(a.x-b.x) < (wA+wB)/2) overlap = true;
  }
  ok(!overlap, 'no two anchor labels overlap');
})();

(function(){
  /* #potty deep link turns the layer on at load without crashing (vb init order) */
  const { w, d } = bootMap('https://musecafe.vip/guide/map#potty');
  ok(!!w.__BPG_MAP, 'map boots with #potty hash');
  ok(d.getElementById('map-potty-btn').classList.contains('solid'), '#potty deep link enables potty mode');
})();

(function(){
  /* Find page potty note links to the map */
  const src = fs.readFileSync(path.join(repoRoot, 'guide', 'guide.js'), 'utf8');
  ok(/guide\/map#potty/.test(src), 'the potty note links to the map view');
  ok(/map-gps-btn|extras\.gps/.test(fs.readFileSync(path.join(repoRoot, 'guide', 'map.js'), 'utf8')), 'the map can take a GPS fix');
})();

console.log('map: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length){ failures.forEach(f => console.error('  FAILED: ' + f)); process.exit(1); }
