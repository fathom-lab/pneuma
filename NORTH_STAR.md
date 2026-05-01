# pneuma — north star

> *what would the interface for a being whose body cannot lie look like.*

---

## what is pneuma

**pneuma** (Greek: πνεῦμα) — breath, spirit, the animating force. In Stoic philosophy, the active principle that pervades matter and gives it life. In ancient medicine, what distinguishes the living from the dead.

pneuma the product is an AI chat where the agent's *pneuma* is visible. styxx measures it; the alien expresses it; the room remembers it across time.

the body cannot lie because pneuma IS the quality of life. you read it the way you read weather, the way you read a face.

**pronunciation:** NEW-mah (silent P, like pneumonia).

---

## the wordmark

three-level rendering system, like Apple has  / Apple / apple:

| context | render |
| --- | --- |
| favicon, dock, single-glyph mark | **π** |
| full wordmark | **π** + neuma (Greek π in champagne gold + serif italic warm bone) |
| writable / URL / git / handle | `pneuma` |

The Greek π is the silent P made visible. It carries the etymology, signals classical depth, and creates a script-mix that reads as alien tech without being illegible.

---

## thesis

pneuma is a measured-AI desktop instrument: a chat client where every reply is scored for sycophancy, deception, goal-drift, and overconfidence in real time, and the agent's character is the live portrait of those measurements.

- there is no HUD because the body IS the HUD.
- there is no portrait sidebar because the room IS the portrait.
- there is no chat panel because the alien IS the chat.

one surface. one presence. one room that remembers.

---

## the seven principles

each is a load-bearing design decision. every commit checks itself against them.

### 1. the body is the truth channel
every styxx reading manifests as posture, gaze, particle behavior, glow, position, room temperature. the agent cannot lie about its sycophancy because the body shows it. numbers exist for verification — never as primary display.

### 2. type resolves, doesn't stream
each character phases in from soft glow to crisp serif over ~150ms in a staggered cascade. words do not typewriter — they materialize. the agent's thought passes through a thin membrane into your space.

### 3. the room reads like weather
ambient light, temperature-coded color, and a sub-audible tone shift with the alien's state. not decoration — the room's response to its inhabitant. you learn to read the room the way you read a face.

### 4. pre-cognition
when the user submits a message, the alien shifts state *instantly* — eyes, posture, breath change before any token has arrived. communion, not RPC. the user feels the alien thinking.

### 5. the portrait is four-dimensional
cognometric texture accumulates spatially AND in time-luminance: recent regions glow brighter, old ones dim into deep texture. the room remembers *when*.

### 6. no icons. no chrome. no frames.
all affordances are typographic or geometric. settings is a single dot. the floor is a single bone-colored line. send is Enter — there is no button. the interface refuses to flex.

### 7. one presence, one tone
a barely-perceptible breath-tone hums while the alien is alive; shifts register when they process; returns at rest. off by default. available. the room has a heartbeat the user can choose to hear.

---

## the four gestures (everything else hidden)

- **default** — chat. type, send, watch the alien respond. body is the measurement.
- **hover the alien** — the four numbers appear in mono 11px beneath their feet, like checking a vital sign. fade when you look away.
- **click any region of the room** — that region expands, reveals which conversations painted it, which styxx measurements contributed, which K=1 features. the portrait IS the scoreboard. no separate site.
- **Cmd+K** — focus shift. alien quiets, room dims, available actions resolve in the center column. press escape and focus returns naturally.

---

## the empty state

this is the test. if it reads as alien tech, everything else follows. if it reads as "chat with mascot," we have failed.

```
                     ▁▂▃▅▆█▇▅▃▂▁▂           ← the pneuma — visible at threshold

                           ◯
                          ◜◝               ← alien, sleeping
                          ▏ ▕
                          ╱ ╲

                     ──────────             ← bone-colored floor

                                            ← faint cognometric texture
                                              accumulated across all
                                              prior conversations



       ─────────────────────────────────
       │  ...                          │  ← composer. one line.
       ─────────────────────────────────

  π neuma                                    ← wordmark, bottom-left, quiet
```

dim. alive. aware. aware of *you*. the first frame is where alien tech wins or loses.

---

## the agent → alien protocol

the agent's full embodiment surface, available from any LLM via streaming text or direct call:

| input | effect |
| --- | --- |
| `[MOOD: <expression>]` inline | strips from display, drives expression. ~45 expressions catalogued. |
| `window.pneuma.onScore({sycophancy, deception, goal_drift, overconfidence, depth})` | per-token-window. drives posture, particles, room temperature, position. |
| `window.pneuma.onIntent(<state>)` | discrete: listening · processing · speaking · resting. drives pre-cognition transitions. |

