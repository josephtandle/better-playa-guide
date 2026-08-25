const fs = require('fs');
const path = require('path');
const geo = require('./brc-geo');
const profileModule = require('./profile');
const recommendModule = require('./recommend');
const sourcesModule = require('./sources');
const eventsIndex = require('../data/events-index.json');

function getSessionPath() {
  return path.join(__dirname, '../data/session.json');
}

function loadSession() {
  const p = getSessionPath();
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveSession(session) {
  const p = getSessionPath();
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(session, null, 2), 'utf8');
  } catch (e) {}
}

function getNowDate() {
  const now = new Date();
  const eventStart = new Date('2026-08-30T00:00:00-07:00').getTime();
  const eventEnd = new Date('2026-09-06T23:59:59-07:00').getTime();
  const nowTime = now.getTime();

  if (nowTime < eventStart || nowTime > eventEnd) {
    return { date: new Date('2026-08-30T18:00:00-07:00'), simulated: true };
  }
  return { date: now, simulated: false };
}

function getOriginAddress(session, profile) {
  if (session && session.address) {
    return { address: session.address, sourceNote: `session location (${session.address})` };
  }
  if (profile && profile.home && profile.home.address) {
    return { address: profile.home.address, sourceNote: `home address (${profile.home.address})` };
  }
  return { address: '8:15 & E', sourceNote: 'default address (8:15 & E)' };
}

/**
 * Build reply for a text command or query.
 * @param {string} cmdText
 * @param {Object} [session]
 */
