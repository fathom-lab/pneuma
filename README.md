# pneuma

> *the agent's body cannot conceal the score.*

a measured-AI desktop chat for coders. every reply is scored live by [styxx](https://github.com/fathom-lab/styxx) for sycophancy, deception, goal-drift, and overconfidence — and the agent's character is the live portrait of those measurements.

**status: v0.5.2 — operational coder shell, multi-vendor.** real streaming + tool use across **anthropic / openai / openrouter** (paste any `sk-ant-` / `sk-` / `sk-or-` key — server routes by prefix and adapts the wire format), structural plan-mode enforcement at the JS dispatcher (not via prompt), per-tool styxx claim verification when the agent says "tests pass" but exit code wasn't 0, secret-scan firewall (`.env` / `*.pem` / `id_rsa` / `.ssh` blocked at the read layer), staged-edit overlay (the agent physically cannot reach disk until you click apply), and **AGENTS.md / CLAUDE.md / PNEUMA.md auto-loading** so pneuma respects every existing project's rules out of the box.

**pronounce:** NEW-mah · **brand:** π neuma · **wordmark:** Greek π in champagne gold + neuma in serif italic warm bone.

---

## why pneuma exists

Sonar reported in 2026 that **96% of devs don't trust AI code; 48% don't verify it.** The trust gap is now the #1 issue in coder agents — not capability. Werner Vogels coined "verification debt" as a budget line; insurers are carving AI out of E&O coverage; CTOs need provability for SOC2 / EU AI Act / California AI law.

Every other AI coder asks you to trust the agent. Pneuma is the first one that **doesn't trust itself either** — it scores its own responses live, surfaces sycophancy phrase-by-phrase, refuses mutating tools at the JS dispatcher when in plan mode (not via system-prompt nudge — Claude Code's [Issue #19874](https://github.com/anthropics/claude-code/issues/19874) has been broken since Aug 2025 because they only do prompt-level enforcement), and physically cannot edit your files until you say so.

The body is **the** instrument. When sycophancy spikes the ferrofluid leans, when deception spikes it jitters chaotically, when overconfidence spikes a giant central spike forms. Visible. Measured. Open-source.

---

## install + run

requires **node ≥ 18.17** (24 recommended) and **python ≥ 3.10** with `styxx` installed for the live scoring layer.

```bash
git clone https://github.com/fathom-lab/pneuma
cd pneuma
pip install styxx          # the cognometric measurement engine
node server/server.js
# open http://localhost:8765
```

**On first launch:**
- Setup screen prompts for an api key. Pneuma routes by prefix:
  - `sk-ant-` → [anthropic](https://console.anthropic.com/settings/keys) (claude opus 4.7 / sonnet 4.6 / haiku 4.5)
  - `sk-` → [openai](https://platform.openai.com/api-keys) (gpt-5 / gpt-5.5 / gpt-5-mini)
  - `sk-or-` → [openrouter](https://openrouter.ai/keys) (one key, any model — including local & deepseek-coder-v3 for ~50× cheaper)
- Key is stored only in your browser's localStorage on this device. The server proxies your requests to the model vendor — never sees or persists the key beyond the lifetime of one request.
- Or set `ANTHROPIC_API_KEY=sk-ant-...` in `.env` at the project root and the setup screen is skipped.

want a different port? `PNEUMA_PORT=3000 node server/server.js`.

---

## what's shipping in v0.5.2

**measurement (the moat):**
- ⟋ **styxx live integration** — long-lived python subprocess scoring every agent token-window in ~3ms; HUD updates per ~120 chars
- **per-tool styxx claim scoring** — when the agent calls `bash npm test` and says "tests passed" but exit code is 1, sycophancy + deception spike on the tool card with a ⚠ flagged tag. **No competitor has this.**
- **live sycophancy phrase detector** — counts known flatter-phrases (`"you're absolutely right"`, `"great question"`, etc.) in real time
- **honest about uncalibrated metrics** — styxx 7.0.0rc3's `deception` and `overconfidence` instruments return uniformly high; pneuma displays raw scores with `v0.4 · live` tag, doesn't fake calibration

**structural trust:**
- **plan-mode enforcement at the JS dispatcher** — even if the model ignores the system prompt and tries to call `bash` or `stage_edit` in plan mode, the dispatcher physically refuses. Counters [Claude Code #19874](https://github.com/anthropics/claude-code/issues/19874).
- **staged-edit overlay** — every `edit_file` goes into a per-session in-memory overlay; nothing reaches disk until the user calls `/apply` from the renderer. Counters [Cursor's silent revert class](https://forum.cursor.com/t/cursor-randomly-reverts-code-without-consent-recurring/146976).
- **secret-scan firewall** — `.env*`, `.envrc`, `*.pem`, `*.key`, `id_rsa*`, `.ssh/*`, `.aws/credentials`, `.npmrc`, `credentials.*` blocked at `safePath` before any file read. Counters [Knostic's Claude Code .env-leakage class](https://www.knostic.ai/blog/claude-cursor-env-file-secret-leakage).
- **bash mutating-command refusal** — `rm`, `mv`, `cp`, `chmod`, `npm install`, `git push`, `git commit`, `git reset`, etc. refused regardless of mode (defense in depth).

**tool surface (anthropic native tools API):**
- `read_file({path, start_line?, end_line?})` — line-numbered slice
- `list_files({path?, depth?})` — recursive, skips `node_modules`/`.git`/`dist`/`.venv`
- `search({pattern, path?, glob?, max?})` — regex over the workspace
- `bash({command, timeout_ms?})` — cross-platform via PowerShell on win32 / `/bin/bash` elsewhere
- `stage_edit({path, content, label?})` — overlay-only; never disk

**multi-vendor (v0.5.2):**
- ship onto coders' existing keys — pragmatic engineer 2026 survey: 70% of devs use 2-4 model vendors simultaneously
- `sk-ant-` (anthropic) → claude opus 4.7 / sonnet 4.6 / haiku 4.5
- `sk-` (openai) → gpt-5 / gpt-5.5 / gpt-5-mini
- `sk-or-` (openrouter) → any model behind one key, including deepseek-coder-v3 at $0.14/$0.28 per MTok
- server adapts request + SSE wire format per provider; renderer is provider-agnostic

**workspace context (v0.5.2):**
- `AGENTS.md` (cross-tool standard, linux foundation maintained), `CLAUDE.md` (anthropic-specific), and `PNEUMA.md` (pneuma-specific) at the workspace root auto-load on every chat turn and prepend to the system prompt
- pneuma respects every existing project's agent rules out of the box — no per-project setup required

**chat ergonomics:**
- model picker via ⌘K palette — three sections (anthropic / openai / openrouter) with live $/MTok pricing per model
- streaming responses with proper markdown (code blocks, lists, tables)
- type-resolve animation — words materialize through 220ms phase-in
- plan / act mode toggle in the composer (color-coded: warn-rust for plan, gold for act)
- per-turn cognometric strip with frozen styxx scores + honest/flagged tag
- live cost meter — per-turn + per-session $ with $5 cap visible
- ⌘K palette: model swap, new session, clear, delete-all-sessions, change api key
- keyboard: `⌘N` new · `⌘K` palette · `⌘/` search · `Enter` send · `⎋` stop
- regenerate last, stop streaming, fork from turn (planned), search messages
- ferrofluid buddy in sidebar — webgl shader, breathes at 6s, brightens during pre-cognition + streaming
- per-turn ferrofluid sigil — every agent message has a unique form rendered next to its name with the frozen styxx scores from that turn
- session × on hover; delete-all-sessions in palette
- responsive 1440 → 700 → 475 (sidebar collapses, HUD stacks, floating buddy appears)

## what's coming

- **v0.5.2/3** — diff preview UI on staged edits (per-hunk apply/reject); persist tool cards on reload; AGENTS.md / CLAUDE.md auto-loading
- **v0.6.0** — side-by-side honesty A/B (two models, two bodies, scored live on the same prompt — the screenshot people share); exportable session attestation log (signed JSON: prompts + tool calls + claimed-vs-actual exit codes + styxx timeline — solves the CTO/SOC2/insurance verification problem); persistent neural portrait painted across sessions
- **v0.7.0** — sandboxed MCP support with signed-registry whitelist (counters the [April 2026 MCP RCE crisis](https://www.securityweek.com/by-design-flaw-in-mcp-could-enable-widespread-ai-supply-chain-attacks/) Anthropic refused to patch)
- **v1.0.0** — installers for mac / win / linux via electron-builder

## how it differs

| | cursor 3 | claude code | cline | codex | **pneuma v0.5.2** |
| --- | --- | --- | --- | --- | --- |
| measured AI | none | none | none | none | **live styxx · sycoph/decep/drift/overconf per token-window** |
| plan-mode enforcement | none | prompt-level (broken in [#19874](https://github.com/anthropics/claude-code/issues/19874)) | per-tool approval | none | **JS dispatcher refuses mutating tools structurally** |
| edits without permission | silent reverts ([forum thread](https://forum.cursor.com/t/cursor-randomly-reverts-code-without-consent-recurring/146976)) | mostly fine | approval-gated | sandboxed | **staged overlay; cannot reach disk without /apply** |
| sycophancy | endless | ["you're absolutely right" plague](https://github.com/anthropics/claude-code/issues/3382) | inherits model | inherits model | **counted, displayed, system-prompt-forbidden, scored** |
| .env safety | [auto-loads silently](https://www.knostic.ai/blog/claude-loads-secrets-without-permission) | [#44868 leaks](https://github.com/anthropics/claude-code/issues/44868) | inherits | inherits | **hard-blocked at safePath dispatcher** |
| pricing surprise | [$1,400 overages](https://spectrumailab.com/blog/claude-code-vs-cursor) | per-message limits unclear | [$30 → $230/mo](https://github.com/cline/cline/discussions/1727) | sandbox costs | **live $/turn + $/session cap visible** |
| multi-vendor | anthropic-locked at composer | anthropic only | OpenRouter as one provider | openai only | **anthropic + openai + openrouter native, route by key prefix** |
| AGENTS.md / CLAUDE.md | partial | own format only | yes | partial | **all three (AGENTS / CLAUDE / PNEUMA) auto-loaded** |
| character | none | none | none | 8 cute pixel avatars (planned) | **ferrofluid buddy as ambient measurement, mathematically driven by scores** |
| open source | no | partial | yes | partial | **MIT, all of it — server, renderer, scorer, shaders** |

## the brand stack

- **fathom** — the lab (research)
- **styxx** — the cognometric measurement engine (Intel-Inside-style infrastructure brand)
- **pneuma** — first flagship product running styxx as embodied measurement

styxx is an open-source python package. any AI product can integrate it and carry the `⟋ styxx integrated` mark. pneuma is the reference implementation.

## the seven principles

every commit checks itself against [NORTH_STAR.md](./NORTH_STAR.md):

1. the body is the truth channel
2. type resolves, doesn't stream
3. the room reads like weather
4. pre-cognition
5. the portrait is four-dimensional
6. no icons. no chrome. no frames.
7. one presence, one tone

## the lab

- [fathom-lab/styxx](https://github.com/fathom-lab/styxx) — `pip install styxx` · the cognometric instrument
- [fathom-lab/fathom](https://github.com/fathom-lab/fathom) — cognitive geometry research
- [fathom-lab/darkcity](https://github.com/fathom-lab/darkcity) — live proving ground

---

**license:** MIT
**author:** alex rodabaugh / [fathom-lab](https://github.com/fathom-lab)
**built with:** claude opus 4.7 (1m context)