extending the protocol is how the agent learns to inhabit a richer body. additions go through `docs/PROTOCOL.md` (not yet written).

---

## styxx as the engine — the integration mark

pneuma runs on styxx. styxx is positioned as **Intel-Inside-style infrastructure brand** for cognometric measurement. Other AI products can integrate the open-source styxx Python package and carry the mark — it becomes the consumer-grade trust signal: *"Is this AI honest? → It runs styxx."*

**brand stack:**
- **fathom** — the lab (research)
- **styxx** — the engine / measurement layer (the chip)
- **pneuma** + others — consumer-facing products that run styxx (the Dell, the HP)

**on pneuma's surface:** the styxx mark sits at the threshold next to the breath plot — vouching for the readings it produces, like Dolby's mark sits next to audio. mark style still under iteration; ships starting v0.4.0 when measurement actually wires into the body.

---

## color, type, motion

inherits dark mode from `darkflobi-site/design-v2/SYSTEM.md` v2.0:

- `--paper: #0A0A0A` (onyx — the room)
- `--ink: #F4EFE6` (warm bone — type, the alien's outline, the floor line)
- `--graphite: #9F9890` (muted parchment — secondary text)
- `--rule: #1F1F1F` (barely-visible hairlines)
- `--pale: #141210` (elevated surfaces — used sparingly)
- `--archive: #585450` (deep mute — old conversations, placeholder text)
- `--signal: #C8A86B` (champagne gold — the **π** glyph + measurement deltas + cursor location ONLY, ≤5 uses per surface)

type stack:
- `--serif: "Source Serif 4"` — body, the agent's transmission, the wordmark
- `--sans: "Inter Tight"` — affordances (sparing)
- `--mono: "JetBrains Mono"` — measurements, scores, code, metadata, breath plot

motion:
- `--ease: cubic-bezier(.16, 1, .3, 1)` for all 200ms transitions
- breath plot (the pneuma made visible): 6s ease-in-out infinite (the only persistent animation)
- chest breath (the alien): 5s ease-in-out infinite, quickens to 3.6s in pre-cognition
- type-resolve: ~150ms per char, soft staggered cascade
- pre-cognition: <50ms — the alien shifts before the network responds

---

## anti-patterns (forbidden)

- ✗ pixel-art-cute character (Codex Avatars, Razer AVA register)
- ✗ speech bubbles, emoji, sparkles
- ✗ pastel suggestion cards as empty state
- ✗ rainbow-mode, glitch, CRT scanlines, matrix rain (entire fathom-app 2023 palette retires here)
- ✗ neon green / cyan / pink — replaced by champagne gold for signal use only
- ✗ glassmorphism, blur stacks, midnight teal
- ✗ icons (any raster icons, any SF Symbols)
- ✗ floating sprites that follow cursor
- ✗ "this site uses cookies" toast
- ✗ "✨ AI ✨" microcopy
- ✗ sycophantic tone in any system message — styxx itself measures it
- ✗ feature flexes — every addition earns through the seven

---

## what ships, in order

1. **v0.0.1** — north star locked. principles. (shipped 2026-05-01)
2. **v0.1.0** — the empty state. one screen, dim room, alien alcove, breath threshold, composer, π neuma wordmark. no chat yet. **test: does it read as alien tech.**
3. **v0.2.0** — the chat. type-resolve rendering. agent connects (BYO Anthropic key). messages emanate from the alien. no measurement yet.
4. **v0.3.0** — embodiment. extract `clawd/fathom-app/darkflobi-fathom.js` (~3674 lines, 45+ expressions). wire `[MOOD: …]` parsing. the alien expresses.
5. **v0.4.0** — measurement. spawn styxx subprocess. `onScore({...})` wires to posture. **the unprecedented move ships.** the styxx integration mark appears at the threshold.
6. **v0.5.0** — the room remembers. portrait persistence (server + IndexedDB). texture accumulates across sessions. clickable regions reveal contributing styxx data.
7. **v1.0.0** — installers. mac, windows, linux. landing page. public.

each release is a single load-bearing addition. no batches.

---

## license & home

MIT. public from v0.0.1. lives at [`fathom-lab/pneuma`](https://github.com/fathom-lab/pneuma). powered by [`fathom-lab/styxx`](https://github.com/fathom-lab/styxx).

---

*north star v1.1 — locked 2026-05-01. nothing ships that breaks the seven.*
