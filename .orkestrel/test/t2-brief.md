# Unit T2 — close the readHit audit before the release

## Role and engine

`opus` — Opus 5, native Claude subagent, the **test** checkout at
`C:\Users\mikes\WebstormProjects\test`, sole serial writer from the clean committed baseline
`30c515e`.

## Objective

Close the findings both audit lanes returned against `readHit`. **The signature needs no change and
neither lane asked for one.** Everything owed is prose, one missing case, and three guide homes this
package already built.

This runs before the release, because publishing fixes the signature and the documentation for every
consumer.

## Authority

1. This checkout's own `AGENTS.md` and its rule files.
2. `.orkestrel/test/t1-audit-objective-report.md` and `.orkestrel/test/t1-audit-subjective-report.md`
   — the findings in the auditors' words. Both exist. Read them before editing.
3. `guides/test.md` — its Contract, its Limits table, and its Bounds section are the three homes
   several findings land in.

## The work

### 1. The `@example` does not compile

**Both lanes, independently. The objective lane proved it by compiling the extracted example
in memory against this repository's options: TS2345.**

The example writes `link.contains(hit)`, passing `Element | undefined` into
`contains(other: Node | null)`. Every real call site already narrows first — the cases use
`requireValue`, and the consumer instruments write `hit !== undefined && target.contains(hit)`.

**The property to change.** Make the example compile, in this package's own idiom. Verify it by
extracting and compiling it rather than by reading it. Report the command.

### 2. The remarks are false about what a driver does

**Objective lane.** The remarks say a driver clicks the element's bounding-box centre, which is the
stated justification for measuring that point. The installed Playwright does not: it clips content
quads to the viewport and selects a point in the first surviving quad — read at
`node_modules/playwright-core/lib/coreBundle.js:20084`. For a wrapped element the union-box centre
can miss while the driver clicks a painted fragment.

**The property to change.** Document the helper as a measurement of the point it names, and stop
claiming it predicts the driver's chosen click point. Read the provider yourself before writing the
replacement; do not paraphrase the finding.

### 3. The reader teaches distrust of the wrong half

**Subjective lane F3, with the objective lane's hazard rulings.** The TSDoc names one fact
`undefined` conflates and sends the reader to `isOutsideViewport`. It says nothing about the facts a
**returned node** conflates, and the returned node is the one that misleads:

- An element the document does not render, and a zero-area element, still yield a node from whatever
  paints at the collapsed rectangle. `contains` is then false and the caller reports a cover that is
  not there.
- A cover carrying `pointer-events: none` is skipped by the hit test, so the reading names the
  element under it and the caller reads "reachable" for a cover a person can see.
- A shadow-tree element retargets: the document-level hit test names the host, the inner element does
  not contain the host, and the caller reports a cover that is the element's own host.

The `isOutsideViewport` composition the TSDoc offers is also insufficient, and the objective lane
gave the counterexample: that predicate tests whether the **whole rectangle** misses the viewport,
while `readHit` fails when the **centre** is outside. With `left = -80` and `width = 100` the right
edge is 20, so the predicate reports false while the centre sits at -30 and `readHit` returns
`undefined`. The two also read different windows — the predicate uses the global `window`, this
reader uses `element.ownerDocument`.

**The property to change.** State each bound where the reader meets it. Name the gates to pass
first — `isRendered` and `isReachable` — and state the viewport distinction precisely rather than
pointing at a predicate that answers a different question.

**Establish the shadow behaviour rather than asserting it.** Write a probe under `tmp/probe/`, run
it, and report what the installed browser actually returns for an element inside a shadow tree. If
it retargets to the host, document that; if it does not, document what it does. Do not ship a
documented limitation you did not observe.

### 4. Three guide homes this package already built

**Subjective lane F2, F3, F4.** Each finding lands in a section that already exists and already has
a voice. Match it rather than inventing a shape.

- **Contract item 16** states that `isReachable` "is the one reachability filter the layer applies"
  and closes "Neither asks about the viewport". `readHit`'s own remarks state the opposite fact about
  the same concept. A reader going to the Contract to learn whether a target is really clickable
  never meets this helper. Give item 16 the third reading in its own voice: `readHit` is the point
  reading that sees a cover and a wrapped target, it is not a filter the acting verbs apply, and
  `isReachable` remains the one filter they do apply.
- **`Bounds a shipped helper carries`** opens "A shipped helper can still decline the question it
  looks like it answers." This helper declines several, named in item 3. Add its entry, in the shape
  the `readPixels` entry already uses.
- **The Limits table** carries a ruling per browser candidate, shipped and refused alike.
  `extractControls` was refused there as "a wrapper over `querySelectorAll` that adds no boundary,
  invariant, composition, or narrower contract" — and `readHit` is a wrapper over `elementFromPoint`
  that must clear the same bar. It does: the centre computation composes two readings, the
  `undefined` translation is this package's absence convention, and "the point is always this
  element's centre" is a materially narrower contract. Record that ruling as a `Ships` row naming
  the consumer sites and those three additions. An unstated ruling is one the next contributor
  re-litigates.

