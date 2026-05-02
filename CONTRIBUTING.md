# contributing to pneuma

pneuma is an ongoing build. contributions are welcome — but every commit is checked against the seven principles in [NORTH_STAR.md](./NORTH_STAR.md). that's the bar.

## the bar

before you open a PR, ask:

1. **does the body still tell the truth?** — does this change preserve or strengthen the link between styxx scores and the visible agent character?
2. **does it earn its weight?** — pneuma refuses feature flexes. each addition must be load-bearing or it doesn't ship.
3. **is anything new pretending more than it is?** — uncalibrated, partial, or experimental features must be marked honestly (`v0.4 · live`, etc.).
4. **does it preserve the seven?** — body as truth channel, type resolves, room as weather, pre-cognition, four-dimensional portrait, no chrome, one tone.

if any answer is no, we'll talk it through in the PR before merging.

## opening an issue

use one of the templates at [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE):

- **bug** — something is broken or behaves wrong
- **feature** — a load-bearing addition that fits the seven principles

questions, ideas, and "is this worth doing" discussions go in [GitHub Discussions](https://github.com/fathom-lab/pneuma/discussions) — open an issue only when the path forward is clear.

## opening a PR

- branch from `main`
- one logical change per PR (the smaller the better — pneuma releases are single load-bearing additions)
- run `node --check server/server.js` before pushing
- if you touched the renderer, open `http://localhost:8765` and verify the affected gesture still works
- keep the diff legible — no drive-by reformatting

## what we're looking for

- bug fixes, especially in the styxx scoring pipeline or the staged-edit overlay
- calibrated cognometric instruments (deception, overconfidence — currently uncalibrated, marked as such)
- ferrofluid shader refinements, additional embodiment states
- documentation that helps a new contributor read the code in under an hour
- accessibility improvements (the room reads like weather — that should hold for assistive tech too)

## what we're not looking for

- crypto features (pneuma is a measured-AI product; the $NEUMA token is announced separately and lives off the product, not in it)
- cosmetic re-skinning that breaks the brand color/type system in [NORTH_STAR.md](./NORTH_STAR.md)
- feature flags or compatibility shims for hypothetical futures
- "AI ✨" microcopy of any kind

## license

by contributing you agree your contribution is licensed under MIT, the same as the rest of the project.
