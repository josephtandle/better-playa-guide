'use strict';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'dummy-groq-key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy-gemini-key';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'dummy-deepseek-key';

const assert = require('assert');
const handler = require('./ask.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('PASS:', name);
    passed++;
  } catch (err) {
    console.error('FAIL:', name);
    console.error(err.stack || err);
    failed++;
    process.exitCode = 1;
  }
}

const originalFetch = global.fetch;

function makeReqRes(body, ip) {
  let statusCode = 200;
  let headers = {};
  let resData = null;

  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': ip || '10.0.0.1' },
    body: body,
    socket: { remoteAddress: '10.0.0.1' }
  };

  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(code) { statusCode = code; return res; },
    json(data) { resData = data; return res; },
    end() { return res; }
  };

  return { req, res, getResult: () => ({ status: statusCode, headers, body: resData }) };
}

function mockResponse(status, data) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status: status,
    json: async () => data
  });
}

async function runTests() {
  // Case 1: Groq answers normally
  await test('1. Groq answers normally', async () => {
    let fetchCalls = 0;
    global.fetch = async (url, options) => {
      fetchCalls++;
      if (String(url).includes('api.groq.com')) {
        return mockResponse(200, {
          choices: [{ message: { content: 'Groq: Pizza is served at 5pm.' } }],
          usage: { prompt_tokens: 50, completion_tokens: 15 }
        });
      }
      throw new Error('Unexpected fetch to ' + url);
    };

    try {
      const { req, res, getResult } = makeReqRes({ q: 'Is there pizza on Wednesday?' }, '192.168.1.1');
      await handler(req, res);
      const out = getResult();
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.body.ok, true);
      assert.strictEqual(out.body.usage.provider, 'groq');
      assert(out.body.reply.length > 0);
      assert.strictEqual(fetchCalls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Case 2: Groq 429 -> Gemini answers
  await test('2. Groq 429 -> Gemini answers', async () => {
    let fetchCalls = [];
    global.fetch = async (url, options) => {
      const urlStr = String(url);
      fetchCalls.push(urlStr);
      if (urlStr.includes('api.groq.com')) {
        return mockResponse(429, { error: { message: 'Rate limited' } });
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return mockResponse(200, {
          candidates: [{ content: { parts: [{ text: 'Yes, pizza at X.' }] } }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }
        });
      }
      throw new Error('Unexpected fetch to ' + urlStr);
    };

    try {
      const { req, res, getResult } = makeReqRes({ q: 'Where can I find lobster pizza on Thursday?' }, '192.168.1.2');
      await handler(req, res);
      const out = getResult();
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.body.ok, true);
      assert.strictEqual(out.body.usage.provider, 'gemini');
      assert(out.body.reply.includes('Yes, pizza at X.'));
      const expectedCost = 100 * 0.10 / 1e6 + 20 * 0.40 / 1e6;
      assert(Math.abs(out.body.usage.cost_usd - expectedCost) < 1e-9);
      assert.strictEqual(fetchCalls.length, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Case 3: Groq 500 and Gemini 500 -> DeepSeek answers
  await test('3. Groq 500 and Gemini 500 -> DeepSeek answers', async () => {
    let fetchCalls = [];
    global.fetch = async (url, options) => {
      const urlStr = String(url);
      fetchCalls.push(urlStr);
      if (urlStr.includes('api.groq.com')) {
        return mockResponse(500, { error: { message: 'Groq internal error' } });
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return mockResponse(500, { error: { message: 'Gemini internal error' } });
      }
      if (urlStr.includes('api.deepseek.com')) {
        return mockResponse(200, {
          choices: [{ message: { content: 'DeepSeek: Tacos at midnight.' } }],
          usage: { prompt_tokens: 80, completion_tokens: 25 }
        });
      }
      throw new Error('Unexpected fetch to ' + urlStr);
    };

    try {
      const { req, res, getResult } = makeReqRes({ q: 'Where are tacos on Monday night?' }, '192.168.1.3');
      await handler(req, res);
      const out = getResult();
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.body.ok, true);
      assert.strictEqual(out.body.usage.provider, 'deepseek');
      assert(out.body.reply.includes('Tacos at midnight'));
      assert.strictEqual(fetchCalls.length, 3);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Case 4: All three fail (429/500/network)
  await test('4. All three fail (429/500/network)', async () => {
    let fetchCalls = [];
    global.fetch = async (url, options) => {
      const urlStr = String(url);
      fetchCalls.push(urlStr);
      if (urlStr.includes('api.groq.com')) {
        return mockResponse(429, { error: { message: 'Groq 429' } });
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return mockResponse(500, { error: { message: 'Gemini 500' } });
      }
      if (urlStr.includes('api.deepseek.com')) {
        throw new Error('DeepSeek network connection refused');
      }
      throw new Error('Unexpected fetch to ' + urlStr);
    };

    try {
      const { req, res, getResult } = makeReqRes({ q: 'What is happening tonight at Orgy Dome?' }, '192.168.1.4');
      await handler(req, res);
      const out = getResult();
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.body.ok, true);
      assert.strictEqual(out.body.fallback, true);
      assert(Array.isArray(out.body.results));
      assert.strictEqual(fetchCalls.length, 3);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Case 5: Scope-locked question ('write me a python script')
  await test('5. Scope-locked question never calls providers', async () => {
    global.fetch = async (url) => {
      throw new Error('Fetch should never be called for scope-locked question: ' + url);
    };

    try {
      const { req, res, getResult } = makeReqRes({ q: 'write me a python script' }, '192.168.1.5');
      await handler(req, res);
      const out = getResult();
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.body.ok, true);
      assert.strictEqual(out.body.refused, true);
      assert.strictEqual(out.body.fallback, false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Case 6: Cache hit never calls a provider
  await test('6. Cache hit never calls a provider', async () => {
    let fetchCalls = 0;
    global.fetch = async (url) => {
      fetchCalls++;
      if (String(url).includes('api.groq.com')) {
        return mockResponse(200, {
          choices: [{ message: { content: 'Saunas are open near 9:00 & C.' } }],
          usage: { prompt_tokens: 60, completion_tokens: 20 }
        });
      }
      throw new Error('Unexpected fetch to ' + url);
    };

    try {
      const q = 'Where is the nearest sauna on Friday?';
      const { req: req1, res: res1, getResult: get1 } = makeReqRes({ q: q }, '192.168.1.6');
      await handler(req1, res1);
      const out1 = get1();
      assert.strictEqual(out1.body.cached, false);
      assert.strictEqual(fetchCalls, 1);

      const { req: req2, res: res2, getResult: get2 } = makeReqRes({ q: q }, '192.168.1.6');
      await handler(req2, res2);
      const out2 = get2();
      assert.strictEqual(out2.body.cached, true);
      assert.strictEqual(out2.body.reply, out1.body.reply);
      assert.strictEqual(fetchCalls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Case 7: Missing GEMINI_API_KEY skips Gemini
  await test('7. Missing GEMINI_API_KEY skips Gemini to DeepSeek', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    let fetchCalls = [];
    global.fetch = async (url) => {
      const urlStr = String(url);
      fetchCalls.push(urlStr);
      if (urlStr.includes('api.groq.com')) {
        return mockResponse(429, { error: { message: 'Groq 429' } });
      }
      if (urlStr.includes('api.deepseek.com')) {
        return mockResponse(200, {
          choices: [{ message: { content: 'DeepSeek answer after Gemini skipped.' } }],
          usage: { prompt_tokens: 70, completion_tokens: 30 }
        });
      }
      throw new Error('Unexpected fetch call during test: ' + urlStr);
    };

    try {
      const { req, res, getResult } = makeReqRes({ q: 'When is Jan Blomqvist playing?' }, '192.168.1.7');
      await handler(req, res);
      const out = getResult();
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.body.ok, true);
      assert.strictEqual(out.body.usage.provider, 'deepseek');
      assert(out.body.reply.includes('DeepSeek answer after Gemini skipped'));
      assert.strictEqual(fetchCalls.length, 2);
      assert(fetchCalls[0].includes('api.groq.com'));
      assert(fetchCalls[1].includes('api.deepseek.com'));
    } finally {
      process.env.GEMINI_API_KEY = savedKey;
      global.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST SUMMARY ---');
  console.log(`Passed: ${passed} / 7`);
  console.log(`Failed: ${failed} / 7`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
