# Unit T1 — publish the hit reader

## Role and engine

`implementer` — Opus 5, native Claude subagent, the **test** checkout at
`C:\Users\mikes\WebstormProjects\test`, sole serial writer from the clean committed baseline
`52d0276`.

## Objective

Publish `readHit` from the browser barrel: a reader that names the element a pointer aimed at one
element's bounding-box centre actually reaches.

## The consumer, which is what earns the capability

`AGENTS.md` § Minimal public API adds a capability with its first real consumer. This one has five,
all in the `roughnotes` workspace at `C:\Users\mikes\WebstormProjects\roughnotes` — read them, never
write there:

- `tests/app/browser/integration.test.ts` — the hand-rolled `followField`
- `tests/app/browser/App.test.ts` — `readCentre(control: Element)`
- `tests/app/browser/components/ContactForm.test.ts`
- `tests/app/browser/components/PaymentForm.test.ts`
- `tests/app/browser/components/SubscribeForm.test.ts`

Each reads `document.elementFromPoint` at a control's bounding-box centre. Four of them already hold
the element. `.orkestrel/roughnotes/finding-wrapped-link-target.md` in that checkout records the
measurement the shape must preserve.

Two axes reach this reader, and neither is covered by an existing helper. A sticky masthead covers a
control that was scrolled to, and a wrapped inline target paints one rectangle per line with a gap
between them, so its bounding-box centre resolves to the ancestor. `isReachable` reads
`checkVisibility` and sees neither.

## The shape

```ts
export function readHit(element: Element): Element | undefined
```

It returns what `document.elementFromPoint` resolves at the element's bounding-box centre, or
`undefined` where the centre lands on nothing. The caller rules on the result with
`element.contains(hit)` and names the cover from the returned node.

**Take the element, never a name.** `guides/test.md` § the predicate and reader contract, and
Contract item 13, both fix this: the predicates, the element readers, and the describers name a node
the caller already has. A name-resolving reader would have to go through `resolveRendered` or
`resolveAccessible`, which throw distinct voices for absent, unreachable, ambiguous, and
off-viewport — a reader that throws on ambiguity is a different thing wearing the reader's name.

**Return the node, never a boolean.** The information that ended the roughnotes diagnosis was
*which* element sat at the centre — `LI` rather than `A`, or the masthead rather than the control. A
boolean says "no" without naming the cover, so it would not have produced the finding this helper
exists to serve.

## The work

1. **Types first.** Check whether `src/browser/types.ts` needs anything. `Element | undefined` uses
   no new declaration; if you find you want one, put it there before the implementation and say why.
2. **Implement** in `src/browser/helpers.ts`. The existing `export * from './helpers.js'` in
   `src/browser/index.ts` publishes it; confirm rather than assume.
3. **Document** with a complete TSDoc block matching the neighbouring readers — summary sentence,
   `@param`, `@returns`, `@example`. The guide parity gate compares the summary against the guide
   row, so write the summary in the form `findDrift` compares.
4. **Test** it in the mirrored file under `tests/src/browser/`. Cover: the centre resolving to the
   element itself; a cover sitting over the centre, where the returned node is the cover; a wrapped
   inline target whose per-line rectangles leave the centre on the ancestor; and a centre that lands
   on nothing. Use real elements and real layout — no mock, no stub, no fake geometry.
5. **Guide row** in `guides/test.md`, in the Browser Helpers table beside `isReachable`:

   ```text
   | `readHit` | function | `(element: Element) => Element | undefined` | Reads the element a pointer aimed at one element's bounding-box centre reaches. |
   ```

6. **Add it to the element-taking lists** — the sentence in `guides/test.md` naming the helpers that
   take a node the caller already has, and Contract item 13. Find both by searching for
   `isRendered`, which both name.

## Unknowns

- Whether the package's browser suite can drive a wrapped inline target deterministically at a fixed
  viewport. If it cannot, say so and cover the wrap case with a construction whose rectangles you
  control rather than skipping it.
- Whether `guides/test.md` carries a Limits row for a hit-target candidate. If it does, update the
  ruling rather than leaving a refusal beside a shipped helper.

## Host facts

- Windows. POSIX syntax in the Bash tool; `npm` resolves as `npm.cmd`.
- Read this checkout's own `AGENTS.md` and rule files for its gate chain, and run it.
- The guide parity gate fails on a published export with no row and on a row with no export.

## Scope

**Owned files:**

- `src/browser/helpers.ts`
- `src/browser/types.ts` — only if a declaration is genuinely needed
- the mirrored test file under `tests/src/browser/`
- `guides/test.md`

**Off-limits — do not edit, for any reason:**

- `package.json` — no version bump
- every other `src/` environment
- the roughnotes checkout and the scaffold checkout — read them, never write them

**Do not bump a version, and do not publish.** Do not commit or push. Do not install anything. Run
no `git checkout`, `git restore`, `git stash`, `git reset`, or `git clean`.

## Execution

Perform this assignment directly. Spawn nothing.

## Acceptance criteria

Ordered cheap-first.

1. Format and lint checks pass on your owned files.
2. The typecheck passes. No `any`, `as`, `!`, or suppression comment in what you add.
3. `readHit` is exported from the browser barrel and takes an `Element`.
4. Its cases cover the four readings named in the work, each against real layout, and **each carries
   a recorded red** — mutate the implementation, run the named case, restore. Show both counts per
   case.
5. The guide row exists and the parity gate passes.
6. The element-taking lists name it.
7. The full gate chain passes. Report every project's counts.

**Observations, not criteria:** the wall-clock durations; whether a Limits row needed updating.

## Deviation contract

A conflict with the objective stops you: report expected, found, exact evidence, done or not done,
and at most one hypothesis. Do not add a name-taking variant. Do not return a boolean. Do not use a
mock, a stub, or fabricated geometry — the reader's whole subject is real layout.

## Output

Write your report to `tmp/units/t1-report.md`, and make your final message the same content:

1. **Done / not done** per criterion.
2. **The shape** — the signature, the TSDoc summary, and the guide row.
3. **The reds** — command and both counts, per case.
4. **The consumer** — what each of the five roughnotes instruments would become, quoted before and
   after. Do not edit them; show the replacement.
5. **Observations.**
6. **What you did not close**, and why.

No process diary.
