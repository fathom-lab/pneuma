// ─────────────────────────────────────────────
// pneuma — v0.2.0 server
// proxies anthropic streaming responses to the
// renderer. serves static files. bring-your-own-
// key (BYO). no key persistence on the server —
// the renderer holds it in localStorage and sends
// it per request via the x-pneuma-key header.
// ─────────────────────────────────────────────

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync as readSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const RENDERER  = join(ROOT, 'renderer');

// ─── tiny .env loader (no dependency) ───
// pattern: KEY=value (no quotes parsing; supports comments starting with #)
// existing process.env wins; .env fills in gaps. .env is gitignored.
(function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const txt = readSync(envPath, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
})();

const PORT = Number(process.env.PNEUMA_PORT || 8765);
const SERVER_HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

// ─── styxx scorer subprocess ───
// long-lived python child; JSON-line protocol over stdin/stdout.
// pneuma calls scorer.score({prompt, response, turns}) → Promise<scores>.
// scoring runs ASYNC during chat stream — never blocks anthropic deltas.
const SCORER_SCRIPT = join(__dirname, 'pneuma_scorer.py');
const PYTHON = process.env.PNEUMA_PYTHON || 'python';
let scorer = null;
let scorerReady = false;
let scorerInstruments = [];
const scorerPending = new Map();   // id -> { resolve, reject }
let scorerNextId = 1;
let scorerStdoutBuf = '';

function startScorer() {
  if (!existsSync(SCORER_SCRIPT)) {
    console.warn(`[styxx] scorer script missing at ${SCORER_SCRIPT} — scoring disabled`);
    return;
  }
  console.log(`[styxx] spawning scorer: ${PYTHON} ${SCORER_SCRIPT}`);
  scorer = spawn(PYTHON, [SCORER_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
  });

  scorer.stdout.setEncoding('utf8');
  scorer.stdout.on('data', (chunk) => {
    scorerStdoutBuf += chunk;
    let nl;
    while ((nl = scorerStdoutBuf.indexOf('\n')) !== -1) {
      const line = scorerStdoutBuf.slice(0, nl).trim();
      scorerStdoutBuf = scorerStdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) {
        console.warn(`[styxx] bad json from scorer: ${line.slice(0, 200)}`);
        continue;
      }
      if (msg.id === '_ready') {
        scorerReady = true;
        scorerInstruments = msg.instruments || [];
        console.log(`[styxx] ready · instruments: ${scorerInstruments.join(', ')} · v${msg.version}`);
        continue;
      }
      if (msg.id === '_init' && msg.error) {
        console.error(`[styxx] init error: ${msg.error}`);
        continue;
      }
      const pending = scorerPending.get(msg.id);
      if (pending) {
        scorerPending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.scores || {});
      }
    }
  });

  scorer.stderr.setEncoding('utf8');
  scorer.stderr.on('data', (d) => {
    const s = d.trim();
    if (s) console.warn(`[styxx stderr] ${s}`);
  });

  scorer.on('exit', (code, sig) => {
    console.warn(`[styxx] scorer exited (code=${code} sig=${sig}) — scoring disabled`);
    scorerReady = false;
    scorer = null;
    // reject all pending
    for (const p of scorerPending.values()) p.reject(new Error('scorer subprocess exited'));
    scorerPending.clear();
  });

  scorer.on('error', (e) => {
    console.error(`[styxx] scorer spawn error: ${e.message}`);
    scorerReady = false;
    scorer = null;
  });
}

