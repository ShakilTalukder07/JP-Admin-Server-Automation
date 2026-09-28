// ============================================================
//  groq.js - shared AI helper
//  • sequential queue (2.5 s gap) - never hits rate limits
//  • multi-key rotation: set GROQ_API_KEYS=key1,key2,... (or
//    single GROQ_API_KEY); on 429 the next key takes over
//  • getStatus() reads Groq's rate-limit headers for !groqstatus
// ============================================================
const cfg = require('./config');
const defaultModel = process.env.GROQ_MODEL || cfg.groq?.model || 'llama-3.3-70b-versatile';
const groq = { model: defaultModel, ...(cfg.groq || {}) };
if (process.env.GROQ_MODEL) groq.model = process.env.GROQ_MODEL;

const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);
let keyIndex = 0;
let lastHeaders = {};

let queue = Promise.resolve();
const GAP_MS = 2500;

function askJson(messages, options = {}) {
  const job = queue.then(() => callGroq(messages, 0, options));
  queue = job.then(() => sleep(GAP_MS), () => sleep(GAP_MS));
  return job;
}

async function callGroq(messages, attempt = 0, options = {}) {
  if (!keys.length) throw new Error('GROQ_API_KEY(S) not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keys[keyIndex]}`,
    },
    body: JSON.stringify({
      model: options.model || groq.model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 2500,
      response_format: { type: 'json_object' },
    }),
  });
  captureHeaders(res);
  if (res.status === 429 && attempt < keys.length) {
    keyIndex = (keyIndex + 1) % keys.length;
    console.warn(`[groq] 429 - rotating to key #${keyIndex + 1}`);
    await sleep(1500);
    return callGroq(messages, attempt + 1, options);
  }
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

function captureHeaders(res) {
  const grab = (n) => res.headers.get(n);
  lastHeaders = {
    keyNumber: keyIndex + 1,
    remainingRequests: grab('x-ratelimit-remaining-requests'),
    limitRequests: grab('x-ratelimit-limit-requests'),
    remainingTokens: grab('x-ratelimit-remaining-tokens'),
    limitTokens: grab('x-ratelimit-limit-tokens'),
    resetRequests: grab('x-ratelimit-reset-requests'),
    at: new Date().toISOString(),
  };
}

// live probe: tiny request just to refresh headers
async function getStatus() {
  try {
    await callGroq([
      { role: 'system', content: 'Respond ONLY with JSON: {"ok":true}' },
      { role: 'user', content: 'ping' },
    ]);
  } catch (e) { /* headers may still have been captured */ }
  return { keysConfigured: keys.length, ...lastHeaders };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = { askJson, getStatus };
