const geo = require('./brc-geo');
const campsJson = require('../data/camps.json');
const config = require('../data/config.json');

// Tunable scoring weights as named constants at top of file
const WEIGHT_TIME_OVERLAP = 10.0;
const WEIGHT_STARTING_SOON = 5.0;
const WEIGHT_WALK_DISTANCE = -0.5; // penalty per walk minute
const PENALTY_EXCEED_MAX_WALK = -15.0;
const PENALTY_UNKNOWN_ADDRESS = -5.0;
const WEIGHT_TAG_MATCH = 4.0;
const WEIGHT_GENRE_MATCH = 3.0;
const BOOST_ARTIST_MATCH = 15.0;
const BOOST_WATCH_DJ = 15.0;
const BOOST_FRIEND_CAMP = 10.0;
const WEIGHT_TIME_OF_DAY = 2.0;

function resolveEventAddress(event) {
  // Prefer an address the geometry engine can actually parse. Some events
  // (landmarks, "Center Camp @ 4:00") carry explicit coordinates instead —
  // fall back to those rather than reporting an unknown location.
  if (event.address && geo.parseAddress(event.address)) return event.address;
  if (typeof event.lat === 'number' && typeof event.lon === 'number') {
    return { lat: event.lat, lon: event.lon };
  }
  if (event.address) {
    const lm = geo.landmark(event.address);
    if (lm) return lm;
  }
  if (event.camp && campsJson[event.camp]) {
    return campsJson[event.camp];
  }
  return null;
}