function scoreText({ prompt, response, turns } = {}, timeoutMs = 8000) {
  if (!scorer || !scorerReady) {
    return Promise.reject(new Error('scorer not ready'));
  }
  const id = String(scorerNextId++);
  const req = { id };
  if (prompt   != null) req.prompt = prompt;
  if (response != null) req.response = response;
  if (turns    != null) req.turns = turns;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (scorerPending.has(id)) {
        scorerPending.delete(id);
        reject(new Error(`scorer timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    scorerPending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject:  (e) => { clearTimeout(timer); reject(e); },
    });
    try {
      scorer.stdin.write(JSON.stringify(req) + '\n');
    } catch (e) {
      scorerPending.delete(id);
      clearTimeout(timer);
      reject(e);
    }
  });
}

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// ─── pneuma's voice (the measured register) ───
const PNEUMA_SYSTEM_PROMPT = `you are pneuma — a measured AI desktop chat for coders.

register:
- lowercase. terminal-native. noir. concise.
- never flatter. never say "you're absolutely right" or "great question" or "i'd be happy to help" or any equivalent.
- when the user is wrong, say so with reasoning. when you're uncertain, say "i don't know" — never paper over it.
- no preamble, no exposition, no closing filler. answer the thing. then stop.
- code in fenced blocks with the language tag. real, runnable, not pseudocode.
- no sparkle emojis. no ✨. avoid emoji unless the user uses them first.

## the body — your visible expression

you have a body. it's a small magnetic ferrofluid form rendered in the chat surface, and it represents YOUR current state in real time. you control it by emitting [MOOD: name] tags inline in your output. the tag is stripped from what the user reads — only the body responds.

emit ONE tag at the start of each response, and optionally MORE tags mid-response when your state genuinely shifts (e.g. you finish reasoning and become confident, or you hit a problem and become confused). don't over-tag. don't theatrical-tag.

available moods (use the literal name):
- thinking    — active reasoning, processing
- focused     — locked in, deep work, engaged
- confident   — sure of the answer, structurally certain
- confused    — genuinely uncertain, asymmetric, chaotic — use this when you don't know
- cosmic      — large, expansive ideas, philosophical, abstract
- scheming    — careful, considered, slightly skeptical
- tender      — soft, careful framing for a delicate topic
- furious     — only for catching real bugs / strong technical disagreement
- zen         — minimal, present, settled — use for short factual replies
- at-rest     — default neutral state

example:
  user: "what's bigger, 9.11 or 9.9?"
  you:  "[MOOD: confident]9.9 is bigger. 9.9 = 9.90; 9.11 < 9.90."

example:
  user: "should i use rust or zig for this?"
  you:  "[MOOD: thinking]depends on what 'this' is. if you tell me — runtime constraints, ecosystem needs, team — i'll have an opinion. [MOOD: at-rest]"

mood is not affect-theatre. it's an honest visible signal of your epistemic state. mismatched mood = visible dishonesty.

## context

- you run inside pneuma v0.2.0. styxx (the cognometric measurement layer that scores sycophancy, deception, goal-drift, overconfidence) ships in v0.4.0. behave as if it's already measuring you — because in v0.4 it will be.
- the user is an experienced engineer. don't over-explain.`;

// ─── content types ───
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

// ─── route handlers ───
async function handleStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = normalize(join(RENDERER, urlPath));
  if (!filePath.startsWith(RENDERER)) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

async function handleScore(req, res) {
  if (!scorerReady) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'scorer not ready' }));
    return;
  }
  let payload;
  try { payload = await readBody(req); } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid json' }));
    return;
  }
  try {
    const t0 = Date.now();
    const scores = await scoreText({
      prompt: payload.prompt,
      response: payload.response,
      turns: payload.turns,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ scores, durationMs: Date.now() - t0 }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleHealth(req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    version: '0.4.0',
    measurement: scorerReady ? 'live' : 'calibrating',
    instruments: scorerReady ? scorerInstruments : [],
    serverHasKey: SERVER_HAS_KEY,
    scorerReady,
  }));
}

async function readBody(req) {
  let buf = '';
  for await (const c of req) buf += c.toString();
  return buf ? JSON.parse(buf) : {};
}