### 5. The summary garden-paths

**Subjective lane F5.** `Reads the element a pointer aimed at one element's bounding-box centre
reaches.` uses `element` in two roles in one sentence and makes the reader hold a long phrase as the
subject of `reaches`.

The lane's replacement: `Reads the topmost element at one element's bounding-box centre.` It names
the rule the hit test applies, and the pointer rationale already opens the remarks.

**The property to change.** Take that sentence or better it. The guide cell carries the same
sentence and the parity gate compares them, so both move in one edit or the gate reddens.

### 6. The missing case, and one case name

**Both lanes.** No case covers a zero-area or unrendered element, and that is the reading this
package treats as canonical elsewhere: the clipped zero-size control is what separates its two
predicates, ruled on in the guide and tested in the suite.

**The property to change.** Add a case for it, driving real layout like its neighbours, and assert
what the reader actually returns. It owes a red from a plausible mutation, like every other case
here.

Rename `reports nothing for a centre that lands outside the viewport`, which names the arrangement
rather than the rule and carries both routes to `undefined` under one name. State the rule and let
the fixture supply the arrangement.

## What must not change

- The signature. `Element` in, `Element | undefined` out. Both lanes ruled it right, and the
  subjective lane ruled out a discriminated return explicitly: `undefined` is this package's absence
  convention and every sibling reader follows it.
- The helper's placement in the file and in the guide's tables. The subjective lane checked the
  file's ordering and found it subject-ordered throughout.
- The name `readHit`. Ruled and kept, with the disambiguation moved into the summary by item 5.

## Unknowns

- What the installed browser returns for a shadow-tree element. Item 3 requires you to observe it.
- Whether any fleet guide already claims the bare name `readHit`. The subjective lane checked the
  mirrors in this checkout and found none. If you can check wider cheaply, do; otherwise say so.

## Host facts

- Windows. POSIX syntax in the Bash tool; `npm` resolves as `npm.cmd`.
- Read this checkout's `AGENTS.md` for its gate chain and run it.
- The guide parity gate compares a `Summary` cell against the TSDoc description paragraph, and a
  titled `@example` against the guide fence of that title. It compares no `Signature` cell.
- `npm test` does not include the distribution project; it is slow and packs the workspace.

## Scope

**Owned files:**

- `src/browser/helpers.ts` — the TSDoc block only. **No implementation byte moves.**
- `tests/src/browser/helpers.test.ts`
- `guides/test.md`
- Probes under `tmp/probe/` and instruments under `tmp/`

**Off-limits — do not edit, for any reason:**

- `package.json` — no version bump
- every other `src/` environment and every other guide
- the roughnotes and scaffold checkouts — read them, never write them

Do not bump a version and do not publish. Do not commit or push. Do not install anything. Run no
`git checkout`, `git restore`, `git stash`, `git reset`, or `git clean`.

## Execution

Perform this assignment directly. Spawn nothing.

## Acceptance criteria

Ordered cheap-first.

1. Format and lint pass on your owned files.
2. The typecheck passes. No `any`, `as`, `!`, or suppression comment in what you add.
3. The `@example` compiles. Report the extraction-and-compile command and its output.
4. The remarks describe what the installed provider does, with the file and line you read.
5. Every bound in item 3 is stated where the reader meets it, and the shadow behaviour you document
   is one you observed. Report the probe and its output.
6. Contract item 16, the Bounds section, and the Limits table each carry their entry.
7. The summary and its guide cell match, and `npm run test:guides` passes.
8. The zero-area or unrendered case exists with a recorded red, and the renamed case states its rule.
9. `readHit`'s implementation is byte-identical to `30c515e`. Prove it with a comparison.
10. The full gate chain passes, with every project's counts. Run the distribution project separately
    and report it.

**Observations, not criteria:** the wall-clock durations; whether a wider fleet name check was
possible.

## Deviation contract

A conflict with the objective stops you: report expected, found, exact evidence, done or not done,
and at most one hypothesis. Do not change the signature. Do not move an implementation byte. Do not
document a limitation you did not observe.

## Output

Write your report to `tmp/units/t2-report.md`, and make your final message the same content:

1. **Done / not done** per criterion.
2. **The example** — before, after, and the compile output.
3. **The driver correction** — what you read, and what the remarks say now.
4. **The bounds** — each one, where it landed, and the shadow probe's output.
5. **The guide** — each of the three entries, quoted.
6. **The case** — its red, and the rename.
7. **The byte comparison.**
8. **Observations**, and **what you did not close**.

No process diary.
