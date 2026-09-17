# Unit T1 audit — subjective lane report

Lane: `reviewer` holding the **subjective** lane, Opus 5, native subagent, clean context,
2026-09-17. Transcribed by the Orchestrator from the lane's returned message; the role carries no
write tool.

**Dispatch defect the lane recorded.** The dispatch named the diff as evidence and supplied neither
the diff nor the status output, to a lane holding `Read`, `Grep`, and `Glob` and no command. Claim 9
was therefore unverifiable and the lane did not reconstruct it. Orchestrator error against
`.agents/orchestration.md` § Required sections.

## Per-claim verdicts

1. **CONFIRMED.** `src/browser/helpers.ts:132-139` computes the centre and returns `hit ?? undefined`.
2. **CONFIRMED.** It reads `element.ownerDocument`, matching `readText` and `readName`.
3. **CONFIRMED.** The element-taking, node-returning contract is fixed by the guide's Surface prose
   and Contract item 13, and the node return is earned by the consumers: three form tests call
   `.closest('a')` on the result and `App.test.ts` calls `.closest('.masthead')`.
4. **CONFIRMED.** Every fixture goes through `buildFixture`, which calls the real `render` and
   attaches to the document. Every measurement comes from `getBoundingClientRect` or
   `getClientRects`.
5. **UNSETTLED.** The mutation designs are plausible defects rather than sabotage, which this lane
   can judge. The recorded reds rest only on the writer's own report, and this lane is read-only.
6. **CONFIRMED.** The case asserts the fragment count is two and the inter-fragment gap is positive,
   so a host that stopped wrapping reddens on the count rather than passing on the hit. The break is
   a property of the font: the container is `7ch` in the same monospace the text is set in.
7. **CONFIRMED.** The guide row's `Summary` cell and the TSDoc description are the identical
   sentence, and the element-taking lists name it.
8. **CONFIRMED.** No `any`, `as`, non-null assertion, or suppression. The tests narrow through
   `requireValue`.
9. **UNSETTLED.** See the dispatch defect.
10. **CONFIRMED**, conditional on republication. Each replacement is equivalent at its site: `box.x`
    and `box.y` equal `box.left` and `box.top`, `App.test.ts` reads `box` nowhere after the hit test
    so dropping it compiles, and the early return narrows for the reads that follow.

## Findings

**F1 — the TSDoc example does not compile. Defect, high.** The example writes `link.contains(hit)`
where `hit` is `Element | undefined` and the DOM declares `contains(other: Node | null)`. Every real
call site already knows this and narrows first — the cases wrap in `requireValue`, `App.test.ts`
returns early on `undefined`, and `integration.test.ts` writes
`centre !== undefined && target.contains(centre)`. The unit met the friction in its own tests and
did not carry the fix into the sample. This matters more than a prose slip: it is the only usage
sample shipping with a new export, it demonstrates the exact call the remarks say the caller makes,
and nothing checks it — the `@example` carries no title, so it pairs with no guide fence and is
never compiled.

**F2 — Contract item 16 claims a completeness the package no longer has. Defect, moderate.** It says
`isReachable` "is the one reachability filter the layer applies" and closes "Neither asks about the
viewport". `readHit`'s remarks state the opposite fact about the same concept. A reader who goes to
the Contract to learn whether a target is really clickable gets `isReachable` and never meets
`readHit`. The parity gate cannot see this, because it compares `Summary` cells and titled examples,
not contract prose.

**F3 — no `Bounds a shipped helper carries` entry, and this helper is what that section exists for.
Defect, moderate.** `readHit` declines several questions it looks like it answers, and the guide
names none:

- `undefined` conflates the centre reaching nothing with the centre sitting outside the viewport.
  The TSDoc names this one; the guide does not.
- A returned node conflates a real cover, an element the document does not render, and an element
  with a zero-area box. An unrendered or zero-area element still yields a node from whatever sits at
  its collapsed rectangle, so `contains` is false and the caller reports a cover that is not there.
  This is the sharper half: the TSDoc teaches the reader to distrust `undefined` and says nothing
  about distrusting a returned node, and the returned node is the one that lies. The zero-area case
  is not hypothetical here — the clipped skip-link idiom is this package's canonical example.
- A cover carrying `pointer-events: none` is invisible to the reading, so the caller reads
  "reachable" for a cover a person can see.

