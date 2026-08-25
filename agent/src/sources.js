const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const geo = require('./brc-geo');
const profileModule = require('./profile');
const config = require('../data/config.json');
const campsData = require('../data/camps.json');
const eventsIndex = require('../data/events-index.json');

function resolveDbPath(sourceDbPath, optsDbPath) {
  let rawPath = sourceDbPath || optsDbPath || process.env.BME_WHATSAPP_DB || config.whatsapp_db;
  if (!rawPath) return null;
  if (rawPath.startsWith('~')) {
    return path.join(os.homedir(), rawPath.slice(1));
  }
  if (!path.isAbsolute(rawPath)) {
    return path.resolve(__dirname, '..', rawPath);
  }
  return rawPath;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build list of camp terms for matching (length >= 5)
const campTermsMap = new Map();
const campsObj = campsData.camps || campsData;
for (const key of Object.keys(campsObj)) {
  const item = campsObj[key];
  const name = (item && item.name) ? item.name : key;
  if (key.length >= 5) {
    campTermsMap.set(key.toLowerCase(), name);
  }
  if (name && name.length >= 5) {
    campTermsMap.set(name.toLowerCase(), name);
  }
}
const campTermsList = Array.from(campTermsMap.entries()).map(([term, name]) => ({
  term,
  name,
  regex: new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i')
}));

// Build list of events for matching (title length >= 6)
const eventTermsList = [];
for (const e of eventsIndex) {
  if (e.title && e.title.trim().length >= 6) {
    const titleTrimmed = e.title.trim();
    eventTermsList.push({
      id: e.id,
      title: titleTrimmed,
      address: e.address || e.location || null,
      regex: new RegExp(`\\b${escapeRegExp(titleTrimmed)}\\b`, 'i')
    });
  }
}

/**
 * Extract address candidates from text and validate with geo.parseAddress.
 */
function extractAddresses(text) {
  if (!text) return [];
  const found = new Set();

  const regexes = [
    /\b(\d{1,2}(?::\d{2})?)\s*(?:&|and|@)\s*([A-Za-z]+)\b/gi,
    /\b([A-Za-z]+)\s*(?:&|and|@)\s*(\d{1,2}(?::\d{2})?)\b/gi,
    /\b(\d{1,2}(?::\d{2})?)\s+([A-Za-z]+)\b/gi,
    /\b([A-Za-z]+)\s+(\d{1,2}(?::\d{2})?)\b/gi
  ];

  for (const re of regexes) {
    let match;
    while ((match = re.exec(text)) !== null) {
      const candidate = match[0];
      const parsed = geo.parseAddress(candidate);
      if (parsed && parsed.address) {
        found.add(parsed.address);
      }
    }
  }

  return Array.from(found);
}

/**
 * Extract matched camps from text.
 */
function extractCamps(text) {
  if (!text) return [];
  const found = new Set();
  for (const item of campTermsList) {
    if (item.regex.test(text)) {
      found.add(item.name);
    }
  }
  return Array.from(found);
}

/**
 * Extract matched events from text (capped at 3).
 */
function extractEvents(text) {
  if (!text) return [];
  const matched = [];
  for (const e of eventTermsList) {
    if (e.regex.test(text)) {
      matched.push({ id: e.id, title: e.title, address: e.address });
      if (matched.length >= 3) break;
    }
  }
  return matched;
}

/**
 * Process a message text and return tip object if it yields at least one address, camp, or event.
 */
function extractTip(text, sender, timestamp, sourceLabel) {
  if (!text) return null;
  const addresses = extractAddresses(text);
  const camps = extractCamps(text);
  const matchedEvents = extractEvents(text);

  if (addresses.length === 0 && camps.length === 0 && matchedEvents.length === 0) {
    return null;
  }

  return {
    text,
    sender: sender || 'Unknown',
    timestamp: timestamp || Date.now(),
    sourceLabel: sourceLabel || '',
    matchedEvents,
    addresses,
    camps
  };
}

/**
 * Scan discovery sources.
 * @param {Object} opts
 * @param {Object} [opts.profile]
 * @param {number} [opts.sinceDays=3]
 * @param {number} [opts.limit=400]
 * @param {string} [opts.dbPath]
 */
function scan(opts = {}) {
  const profile = opts.profile || profileModule.load();
  const sinceDays = typeof opts.sinceDays === 'number' ? opts.sinceDays : 3;
  const limit = typeof opts.limit === 'number' ? opts.limit : 400;

  const sourcesConfig = (profile && Array.isArray(profile.sources)) ? profile.sources : [];

  const resultsSources = [];
  const allTips = [];

  const cutoffMs = Date.now() - (sinceDays * 86400 * 1000);

  for (const source of sourcesConfig) {
    if (!source || source.enabled === false) continue;

    const label = source.label || source.id || 'unnamed';
    const type = source.type;
    const dbPath = resolveDbPath(source.dbPath, opts.dbPath);

    if (type === 'whatsapp_group') {
      if (!dbPath) {
        resultsSources.push({ label, type, ok: false, count: 0, reason: 'no_whatsapp_db' });
        continue;
      }
      if (!fs.existsSync(dbPath)) {
        resultsSources.push({ label, type, ok: false, count: 0, reason: 'db_missing' });
        continue;
      }
      let db = null;
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const stmt = db.prepare(
          'SELECT text, sender, timestamp FROM messages WHERE jid = ? AND text IS NOT NULL AND timestamp > ? ORDER BY timestamp DESC LIMIT ?'
        );
        const rows = stmt.all(source.id, cutoffMs, limit);
        resultsSources.push({ label, type, ok: true, count: rows.length });
        for (const row of rows) {
          const tip = extractTip(row.text, row.sender, row.timestamp, label);
          if (tip) allTips.push(tip);
        }
      } catch (err) {
        resultsSources.push({ label, type, ok: false, count: 0, reason: err.message || 'db_error' });
      } finally {
        if (db) {
          try { db.close(); } catch (e) {}
        }
      }
    } else if (type === 'telegram_channel') {
      resultsSources.push({ label, type, ok: false, count: 0, reason: 'telegram_not_wired' });
    } else if (type === 'whatsapp_invite') {
      if (!dbPath) {
        resultsSources.push({ label, type, ok: false, count: 0, reason: 'no_whatsapp_db' });
        continue;
      }
      if (!fs.existsSync(dbPath)) {
        resultsSources.push({ label, type, ok: false, count: 0, reason: 'not_joined' });
        continue;
      }
      let db = null;
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const conv = db.prepare(
          'SELECT jid FROM conversations WHERE LOWER(name) = LOWER(?) LIMIT 1'
        ).get(label);
        if (!conv || !conv.jid) {
          resultsSources.push({ label, type, ok: false, count: 0, reason: 'not_joined' });
        } else {
          const stmt = db.prepare(
            'SELECT text, sender, timestamp FROM messages WHERE jid = ? AND text IS NOT NULL AND timestamp > ? ORDER BY timestamp DESC LIMIT ?'
          );
          const rows = stmt.all(conv.jid, cutoffMs, limit);
          resultsSources.push({ label, type, ok: true, count: rows.length });
          for (const row of rows) {
            const tip = extractTip(row.text, row.sender, row.timestamp, label);
            if (tip) allTips.push(tip);
          }
        }
      } catch (err) {
        resultsSources.push({ label, type, ok: false, count: 0, reason: 'not_joined' });
      } finally {
        if (db) {
          try { db.close(); } catch (e) {}
        }
      }
    } else {
      resultsSources.push({ label, type, ok: false, count: 0, reason: 'unknown_type' });
    }
  }

  allTips.sort((a, b) => b.timestamp - a.timestamp);

  return {
    sources: resultsSources,
    tips: allTips
  };
}

module.exports = {
  scan,
  extractAddresses,
  extractCamps,
  extractEvents,
  extractTip
};
