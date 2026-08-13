# Test

> The test helpers the fleet had already written forty-one times, published once. Every Orkestrel
> package hand-rolls a call recorder, a delay, a temporary directory, and a source-file walker in its
> own `tests/setup*.ts`; this package holds one implementation of each and ships as a
> `devDependency`. Nothing here runs in production code. Source: [`src/core`](../src/core) and
> [`src/server`](../src/server).
>
> It has **zero runtime dependencies**, and that is load-bearing rather than tidy. A helper package
> that depended on `@orkestrel/emitter` would install a second copy of it into every consumer that
> already pins one, and the compiler reads two copies as two distinct types. Zero dependencies is
> what makes this package incapable of causing that failure for anyone. The same rule reaches the
> signatures: no exported type here names an `@orkestrel/*` type, because such a signature rejects
> the consumer's own local value inside the consumer's own repository.

## Install

```bash
npm install --save-dev @orkestrel/test
```

`@orkestrel/test` is the host-independent core. `@orkestrel/test/server` is the Node face — the two
filesystem helpers. Core touches neither `node:*` nor the DOM, so a browser test project imports it
unchanged.

## Surface

Seventeen exports: eleven values and six types, across two environments.

```ts
import { createRecorder, waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'

// A temporary directory the test owns, seeded with the input under test.
const scratch = createScratch({ files: { 'input.txt': 'hello' } })

// A real callback rather than a spy: hand `handler` to the code under test.
const recorder = createRecorder<[path: string]>()
loader.on('read', recorder.handler)

loader.watch(scratch.path)
await waitForDelay(10) // let a real host timer elapse

recorder.count // how many reads arrived
recorder.calls // the arguments of each, oldest first

scratch.destroy()
```

### Core

Imported from `@orkestrel/test`.

#### Types

| Type                | Kind      | Shape                                                                                                   |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `RecorderInterface` | interface | `{ calls, count, handler }` plus `clear` — the recorded calls of one callback.                          |
| `ClockInterface`    | interface | `{ now }` plus `advance` / `set` — a time source the test moves by hand.                                |
| `JSONValue`         | type      | `string \| number \| boolean \| null \| readonly JSONValue[] \| { readonly [key: string]: JSONValue }`. |