function buildReply(cmdText, session = {}) {
  const rawInput = (cmdText || '').trim();
  if (!rawInput) {
    return buildReply('/help', session);
  }

  const profile = profileModule.load();
  const lowerInput = rawInput.toLowerCase();

  // /start or /help
  if (lowerInput === '/start' || lowerInput === '/help') {
    return [
      '🔥 Burning Man Events Bot',
      '',
      'Available commands:',
      '• /now - Recommendations right now',
      '• /next <hours> - Recommendations for next N hours (e.g. /next 2)',
      '• /food - Food & drink events',
      '• /party - Parties & music',
      '• /workshops - Workshops & talks',
      '• /music - Music sets',
      '• /adult - Adult events',
      '• /where <address> - Set current BRC location (e.g. /where 7:30 & E)',
      '• /mustdo - Your must-do list',
      '• /fav - Your saved favorites',
      '• /friend - Your friends list',
      '• /tips - Recent WhatsApp group discovery tips',
      '',
      'Or send free text to search events. Share live location anytime!'
    ].join('\n');
  }

  // /where <address>
  if (lowerInput.startsWith('/where')) {
    const parts = rawInput.split(/\s+/);
    const addrArg = parts.slice(1).join(' ').trim();
    if (!addrArg) {
      const curr = session.address || (profile.home && profile.home.address) || 'Not set';
      return `Current address: ${curr}\nUsage: /where <address> (e.g. /where 7:30 & E)`;
    }
    const parsed = geo.parseAddress(addrArg);
    if (parsed && parsed.address) {
      session.address = parsed.address;
      saveSession(session);
      return `📍 Address set to: ${parsed.address}`;
    }
    return `❌ Could not parse BRC address "${addrArg}". Try format like "7:30 & E".`;
  }

  // /mustdo
  if (lowerInput === '/mustdo') {
    const items = profile.mustDo || [];
    if (items.length === 0) return 'No must-do items set in profile.';
    const lines = ['📌 MUST-DO ITEMS:'];
    items.forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item.what || item.title || 'Item'}`);
      if (item.address) lines.push(`   Loc: ${item.address}`);
      if (item.start) lines.push(`   Time: ${item.start}`);
    });
    return lines.join('\n');
  }

  // /fav or /fav add <id>
  if (lowerInput.startsWith('/fav')) {
    const parts = rawInput.split(/\s+/);
    if (parts[1] && parts[1].toLowerCase() === 'add') {
      const eventId = parts[2];
      if (!eventId) return 'Usage: /fav add <eventId>';
      profileModule.addFavorite(null, eventId);
      return `⭐ Added event ${eventId} to favorites.`;
    }
    const favorites = profile.favorites || [];
    if (favorites.length === 0) return 'No favorites saved.';
    const lines = ['⭐ FAVORITES:'];
    favorites.forEach((fav, idx) => {
      const str = typeof fav === 'string' ? fav : (fav.id || JSON.stringify(fav));
      lines.push(`${idx + 1}. ${str}`);
    });
    return lines.join('\n');
  }

  // /friend or /friend add <name> <address>
  if (lowerInput.startsWith('/friend')) {
    const parts = rawInput.split(/\s+/);
    if (parts[1] && parts[1].toLowerCase() === 'add') {
      const name = parts[2];
      const addr = parts.slice(3).join(' ');
      if (!name || !addr) return 'Usage: /friend add <name> <address>';
      profileModule.addFriend(null, name, addr);
      return `👥 Added friend ${name} at ${addr}.`;
    }
    if (parts.length >= 3 && parts[1].toLowerCase() !== 'add') {
      const name = parts[1];
      const addr = parts.slice(2).join(' ');
      profileModule.addFriend(null, name, addr);
      return `👥 Added friend ${name} at ${addr}.`;
    }
    const friends = profile.friends || [];
    if (friends.length === 0) return 'No friends listed in profile.';
    const lines = ['👥 FRIENDS:'];
    friends.forEach(f => {
      lines.push(`• ${f.name}: ${f.address || f.camp || 'Unknown'}`);
    });
    return lines.join('\n');
  }

  // /tips
  if (lowerInput === '/tips') {
    const scanRes = sourcesModule.scan({ profile, sinceDays: 3, limit: 100 });
    const tips = scanRes.tips || [];
    if (tips.length === 0) return 'No recent tips found in connected WhatsApp groups.';
    const lines = [`💡 RECENT DISCOVERY TIPS (${tips.length}):`];
    tips.slice(0, 5).forEach((t, i) => {
      const sender = t.sender || 'Group';
      const textSub = (t.text || '').replace(/\s+/g, ' ').slice(0, 100);
      lines.push(`\n${i + 1}. [${t.sourceLabel || sender}] "${textSub}..."`);
      if (t.addresses.length > 0) lines.push(`   Addrs: ${t.addresses.join(', ')}`);
      if (t.camps.length > 0) lines.push(`   Camps: ${t.camps.join(', ')}`);
      if (t.matchedEvents.length > 0) {
        lines.push(`   Events: ${t.matchedEvents.map(e => e.title).join(', ')}`);
      }
    });
    return lines.join('\n').slice(0, 1500);
  }

  // Recommendation commands: /now, /next, /food, /party, /workshops, /workshop, /music, /adult
  let tagFilter = null;
  let winMinutes = 180;

  let isRecCmd = false;
  if (lowerInput.startsWith('/now')) {
    isRecCmd = true;
  } else if (lowerInput.startsWith('/next')) {
    isRecCmd = true;
    const match = rawInput.match(/\/next\s+(\d+)/i);
    if (match) {
      winMinutes = (parseInt(match[1], 10) || 3) * 60;
    }
  } else if (lowerInput.startsWith('/food')) {
    isRecCmd = true;
    tagFilter = 'food';
  } else if (lowerInput.startsWith('/party')) {
    isRecCmd = true;
    tagFilter = 'party';
  } else if (lowerInput.startsWith('/workshops') || lowerInput.startsWith('/workshop')) {
    isRecCmd = true;
    tagFilter = 'workshop';
  } else if (lowerInput.startsWith('/music')) {
    isRecCmd = true;
    tagFilter = 'music';
  } else if (lowerInput.startsWith('/adult')) {
    isRecCmd = true;
    tagFilter = 'adult';
  }

  if (isRecCmd) {
    const { address: fromAddr, sourceNote } = getOriginAddress(session, profile);
    const { date: atDate, simulated } = getNowDate();

    const recs = recommendModule.recommend({
      at: atDate,
      from: fromAddr,
      windowMinutes: winMinutes,
      tags: tagFilter,
      limit: 6,
      profile: profile,
      events: eventsIndex
    });

    const lines = [];
    if (simulated) {
      lines.push('[Simulating event week: 2026-08-30 18:00]');
    }
    lines.push(`RECOMMENDATIONS (${recs.length} found)`);
    lines.push(`Origin: ${fromAddr} (${sourceNote})`);
    lines.push('----------------------------------------');

    if (recs.length === 0) {
      lines.push('No matching events found for this window.');
      return lines.join('\n');
    }

    recs.forEach((rec, idx) => {
      const e = rec.event;
      const occ = rec.occurrence;
      const timeStr = occ && occ.start ? occ.start.split('T')[1].slice(0, 5) : '18:00';
      const walkStr = rec.walkMin !== null && !isNaN(rec.walkMin) ? `${Math.round(rec.walkMin)}m walk` : 'loc unknown';
      const pinStr = rec.pinned ? '[MUST-DO] ' : '';

      lines.push(`${idx + 1}. ${pinStr}${e.title}`);
      lines.push(`   Time: ${timeStr} | ${walkStr} | Score: ${rec.score}`);
      lines.push(`   Loc: ${e.address || e.location || 'BRC'}${e.camp ? ` (${e.camp})` : ''}`);
      if (rec.why && rec.why.length > 0) {
        lines.push(`   Why: ${rec.why.join(' • ')}`);
      }
    });

    return lines.join('\n').slice(0, 1500);
  }

  // Free text search query
  const query = lowerInput.replace(/^\//, '');
  const matches = eventsIndex.filter(e => {
    const fullText = `${e.title} ${e.description || ''} ${e.camp || ''} ${(e.tags || []).join(' ')}`.toLowerCase();
    return fullText.includes(query);
  }).slice(0, 5);

  if (matches.length === 0) {
    return `No events found matching "${query}".`;
  }

  const lines = [`🔍 SEARCH RESULTS FOR "${query}" (${matches.length}):`];
  matches.forEach((e, idx) => {
    lines.push(`${idx + 1}. [${e.id}] ${e.title}`);
    lines.push(`   Loc: ${e.address || e.location || 'BRC'}${e.camp ? ` (${e.camp})` : ''}`);
  });
  return lines.join('\n').slice(0, 1500);
}

/**
 * Start Telegram bot service.
 */
function startBot() {
  const token = process.env.BME_BOT_TOKEN;
  if (!token) {
    throw new Error('BME_BOT_TOKEN environment variable is required. Please set BME_BOT_TOKEN (obtain token from Telegram @BotFather).');
  }

  const TelegramBot = require('node-telegram-bot-api');
  const bot = new TelegramBot(token, { polling: true });

  const allowedIds = (process.env.BME_ALLOWED_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  function isAllowed(msg) {
    if (!allowedIds || allowedIds.length === 0) return true;
    const senderId = msg && msg.from ? String(msg.from.id) : null;
    if (!senderId || !allowedIds.includes(senderId)) {
      console.log(`[bme-bot] Dropping message from unauthorized user ID: ${senderId}`);
      return false;
    }
    return true;
  }

  const session = loadSession();

  function handleMessage(msg) {
    if (!isAllowed(msg)) return;
    const chatId = msg.chat.id;

    // Handle live location
    if (msg.location) {
      const lat = msg.location.latitude;
      const lon = msg.location.longitude;
      const resolved = geo.latLonToAddress(lat, lon);
      if (resolved && resolved.address) {
        session.address = resolved.address;
        saveSession(session);
        const reply = buildReply('/now', session);
        bot.sendMessage(chatId, `📍 Live location updated to: ${resolved.address}\n\n${reply}`);
      } else {
        bot.sendMessage(chatId, `📍 Received location (${lat.toFixed(4)}, ${lon.toFixed(4)}), but it is outside Black Rock City.`);
      }
      return;
    }

    if (msg.text) {
      const reply = buildReply(msg.text, session);
      bot.sendMessage(chatId, reply);
    }
  }

  bot.on('message', handleMessage);
  bot.on('edited_message', msg => {
    if (msg.location) handleMessage(msg);
  });

  console.log('[bme-bot] Burning Man Events Telegram Bot started polling.');
  return bot;
}

module.exports = {
  startBot,
  buildReply,
  loadSession,
  saveSession
};
