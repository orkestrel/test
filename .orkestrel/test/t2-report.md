# Unit T2 report — the readHit audit findings

Every criterion is closed. The gates are green on the full chain, and the distribution project is
green on its own run. `readHit`'s implementation is byte-identical to `30c515e`.

## 1. Done per criterion

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | Format and lint pass on the owned files | Done | `npx oxfmt --config .oxfmtrc.json --check src/browser/helpers.ts tests/src/browser/helpers.test.ts` exit 0; `npx oxlint --config .oxlintrc.json --deny-warnings` on the same pair exit 0; tree-wide `npm run format:check` and `npm run lint:check` exit 0 |
| 2 | Typecheck passes, no `any`, `as`, `!`, or suppression | Done | `npm run check` exit 0; the added case declares `ReadonlyArray<{ readonly id: string; readonly mode: ShadowRootMode }>` rather than an `as const` tuple |
| 3 | The `@example` compiles | Done | `node tmp/example-check.mjs readHit` then `npx tsc --noEmit -p tmp/example/tsconfig.json` — TS2345 before, exit 0 after |
| 4 | The remarks describe the installed provider | Done | `playwright-core@1.63.0`, `_clickablePoint` at `node_modules/playwright-core/lib/coreBundle.js:20084` |
| 5 | Every bound stated where the reader meets it, shadow behaviour observed | Done | `tmp/probe/hit.test.ts` and `tmp/probe/fixtures.test.ts` under `tmp/probe/hit.config.ts` |
| 6 | Contract item 16, Bounds, Limits each carry their entry | Done | quoted in section 5 |
| 7 | Summary matches its guide cell, `npm run test:guides` passes | Done | 47 passed, 1 skipped |
| 8 | The collapsed-box case exists with a recorded red, the renamed case states its rule | Done | section 6 |
| 9 | `readHit` byte-identical to `30c515e` | Done | section 7 |
| 10 | The full gate chain passes | Done | section 8 |

## 2. The example

Before, and the compile that refused it:

```ts
const link = requireValue(container.querySelector('a'))
const hit = readHit(link)
link.contains(hit) // false for a wrapped link whose centre sits between its line boxes
```

```text
$ node tmp/example-check.mjs readHit
$ npx tsc --noEmit -p tmp/example/tsconfig.json
tmp/example/example.ts(8,15): error TS2345: Argument of type 'Element | undefined' is not assignable to parameter of type 'Node | null'.
  Type 'undefined' is not assignable to type 'Node | null'.
exit=2
```

After:

```ts
const link = requireValue(container.querySelector('a'))
const hit = readHit(link)
// False for a wrapped link whose centre sits between its line boxes.
hit !== undefined && link.contains(hit)
```

```text
$ node tmp/example-check.mjs readHit
$ npx tsc --noEmit -p tmp/example/tsconfig.json
exit=0
```

`tmp/example-check.mjs` reads the fence out of the TSDoc block preceding `export function readHit(`,
strips the ` * ` prefixes, and writes `tmp/example/example.ts` under a `tmp/example/tsconfig.json`
copied from the repository's own `compilerOptions` with the path aliases rebased. It supplies the
example's free names and nothing else: `container` as a declared `HTMLElement`, and `requireValue`
from `@src/core`. The guard is the narrowing every real call site already writes — the cases wrap in
`requireValue`, and the `roughnotes` instruments write `hit !== undefined && target.contains(hit)`.

## 3. The driver correction

What I read, in `node_modules/playwright-core/lib/coreBundle.js`:

- `_clickablePoint` opens at line 20084.
- Line 20108: `const filtered = quads.map((quad2) => intersectQuadWithViewport(quad2)).filter((quad2) => computeQuadArea(quad2) > 0.99)`.
- Line 20119 takes `filtered[0]`, and line 20120 returns `{ point: quadMiddlePoint(quad), box }`.
- `quadMiddlePoint` at line 19874 averages that quad's corners.
- Line 20250 is the click path reaching it, and `node_modules/@vitest/browser-playwright/dist/locators.js:12`
  is the provider delegating to Playwright's own `click`.

