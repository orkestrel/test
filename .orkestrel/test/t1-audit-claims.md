# Unit T1 audit — the claims under test

The subject is `readHit`, published from the browser barrel of `@orkestrel/test` at
`C:\Users\mikes\WebstormProjects\test`, committed at `30c515e` with its records at `c29d9cd`.

It was written by Opus 5 and has had no adversarial round. **Publishing fixes its signature in a
package other repositories compile against**, so this audit runs before the release rather than
after it.

Evidence:

- The tree at `30c515e`. `git show 52d0276..30c515e` is the change.
- `.orkestrel/test/t1-brief.md` — what the unit was asked to do.
- `.orkestrel/test/t1-report.md` — its own account. A claim, never evidence.
- The five consumer instruments the capability exists for, in
  `C:\Users\mikes\WebstormProjects\roughnotes\tests\app\browser\`. Read-only; never write there.

Re-derive every number you rule on.

## The claims

Rule on each: `CONFIRMED`, `REFUTED`, or `UNSETTLED`, with the evidence that decides it.

1. `readHit(element)` returns the element `elementFromPoint` resolves at the element's bounding-box
   centre, and `undefined` where the centre lands on nothing.
2. It reads `element.ownerDocument` rather than the global `document`, so it answers about the
   document the element is in, matching the package's other readers.
3. The shape obeys the package's own contract: the predicates, element readers, and describers take
   a node the caller already has. It takes an element rather than a name, and returns a node rather
   than a boolean.
4. Every case drives real layout. No mock, no stub, no fabricated rectangle.
5. Each case has a recorded red, and each mutation is a defect a plausible implementation could
   hold rather than a sabotage written to fail.
6. The wrapped-target case produces exactly two line boxes deterministically, and asserts the
   fragment count and the gap between them, so a host that stopped wrapping reddens rather than
   passing on a coincidence.
7. The guide row exists, its `Summary` cell equals the TSDoc description paragraph in the form the
   parity gate compares, and the element-taking lists name it.
8. The added code carries no `any`, no `as`, no non-null assertion, and no suppression comment.
9. Nothing outside the unit's owned list moved, and no version was bumped.
10. The five consumer replacements the report shows would each compile and behave, including the
    `null`-to-`undefined` shape change at every call site that tests the result.

## Where to look hardest

Unprompted hazards. Rule on each as a finding if it is real. **This is the half that matters: a
published signature is hard to change.**

- **`elementFromPoint` is viewport-relative.** State what `readHit` returns for an element that is
  rendered but scrolled outside the viewport, whether that is documented, and whether a consumer
  reading `undefined` could wrongly conclude the element is covered rather than off-screen.
  `isOutsideViewport` already exists in this package — state how the two compose and whether the
  documentation sends a reader to it.
- **Shadow DOM.** `elementFromPoint` returns the shadow host rather than the inner node. State what
  that does to a `contains` ruling, and whether the documentation names it.
- **A zero-area element.** State what the centre resolves to when width or height is zero, and
  whether the case set covers it.
- **Subpixel geometry.** The centre is computed from a fractional rectangle. State whether any
  rounding makes the reading unstable at a boundary, and whether the wrap case's assertion could
  flake on a host with different font metrics.
- **The return type against the family.** Every sibling predicate returns a boolean and never
  throws. `readHit` returns a node or `undefined`. State whether a caller can distinguish "nothing
  at the centre" from "the element is not rendered at all", and whether it should be able to.
- **The guide's escaped union arm.** The row writes the return type with an escaped pipe so the
  table cell does not split. State whether the parity gate compares the escaped or unescaped form,
  and whether a future reader editing that cell would break the gate silently.

## Out of scope

The release decision. Whether the package should bump and publish is the repository owner's, and no
lane rules on it.
