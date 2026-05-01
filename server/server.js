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

// ─── workspace ───
// the dir the agent can read/list/search/edit. defaults to process.cwd().
// constrains every file op via path.resolve + prefix check.
import { realpathSync, statSync } from 'node:fs';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execCb);

let WORKSPACE = process.env.PNEUMA_WORKSPACE
  ? resolve(process.env.PNEUMA_WORKSPACE)
  : process.cwd();
try { WORKSPACE = realpathSync(WORKSPACE); } catch {}
console.log(`[workspace] ${WORKSPACE}`);

function safePath(rel) {
  // resolve relative to workspace, refuse anything escaping
  const abs = resolve(WORKSPACE, rel);
  if (!abs.startsWith(WORKSPACE + (WORKSPACE.endsWith('/') || WORKSPACE.endsWith('\\') ? '' : '\\')) &&
      !abs.startsWith(WORKSPACE + '/') && abs !== WORKSPACE) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return abs;
}

// ─── per-session staged edits (never written to disk until /apply) ───
// Map<sessionId, Map<absPath, { content, originalContent, label }>>
const STAGED = new Map();
function getStage(sessionId) {
  if (!STAGED.has(sessionId)) STAGED.set(sessionId, new Map());
  return STAGED.get(sessionId);
}

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

// ─── tool definitions (anthropic tools API) ───
// pneuma is a measured-AI CODER chat. these are the agent's hands.
// edits are STAGED in a per-session overlay — nothing writes to disk
// until the user explicitly applies via the renderer.
const PNEUMA_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace. Returns text content with line numbers prepended (1: foo, 2: bar, ...). Use sparingly on large files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'workspace-relative path' },
        start_line: { type: 'integer', description: 'optional 1-indexed start line' },
        end_line:   { type: 'integer', description: 'optional 1-indexed end line (inclusive)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories in the workspace. Recursive with depth. Skips node_modules, .git, dist, build, .venv by default.',
    input_schema: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'workspace-relative dir (default ".")' },
        depth: { type: 'integer', description: 'max recursion depth (default 2)' },
      },
    },
  },
  {
    name: 'search',
    description: 'Grep workspace files for a regex. Returns matching lines with file:line: prefix.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regex pattern' },
        path:    { type: 'string', description: 'workspace-relative scope (default ".")' },
        glob:    { type: 'string', description: 'optional glob filter (e.g. "*.ts")' },
        max:     { type: 'integer', description: 'max matches to return (default 100)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'bash',
    description: 'Run a shell command in the workspace. Read-only by default — mutating commands (rm/mv/install/git push/etc.) will be refused. Returns stdout + stderr + exit code.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'the shell command to run' },
        timeout_ms: { type: 'integer', description: 'kill after N ms (default 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'stage_edit',
    description: 'Stage a file edit in the per-session overlay. Does NOT write to disk. The user reviews and clicks apply. Returns a diff preview. Use this for ALL edits — never claim a file is written until the user has applied.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'workspace-relative path (file is created if it does not exist)' },
        content: { type: 'string', description: 'full new content of the file' },
        label:   { type: 'string', description: 'short human label for the staged edit (e.g. "split verify into three files")' },
      },
      required: ['path', 'content'],
    },
  },
];

// commands that mutate the workspace — refused by `bash` tool
const MUTATING_RE = /(?:^|\s|;|&&|\|\|)(rm|mv|cp|chmod|chown|mkfs|dd|sudo|npm\s+install|pnpm\s+install|yarn\s+install|pip\s+install|brew\s+install|apt\s+install|apt-get\s+install|git\s+push|git\s+commit|git\s+reset|git\s+checkout|git\s+merge|git\s+rebase|git\s+rm|git\s+clean|git\s+restore|>>?|tee)\b/i;