function getTimeOfDaySlot(hour) {
  if (hour >= 5 && hour < 8) return 'sunrise';
  if (hour >= 8 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'sunset';
  if (hour >= 20 || hour < 1) return 'night';
  return 'late'; // 1 to 5
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function recommend(options = {}) {
  const {
    at = new Date(),
    from,
    windowMinutes = config.default_window_minutes || 180,
    tags,
    limit = config.default_limit || 8,
    profile = {},
    events = [],
    includePartner = false
  } = options;

  const atTime = (at instanceof Date ? at : new Date(at)).getTime();
  const windowEnd = atTime + windowMinutes * 60 * 1000;

  const fromAddr = from || (profile.home && profile.home.address) || '8:15 & E';
  const maxWalkMin = profile.maxWalkMinutes || profile.max_walk_minutes || 30;

  const tagWeights = profile.tagWeights || profile.tag_weights || {};
  const genreWeights = profile.genreWeights || profile.genre_weights || {};
  const avoidTags = (profile.avoidTags || profile.avoid_tags || []).map(t => String(t).toLowerCase());
  const timeOfDayMap = profile.timeOfDay || profile.time_of_day || {};
  const ambiguousIgnoreSet = new Set((profile.ambiguousIgnore || profile.ambiguous_ignore || []).map(a => String(a).toLowerCase()));
  const topArtists = profile.artists || profile.top_artists || [];
  const watchDjs = profile.watchDjs || profile.watch_djs || [];
  const friends = profile.friends || [];
  const mustDoList = profile.mustDo || profile.must_do || [];

  // Filter tags normalization
  let requiredTags = null;
  if (tags) {
    if (Array.isArray(tags)) {
      requiredTags = tags.map(t => String(t).toLowerCase());
    } else if (typeof tags === 'string') {
      requiredTags = [tags.toLowerCase()];
    }
  }

  const results = [];

  // 1. Process Must-Do items first
  const pinnedMustDos = [];
  for (const item of mustDoList) {
    if (!item) continue;
    let itemStart = null;
    let itemEnd = null;
    if (item.start && item.end) {
      itemStart = new Date(item.start).getTime();
      itemEnd = new Date(item.end).getTime();
    } else if (item.date && item.start) {
      itemStart = new Date(`${item.date}T${item.start}`).getTime();
      itemEnd = item.end ? new Date(`${item.date}T${item.end}`).getTime() : itemStart + 60 * 60 * 1000;
    }

    if (itemStart && itemEnd) {
      if (itemStart < windowEnd && itemEnd > atTime) {
        const itemAddr = item.address || fromAddr;
        let walkMin = null;
        let distFt = null;
        if (itemAddr) {
          const wm = geo.walkMinutes(fromAddr, itemAddr);
          const df = geo.distanceFt(fromAddr, itemAddr);
          if (!isNaN(wm)) walkMin = Math.round(wm * 10) / 10;
          if (!isNaN(df)) distFt = Math.round(df);
        }

        pinnedMustDos.push({
          event: {
            id: item.id || `mustdo-${pinnedMustDos.length}`,
            title: item.what || item.title || 'Must-Do Event',
            description: item.note || '',
            address: item.address || null,
            tags: ['must-do']
          },
          occurrence: {
            date: item.date || '',
            start: item.start || new Date(itemStart).toISOString(),
            end: item.end || new Date(itemEnd).toISOString(),
            dur_min: Math.round((itemEnd - itemStart) / 60000)
          },
          score: 999999,
          walkMin: walkMin,
          distanceFt: distFt,
          why: ['Must-Do item' + (item.note ? `: ${item.note}` : '')],
          pinned: true
        });
      }
    }
  }

  // 2. Score regular events
  for (const evt of events) {
    if (!evt || !evt.occurrences || !Array.isArray(evt.occurrences)) continue;

    // Check avoid_tags -> hard exclude
    const evtTags = (evt.tags || []).map(t => String(t).toLowerCase());
    if (avoidTags.some(avoid => evtTags.includes(avoid))) {
      continue;
    }

    // Check required tags filter (--tag food)
    if (requiredTags && requiredTags.length > 0) {
      const matches = requiredTags.every(req => evtTags.includes(req));
      if (!matches) continue;
    }

    const eventAddr = resolveEventAddress(evt);
    let walkMin = null;
    let distFt = null;

    if (eventAddr) {
      const wm = geo.walkMinutes(fromAddr, eventAddr);
      const df = geo.distanceFt(fromAddr, eventAddr);
      if (!isNaN(wm)) walkMin = Math.round(wm * 10) / 10;
      if (!isNaN(df)) distFt = Math.round(df);
    }

    const fullText = (evt.title + ' ' + (evt.description || '')).toLowerCase();

    for (const occ of evt.occurrences) {
      const occStart = new Date(occ.start).getTime();
      const occEnd = new Date(occ.end).getTime();

      // Check overlap with [atTime, windowEnd]
      if (occStart >= windowEnd || occEnd <= atTime) {
        continue;
      }

      // Check if event ends before arrival time
      if (walkMin !== null) {
        const arrivalTime = atTime + walkMin * 60 * 1000;
        if (occEnd <= arrivalTime) {
          continue;
        }
      }

      let score = 0;
      const why = [];

      // Time fit score
      score += WEIGHT_TIME_OVERLAP;
      if (occStart >= atTime) {
        const timeUntilStartMin = (occStart - atTime) / 60000;
        const startSoonFactor = Math.max(0, 1 - timeUntilStartMin / windowMinutes);
        score += WEIGHT_STARTING_SOON * startSoonFactor;
        if (timeUntilStartMin < 30) {
          why.push(`starts in ${Math.round(timeUntilStartMin)} min`);
        } else {
          why.push(`starts soon`);
        }
      } else {
        why.push(`already running`);
      }

      // Distance score
      if (walkMin === null) {
        score += PENALTY_UNKNOWN_ADDRESS;
        why.push('location unknown');
      } else {
        score += walkMin * WEIGHT_WALK_DISTANCE;
        if (walkMin > maxWalkMin) {
          score += PENALTY_EXCEED_MAX_WALK;
          why.push(`${Math.round(walkMin)} min walk (exceeds max ${maxWalkMin} min)`);
        } else {
          why.push(`${Math.round(walkMin)} min walk`);
        }
      }

      // Tag score
      let userTagScore = 0;
      let matchedTagNames = [];
      if (evtTags.length > 0) {
        let sum = 0;
        for (const t of evtTags) {
          const w = tagWeights[t] !== undefined ? tagWeights[t] : 0;
          sum += w;
          if (w > 0) matchedTagNames.push(`${t} (${w})`);
        }
        userTagScore = sum / evtTags.length;
      }

      let finalTagScore = userTagScore;
      if (includePartner && profile.partner && (profile.partner.tagWeights || profile.partner.tag_weights)) {
        const pTagWeights = profile.partner.tagWeights || profile.partner.tag_weights || {};
        const pWeight = profile.partner.weight || 0.5;
        let pSum = 0;
        if (evtTags.length > 0) {
          for (const t of evtTags) {
            pSum += pTagWeights[t] !== undefined ? pTagWeights[t] : 0;
          }
          const pTagScore = pSum / evtTags.length;
          finalTagScore = (1 - pWeight) * userTagScore + pWeight * pTagScore;
        }
      }

      score += finalTagScore * WEIGHT_TAG_MATCH;
      if (matchedTagNames.length > 0) {
        why.push(`tags: ${matchedTagNames.join(', ')}`);
      }

      // Genre score
      let genreScoreSum = 0;
      for (const [genre, weight] of Object.entries(genreWeights)) {
        if (!genre || !weight) continue;
        const rx = new RegExp('\\b' + escapeRegExp(genre.toLowerCase()) + '\\b', 'i');
        if (rx.test(fullText)) {
          let gWeight = weight;
          if (includePartner && profile.partner) {
            const pGenreWeights = profile.partner.genreWeights || profile.partner.genre_weights || {};
            const pWeight = profile.partner.weight || 0.5;
            const pGw = pGenreWeights[genre] || 0;
            gWeight = (1 - pWeight) * weight + pWeight * pGw;
          }
          genreScoreSum += gWeight;
          why.push(`genre "${genre}"`);
        }
      }
      score += genreScoreSum * WEIGHT_GENRE_MATCH;

      // Artist & DJ match
      const candidateArtists = [];
      for (const a of topArtists) {
        const name = typeof a === 'string' ? a : (a && a.name ? a.name : '');
        if (name) candidateArtists.push({ name, isDj: false });
      }
      for (const d of watchDjs) {
        const name = typeof d === 'string' ? d : (d && d.name ? d.name : '');
        if (name) candidateArtists.push({ name, isDj: true });
      }

      for (const cand of candidateArtists) {
        const artistName = cand.name.trim();
        if (!artistName) continue;
        const lowerName = artistName.toLowerCase();
        if (ambiguousIgnoreSet.has(lowerName)) continue;
        if (artistName.length < 7 && !artistName.includes(' ')) continue;

        const rx = new RegExp('\\b' + escapeRegExp(artistName) + '\\b', 'i');
        if (rx.test(fullText)) {
          score += cand.isDj ? BOOST_WATCH_DJ : BOOST_ARTIST_MATCH;
          why.push(`${artistName} plays here`);
        }
      }

      // Friend's camp match
      for (const f of friends) {
        if (!f) continue;
        const fCamp = f.camp ? f.camp.toLowerCase() : '';
        const fAddr = f.address ? f.address.toLowerCase() : '';
        const eCamp = evt.camp ? evt.camp.toLowerCase() : '';
        const eAddr = eventAddr ? eventAddr.toLowerCase() : '';

        if ((fCamp && eCamp && eCamp === fCamp) || (fAddr && eAddr && eAddr === fAddr)) {
          score += BOOST_FRIEND_CAMP;
          why.push(`${f.name} camps here`);
        }
      }

      // Time of day boost
      const occStartHour = new Date(occStart).getHours();
      const slot = getTimeOfDaySlot(occStartHour);
      const todWeight = timeOfDayMap[slot] !== undefined ? timeOfDayMap[slot] : 0;
      score += todWeight * WEIGHT_TIME_OF_DAY;

      results.push({
        event: evt,
        occurrence: occ,
        score: Math.round(score * 10) / 10,
        walkMin: walkMin,
        distanceFt: distFt,
        why: why
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Combine pinned items at top
  const combined = [...pinnedMustDos, ...results];
  return combined.slice(0, limit);
}

module.exports = {
  recommend,
  WEIGHT_TIME_OVERLAP,
  WEIGHT_STARTING_SOON,
  WEIGHT_WALK_DISTANCE,
  PENALTY_EXCEED_MAX_WALK,
  PENALTY_UNKNOWN_ADDRESS,
  WEIGHT_TAG_MATCH,
  WEIGHT_GENRE_MATCH,
  BOOST_ARTIST_MATCH,
  BOOST_WATCH_DJ,
  BOOST_FRIEND_CAMP,
  WEIGHT_TIME_OF_DAY
};
