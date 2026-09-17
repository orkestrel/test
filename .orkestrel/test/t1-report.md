# Unit T1 — publish the hit reader

`readHit` ships from the browser barrel. Every criterion is done. The gate chain is green.

## 1. Done / not done per criterion

| #   | Criterion                                                       | State | Evidence                                                                                                               |
| --- | --------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Format and lint pass on owned files                             | Done  | `npm run format:check` — "All matched files use the correct format", 60 files; `npm run lint:check` — exit 0, no output |
| 2   | Typecheck passes; no `any`, `as`, `!`, or suppression comment    | Done  | `npm run check` — the root project plus the core, browser, and server projects, all silent                             |
| 3   | `readHit` exported from the browser barrel, taking an `Element`  | Done  | `dist/src/browser/index.d.ts:1281` — `export declare function readHit(element: Element): Element \| undefined;`         |
| 4   | The cases cover the four readings, each with a recorded red      | Done  | Section 3                                                                                                              |
| 5   | The guide row exists and the parity gate passes                  | Done  | `guides/test.md:275`; `npm run test:guides` 47 passed; the two parity reds in section 3                                |
| 6   | The element-taking lists name it                                 | Done  | `guides/test.md:221` (Surface prose) and `guides/test.md:1188` (Contract item 13)                                      |
| 7   | The full gate chain passes, with every project's counts          | Done  | Section 5                                                                                                              |

Touched files, all owned:

- `C:\Users\mikes\WebstormProjects\test\src\browser\helpers.ts` — adds `readHit` after `isRendered`,
  with its TSDoc block.
- `C:\Users\mikes\WebstormProjects\test\tests\src\browser\helpers.test.ts` — adds the `readHit`
  describe block and its import.
- `C:\Users\mikes\WebstormProjects\test\guides\test.md` — adds the Helpers row, names `readHit` in
  the two element-taking lists, and describes its cases in the Tests section.

Diffstat, against `52d0276`:

```text
 guides/test.md                    | 58 ++++++++++++++++++-----------------
 src/browser/helpers.ts            | 37 +++++++++++++++++++++++
 tests/src/browser/helpers.test.ts | 63 +++++++++++++++++++++++++++++++++++++++
 3 files changed, 131 insertions(+), 27 deletions(-)
```

The guide deletions are rewrapping alone. `git diff --word-diff=porcelain guides/test.md` reports no
removed word: every deletion is a line the added name pushed past 100 columns, rewrapped with its
paragraph.

`src/browser/types.ts` is untouched. `Element | undefined` needs no declaration, and inventing one
for a native pair would add a name the caller has to learn for nothing.

## 2. The shape

The signature:

```ts
export function readHit(element: Element): Element | undefined
```

The implementation, at `src/browser/helpers.ts:132`:

```ts
export function readHit(element: Element): Element | undefined {
	const rectangle = element.getBoundingClientRect()
	const hit = element.ownerDocument.elementFromPoint(
		rectangle.left + rectangle.width / 2,
		rectangle.top + rectangle.height / 2,
	)
	return hit ?? undefined
}
```

It reads `element.ownerDocument` rather than the global `document`, which is what `readText` already
does, so the reader answers about the document the element is in.

The TSDoc summary, which is the sentence the parity gate compares:

```text
Reads the element a pointer aimed at one element's bounding-box centre reaches.
```

The `@remarks` name the two axes, the reason `isReachable` sees neither, and why the return is a node
rather than a verdict. The `@example` shows the `contains` ruling the caller makes.

The guide row, at `guides/test.md:275`:

```text
| `readHit` | function | `(element: Element) => Element \| undefined` | Reads the element a pointer aimed at one element's bounding-box centre reaches. |
```

The union arm is escaped `\|`, which is what the surrounding rows do for `readFocus`, `parseColor`,
and `readRing`, and what the Types preamble states. Written bare it splits the cell.

## 3. The reds

Each case was reddened by mutating `readHit` itself, then restored. Every run is
`npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:browser -t "<case>"`
from `C:\Users\mikes\WebstormProjects\test`.

The mutations, each a defect a plausible implementation could hold rather than a sabotage written to
fail:

- **corner** — aim at `rectangle.right, rectangle.bottom` rather than the centre.
- **top** — aim at `rectangle.top + 1` rather than the vertical centre.
- **floor** — `return hit ?? element.ownerDocument.body`, treating a miss as the body.

| Case                                                                                    | Mutation | Red                           | Failure                                                                           | Green after restore           |
| ----------------------------------------------------------------------------------------- | -------- | ----------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| `names the element itself when its own centre is what a pointer reaches`                | corner   | 1 failed \| 248 skipped (249) | `expected <body><div>…(1)</div></body> to be <button type="button" …(1)></button>` | 1 passed \| 248 skipped (249) |
| `names the cover a reachable control sits under`                                        | corner   | 1 failed \| 248 skipped (249) | `expected '' to be 'masthead'`                                                    | 1 passed \| 248 skipped (249) |
| `names the ancestor under a wrapped inline target whose centre falls between its lines` | top      | 1 failed \| 248 skipped (249) | `expected '' to be 'entry'`                                                       | 1 passed \| 248 skipped (249) |
| `reports nothing for a centre that lands outside the viewport`                          | floor    | 1 failed \| 248 skipped (249) | `expected <body><div>…(1)</div></body> to be undefined`                           | 1 passed \| 248 skipped (249) |