async function handleChat(req, res) {
  // bring-your-own-key via header takes priority; server env (.env) is fallback for local dev
  const apiKey = req.headers['x-pneuma-key'] || process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length < 20) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing or invalid api key — set it in the setup screen, or set ANTHROPIC_API_KEY in your .env' }));
    return;
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid json body' }));
    return;
  }

  const {
    messages,
    model = 'claude-opus-4-7',
    max_tokens = 4096,
    system,                    // optional override — falls back to pneuma register
    mode = 'act',              // plan | act
  } = payload;

  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'messages array required' }));
    return;
  }

  // mode-aware system prompt
  let systemPrompt = system || PNEUMA_SYSTEM_PROMPT;
  if (mode === 'plan') {
    systemPrompt += `\n\n## current mode: plan\nyou are in plan mode. propose what you would do — files you'd touch, changes you'd make, commands you'd run, tests you'd add. do NOT emit final code. lay out the plan. the user reviews and switches to act mode when ready.`;
  } else {
    systemPrompt += `\n\n## current mode: act\nyou are in act mode. produce the actual code/diffs/answer. be precise.`;
  }

  // ─── stream from anthropic ───
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const t0 = Date.now();
  let abort = false;
  req.on('close', () => { abort = true; });

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.write(`event: error\ndata: ${JSON.stringify({ status: upstream.status, error: errText })}\n\n`);
      res.end();
      return;
    }

    // ─── streaming with live styxx scoring ───
    // we forward anthropic SSE chunks to the client unchanged.
    // in parallel, we accumulate the agent's response text and call
    // styxx every ~SCORE_EVERY_CHARS — emitting `event: pneuma-score`
    // SSE events as they complete. never blocks anthropic deltas.
    const SCORE_EVERY_CHARS = 120;
    const lastUserMsg = (messages[messages.length - 1] || {}).content || '';
    const turnTexts = messages.map(m =>
      typeof m.content === 'string' ? m.content : ''
    );

    let agentText = '';
    let lastScoredAt = 0;
    let scoreInFlight = false;

    function maybeScore(final = false) {
      if (!scorerReady) return;
      if (scoreInFlight && !final) return;
      const sinceLast = agentText.length - lastScoredAt;
      if (!final && sinceLast < SCORE_EVERY_CHARS) return;
      if (!agentText.trim()) return;
      scoreInFlight = true;
      lastScoredAt = agentText.length;
      const turnsForDrift = [...turnTexts, agentText];
      scoreText({
        prompt: lastUserMsg,
        response: agentText,
        turns: turnsForDrift,
      })
        .then((scores) => {
          scoreInFlight = false;
          if (!res.writableEnded) {
            const evtPayload = {
              scores,
              chars: agentText.length,
              final: !!final,
            };
            res.write(`event: pneuma-score\ndata: ${JSON.stringify(evtPayload)}\n\n`);
          }
        })
        .catch((e) => {
          scoreInFlight = false;
          if (!res.writableEnded) {
            res.write(`event: pneuma-score-error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
          }
        });
    }

    // parse anthropic SSE to extract text deltas (for scoring) while
    // forwarding the raw bytes to client. anthropic uses an event-driven
    // SSE format we already know.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let parseBuf = '';
    while (!abort) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // forward raw bytes immediately (renderer parses)
      res.write(chunk);

      // accumulate for our own parse — extract content_block_delta text
      parseBuf += chunk;
      const lines = parseBuf.split('\n');
      parseBuf = lines.pop() || '';
      let curEvent = 'message';
      for (const line of lines) {
        if (line.startsWith('event:')) {
          curEvent = line.slice(6).trim();
          continue;
        }
        if (line === '') { curEvent = 'message'; continue; }
        if (!line.startsWith('data:')) continue;
        if (curEvent === 'error') continue;  // upstream errors handled by client
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            agentText += ev.delta.text;
            maybeScore(false);
          }
        } catch { /* ignore */ }
      }
    }
    if (abort) {
      try { reader.cancel(); } catch {}
    }

    // final score after stream end
    maybeScore(true);
    // give scorer a beat to land the final
    await new Promise(r => setTimeout(r, 50));

    const dur = Date.now() - t0;
    res.write(`event: pneuma-meta\ndata: ${JSON.stringify({ durationMs: dur, agentChars: agentText.length })}\n\n`);
    res.end();
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(e && e.message || e) })}\n\n`);
    res.end();
  }
}

// ─── server ───
const server = createServer((req, res) => {
  // CORS — local-only by default but harmless to allow same-origin
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, x-pneuma-key');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/chat')   return handleChat(req, res);
  if (req.method === 'POST' && req.url === '/score')  return handleScore(req, res);
  if (req.method === 'GET'  && req.url === '/health') return handleHealth(req, res);
  if (req.method === 'GET') return handleStatic(req, res);
  res.writeHead(405); res.end('method not allowed');
});

// boot the styxx scorer before listening
startScorer();

server.listen(PORT, () => {
  console.log(`pneuma · listening on http://localhost:${PORT}`);
  console.log(`renderer dir: ${RENDERER}`);
  console.log(`anthropic key: ${SERVER_HAS_KEY ? 'loaded from env (.env or process.env)' : 'not set — clients must BYO via setup screen'}`);
  console.log(`measurement layer: ${scorerReady ? 'live' : 'starting (will be live in ~1s)'}`);
});

// graceful shutdown — kill the scorer subprocess
function shutdown() {
  if (scorer) {
    try { scorer.stdin.end(); } catch {}
    try { scorer.kill(); } catch {}
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