async function execTool(name, input, sessionId) {
  switch (name) {
    case 'read_file': {
      const abs = safePath(input.path || '');
      const data = await readFile(abs, 'utf8');
      const lines = data.split('\n');
      const s = Math.max(1, input.start_line || 1);
      const e = Math.min(lines.length, input.end_line || lines.length);
      const slice = lines.slice(s - 1, e);
      const numbered = slice.map((l, i) => `${s + i}: ${l}`).join('\n');
      return { ok: true, output: numbered, meta: { path: input.path, lines: `${s}-${e}/${lines.length}` } };
    }
    case 'list_files': {
      const start = safePath(input.path || '.');
      const depth = Math.max(1, Math.min(6, input.depth || 2));
      const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', '.cache', 'release']);
      const out = [];
      async function walk(dir, d) {
        if (d > depth) return;
        const { readdir } = await import('node:fs/promises');
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
        for (const ent of entries) {
          if (SKIP.has(ent.name) || ent.name.startsWith('.DS_')) continue;
          const full = join(dir, ent.name);
          const rel = full.replace(WORKSPACE, '').replace(/\\/g, '/').replace(/^\//, '');
          out.push(ent.isDirectory() ? `${rel}/` : rel);
          if (out.length > 1000) return;
          if (ent.isDirectory()) await walk(full, d + 1);
        }
      }
      await walk(start, 1);
      return { ok: true, output: out.join('\n'), meta: { count: out.length } };
    }
    case 'search': {
      const start = safePath(input.path || '.');
      const max = Math.min(500, input.max || 100);
      const re = new RegExp(input.pattern, 'g');
      const glob = input.glob ? new RegExp('^' + input.glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') : null;
      const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', '.cache']);
      const matches = [];
      async function walk(dir) {
        if (matches.length >= max) return;
        const { readdir } = await import('node:fs/promises');
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
          if (SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
          const full = join(dir, ent.name);
          if (ent.isDirectory()) { await walk(full); continue; }
          if (glob && !glob.test(ent.name)) continue;
          if (matches.length >= max) return;
          let txt;
          try { txt = await readFile(full, 'utf8'); } catch { continue; }
          const lines = txt.split('\n');
          for (let i = 0; i < lines.length; i++) {
            re.lastIndex = 0;
            if (re.test(lines[i])) {
              const rel = full.replace(WORKSPACE, '').replace(/\\/g, '/').replace(/^\//, '');
              matches.push(`${rel}:${i + 1}: ${lines[i].slice(0, 200)}`);
              if (matches.length >= max) return;
            }
          }
        }
      }
      await walk(start);
      return { ok: true, output: matches.join('\n') || '(no matches)', meta: { count: matches.length, capped: matches.length >= max } };
    }
    case 'bash': {
      const cmd = String(input.command || '').trim();
      if (!cmd) return { ok: false, error: 'empty command' };
      if (MUTATING_RE.test(cmd)) {
        return { ok: false, error: `refused: command appears to mutate the workspace. use stage_edit for file changes; tell the user to run mutating commands themselves. cmd: ${cmd.slice(0, 200)}` };
      }
      const timeout = Math.min(60000, input.timeout_ms || 30000);
      // cross-platform: use powershell on win32 (handles pwd, ls, cat aliases),
      // /bin/bash elsewhere. agents can write either-style and it works.
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
      const shellArgs = process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-Command', cmd]
        : ['-c', cmd];
      try {
        const { spawn: spawnRaw } = await import('node:child_process');
        const result = await new Promise((resolve, reject) => {
          const child = spawnRaw(shell, shellArgs, { cwd: WORKSPACE, env: process.env });
          let stdout = '', stderr = '';
          let killed = false;
          const timer = setTimeout(() => {
            killed = true;
            try { child.kill('SIGKILL'); } catch {}
          }, timeout);
          child.stdout.on('data', d => { stdout += d; if (stdout.length > 200000) { try { child.kill(); } catch {} } });
          child.stderr.on('data', d => { stderr += d; if (stderr.length > 200000) { try { child.kill(); } catch {} } });
          child.on('error', reject);
          child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code: killed ? 124 : code });
          });
        });
        const out = result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
        return {
          ok: result.code === 0,
          output: out || '(no output)',
          meta: { cmd, exit: result.code, shell },
        };
      } catch (e) {
        return { ok: false, output: '', meta: { cmd, error: e.message } };
      }
    }
    case 'stage_edit': {
      const abs = safePath(input.path || '');
      let original = '';
      try { original = await readFile(abs, 'utf8'); } catch { original = ''; }
      const stage = getStage(sessionId);
      const existing = stage.get(abs);
      stage.set(abs, {
        content: input.content,
        originalContent: existing?.originalContent ?? original,
        label: input.label || existing?.label || `edit ${input.path}`,
        path: input.path,
      });
      // simple unified-ish preview
      const oldLines = (existing?.originalContent ?? original).split('\n');
      const newLines = input.content.split('\n');
      const dStat = `${oldLines.length} → ${newLines.length} lines`;
      return {
        ok: true,
        output: `staged: ${input.path} (${dStat})\nlabel: ${input.label || '(no label)'}\nthe user will review and apply via the renderer. do NOT claim this file is written.`,
        meta: { path: input.path, oldLines: oldLines.length, newLines: newLines.length, label: input.label },
      };
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}

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

async function handleWorkspace(req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ workspace: WORKSPACE, tools: PNEUMA_TOOLS.map(t => t.name) }));
}