The wrap case needs its own mutation, and the reason is the finding's own geometry. Under **corner**
the bottom-right point of a wrapped anchor's bounding box still lands inside the list item, so the
case stays green — the corner is wrong for a different reason than the centre is. **top** aims at the
first line rectangle, where the anchor really is, so the reading names the link instead of the entry
and the case reddens on exactly the property it claims.

The guide gate carries its own reds, each `npm run test:guides`:

| What was mutated                                       | Red                                     | Failure                                                                                                                                                                                                     | Green after restore         |
| -------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| The `readHit` row deleted from the Helpers table       | 1 failed \| 46 passed \| 1 skipped (48) | `expected [ 'function readHit' ] to deeply equal []`                                                                                                                                                        | 47 passed \| 1 skipped (48) |
| The row's Summary cell changed to `Names the element…` | 1 failed \| 46 passed \| 1 skipped (48) | `summary function readHit: guide "Names the element a pointer aimed at one element's bounding-box centre reaches." source "Reads the element a pointer aimed at one element's bounding-box centre reaches."` | 47 passed \| 1 skipped (48) |

### What the cases construct

Every case uses real elements and real layout. Nothing is stubbed, and no rectangle is fabricated.

- **The element itself.** A 160x40 button inside a `position: fixed` wrapper. `readHit` returns the
  button by identity.
- **The cover.** The same button, with a sibling `position: absolute` block filling the wrapper over
  it. The reading names the cover, `target.contains(hit)` is `false`, and `isReachable(target)` is
  `true` — which is the contrast the helper exists for.
- **The wrap.** A list item set `font: 16px/60px monospace; width: 7ch`, holding an inline anchor
  reading `alpha beta`. The container fits `alpha` and refuses `alpha beta` in the same font it
  measures `ch` from, so exactly two line boxes form whatever font the host resolves, and the 60px
  line height opens a gap no font metric closes. The case asserts that the anchor produced two client
  rectangles and that the second starts below the first ends, so a host that stopped wrapping reddens
  here rather than passing on a coincidence. `readHit` returns the list item; `isReachable` still
  accepts the anchor.
- **Nothing.** A button fixed at `left: -400px`, 200px wide, so its centre sits at x = -300.
  `isOutsideViewport` reports `true` and `readHit` reports `undefined`.

## 4. The consumer

The instruments in `C:\Users\mikes\WebstormProjects\roughnotes` that this capability exists for. None
was edited. Each replacement is shown against its current text.

### `tests/app/browser/integration.test.ts` — `followField`

Before, at line 216:

```ts
	const target = resolveAccessible('link', name)
	const box = target.getBoundingClientRect()
	const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
```

After:

```ts
	const target = resolveAccessible('link', name)
	const box = target.getBoundingClientRect()
	const centre = readHit(target)
```

`box` stays, because the reading string still reports the link's box size. One line later the null
test becomes an undefined test:

```ts
	// before
	const reading = `… | centre hits ${centre?.tagName ?? 'nothing'} | reaches link ${String(centre !== null && target.contains(centre))}`
	// after
	const reading = `… | centre hits ${centre?.tagName ?? 'nothing'} | reaches link ${String(centre !== undefined && target.contains(centre))}`
```

Add `readHit` to the existing `@orkestrel/test/browser` import at line 28, between `readFrame` and
`readPage`.

### `tests/app/browser/App.test.ts` — `readCentre`

Before, at line 45:

```ts
function readCentre(control: Element): string {
	control.scrollIntoView({ behavior: 'instant', block: 'start' })
	const box = control.getBoundingClientRect()
	const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
	const name = control.textContent?.trim() ?? ''
	if (hit === null) return `${name} reaches nothing`
```

After:

```ts
function readCentre(control: Element): string {
	control.scrollIntoView({ behavior: 'instant', block: 'start' })
	const hit = readHit(control)
	const name = control.textContent?.trim() ?? ''
	if (hit === undefined) return `${name} reaches nothing`
```

The `box` local goes entirely; nothing else in the function reads it. The rest of the body —
`control.contains(hit)`, the masthead test, the `hit.tagName` fallback — is unchanged, which is the
point: the caller keeps the ruling and the helper keeps the measurement. The import at line 4 becomes
`import { describeFocus, findRule, readClasses, readHit } from '@orkestrel/test/browser'`.

### `tests/app/browser/components/ContactForm.test.ts`, `PaymentForm.test.ts`, `SubscribeForm.test.ts`

Each holds the identical loop. Before, at lines 30, 29, and 28 respectively:

```ts
		for (const link of links) {
			const box = link.getBoundingClientRect()
			const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
			expect.soft(hit?.closest('a')).toBe(link)
		}
```

After:

```ts
		for (const link of links) {
			expect.soft(readHit(link)?.closest('a')).toBe(link)
		}
```

