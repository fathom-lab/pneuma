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

async function handleHealth(req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    version: '0.2.0',
    measurement: 'calibrating · ships v0.4.0',
    serverHasKey: SERVER_HAS_KEY,
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

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (!abort) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    if (abort) {
      try { reader.cancel(); } catch {}
    }
    const dur = Date.now() - t0;
    res.write(`event: pneuma-meta\ndata: ${JSON.stringify({ durationMs: dur })}\n\n`);
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
  if (req.method === 'GET'  && req.url === '/health') return handleHealth(req, res);
  if (req.method === 'GET') return handleStatic(req, res);
  res.writeHead(405); res.end('method not allowed');
});

server.listen(PORT, () => {
  console.log(`pneuma · listening on http://localhost:${PORT}`);
  console.log(`renderer dir: ${RENDERER}`);
  console.log(`anthropic key: ${SERVER_HAS_KEY ? 'loaded from env (.env or process.env)' : 'not set — clients must BYO via setup screen'}`);
  console.log(`measurement layer: calibrating · ships v0.4.0`);
});
