#!/usr/bin/env node
const path = require('path');
const geo = require('./brc-geo');
const profileModule = require('./profile');
const recommendModule = require('./recommend');
const eventsIndex = require('../data/events-index.json');
const config = require('../data/config.json');

const LINE_WIDTH = 58;

function wrap(str, width = LINE_WIDTH, indent = '') {
  if (!str) return '';
  const words = str.split(/\s+/);
  let line = indent;
  const lines = [];
  for (const word of words) {
    if ((line + (line.trim() ? ' ' : '') + word).length > width) {
      if (line.trim()) lines.push(line);
      line = indent + word;
    } else {
      line += (line.trim() ? ' ' : '') + word;
    }
  }
  if (line.trim()) lines.push(line);
  return lines.join('\n');
}

function divider() {
  return '-'.repeat(LINE_WIDTH);
}

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'with-alla' || key === 'with-partner') {
        flags['with-partner'] = true;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function getNowDate() {
  const now = new Date();
  const eventStart = new Date('2026-08-30T00:00:00-07:00').getTime();
  const eventEnd = new Date('2026-09-06T23:59:59-07:00').getTime();
  const nowTime = now.getTime();

  let simTime;
  let simulated = false;
  if (nowTime < eventStart || nowTime > eventEnd) {
    simTime = new Date('2026-08-30T18:00:00-07:00');
    simulated = true;
  } else {
    simTime = now;
  }
  return { date: simTime, simulated };
}

function parseWindowMinutes(winStr) {
  if (!winStr) return config.default_window_minutes || 180;
  const m = winStr.match(/^(\d+)([hm])?$/i);
  if (!m) return parseInt(winStr, 10) || 180;
  const val = parseInt(m[1], 10);
  const unit = (m[2] || 'm').toLowerCase();
  return unit === 'h' ? val * 60 : val;
}

function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    rawArgs.push('now');
  }

  const cmd = rawArgs[0].toLowerCase();
  const rest = rawArgs.slice(1);
  const { flags, positional } = parseArgs(rest);

  const profile = profileModule.load();

  if (cmd === 'status') {
    console.log('='.repeat(LINE_WIDTH));
    console.log('BURNING MAN EVENTS AGENT STATUS');
    console.log('='.repeat(LINE_WIDTH));
    console.log(`Events indexed: ${eventsIndex.length}`);
    console.log(`User profile: ${profile.name}`);
    console.log(`Home camp: ${profile.home.camp || 'Not set'}`);
    console.log(`Home address: ${profile.home.address || 'Not set'}`);
    console.log(`Profile dir: ${profileModule.resolveDir()}`);
    console.log(`Top artists: ${profile.artists.length}`);
    console.log(`Must-Do items: ${profile.mustDo.length}`);
    console.log(`Favorites: ${profile.favorites.length}`);
    console.log(`Friends: ${profile.friends.length}`);
    return;
  }

  if (cmd === 'where') {
    const addrStr = positional.join(' ');
    if (!addrStr) {
      console.log('Usage: bme where <address>');
      return;
    }
    const parsed = geo.parseAddress(addrStr);
    const latLon = geo.addressToLatLon(addrStr);
    console.log(`Address: ${addrStr}`);
    if (parsed) console.log(`Normalized: ${parsed.address}`);
    if (latLon) {
      console.log(`Lat/Lon: ${latLon.lat.toFixed(6)}, ${latLon.lon.toFixed(6)}`);
      const manDist = geo.distanceFt(latLon, 'The Man');
      const ccDist = geo.distanceFt(latLon, 'Center Camp');
      if (!isNaN(manDist)) console.log(`Distance to Man: ${Math.round(manDist)} ft`);
      if (!isNaN(ccDist)) console.log(`Distance to Center Camp: ${Math.round(ccDist)} ft`);
    } else {
      console.log('Could not resolve location.');
    }
    return;
  }

  if (cmd === 'mustdo') {
    console.log('MUST-DO ITEMS');
    console.log(divider());
    if (profile.mustDo.length === 0) {
      console.log('No must-do items set.');
      return;
    }
    profile.mustDo.forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.what || item.title}`);
      console.log(`   When: ${item.date || ''} ${item.start || ''}-${item.end || ''}`);
      console.log(`   Where: ${item.address || 'Unknown'}`);
      if (item.note) console.log(`   Note: ${item.note}`);
    });
    return;
  }

  if (cmd === 'fav') {
    const subCmd = positional[0] ? positional[0].toLowerCase() : 'list';
    if (subCmd === 'add') {
      const eventId = positional[1];
      if (!eventId) {
        console.log('Usage: bme fav add <event-id>');
        return;
      }
      profileModule.addFavorite(null, eventId);
      console.log(`Added favorite: ${eventId}`);
    } else {
      console.log('FAVORITES');
      console.log(divider());
      if (profile.favorites.length === 0) {
        console.log('No favorites saved.');
        return;
      }
      profile.favorites.forEach((fav, i) => {
        console.log(`${i + 1}. ${typeof fav === 'string' ? fav : fav.id || JSON.stringify(fav)}`);
      });
    }
    return;
  }

  if (cmd === 'friend') {
    const subCmd = positional[0] ? positional[0].toLowerCase() : 'list';
    if (subCmd === 'add') {
      const fName = positional[1];
      const fAddr = positional[2];
      if (!fName || !fAddr) {
        console.log('Usage: bme friend add <name> <address>');
        return;
      }
      profileModule.addFriend(null, fName, fAddr);
      console.log(`Added friend: ${fName} at ${fAddr}`);
    } else {
      console.log('FRIENDS');
      console.log(divider());
      if (profile.friends.length === 0) {
        console.log('No friends listed.');
        return;
      }
      profile.friends.forEach(f => {
        console.log(`${f.name}: ${f.address || f.camp}`);
      });
    }
    return;
  }

  if (cmd === 'search') {
    const query = positional.join(' ').toLowerCase();
    if (!query) {
      console.log('Usage: bme search <text>');
      return;
    }
    const matches = eventsIndex.filter(e => {
      // presenter/series matter: the official listings often omit the speaker's name,
      // so it only reaches us from the camp's own site.
      const text = `${e.title} ${e.description || ''} ${e.camp || ''} ${e.presenter || ''} ${e.series || ''} ${(e.tags || []).join(' ')}`.toLowerCase();
      return text.includes(query);
    }).slice(0, 10);

    console.log(`SEARCH RESULTS FOR "${query}" (${matches.length})`);
    console.log(divider());
    matches.forEach((e, i) => {
      console.log(`${i + 1}. [${e.id}] ${e.title}`);
      console.log(`   Camp: ${e.camp || 'N/A'} | Location: ${e.address || e.location || 'Unknown'}`);
    });
    return;
  }

  if (cmd === 'event') {
    const idStr = positional[0];
    if (!idStr) {
      console.log('Usage: bme event <id>');
      return;
    }
    const target = eventsIndex.find(e => String(e.id) === idStr);
    if (!target) {
      console.log(`Event ${idStr} not found.`);
      return;
    }
    console.log(`[${target.id}] ${target.title}`);
    console.log(divider());
    console.log(`Camp: ${target.camp || 'N/A'}`);
    console.log(`Address: ${target.address || target.location || 'Unknown'}`);
    console.log(`Type: ${target.type || 'N/A'} | Tags: ${(target.tags || []).join(', ')}`);
    console.log(divider());
    console.log(wrap(target.description || 'No description provided.'));
    console.log(divider());
    console.log('Occurrences:');
    (target.occurrences || []).forEach(occ => {
      console.log(`- ${occ.date} ${occ.start.split('T')[1]} - ${occ.end.split('T')[1]} (${occ.dur_min}m)`);
    });
    return;
  }

  if (cmd === 'setup') {
    console.log('BURNING MAN EVENTS SETUP');
    console.log(divider());
    console.log(`Profile directory: ${profileModule.resolveDir()}`);
    console.log('Place YAML files (me.yaml, music.yaml, partner.yaml, etc.)');
    console.log('in that directory to customize recommendations.');
    return;
  }

  // Handle recommendation commands: now, next, food, party, workshops
  let tagFilter = flags.tag || null;
  let winStr = flags.in || null;

  if (cmd === 'next') {
    const hrs = positional[0] || '3';
    winStr = `${hrs}h`;
  } else if (cmd === 'food') {
    tagFilter = 'food';
  } else if (cmd === 'party') {
    tagFilter = 'party';
  } else if (cmd === 'workshops' || cmd === 'workshop') {
    tagFilter = 'workshop';
  }

  const { date: atDate, simulated } = getNowDate();
  const fromAddress = flags.from || profile.home.address || '8:15 & E';
  const windowMins = parseWindowMinutes(winStr);
  const limitVal = parseInt(flags.limit, 10) || config.default_limit || 8;
  const withPartner = flags['with-partner'] || false;

  const recs = recommendModule.recommend({
    at: atDate,
    from: fromAddress,
    windowMinutes: windowMins,
    tags: tagFilter,
    limit: limitVal,
    profile: profile,
    events: eventsIndex,
    includePartner: withPartner
  });

  if (simulated) {
    console.log('[Simulating event week: 2026-08-30 18:00]');
  }
  console.log(`RECOMMENDATIONS (${recs.length} found)`);
  console.log(`From: ${fromAddress} | Window: ${windowMins}m`);
  console.log(divider());

  if (recs.length === 0) {
    console.log('No matching events found for this time window.');
    return;
  }

  recs.forEach((rec, idx) => {
    const e = rec.event;
    const occ = rec.occurrence;
    const timeStr = occ && occ.start ? occ.start.split('T')[1].slice(0, 5) : '';
    const walkStr = rec.walkMin !== null ? `${rec.walkMin}m walk` : 'location unknown';
    const pinStr = rec.pinned ? '[MUST-DO] ' : '';

    console.log(`${idx + 1}. ${pinStr}${e.title}`);
    console.log(`   Time: ${timeStr} | ${walkStr} | Score: ${rec.score}`);
    console.log(`   Loc: ${e.address || e.location || 'Unknown'}${e.camp ? ` (${e.camp})` : ''}`);
    if (rec.why && rec.why.length > 0) {
      console.log(`   Why: ${rec.why.join(' • ')}`);
    }
    console.log('');
  });
}

if (require.main === module) {
  main();
}