So the driver clamps each content quad to the viewport, drops every quad left without area, takes the
first surviving quad, and clicks its midpoint. For a wrapped inline target that is the midpoint of
the first line box, which is on the element — not the union-box centre this reader measures.

The remarks now say this:

> It does not predict where the installed driver clicks. `playwright-core@1.63.0` clips each
> content quad to the viewport, drops every quad left without area, and takes the midpoint of the
> first quad that survives — `_clickablePoint` at `playwright-core/lib/coreBundle.js:20084`,
> reached from the locator `click` the Vitest provider delegates to. For the wrapped target the
> first surviving quad is the first line box, so the driver aims inside the link while this centre
> sits in the gap. Read a result as the answer for the point this names, and for no other.

The opening paragraph no longer claims a driver clicks the bounding-box centre. It states what the
helper measures and why that point is worth measuring: it is where a thumb aimed at the middle of
what a person sees lands.

## 4. The bounds, and the probe

The probe is `tmp/probe/hit.test.ts`, with the fixture rehearsal in `tmp/probe/fixtures.test.ts`, run
under `tmp/probe/hit.config.ts` — a browser project pointed at `tmp/probe/**/*.test.ts`, because the
repository's own `probe` project is Node with the browser disabled. The command:

```text
npx vitest run --config tmp/probe/hit.config.ts --no-cache --reporter=verbose
```

Its output, from the installed chromium:

```text
[open shadow] inner box {"x":150,"y":150,"width":120,"height":40,...}
[open shadow] readHit(inner) = div#host
[open shadow] inner.contains(hit) = false
[open shadow] host.contains(hit) = true
[open shadow] document.elementFromPoint = div#host
[open shadow] root.elementFromPoint = button#inner
[closed shadow] readHit(inner) = div#sealed
[closed shadow] inner.contains(hit) = false
[closed shadow] host.contains(hit) = true
[zero area] box {"x":140,"y":334,"width":0,"height":0,...}
[zero area] readHit = body
[zero area] target.contains(hit) = false
[display none] box {"x":0,"y":0,"width":0,"height":0,...}
[display none] readHit = body
[display none] target.contains(hit) = false
[detached] readHit = body
[pointer-events none] readHit = button#under
[pointer-events none] target.contains(hit) = true
[partial overlap] box {"x":-80,"y":120,"width":100,"height":40,"right":20,...}
[partial overlap] isOutsideViewport = false
[partial overlap] centre x = -30
[partial overlap] readHit = undefined
```

The fixture rehearsal fixed the identities the cases assert, so no case rests on a guess:

```text
[clipped] box {"x":120,"y":134,"width":0,"height":0,...}
[clipped] isRendered true isReachable false
[clipped] readHit = div#rail
[folded] readHit = body
[open] readHit = div#host
[edge] box.right 20 isOutsideViewport false
[edge] isReachable true
[edge] readHit = undefined
```

Each bound, and where it landed:

- **Shadow retargeting. Observed, in an open root and a closed one alike.** The document-level hit
  test names the host; the element's own root, asked directly, names the inner element. Stated in the
  remarks paragraph on a returned node, in the guide's Bounds entry, and pinned by the new shadow
  case.
- **An element the document does not render, and a zero-area element.** Each yields a node.
  `display: none` collapses to the origin and reads `body`; a control clipped to zero size collapses
  onto a point in its own container and reads that container. Stated in the remarks paragraph opening
  `Pass {@link isRendered} and {@link isReachable} before reading`, in the Bounds entry, and pinned by
  the new collapsed-box case.
- **A `pointer-events: none` cover.** The hit test skips it and names the element underneath, so the
  caller reads reachable for a cover a person can see. Stated in the remarks and in the Bounds entry.
  Pinned by no case — see section 9.
- **The viewport distinction.** `isOutsideViewport` asks whether the whole rectangle misses the
  viewport, and this reader asks where one point lands. The counterexample is measured rather than
  asserted: right edge 20, predicate false, centre -30, reader `undefined`. The remarks state it, name
  the different windows the two read — the predicate's global `window` against this reader's
  `element.ownerDocument` — and send the caller to compare the centre against that document's own
  viewport instead of to a predicate answering a different question.