**F4 — no Limits ruling row for a shipped browser candidate. Defect, moderate.** That table
adjudicates what ships and carries a ruling per candidate, shipped and refused alike. The missing
argument is the sharpest one against this helper: `extractControls` was refused there as "a wrapper
over `querySelectorAll` that adds no boundary, invariant, composition, or narrower contract", and
`readHit` is a wrapper over `elementFromPoint` that must clear the same bar. It does — the centre
computation composes two readings, the `undefined` translation is this package's absence convention,
and "the point is always this element's centre" is a materially narrower contract — but the guide is
where that ruling lives, and an unstated ruling is one the next contributor re-litigates.

**F5 — the summary garden-paths. Recommendation, low.** `element` carries two roles in one sentence
and the reader must hold a long phrase as the subject of `reaches`. Recommend `Reads the topmost
element at one element's bounding-box centre.`, which names the rule the hit test applies; the
pointer rationale already opens the remarks. The guide cell changes in the same edit or the gate
reddens.

**F6 — one case name names the arrangement, and covers two routes under one name. Recommendation,
low.** `reports nothing for a centre that lands outside the viewport` names the arrangement where its
neighbours state rules, and it is the only case covering `undefined`, so both routes ride one name.

**F7 — the guide's `Signature` column is compared against nothing. Recommendation, low.** The
installed comparator's drift categories are summary and example, and the surface projection carries
name, keyword, and summary only. `readHit`'s signature cell is correct today and nothing keeps it so.

## Hazard rulings

- **Viewport-relative coordinates.** Real. A rendered element scrolled outside the viewport reads
  `undefined`, indistinguishable from a centre that hit nothing. The TSDoc names it and sends the
  reader to `isOutsideViewport`; the guide does not. Carried by F3.
- **Shadow DOM.** Real and undocumented anywhere. A document-level hit test names the host rather
  than the encapsulated node, so `contains` is false for an element that is perfectly hittable and
  the caller reports a cover that is the element's own host. This is a package-wide silence rather
  than a `readHit` regression — the two predicates are shadow-bounded too and say nothing.
- **A zero-area element.** Real and uncovered. The centre of a zero-size rectangle is a point on the
  element's own edge, so the reading names whatever paints there. This package treats the clipped
  zero-size control as the canonical case separating its two predicates, which makes the silence
  worse rather than neutral.
- **Subpixel geometry.** No finding. With a 60px line height the gap is tens of pixels wide and no
  rounding reaches it. The case pins the fragment count and the gap sign, so a host that changed the
  answer reddens rather than drifting.
- **The return type against the family.** A caller cannot distinguish "nothing at the centre" from
  "not rendered at all", and it **should not** be able to: `undefined` is this package's absence
  convention and every sibling reader follows it. A discriminated return buys a distinction the
  caller gets free by gating on `isRendered` and `isReachable` first, at the cost of a shape no other
  reader has. The fix is prose. The one real ergonomic cost of `undefined` is the narrowing at every
  `contains` call site, which is exactly what F1 fails to show.
- **The escaped union arm.** Removing the escape splits the row, which shifts the `Summary` column
  out from under its header and makes the summary comparison fail — so the gate reddens rather than
  passing silently, but its message names a summary nobody touched. The escaping convention is stated
  only in the Types preamble about `Shape` cells; the Helpers table carries no such preamble for
  `Signature`.

## Rulings this lane owns

- **The name.** Keep `readHit`. `read*` is the fixed prefix for obtaining a value from a live host
  object, and `hit` is the standard noun for what a hit test returns. The reservation: `hit` carries
  an everyday sense as a tally, and a developer meeting it cold could read "hit count" first. The
  return type settles it at the point of use, and the unambiguous alternative is worse — `target` is
  the word the journey layer already owns. Let the summary carry the disambiguation instead.
- **The TSDoc block.** It teaches the two axes well: both arrangements named, the reason
  `isReachable` sees neither given concretely, and the node return argued from what the caller does
  with it. Where it falls short is the second half: it names one of the facts it cannot distinguish
  and is silent on the others, so it trains the reader to distrust `undefined` and to trust a
  returned node.
- **The case names.** They state rules and match the neighbours' voice. One exception, F6.
- **Where it sits.** Correct, reached against the report's own reasoning rather than with it: the
  claim that it was split off a contiguous `read*` block does not survive the file, which already
  has `read*` in several disjoint regions and is ordered by subject throughout.
- **Whether to publish at all.** Publish. The count of consumers is not what earns it — the consumer
  workspace already carries a large local `read*` family, so a sixth local helper would have cost one
  export and no release. What earns it is that the gap is in this package's own concept:
  `isReachable` is documented as the layer's answer to "can a person click this", and the finding
  that produced this helper is that it cannot see a cover or a wrap. A reader following the Contract
  today is told a complete story that is not complete. Leaving it in the consumer leaves that hole in
  the package and lets every workspace patch it differently.

VERDICT: REJECT
