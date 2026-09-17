# Release preparation — @orkestrel/test 0.0.16

Prepared 2026-09-17 under `.agents/skills/orkestrel-publish`. **Stopped at the window on the
repository owner's instruction. Nothing has been uploaded.**

## The round, and why this package goes first

The round covers `@orkestrel/test` and `@orkestrel/scaffold`. Neither is a runtime dependency of the
other; each is the other's development dependency, so they carry no runtime layer between them.

The order is forced by a line of scaffold's own code. `src/core/constants.ts:536` in the scaffold
checkout reads `manifest.devDependencies['@orkestrel/test']` into its published output, so scaffold's
`dist/` moves when it re-pins that development range, and `.agents/orchestration.md` § What a bump
obliges rules such a re-pin a release. Publishing this package first lets scaffold carry the test
pin, the `guide` and `probe` catch-ups, and its own changes in one release. The reverse order costs
scaffold a second release for the pin alone.

## Registry evidence, taken 2026-09-17

| Package | Registry serves |
| ------- | --------------- |
| `@orkestrel/scaffold` | 0.0.71 |
| `@orkestrel/test` | 0.0.15 |
| `@orkestrel/contract` | 0.0.17 |
| `@orkestrel/guide` | 0.0.20 |
| `@orkestrel/probe` | 0.0.16 |

Every pin below derives from that reading rather than from the local manifest.

## The visit

Run in the order `references/wave.md` § Visit a repository fixes.

1. **Re-pinned** `@orkestrel/guide` `^0.0.19` → `^0.0.20`, `@orkestrel/probe` `^0.0.15` → `^0.0.16`,
   `@orkestrel/scaffold` `^0.0.70` → `^0.0.71`. `@orkestrel/contract` already sat at the caret.
   Install clean.
2. **Preparation commit** `94ccc29`, carrying the manifest and the lockfile, because
   `scaffold overwrite` refuses a tree with uncommitted changes.
3. **`scaffold overwrite`** wrote 4 files and left 47 unchanged, replacing `configs/policy.ts` with
   the published floor. **`scaffold audit` then exits 0 with 0 of 45 planned paths drifted**, which
   is the sweep's proof.
4. **Full install**, because the overwrite re-declared `@types/node` `^26.5.1` → `^26.6.1`.
5. **Self-pin sweep: empty.** This package embeds no declared range in its published output and
   carries no version literal in `src/` or `tests/`, so no snapshot or fixture carries the prior
   version or the prior ranges.
6. **`format`**, then the gates.
7. **Vendored-floor commit** `12d02dc`.

## The gates, all outside the window

| Gate | Result |
| ---- | ------ |
| `npm run format:check` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npm run check` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | exit 0 |
| `npm run test:distribution` | exit 0 — 11 passed, 4 skipped |
| `npm run prepublishOnly` | exit 0 — 11 passed, 4 skipped |

## The bump ruling, measured

`npm pack @orkestrel/test@0.0.15` fetched the published tarball. The rebuilt `dist/` was compared
against it, source maps excluded, material content only.

```text
local files 10  published files 10
moved: 2
  src/browser/index.d.ts CHANGED
  src/browser/index.js CHANGED
```

Exactly the two files `readHit` enters. **The dist moved materially, so the bump is owed.** Bumped
0.0.15 → 0.0.16 from the registry reading. The bump edits no emitted byte, so the dist built before
it is the artifact that ships.

Release commit `9999a20`, pushed to `origin/main`. The tree is clean.

## Standing readings, recorded rather than taken

`scaffold audit` reports three major-version advisories outside this round's `@orkestrel` re-pin
step. Each is a major migration rather than a caret catch-up, and none was taken here:

- `vitest` declares major 4, registry serves major 5.
- `@vitest/browser-playwright` declares major 4, registry serves major 5.
- `typescript` declares major 6, registry serves major 7.

## What remains

- **The upload.** `npm publish` needs the account's one-time code with the owner at the keyboard,
  per `references/window.md`. Not run.
- **Registry confirmation** of 0.0.16, which closes this layer.
- **Scaffold's visit**, blocked until the registry serves 0.0.16, because its first step re-pins
  this package to what the registry serves.
- **A later development re-pin here.** When scaffold publishes, this package's
  `@orkestrel/scaffold` pin moves and its vendored floor takes another `overwrite`. That re-pin
  moves no emitted byte here, so it obliges a commit rather than a release.
- **`roughnotes`** carries five hand-rolled hit-target instruments that adopt `readHit` once this
  publishes. That adoption is a consumer change, not part of this round.

RELEASE: OPEN — layer one prepared and stopped at the window; nothing uploaded.
