# Unit T1 — audit verdict

Round one, 2026-09-17. Subject: `readHit`, published from the browser barrel of `@orkestrel/test`,
written by Opus 5 as unit T1 and committed at `30c515e` with no adversarial round. The round ran
before the release rather than after it, because publishing fixes the signature in a package other
repositories compile against.

**Ruling: ACCEPT, after unit T2 closed the findings.** Both lanes returned `REJECT`, and both
rejected the documentation rather than the signature. The objective lane's opening sentence states
the reconciliation exactly: the calculation implements the requested signature, and the published
documentation teaches an invalid TypeScript call and overstates what the result establishes. No
implementation byte moved in the fix.

## Lanes that ran

| Lane       | Role and engine                                      | Verdict | Report                            |
| ---------- | ---------------------------------------------------- | ------- | --------------------------------- |
| Subjective | `reviewer` — Opus 5, native subagent, clean context   | REJECT  | `t1-audit-subjective-report.md`   |
| Objective  | `analyst` — GPT-5.6 Sol through the Codex bench       | REJECT  | `t1-audit-objective-report.md`    |
| Gates      | `verifier` — Sonnet, over unit T2's tree              | GREEN   | `t2-verify-report.md`             |

Both lanes read the same numbered claims at `t1-audit-claims.md`, in clean contexts, blind to each
other. No lane was substituted and no bench was dark.

## What the round settled

**The signature stands.** Neither lane asked for a change to `readHit(element): Element | undefined`,
and both argued against one. The subjective lane ruled that a caller cannot distinguish "nothing at
the centre" from "not rendered at all" and must not be able to, because `undefined` is this package's
absence convention and every sibling reader follows it. The objective lane ruled the same way from
the other side: a boolean would discard useful evidence, and a speculative result union buys a
distinction the caller gets free by gating on `isRendered` and `isReachable` first. The name
`readHit` also stands — `read*` is the fixed prefix for obtaining a value from a live host object.

**The example did not compile, and nothing in the repository could have caught it.** Both lanes
reached this independently. `link.contains(hit)` passes `Element | undefined` into the installed DOM
signature `contains(other: Node | null)`; the objective lane extracted the fence and compiled it
against this repository's own options, producing `TS2345`. An untitled `@example` pairs with no guide
fence and is never compiled, so the only usage sample shipping with the export demonstrated a call
the compiler refuses.

**The driver justification was false for the installed provider.** The remarks claimed a driver
clicks the bounding-box centre, which was the whole argument for measuring that point.
`playwright-core@1.63.0` clips each content quad to the viewport, drops every quad left without
area, and takes the midpoint of the first survivor, at `_clickablePoint` in `coreBundle.js`. For a
wrapped target that midpoint sits inside the first line box while the union-box centre sits in the
gap between lines.

**The reader taught distrust of the wrong half.** The documentation named a fact `undefined`
conflates and was silent on the facts a returned node conflates, and the returned node is the one
that misleads. Both lanes ruled the unrendered element, the zero-area element, and the shadow tree
as real undocumented limitations. The subjective lane added the `pointer-events: none` cover. The
objective lane refuted the viewport composition the TSDoc pointed at: `isOutsideViewport` asks
whether the whole rectangle misses the viewport while this reader asks where one point lands, and
each reads a different window.

## Claims neither lane could settle

- **Claim 5, the recorded reds.** Both lanes returned `UNSETTLED`. The mutation designs are plausible
  defects rather than sabotage, which a reading lane can judge, and the recorded reds rest on the
  writer's own report, which a read-only lane cannot re-run. Unit T2 recorded a fresh red per added
  case, and the `verifier` run at `t2-verify-report.md` is the independent gate evidence.
- **Claim 6, deterministic wrapping.** The subjective lane confirmed it and the objective lane left
  it `UNSETTLED`, because `monospace` does not fix vertical font metrics and browser execution was
  blocked in its sandbox. Reconciled as confirmed for the property the case asserts — the fragment
  count and the sign of the inter-fragment gap — and unproven for the stronger claim that every host
  font produces that geometry. The case reddens visibly rather than drifting if that stops holding.
- **Claim 9, scope.** The objective lane refuted it as written for the range `52d0276..30c515e`,
  which also carries the retained records from `c29d9cd`. The feature commit itself changes only the
  owned helper, its mirrored test, and the guide, and `package.json` is unchanged. This is a
  discrepancy in how the claim described its range, not an unauthorized edit.

## Findings carried

Unit T2 carried every finding both lanes raised. Its brief is `t2-brief.md`, its report `t2-report.md`,
and the landing commit is `07e32cd`.

| Finding                                                          | Lane       | Where it landed                                              |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| The example does not compile                                      | Both       | The TSDoc sample carries the narrowing every call site writes |
| The driver explanation is false for the installed provider        | Objective  | The remarks state what the helper measures and claim no more  |
| Unrendered, zero-area, `pointer-events: none`, and shadow bounds  | Both       | The remarks and the guide's bounds section                    |
| The viewport composition names a predicate answering another question | Objective | The remarks state the distinction rather than pointing away   |
| Contract item 16 claims a completeness the package no longer has  | Subjective | The contract item                                             |
| No bounds entry for a helper that declines questions              | Subjective | The guide's bounds section                                    |
| No Limits ruling row for a shipped browser candidate              | Subjective | The Limits table, against the `extractControls` refusal       |
| The summary garden-paths                                          | Subjective | The summary and its guide cell, edited together               |
| Missing cases for the collapsed box and the shadow tree           | Both       | A case each, with a recorded red from a plausible defect      |

## Findings recorded, not carried

- **The guide's `Signature` column is compared against nothing.** Both lanes reached it. `findDrift`
  compares the summary and titled examples, so an incorrect signature cell stays green while removing
  the `\|` escape reddens on a summary nobody touched. Low severity, and a pre-existing parity limit
  rather than a defect this unit introduced. It belongs to whoever next owns the guide comparator.
- **Shadow encapsulation is a package-wide silence.** The subjective lane ruled that `isRendered` and `isReachable` are
  shadow-bounded too and say nothing. T2 closed it for `readHit` alone. The wider
  silence belongs to whoever next owns the predicate documentation.
- **A case name names its arrangement rather than its rule**, and covered both `undefined` routes
  under one name. T2's added cases split the routes; the naming recommendation is low severity and
  was not separately carried.

## Deviations this round

- **The subjective lane was dispatched without the diff or the status output.** The lane holds
  `Read`, `Grep`, and `Glob` and no command, so claim 9 was unverifiable and the lane recorded that
  rather than reconstructing it. Orchestrator error against `.agents/orchestration.md` § Required
  sections, which names both as mandatory review evidence for a code change.
- **The objective lane could not execute the browser suite.** Vite failed with `EPERM` writing its
  temporary configuration inside the bench sandbox. The lane named the exact settling command instead
  of substituting a weaker reading, which is the required handling, and the `verifier` took that
  proof on the host.
- **This verdict was written after the round, from the round's retained record.** The reconciliation
  it states is the one unit T2's brief and commit acted on. The contract requires that
  reconciliation in this file, and the round closed without writing it.

VERDICT: ACCEPT — unit T2 closed every carried finding, the gates ran green, and `@orkestrel/test`
published at 0.0.16 on 2026-09-17.
