# pneuma

> *the agent's body is its breath. its breath cannot lie.*

a measured-AI desktop chat for coders. every reply is scored for sycophancy, deception, goal-drift, and overconfidence — and the agent's character is the live portrait of those measurements.

**status: v0.2.0 — working chat.** real anthropic streaming, real markdown, real sycophancy phrase detection counted live. styxx full integration ships in v0.4.0.

**pronounce:** NEW-mah · **brand:** π neuma · **wordmark:** Greek π in champagne gold + neuma in serif italic warm bone.

---

## install + run

requires **node ≥ 18.17** (24 recommended). no other dependencies — uses native fetch + http modules.

```bash
git clone https://github.com/fathom-lab/pneuma
cd pneuma
node server/server.js
# open http://localhost:8765
```

or:

```bash
npm start
```

first launch shows a setup screen — paste your [anthropic api key](https://console.anthropic.com/settings/keys) (`sk-ant-...`). it's stored only in your browser's localStorage on this device. the server proxies your requests to anthropic — it never sees or persists the key beyond the lifetime of one request.

want a different port? `PNEUMA_PORT=3000 node server/server.js`.

---

## what works in v0.2.0

- **real chat with claude opus 4.7 / sonnet 4.6 / haiku 4.5** — switch via ⌘K palette
- **streaming responses with real markdown** — code blocks, lists, tables, citations rendered correctly mid-stream
- **type-resolve animation** — words materialize through a soft 220ms phase-in; per principle 2, type resolves, doesn't typewriter
- **plan / act mode toggle** — plan = read-only-ish, act = produce code. system prompt switches accordingly
- **persistent sessions** — saved to localStorage, sidebar groups by today / earlier, auto-titled from your first message
- **live sycophancy phrase detector** — pneuma watches the agent's stream for known flatter-phrases (`"you're absolutely right"`, `"great question"`, etc.) and counts them. the HUD shows `0 sycoph phrases · last N turns`. honest, real, minimal — pneuma already measures something. v0.4 swaps in the full styxx engine.
- **per-turn cognometric strip** — each agent reply gets its own honesty tag (`honest` / `flagged`)
- **live cost meter** — per-turn and per-session token / dollar counts, with a $5 session cap visible
- **⌘K palette** — model swap, new session, clear, settings, links to fathom-lab + styxx
- **keyboard shortcuts** — `⌘N` new · `⌘K` palette · `⌘/` search · `Enter` send · `⎋` stop / close
- **regenerate last** — strip the last assistant turn, re-send the user message
- **stop streaming** — `⎋` or click `STOP` mid-stream; partial response is preserved
- **ferrofluid buddy in sidebar** — webgl shader, breathes at 6s cycle, brightens during pre-cognition (composer focus) and streaming
- **per-turn ferrofluid sigil** — every agent message has a tiny unique form rendered next to its name
- **first-class responsive** — works at 1440px desktop down to 475px mobile (sidebar collapses, HUD stacks, floating buddy appears)

## what's coming

- **v0.3.0** — alien embodiment expansion: extract the 45+ expressions and particle systems from `clawd/fathom-app/darkflobi-fathom.js`, wire `[MOOD: …]` inline tags from agent stream
- **v0.4.0** — **the unprecedented move.** spawn a styxx subprocess (or call a styxx http daemon), score every agent token-window for the full four cognometric instruments. the ferrofluid buddy responds mathematically: sycophancy → leans toward camera, deception → micro-jitter, goal-drift → asymmetric form, overconfidence → one giant central spike, depth → crystalline geometry. the styxx mark in the HUD activates.
- **v0.5.0** — **the room remembers.** persistent neural portrait painted across sessions; click any region of the portrait to see contributing styxx measurements. the conversation history IS the cognometric scoreboard.
- **v1.0.0** — installers for mac / win / linux, electron-builder pipeline.

## how it differs

| | cursor 3 | claude code desktop | cline | codex | **pneuma v0.2** |
| --- | --- | --- | --- | --- | --- |
| measured AI | none | none | none | none | **live sycophancy detector + full styxx in v0.4** |
| pricing surprise | $1,400 overages reported | per-message limits unclear | $30 → $230/mo | sandbox costs | **live $/turn + $/session cap visible** |
| edits without permission | silent reverts (#132183) | mostly fine | approval-gated | sandboxed | **plan-mode by default · "no edits applied" status** |
| sycophancy | endless | "you're absolutely right" plague | inherits model | inherits model | **counted, displayed, designed against** |
| character | none | none | none | 8 cute pixel avatars (planned) | **ferrofluid buddy as ambient measurement** |
| register | IDE/agent platform | single-vendor workspace | approval-gated transparency | OpenAI ecosystem | **luxury research instrument** |
| open source | no | partial | yes | partial | **MIT, all of it** |

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