async function handleTool(req, res) {
  // direct tool invocation (used by renderer to test, and by /chat tool-loop)
  let payload;
  try { payload = await readBody(req); } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid json' }));
    return;
  }
  const { name, input, sessionId = 'default' } = payload;
  try {
    const result = await execTool(name, input || {}, sessionId);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function handleStagedList(req, res) {
  let payload;
  try { payload = await readBody(req); } catch { payload = {}; }
  const sessionId = payload.sessionId || 'default';
  const stage = getStage(sessionId);
  const items = [];
  for (const [abs, v] of stage.entries()) {
    items.push({
      path: v.path,
      label: v.label,
      oldLines: v.originalContent.split('\n').length,
      newLines: v.content.split('\n').length,
    });
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ items, count: items.length }));
}

async function handleApply(req, res) {
  let payload;
  try { payload = await readBody(req); } catch { payload = {}; }
  const sessionId = payload.sessionId || 'default';
  const onlyPath = payload.path;   // optional: apply just one
  const stage = getStage(sessionId);
  const { writeFile, mkdir } = await import('node:fs/promises');
  const applied = [];
  const errors = [];
  for (const [abs, v] of [...stage.entries()]) {
    if (onlyPath && v.path !== onlyPath) continue;
    try {
      // ensure parent exists
      const parent = dirname(abs);
      await mkdir(parent, { recursive: true });
      await writeFile(abs, v.content, 'utf8');
      applied.push(v.path);
      stage.delete(abs);
    } catch (e) {
      errors.push({ path: v.path, error: e.message });
    }
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ applied, errors }));
}

async function handleDiscard(req, res) {
  let payload;
  try { payload = await readBody(req); } catch { payload = {}; }
  const sessionId = payload.sessionId || 'default';
  const onlyPath = payload.path;
  const stage = getStage(sessionId);
  const discarded = [];
  for (const [abs, v] of [...stage.entries()]) {
    if (onlyPath && v.path !== onlyPath) continue;
    discarded.push(v.path);
    stage.delete(abs);
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ discarded }));
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

  // mode-aware system prompt + tool guidance
  let systemPrompt = system || PNEUMA_SYSTEM_PROMPT;
  systemPrompt += `\n\n## workspace\nyou have tools to read/list/search/run-bash/stage-edits in the workspace at \`${WORKSPACE}\`. always read before editing. always run tests via \`bash\` to verify claims — never say "tests pass" without actually running them. all edits go through \`stage_edit\` (never write to disk directly) — the user reviews and applies.`;
  if (mode === 'plan') {
    systemPrompt += `\n\n## current mode: plan\npropose changes — read files, list dirs, search. do NOT call \`stage_edit\` or mutate anything. lay out the plan. the user switches to act mode when ready.`;
  } else {
    systemPrompt += `\n\n## current mode: act\nproduce the actual changes. use \`stage_edit\` for every file change. verify with \`bash\` (e.g. \`npm test\`, \`tsc --noEmit\`, \`python -m pytest\`). report the verified state, not a claim.`;
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
        // tools: PNEUMA_TOOLS,    // re-enabled in v0.5b once tool loop is wired
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

  if (req.method === 'POST' && req.url === '/chat')      return handleChat(req, res);
  if (req.method === 'POST' && req.url === '/score')     return handleScore(req, res);
  if (req.method === 'POST' && req.url === '/tool')      return handleTool(req, res);
  if (req.method === 'POST' && req.url === '/staged')    return handleStagedList(req, res);
  if (req.method === 'POST' && req.url === '/apply')     return handleApply(req, res);
  if (req.method === 'POST' && req.url === '/discard')   return handleDiscard(req, res);
  if (req.method === 'GET'  && req.url === '/health')    return handleHealth(req, res);
  if (req.method === 'GET'  && req.url === '/workspace') return handleWorkspace(req, res);
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