## 5. The guide

**Contract item 16**, appended in its own voice:

> `readHit` reads beside that pair rather than filtering with it. It hit-tests one point — the
> element's own bounding-box centre — which is how it sees what neither predicate can: a cover
> over a control they both accept, and a wrapped inline target whose centre falls between its line
> boxes. No acting verb consults it, because it names a node rather than ruling, and `isReachable`
> stays the one reachability filter the verbs apply. It is also the reader that needs the pair run
> first, and [Bounds a shipped helper carries](#bounds-a-shipped-helper-carries) states what it
> reports for an element that failed them.

**`Bounds a shipped helper carries`**, in the shape the `readPixels` entry uses:

> - **`readHit` answers for one point, and a node it returns is no proof of a cover.** An element the
>   document does not render measures a zero rectangle at the origin, and a zero-area element measures
>   a point on its own edge, so each is hit-tested like any other point and names whatever paints
>   there — the surrounding container, or the document body for a rectangle collapsed at the origin —
>   while `contains` reads false. A cover painted with `pointer-events: none` is absent from the hit
>   test, so the reading names the element underneath it and the caller reads reachable for a cover a
>   person can see. An element inside a shadow tree retargets in an open root and a closed one alike:
>   the document-level hit test names the host, which the inner element does not contain. Run
>   `isRendered` and `isReachable` first, and ask `element.getRootNode()` for its own
>   `elementFromPoint` where the subject sits in a shadow tree. `undefined` carries the other silence:
>   a centre outside the viewport reads the same as a centre that reaches nothing, and
>   `isOutsideViewport` does not separate them, because it asks whether the whole rectangle misses the
>   viewport while this asks where one point lands.

**The Limits table**, a `Ships` row placed immediately after the `extractControls` refusal it has to
clear:

> | A pointer-centre hit reading — `readHit` | Ships | It ships as `readHit`. `extractControls` is the bar it has to clear, and it does: the centre computation composes a rectangle reading with a hit test, the `undefined` translation is this package's absence convention for a reader, and "the point is always this element's centre" is a materially narrower contract than `elementFromPoint`. `roughnotes` writes that composition inline in `App.test.ts`, `integration.test.ts`, and the `ContactForm`, `PaymentForm`, and `SubscribeForm` suites, each against the cover and the wrapped target `isReachable` cannot see. |

**The summary.** The TSDoc description and the `Summary` cell both read
`Reads the topmost element at one element's bounding-box centre.` `npm run test:guides` passes with
47 passed and 1 skipped.

## 6. The cases

The instrument is `tmp/mutate-readhit.mjs`, which swaps one plausible defect into the `readHit` body
and restores the original bytes. Each run is
`npm run test:src:browser -- tests/src/browser/helpers.test.ts -t readHit`.

| Case | Mutation | Result |
|---|---|---|
| `names whatever paints at a collapsed box, because it never asks for layout` | `layout` — refuse a zero-width or zero-height rectangle and return `undefined`, the plausible "fix" the documented bound denies | `1 failed \| 5 passed \| 214 skipped`, the collapsed-box case alone |
| `names the host for an element inside a shadow tree, open root and closed alike` | `shadow` — read `element.getRootNode()` where it is a `ShadowRoot`, the deepest-node reinterpretation the objective lane warned about | `1 failed \| 5 passed \| 214 skipped`, the shadow case alone |
| `reports nothing where the centre lies outside the viewport, whatever the box does` | `clamp` — clamp the centre into the viewport the way the driver clamps its quads | `1 failed \| 5 passed \| 214 skipped`, the viewport case alone |

Green after each restore: `6 passed | 214 skipped (220)`.

**The rename.** `reports nothing for a centre that lands outside the viewport` became
`reports nothing where the centre lies outside the viewport, whatever the box does`. The name states
the rule, and the fixture supplies both arrangements: a button wholly off-screen, where
`isOutsideViewport` reports true, and one at `left: -80` with `width: 100`, where the right edge is
20, the predicate reports false, `isReachable` reports true, and the reader still returns `undefined`.
That second arrangement is the counterexample the remarks carry, so the prose and the case pin the
same fact.

The collapsed-box case drives real layout like its neighbours: a clipped zero-size skip link inside a
sized rail, and a `display: none` button. It asserts the gates first — `isRendered` true and
`isReachable` false for the clipped control, `isRendered` false for the folded one — then that the
reader names the rail for one and `document.body` for the other, and that `contains` is false either
way.

## 7. The byte comparison

`tmp/body-compare.mjs` extracts the `readHit` declaration from `git show 30c515e:src/browser/helpers.ts`
and from the working tree, and digests each:

```text
baseline bytes 279 sha256 524a6209198b5c1b73ea73a3d19398e9b5f2259f8a05e71b3c2e4ee106a7c694
current  bytes 279 sha256 524a6209198b5c1b73ea73a3d19398e9b5f2259f8a05e71b3c2e4ee106a7c694
identical = true
```

Run after every mutation restore and again at the end. The signature is unchanged: `Element` in,
`Element | undefined` out.

## 8. The gate chain

Run in order, each exit code read from the command rather than from a pipeline:

```text
npm run format:check       exit 0   60 files
npm run lint:check         exit 0
npm run check              exit 0
npm run build              exit 0
npm test                   exit 0
  src:core + src:browser + src:server   7 files, 501 passed | 9 skipped (510)   11.49s
  policy                                1 file, 101 passed | 1 skipped (102)     1.89s
  config                                1 file, 172 passed | 1 skipped (173)     3.33s
  setup                                 3 files, 24 passed (24)                  384ms
  guides                                1 file, 47 passed | 1 skipped (48)       1.08s
npm run test:distribution  exit 0       1 file, 11 passed | 4 skipped (15)       14.91s
```

Diffstat against `30c515e`:

```text
 guides/test.md                    | 23 +++++++++++-
 src/browser/helpers.ts            | 63 ++++++++++++++++++++++---------
 tests/src/browser/helpers.test.ts | 79 +++++++++++++++++++++++++++++++++++----
 3 files changed, 140 insertions(+), 25 deletions(-)
```

`package.json` is untouched, no version moved, and nothing was installed, committed, or pushed.

## 9. Observations, and what I did not close

**Observations.**

- **The wider fleet name check was possible, and the name is unclaimed.** The scaffold checkout at
  `C:\Users\mikes\WebstormProjects\scaffold\guides\` carries the fleet's guide mirrors; a recursive
  search for `readHit` across them returns nothing, and the same search in
  `C:\Users\mikes\WebstormProjects\roughnotes\guides\` returns nothing. The control matters:
  `readPixels` over the same mirrors matches `guides/test.md`, so the search reaches the files. That
  mirror predates this helper.
- **Wall clock.** Each scoped browser run of the `readHit` cases finished in under 2s. The `npm test`
  chain reported roughly 18s of suite time, and `npm run test:distribution` took 14.91s.
- **The browser project runs unrestricted on this host.** The objective lane's `EPERM` before
  collection did not reproduce; every browser run here collected and passed.
- **`oxfmt` formats Markdown.** It rewrote the Limits row's trailing pipe after my padding put it
  mid-cell. Only that line changed, and `format:check` is green.

**Not closed, and named rather than deferred.**

- **The `pointer-events: none` bound is documented and pinned by no case.** I observed it — the hit
  test skips the veil and names the button underneath — and it is stated in the remarks and in the
  Bounds entry. I added no case for it because no plausible mutation of `readHit` reddens one: the
  fact belongs to the browser's hit test rather than to this reader, and every mutation I could write
  either changes nothing at that point or reddens a different case. The brief's criterion 8 asked for
  the collapsed-box case and the rename, and each is closed.
- **The subjective lane's F7 — the guide's `Signature` column is compared against nothing — is
  outside this brief.** The comparator's drift categories are summary and example. `readHit`'s
  signature cell is correct and nothing keeps it so. Recorded against the parity capability for a
  later change, and not touched here.
- **The objective lane's claim 5 and claim 6 stay UNSETTLED on their own terms.** I re-ran mutations
  only for the cases this unit added; the prior unit's recorded reds are not re-established here.
