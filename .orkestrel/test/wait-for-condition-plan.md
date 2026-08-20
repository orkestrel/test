# Add `waitForCondition` to `@orkestrel/test`

## Why this belongs here rather than in each package

`@orkestrel/test` publishes `waitForDelay` and no way to wait until a condition holds:

```text
$ grep -oE 'export declare (function|const) [a-zA-Z]+' node_modules/@orkestrel/test/dist/src/*/index.d.ts
… captureError collect collectStream createHostileValues createLoopback createRecorder createScratch
  createTeardown isExcluded matchesIdentity readInventory removeTree requireValue resolveContained
  resolveRoot roundTripJSON waitForDelay
```

Three packages have now written a fixed-sleep race for want of it:

- `@orkestrel/browser` wrote the local `waitForCondition` this plan adopts.
- `@orkestrel/probe` raced its arming files against a fixed 750 ms wait
  (`tests/src/bin/main.test.ts`, repaired 2026-08-19: the files appear at ~153 ms and the failed boot
  removes them by ~670 ms, so the constant landed past the close every run).
- `@orkestrel/process` races a grandchild's Node bootstrap against a 50 ms deadline
  (`tests/src/server/helpers.test.ts`, measured 2026-08-20: three of six trials never write).

One absent helper is the shared root cause of a defect class. `AGENTS.md` § Design laws: centralize a
pattern repeated twice.

## The starting point, from `@orkestrel/browser`

```ts
export async function waitForCondition(
	condition: () => boolean,
	timeout = 1000,
	interval = 10,
): Promise<void> {
	const deadline = Date.now() + timeout
	while (!condition()) {
		if (Date.now() >= deadline) {
			throw new Error(`Condition was not met within ${timeout}ms`)
		}
		await waitForDelay(interval)
	}
}
```

## Two corrections before it lands

### 1. `Date.now()` must be `performance.now()`

`.claude/rules/tests.md`:

> Measure an elapsed interval with `performance.now()`, never `Date.now()`. `Date.now()` returns whole
> milliseconds, so an interval built from two of its readings truncates at both ends and can
> under-report by a millisecond — enough to fail a boundary assertion against a timer that behaved
> correctly. `performance.now()` is monotonic and sub-millisecond, and it does not move when the wall
> clock does.

The last clause is the one that matters most here. A helper whose whole job is bounding a wait must
not have its deadline move when the host's wall clock is adjusted mid-wait. Shipping this helper with
`Date.now()` would install the defect it exists to prevent into 46 consumers at once.

### 2. Rule on whether the condition may be asynchronous

`() => boolean` cannot express the conditions that produced two of the three races above: probe polls
`readdirSync` and process polls `existsSync`, and a caller waiting on a fetch, a query, or a stat
needs `Promise<boolean>`. Decide between `() => boolean` and
`() => boolean | Promise<boolean>` deliberately and state the reason.

Widening costs nothing at the call site — an awaited synchronous predicate is still synchronous — and
refusing it forces every asynchronous caller back to a hand-rolled loop, which is the situation this
helper exists to end.

## Open questions for the implementing unit

- **Throw or return?** The browser original throws with a named message; probe's local repair returned
  a boolean. Throwing is the better default for a test helper, because a silent `false` becomes a
  confusing assertion failure elsewhere rather than a message naming what was awaited. Confirm, and
  make the message name the condition where a caller can supply a label.
- **Does it belong in core or server?** It uses only timers, so core. Confirm against the package's own
  environment split.
- **Defaults.** `timeout = 1000` and `interval = 10` suit the measured cases: probe's arming window
  opens at ~153 ms, process's grandchild writes at ~295 ms. State that the defaults are chosen for a
  test's patience, not a production timeout.

## What this obliges

`@orkestrel/test` is a devDependency of **46** packages. A new export is additive, so consumers re-pin
at their own pace; nothing cascades. `probe` and `process` re-pin and replace their local loops as
part of their current campaigns.

## Not started

This plan is recorded, not implemented. The current campaign is probe and process; this is the row
that closes the class rather than the instance.
