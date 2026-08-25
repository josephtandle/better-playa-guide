const fs = require('fs');
const path = require('path');
const sources = require('../src/sources');
const geo = require('../src/brc-geo');

let failed = false;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// Ensure BME_BOT_TOKEN is unset for requirement 6 check
delete process.env.BME_BOT_TOKEN;

// Requirement 6: require('../src/bot.js') does not throw when BME_BOT_TOKEN is unset
let bot;
try {
  bot = require('../src/bot');
  assert(typeof bot.buildReply === 'function' && typeof bot.startBot === 'function', '1. require("./src/bot.js") does not throw when BME_BOT_TOKEN is unset');
} catch (err) {
  assert(false, `1. require("./src/bot.js") threw when BME_BOT_TOKEN is unset: ${err.message}`);
}

// Requirement 1: sources.scan with a profile that has NO sources returns {sources:[],tips:[]} and does not throw
try {
  const res = sources.scan({ profile: { sources: [] } });
  assert(
    res && Array.isArray(res.sources) && res.sources.length === 0 && Array.isArray(res.tips) && res.tips.length === 0,
    '2. sources.scan with a profile that has NO sources returns {sources:[],tips:[]} and does not throw'
  );
} catch (err) {
  assert(false, `2. sources.scan with NO sources threw: ${err.message}`);
}

// Requirement 2: Pointing a whatsapp_group source at a NON-EXISTENT db path returns ok:false and does NOT throw
try {
  const fakeProfile = {
    sources: [
      { type: 'whatsapp_group', id: 'redacted@example.invalid', label: 'Fake Group', enabled: true, dbPath: '/non/existent/path/db.sqlite' }
    ]
  };
  const res = sources.scan({ profile: fakeProfile, dbPath: '/non/existent/path/db.sqlite' });
  assert(
    res && res.sources && res.sources.length === 1 && res.sources[0].ok === false,
    '3. Pointing a whatsapp_group source at a NON-EXISTENT db path returns ok:false and does NOT throw'
  );
} catch (err) {
  assert(false, `3. Pointing a whatsapp_group source at NON-EXISTENT db threw: ${err.message}`);
}

// Requirement 3: Address extractor pulls "7:30 & E" out of "come by 7:30 & E around sunset" and rejects "call me at 7:30"
try {
  const addrs1 = sources.extractAddresses('come by 7:30 & E around sunset');
  const addrs2 = sources.extractAddresses('call me at 7:30');

  const pulledCorrect = addrs1.includes('7:30 & E');
  const rejectedTime = addrs2.length === 0;

  assert(
    pulledCorrect && rejectedTime,
    `4. Address extractor pulls "7:30 & E" (got: ${JSON.stringify(addrs1)}) and rejects "7:30" (got: ${JSON.stringify(addrs2)})`
  );
} catch (err) {
  assert(false, `4. Address extractor test threw: ${err.message}`);
}

// Requirement 4: bot.buildReply('/help', {}) returns a non-empty string mentioning at least 3 commands
try {
  const replyHelp = bot.buildReply('/help', {});
  const cmdMatches = (replyHelp || '').match(/\/[a-z]+/gi) || [];
  const uniqueCmds = new Set(cmdMatches);
  assert(
    typeof replyHelp === 'string' && replyHelp.length > 0 && uniqueCmds.size >= 3,
    `5. bot.buildReply('/help', {}) returns a non-empty string mentioning at least 3 commands (found ${uniqueCmds.size}: ${Array.from(uniqueCmds).join(', ')})`
  );
} catch (err) {
  assert(false, `5. bot.buildReply('/help', {}) threw: ${err.message}`);
}

// Requirement 5: bot.buildReply('/now', {address:'8:15 & E'}) returns a non-empty string containing a time
try {
  const replyNow = bot.buildReply('/now', { address: '8:15 & E' });
  const hasTime = /\b\d{1,2}:\d{2}\b/.test(replyNow);
  assert(
    typeof replyNow === 'string' && replyNow.length > 0 && hasTime,
    `6. bot.buildReply('/now', {address:'8:15 & E'}) returns a non-empty string containing a time`
  );
} catch (err) {
  assert(false, `6. bot.buildReply('/now', ...) threw: ${err.message}`);
}

// Requirement 7: WhatsApp DB scan using environment variables
const testGroupJid = process.env.BME_TEST_GROUP_JID;
const testDbPath = process.env.BME_WHATSAPP_DB;

if (testGroupJid && testDbPath && fs.existsSync(testDbPath)) {
  try {
    const testProfile = {
      sources: [
        { type: 'whatsapp_group', id: testGroupJid, label: 'Test Group', enabled: true, dbPath: testDbPath }
      ]
    };
    const res = sources.scan({ profile: testProfile, sinceDays: 365, limit: 400, dbPath: testDbPath });
    const srcRes = res && res.sources && res.sources[0];
    if (srcRes && srcRes.ok) {
      assert(true, `7. Real WhatsApp DB scan for test group returned ok:true (found ${srcRes.count} messages)`);
    } else {
      assert(false, `7. Real WhatsApp DB scan for test group returned ok:false (${srcRes ? srcRes.reason : 'unknown'})`);
    }
  } catch (err) {
    assert(false, `7. Real WhatsApp DB scan for test group threw: ${err.message}`);
  }
} else {
  console.log('SKIP 7: BME_TEST_GROUP_JID or BME_WHATSAPP_DB is unset or DB file does not exist');
}

if (failed) {
  process.exit(1);
}