Each interface's `readonly` data members are the row above; its call-signature members are listed
under [Methods](#methods).

#### Helpers

| API             | Kind     | Signature                                                   | Summary                                                     |
| --------------- | -------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `waitForDelay`  | function | `(ms?: number) => Promise<void>`                            | Waits for a real host timer; defaults to `0`.               |
| `captureError`  | function | `(thunk: () => unknown) => unknown`                         | Runs a thunk and returns whatever it threw.                 |
| `requireValue`  | function | `<T>(value: T \| null \| undefined, message?: string) => T` | Narrows away `null` and `undefined` by throwing.            |
| `collect`       | function | `<T>(source: AsyncIterable<T>) => Promise<readonly T[]>`    | Drains an async iterable into an array, in iteration order. |
| `collectStream` | function | `<T>(stream: ReadableStream<T>) => Promise<readonly T[]>`   | Drains a readable stream into an array, in read order.      |
| `roundTripJSON` | function | `<T extends JSONValue>(value: T) => T`                      | Copies a JSON value through `stringify` and `parse`.        |
| `resolveRoot`   | function | `(meta: ImportMeta) => URL`                                 | The URL one directory above the calling module's own file.  |

#### Factories

| API              | Kind     | Signature                                                          | Summary                                                 |
| ---------------- | -------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `createRecorder` | function | `<TArgs extends readonly unknown[]>() => RecorderInterface<TArgs>` | A recorder whose `handler` appends each call, in order. |
| `createClock`    | function | `(start?: number) => ClockInterface`                               | A clock starting at `start`, `0` by default.            |

### Server

Imported from `@orkestrel/test/server`.

#### Types

| Type               | Kind      | Shape                                                                                    |
| ------------------ | --------- | ---------------------------------------------------------------------------------------- |
| `ScratchInterface` | interface | `{ path }` plus `write` / `read` / `exists` / `destroy` — one owned temporary directory. |
| `ScratchOptions`   | interface | `{ prefix?: string, files?: Readonly<Record<string, string>> }`.                         |
| `InventoryOptions` | interface | `{ extensions?: readonly string[], exclude?: readonly string[] }`.                       |

#### Helpers

| API             | Kind     | Signature                                                                                                               | Summary                                           |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `readInventory` | function | `(root: URL \| string, directories: readonly string[], options?: InventoryOptions) => Readonly<Record<string, string>>` | File contents keyed by sorted root-relative path. |

#### Factories

| API             | Kind     | Signature                                        | Summary                                                       |
| --------------- | -------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `createScratch` | function | `(options?: ScratchOptions) => ScratchInterface` | Allocates a temporary directory the caller owns and destroys. |

## Methods

The call-signature members of each behavioral interface. Their `readonly` data members stay in the
[Surface](#surface) rows above.

#### `RecorderInterface`

| Method  | Returns | Behavior                                                                     |
| ------- | ------- | ---------------------------------------------------------------------------- |
| `clear` | `void`  | Truncates the recorded calls in place; the recorder stays usable afterwards. |

#### `ClockInterface`

| Method    | Returns | Behavior                                        |
| --------- | ------- | ----------------------------------------------- |
| `advance` | `void`  | Adds milliseconds to the current time.          |
| `set`     | `void`  | Replaces the current time with the given value. |

#### `ScratchInterface`

| Method    | Returns               | Behavior                                                     |
| --------- | --------------------- | ------------------------------------------------------------ |
| `write`   | `void`                | Writes a file below the directory, creating missing parents. |
| `read`    | `string \| undefined` | Reads a file, or `undefined` when it does not exist.         |
| `exists`  | `boolean`             | Whether a path below the directory exists.                   |
| `destroy` | `void`                | Removes the directory and everything in it.                  |

## Contract

These hold across `src/core`, `src/server`, and this guide.

1. **Doc ↔ source bijection.** Every `## Surface` row is a real export, and every export is a row —
   exhaustive in both directions, name and kind together. [`tests/guides.test.ts`](../tests/guides.test.ts)
   proves it, and builds its own file inventory with this package's `readInventory` and
   `resolveRoot`.
2. **`clear()` truncates.** It empties the backing array rather than replacing it, so a `calls`
   reference captured before the call reads as empty after it. Thirty of the fleet's thirty-two
   local recorders already did this, and none of the 129 `clear()` call sites captures `calls`
   first, which is what makes adoption a no-op.
3. **`captureError` never throws for a missing throw.** It returns the thrown value, or `undefined`
   when the thunk completed. It converts; it decides nothing. The variant that throws when nothing
   was thrown is an assertion, and it is not published here.
4. **`requireValue` tests presence, not truth.** `0`, `''`, and `false` pass through unchanged; only
   `null` and `undefined` throw. It exists because `!` and `as` are banned, so a throwing narrowing
   helper is the sanctioned way to reach a value's non-nullable type.
5. **`roundTripJSON` is constrained to `JSONValue`.** Its claim is that the copy has the input's
   type, and that is true only for values JSON can represent. An unconstrained `<T>(value: T) => T`
   over `JSON.parse(JSON.stringify(v))` is unsound; the constraint is the fix.
6. **`readInventory` refuses links.** It throws when the root or a requested directory is a symbolic
   link, or is not a directory, or resolves outside the root. It skips a symlink met while walking
   rather than following it. Keys are root-relative, sorted, and separated by `/` on every host, so
   a Windows run and a Linux run produce the same map.
7. **`createScratch` stays inside its own directory.** Every `write`, `read`, and `exists` path that
   escapes the allocated directory throws, including one that escapes through a symlink, and a
   failed seed removes the directory before rethrowing. `destroy()` is idempotent and removes only
   what the factory allocated.
8. **Zero runtime dependencies, and no foreign type in a signature.** `dependencies` is empty and
   stays empty. No exported signature names an `@orkestrel/*` type, so no consumer can be handed a
   two-copies type failure by installing this package.

## Limits

This package ships what the fleet repeats, not everything the fleet has. A candidate ships when it
has **three or more members that are not all inside one dependency cluster, or five or more members
regardless** — where a cluster is a set of packages one of which runtime-depends on another. Two
related packages sharing a helper is one team's convention, not a fleet pattern.

Everything below was measured, counted, and left out on that rule. Each is revisited when a third
independent consumer appears.

| Excluded                                                                                                                                            | Members  | Why                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRecorderMap` with `RecorderMap`, `RecorderEventMap`, `SubscriberInterface`, `isTotal`                                                        | 13       | A published signature cannot import the consumer's event map, and an indexed access is not an inference site, so the map would have to be passed explicitly at roughly 219 call sites — 18 of which read a property off a call argument and would hard-error with `as` and `!` banned. `createRecorder`, the kernel all 13 local copies are built from, ships instead. |
| `createFixtureServer`                                                                                                                               | 3        | One cluster, and it needs a port guard that `@orkestrel/server` already publishes. Depending on that package drags a six-package runtime closure into all 41 repositories to avoid a two-line predicate. Import `isAddressInfo` from `@orkestrel/server` directly.                                                                                                     |
| Every browser helper — `createElement` and the five `database` / `indexeddb` names                                                                  | 2 each   | Every candidate is a two-member group and one of them is a cluster. A published browser environment costs a build target, a scoped tsconfig, a barrel, and a Playwright test project. There is no `src/browser` here.                                                                                                                                                  |
| `createManualTimer`                                                                                                                                 | 2        | A cluster, and its shape is `@orkestrel/terminal`'s published `TimerHandler`. Copying it here would be a second, unversioned declaration of one package's contract. `createClock` ships because its seam is `() => number`, which nobody owns.                                                                                                                         |
| `EXTREME_NUMBERS`, `TRICKY_KEYS`, `deepFreeze`, `invokeRaw`, `createRevokedProxy`, `createThrowingGetter`, `createCyclicRecord`, `createDeepRecord` | 2–3 each | Every one sits in the guard-and-evaluator cluster. A numeric corpus or a hostile-object table is test policy — what a given suite decided to check — rather than a reusable mechanism, and covering the variants would need a mode argument.                                                                                                                           |

Smaller rejections, with their counts: `createErrorRecorder` (11, but a five-line delegate to
`createRecorder` in 10 of them), `createGate` (8, superseded by native `Promise.withResolvers`),
`TEST_SEED` (4, a bare literal), `requireElement` and `requireText` (2 each, redundant under
`noUncheckedIndexedAccess`), `uniqueName` (2, hidden module state), `flushSocket` (2, an unjustified
constant), `waitForCondition` (2, polling), the throwing variant of `captureError` (1),
`requireMatch` (1), and `waitForSettlement` (1). Every product-specific peer, protocol fixture, and
domain builder stays in the package that owns it.

## Patterns

### Record calls without a spy

A recorder is a real callback, so the code under test is driven exactly as a consumer drives it.
`clear()` truncates in place, which is what lets a captured reference stay correct.

```ts
import { createRecorder } from '@orkestrel/test'

const recorder = createRecorder<[id: string, size: number]>()
recorder.handler('a', 1)
recorder.handler('b', 2)
recorder.count // 2
recorder.calls // [['a', 1], ['b', 2]]

const captured = recorder.calls
recorder.clear()
recorder.count // 0
captured.length // 0 — the same array, truncated
recorder.handler('c', 3)
recorder.count // 1 — still usable
```

### Drive time by hand

`createClock` replaces a `() => number` seam. It does not replace the host clock, and nothing here
patches timers.

```ts
import { createClock } from '@orkestrel/test'

const clock = createClock()
clock.now() // 0
clock.advance(250)
clock.now() // 250
clock.set(1_000)
clock.now() // 1000
```

### Capture a throw, then assert on it

```ts
import { captureError } from '@orkestrel/test'

const thrown = captureError(() => JSON.parse('{'))
thrown instanceof SyntaxError // true

captureError(() => 'fine') // undefined — a completed thunk is not an error
```

### Narrow without `!` or `as`

```ts
import { requireValue } from '@orkestrel/test'

requireValue(0) // 0
requireValue('') // ''
requireValue(false) // false
requireValue(undefined) // throws Error: Value is required
requireValue(null, 'port is required') // throws Error: port is required
```

### Drain an async source

```ts
import { collect, collectStream } from '@orkestrel/test'

async function* letters() {
	yield 'a'
	yield 'b'
}

await collect(letters()) // ['a', 'b']

const stream = new ReadableStream<number>({
	start(controller) {
		controller.enqueue(1)
		controller.enqueue(2)
		controller.close()
	},
})

await collectStream(stream) // [1, 2]
```

### Copy a JSON value

```ts
import { roundTripJSON } from '@orkestrel/test'

const original = { name: 'a', tags: ['x'] }
const copy = roundTripJSON(original)
copy // { name: 'a', tags: ['x'] }
copy.tags === original.tags // false — fresh references all the way down
```

### Read a source inventory

The pairing `resolveRoot` and `readInventory` is what a guides-parity suite needs: the workspace
root from `import.meta`, then the file map. `exclude` matches whole root-relative keys.

```ts
import { resolveRoot } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'

// From tests/guides.test.ts, one directory up is the workspace root.
const root = resolveRoot(import.meta)

Object.keys(readInventory(root, ['src/core'], { extensions: ['.ts'] }))
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts', 'src/core/types.ts']

Object.keys(
	readInventory(root, ['src/core'], {
		extensions: ['.ts'],
		exclude: ['src/core/index.ts'],
	}),
)
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/types.ts']
```

### Own a temporary directory

```ts
import { createScratch } from '@orkestrel/test/server'

const scratch = createScratch({ prefix: 'guide-', files: { 'src/index.ts': 'export {}\n' } })

scratch.read('src/index.ts') // 'export {}\n'
scratch.exists('src') // true
scratch.read('missing.ts') // undefined
scratch.write('../escape.ts', '') // throws Error: Path outside scratch directory: ../escape.ts

scratch.destroy()
scratch.destroy() // no-op — destroy is idempotent
```

### Practices

- **Adopt one family at a time.** Replace a package's local recorder, then its delay, then its
  temporary directory. Nothing here re-exports another package's symbol, so each swap is
  independent.
- **Import by environment.** Reach for `@orkestrel/test` first; drop to `@orkestrel/test/server`
  only for the filesystem helpers.
- **Keep the helper out of the assertion.** `captureError` converts a throw into a value and
  `requireValue` converts absence into a throw; the test still does the asserting.
- **Let `readInventory` refuse.** A symlinked root or an escaping directory is an error, not a
  filtered result, so a misconfigured walk fails loudly instead of returning a short map.

## Tests

- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — `waitForDelay` against a
  real elapsed interval, `captureError` on both outcomes, `requireValue` across `0` / `''` / `false`
  / `null` / `undefined`, `collect` and `collectStream` on empty and ordered sources,
  `roundTripJSON` reference freshness, and `resolveRoot`.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createRecorder` call
  order and typed tuples, the `clear()` truncation ruling against a captured reference, and
  `createClock` default, accumulation, and replacement.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — `readInventory` key
  sorting, extension filtering, exact-path exclusion, empty input, symlinked root and requested
  directory refusal, descendant-link skipping, escaping-directory refusal, and host case behavior
  probed at runtime rather than assumed.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — `createScratch`
  allocation below the temporary directory, nested seeding, containment refusals including through a
  symlink, cleanup after a failed seed, and idempotent `destroy()`.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ source bijection, the
  `## Methods` ↔ interface bijection, and link resolution for this guide.

## See also

- [`README.md`](README.md) — the guides index.
- `AGENTS.md` at the workspace root — the rules this package's own source and tests follow.
