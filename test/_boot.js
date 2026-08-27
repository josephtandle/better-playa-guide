/* Boots the real guide page (index.html + data.js + guide.js) inside jsdom with
 * no network. Returns the window plus the __BPG test surface guide.js exports.
 * Repo root is resolved relative to this file: never hardcode machine paths. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(repoRoot, 'guide', 'index.html'), 'utf8')
  /* Scripts must not load from disk or network; we eval the real files ourselves. */
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '');
const DATA_SRC = fs.readFileSync(path.join(repoRoot, 'guide', 'data.js'), 'utf8');
const GUIDE_SRC = fs.readFileSync(path.join(repoRoot, 'guide', 'guide.js'), 'utf8');

/* opts.url: page url (share-hash tests); opts.localStorage: {key: value} seeded
 * BEFORE guide.js runs, simulating a returning visitor. */
function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(HTML, {
    url: opts.url || 'https://musecafe.vip/guide/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  if (!w.matchMedia) {
    w.matchMedia = function () {
      return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
    };
  }
  if (opts.localStorage) {
    Object.keys(opts.localStorage).forEach(k => w.localStorage.setItem(k, opts.localStorage[k]));
  }
  w.eval(DATA_SRC);
  /* opts.mutateData(guideData): edit the payload BEFORE guide.js boots, e.g.
   * to inject a hostile fixture event and prove the render layer escapes it. */
  if (typeof opts.mutateData === 'function') opts.mutateData(w.__GUIDE__);
  w.eval(GUIDE_SRC);
  /* jsdom keeps readyState at "loading" here, so guide.js deferred init() to
   * DOMContentLoaded. Fire it now so the page is fully initialised. */
  if (w.document.readyState === 'loading') {
    w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: false }));
  }
  if (!w.__BPG) throw new Error('guide.js did not export window.__BPG (init crashed?)');
  return { dom, window: w, document: w.document, BPG: w.__BPG, GUIDE: w.__GUIDE__ };
}

module.exports = { boot, repoRoot };