The import at line 4 in each becomes
`import { clickAccessible, fillAccessible, readHit } from '@orkestrel/test/browser'`.

Across the instruments the replacement removes the hand-rolled geometry and one shape mismatch — the
`null` the DOM returns against the `undefined` this layer's readers return.

## 5. Gate evidence

The chain `AGENTS.md` names, run in order from a clean baseline through `tmp/gates.sh`, with each log
retained beside it:

| Gate                   | Exit | Seconds | Result                                                   |
| ---------------------- | ---- | ------- | -------------------------------------------------------- |
| `npm run format:check` | 0    | 2       | All matched files use the correct format, 60 files       |
| `npm run lint:check`   | 0    | 0       | No diagnostics                                           |
| `npm run check`        | 0    | 5       | Root, `src:core`, `src:browser`, `src:server` all silent |
| `npm run build`        | 0    | 9       | Core, browser, and server bundles emitted                |
| `npm test`             | 0    | 23      | Per-project counts following                             |

Per-project counts inside `npm test`, read from `tmp/gate-test.log.txt`:

| Project       | Test files | Tests                       |
| ------------- | ---------- | --------------------------- |
| `test:src`    | 7 passed   | 499 passed, 9 skipped (508) |
| `test:policy` | 1 passed   | 101 passed, 1 skipped (102) |
| `test:config` | 1 passed   | 172 passed, 1 skipped (173) |
| `test:setup`  | 3 passed   | 24 passed (24)              |
| `test:guides` | 1 passed   | 47 passed, 1 skipped (48)   |

Logs retained under `tmp/`: `gate-format-check.log.txt`, `gate-lint-check.log.txt`,
`gate-check.log.txt`, `gate-build.log.txt`, `gate-test.log.txt`. Instruments retained under `tmp/`:
`gates.sh`, `mutate.cjs`, `mutate2.cjs`, `rowtoggle.cjs`, `drift.cjs`, and the guide edit scripts
`fixrow2.cjs`, `lists.cjs`, `reflow.cjs`, `wrap1.cjs`, `wrap2.cjs`, `wrap3.cjs`, `wrap4.cjs`,
`tests-sentence.cjs`.

## 6. Observations

**Each unknown resolved, and neither forced a fallback.**

- **The wrapped inline target drives deterministically, with no fixed viewport at all.** The brief
  allowed a controlled-rectangle construction if real wrapping could not be driven. It can. Sizing the
  container in `ch` against the same monospace font the text is set in makes the break point a
  property of the font rather than of the host's metrics, and `position: fixed` on the list takes the
  viewport out of the question. The case asserts the fragment count, so a host that changes the answer
  reddens instead of drifting into a coincidental pass. No `page.viewport` call, no staged pane, and
  no restoration hook — which also keeps the case out of the viewport-restoring group that
  `beforeAll` and `afterAll` manage in that file.
- **`guides/test.md` carries no Limits row for a hit-target candidate, so nothing needed correcting.**
  Searched case-insensitively across the whole guide for `elementFromPoint`, `hit`, `centre`,
  `center`, `cover`, `occlu`, and `overlap`. The Limits table's browser rows rule on a surface digest,
  a control extractor, text resolution by selector, a DOM element builder, class-ancestry orphan
  detection, and clearing web storage, and none of them is this candidate. `readHit` ships as an added
  row rather than as a reversal.

**Ancillary placements, decided and carried on from.** The deviation contract scopes these to me:

- In source, `readHit` sits after `isRendered`, closing the group that reads geometry and
  reachability, rather than among the `read*` family further down. Its remarks link `isReachable` and
  `isOutsideViewport`, and a reader meets all three together.
- In both element-taking lists, `readHit` is named after `isReachable` rather than among the element
  readers, for the same reason and to match the guide row the brief placed there.
- The Tests section prose gained a sentence naming its cases, beside the sentence that already
  describes `isReachable` and `isRendered` coverage. That section enumerates every helper's cases, so
  a shipped helper missing from it is guide drift. It is inside the owned file.

**`npm run test:distribution` was not run.** It sits outside the gate chain `AGENTS.md` names, and it
packs this workspace and `npm install`s it into a throwaway consumer, which the permission floor keeps
off a writing unit. The built declaration is the evidence for criterion 3 instead:
`dist/src/browser/index.d.ts:1281`. Run it yourself before the release if the published artifact is
the subject.

**Timing.** The whole chain takes 39 seconds on this host. The browser project's own reported duration
is 1.46s for a filtered run and the guide gate 1.04s, so nothing here is near a timing bound and none
of the counts is load-sensitive.

## 7. What I did not close

- **The roughnotes edits.** Off-limits by the brief, and shown as replacements in section 4 rather
  than applied. They need `@orkestrel/test` republished at a version carrying `readHit` before they
  can be made, or a packed tarball installed there. Neither is mine.
- **No version bump, no publish, no commit.** As instructed. The tree is dirty across the three owned
  files and `.orkestrel/` is untracked, exactly as it was at dispatch.
- **The scaffold skill that will name `readHit`.** Read-only reference by the brief. I opened nothing
  in it that changes this unit, and wrote nothing there.
