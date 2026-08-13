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

`@orkestrel/test` is the host-independent core. `@orkestrel/test/server` is the Node face — the
filesystem helpers and their containment predicates. Core touches neither `node:*` nor the DOM, so a
browser test project imports it unchanged.

## Surface

Seventeen exports: twelve values and five types, across two environments.

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
| `JSONValue`         | type      | `string \| number \| boolean \| null \| readonly JSONValue[] \| { readonly [key: string]: JSONValue }`. |

Each interface's `readonly` data members are the row above; its call-signature members are listed
under [Methods](#methods).

#### Helpers

| API             | Kind     | Signature                                                   | Summary                                                     |
| --------------- | -------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `waitForDelay`  | function | `(ms?: number) => Promise<void>`                            | Waits for a real host timer; defaults to `0`.               |
| `captureError`  | function | `(thunk: () => unknown) => unknown`                         | Runs a synchronous thunk and returns whatever it threw.     |
| `requireValue`  | function | `<T>(value: T \| null \| undefined, message?: string) => T` | Narrows away `null` and `undefined` by throwing.            |
| `collect`       | function | `<T>(source: AsyncIterable<T>) => Promise<readonly T[]>`    | Drains an async iterable into an array, in iteration order. |
| `collectStream` | function | `<T>(stream: ReadableStream<T>) => Promise<readonly T[]>`   | Drains a readable stream into an array, in read order.      |
| `roundTripJSON` | function | `<T extends JSONValue>(value: T) => T`                      | Copies a JSON value; throws on a non-finite number.         |
| `resolveRoot`   | function | `(meta: ImportMeta) => URL`                                 | The URL one directory above the calling module's own file.  |

#### Factories

| API              | Kind     | Signature                                                          | Summary                                                 |
| ---------------- | -------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `createRecorder` | function | `<TArgs extends readonly unknown[]>() => RecorderInterface<TArgs>` | A recorder whose `handler` appends each call, in order. |

### Server

Imported from `@orkestrel/test/server`.

#### Types

| Type               | Kind      | Shape                                                                                    |
| ------------------ | --------- | ---------------------------------------------------------------------------------------- |
| `ScratchInterface` | interface | `{ path }` plus `write` / `read` / `exists` / `destroy` — one owned temporary directory. |
| `ScratchOptions`   | interface | `{ prefix?: string, files?: Readonly<Record<string, string>> }`.                         |
| `InventoryOptions` | interface | `{ extensions?: readonly string[], exclude?: readonly string[] }`.                       |

#### Helpers

| API                | Kind     | Signature                                                                                                               | Summary                                                           |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `readInventory`    | function | `(root: URL \| string, directories: readonly string[], options?: InventoryOptions) => Readonly<Record<string, string>>` | File contents keyed by sorted root-relative path.                 |
| `resolveContained` | function | `(root: string, target: string) => string \| undefined`                                                                 | The absolute target below `root`, or `undefined` when it escapes. |
| `hasSymbolicLink`  | function | `(root: string, target: string) => boolean`                                                                             | Whether an existing segment from `root` to `target` is a link.    |

`resolveContained` and `hasSymbolicLink` are the containment check and the symlink walk this package
runs on itself. `readInventory` and `createScratch` both call them, so one rule has one
implementation and a refusal cannot drift between the two. They are exported for two reasons: a
declaration in a centralized file is exported, and a consumer writing its own filesystem fixture
needs exactly these two checks and would otherwise write a third copy of them.

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
   exhaustive in both directions, name and kind together. The same suite anchors three further
   comparisons to source rather than to the guide: the barrel exposes exactly what the modules
   declare, `## Methods` documents exactly the interfaces that carry call signatures, and every name
   a `ts` fence imports from this package is a real export. Deleting a documented section therefore
   fails rather than passing with nothing left to check.
   [`tests/guides.test.ts`](../tests/guides.test.ts) proves all of it, and builds its own file
   inventory with this package's `readInventory` and `resolveRoot`.
2. **`clear()` truncates.** It empties the backing array rather than replacing it, so a `calls`
   reference captured before the call reads as empty after it. Thirty of the fleet's thirty-two
   local recorders already did this, and none of the 129 `clear()` call sites captures `calls`
   first, which is what makes adoption a no-op.
3. **`captureError` converts a synchronous throw into a value.** It returns the thrown value
   exactly, including `null` and `undefined`, and it never throws for a thunk that completed. Two
   limits come with that. A thunk that throws `undefined` is indistinguishable from one that
   completed, because both return `undefined`; assert on a thrown value's identity, not on its
   absence. And an `async` thunk never throws synchronously — it returns a rejected promise — so
   `captureError` returns `undefined` and the rejection escapes unhandled. It converts; it decides
   nothing. The variant that throws when nothing was thrown is an assertion, and it is not published
   here.
4. **`requireValue` tests presence, not truth.** `0`, `''`, and `false` pass through unchanged; only
   `null` and `undefined` throw. It exists because `!` and `as` are banned, so a throwing narrowing
   helper is the sanctioned way to reach a value's non-nullable type.
5. **`roundTripJSON` throws rather than returning `null` quietly.** The `JSONValue` constraint is
   not enough on its own: `NaN`, `Infinity`, and `-Infinity` are numbers, they satisfy the
   constraint, and `JSON.stringify` turns each of them into `null`. So the helper rejects a
   non-finite number at any depth with `JSON values must contain finite numbers`, and the copy's
   type claim holds for every value it does return. One normalization remains and is not an error:
   `-0` serializes as `0`, so the copy is `0`.
6. **`readInventory` refuses links.** It throws when the root or a requested directory is a symbolic
   link, or is not a directory, or resolves outside the root. It skips a symlink met while walking
   rather than following it. Keys are root-relative, separated by `/` whatever the host separator
   is, and sorted by that key. Case is the host's decision, not this package's: whether two names
   differing only in case are one file varies by filesystem, so the suite probes the running host
   and asserts what the probe returned instead of assuming either answer.
7. **`createScratch` stays inside its own directory.** Every `write`, `read`, and `exists` path that
   escapes the allocated directory throws, including one that escapes through a symlink, and a
   failed seed removes the directory before rethrowing. `destroy()` is idempotent, and it removes
   the directory this factory allocated rather than whatever happens to sit at that path when it
   runs.
8. **Zero runtime dependencies, and no foreign type in a signature.** `dependencies` is empty and
   stays empty. No exported signature names an `@orkestrel/*` type, so no consumer can be handed a
   two-copies type failure by installing this package.

### Threat model

This package operates on directories the test itself created. It is not a sandbox against hostile
filesystem content, and rules 6 and 7 should be read that way.

The symlink refusals stop accidental escape — a stray link left in a checkout, a directory that
turns out to point somewhere else — and they catch that case reliably. They do not stop hard links.
A hard link created inside the scratch directory is an ordinary directory entry: `lstat` reports a
regular file, so `readInventory` reads the outside inode and `createScratch` writes through it.
Detecting that would need inode bookkeeping on every entry, and it would buy nothing, because
anyone able to create a hard link inside the scratch directory already writes wherever the test
process writes. So no hard-link detection is added, and the boundary is documented instead.

## Limits

This package ships what the fleet repeats, not everything the fleet has.

The membership rule is a threshold a candidate must clear to be **considered**. It is never a
guarantee of shipping. A candidate is considered when it has **three or more members that are not
all inside one dependency cluster, or five or more members regardless** — where a cluster is a set
of packages one of which runtime-depends on another. Two related packages sharing a helper is one
team's convention, not a fleet pattern. A candidate that clears the threshold can still be excluded,
and several below are.

A member is one package carrying an implementation, under whatever name that package spells it and
whether it exports the helper or declares it inside a test file. Counts are of those groups, so the
first column names the group rather than an export: **nothing in this section is importable**, and
the only names you can install are in [Surface](#surface). The widest group that did ship is
`captureError` at 13 — 12 packages export one and `csv` keeps a file-local declaration.

Everything below was measured and counted across the 41 published packages. Each row says which half
of the rule decided it: **fails** the threshold, or **clears** it and is excluded for a second,
named reason. Each is revisited when its count or its second reason changes.

| Excluded                                                                                                                             | Members  | Rule   | Why                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A recorder map over an emitter's events, with its map, event-map, subscriber, and totality types                                     | 13       | Clears | A published signature cannot import the consumer's event map, and an indexed access is not an inference site, so the map would have to be passed explicitly at 219 call sites — 18 of which read a property off a call argument and would hard-error with `as` and `!` banned. `createRecorder`, the kernel all 13 local copies are built from, ships instead. |
| An ephemeral-port HTTP fixture server — `middleware`, `router`, `server`                                                             | 3        | Clears | Two of the three are one cluster and `middleware` is independent, so the count stands. It is excluded because it needs a port guard `@orkestrel/server` already publishes, and depending on that package drags a six-package runtime closure into all 41 repositories to avoid a two-line predicate. Import `isAddressInfo` from `@orkestrel/server` directly. |
| Every browser helper — a DOM element builder, and the three helpers `database` and `indexeddb` share under five names                | 2 each   | Fails  | Each candidate has two members, and the `database` / `indexeddb` pair is one cluster. A published browser environment would also cost a build target, a scoped tsconfig, a barrel, and a Playwright test project. There is no `src/browser` here.                                                                                                              |
| A hand-driven timer — `terminal`, `toolbox`                                                                                          | 2        | Fails  | Two members, and `toolbox` runtime-depends on `terminal`, so they are one cluster twice over. Its shape is also `@orkestrel/terminal`'s published `TimerHandler`, which a copy here would redeclare unversioned.                                                                                                                                               |
| A hand-driven clock — `mcp`, `middleware`                                                                                            | 2        | Fails  | Two members. Two is below the threshold under either half of the rule, and the two packages are independent, so no reading of it admits them. This shipped in the first draft as `createClock` and `ClockInterface` on taste alone, and is struck: a rule taste can override is not a rule. Both packages keep their local clocks until a third appears.       |
| Numeric corpora, hostile-key tables, deep-freeze, raw invocation, revoked proxies, throwing getters, cyclic and deep record builders | 2–3 each | Fails  | Every group sits inside the guard-and-evaluator cluster, so no group reaches three independent members. A numeric corpus or a hostile-object table is test policy — what a given suite decided to check — rather than a reusable mechanism, and covering the variants would need a mode argument.                                                              |

Three smaller candidates clear the threshold and are excluded anyway. An error-recording wrapper has
11 members, and in 10 of them it is a five-line delegate to the recorder that already ships. A
promise gate has 8 members across two names, and native `Promise.withResolvers` supersedes all of
them. A shared random seed has 4 members and is a bare literal.

The rest fail the threshold on count: element and text requiring (2 each, and redundant under
`noUncheckedIndexedAccess`), unique naming (2, hidden module state), socket flushing (2, an
unjustified constant), condition polling (2, and polling is banned architecture), the throwing
variant of `captureError` (1), pattern requiring (1), and settlement waiting (1). Every
product-specific peer, protocol fixture, and domain builder stays in the package that owns it.

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

### Capture a throw, then assert on it

Assert on what came back, not on the fact that something came back. `undefined` is both "nothing was
thrown" and "`undefined` was thrown", and the helper cannot tell you which.

```ts
import { captureError } from '@orkestrel/test'

const thrown = captureError(() => JSON.parse('{'))
thrown instanceof SyntaxError // true

captureError(() => 'fine') // undefined — the thunk completed
captureError(() => {
	throw undefined
}) // undefined — the same result, from a thunk that threw

// An async thunk returns a rejected promise instead of throwing, so nothing is captured
// and the rejection escapes. Await the call and catch it yourself.
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
import { captureError, roundTripJSON } from '@orkestrel/test'

const original = { name: 'a', tags: ['x'] }
const copy = roundTripJSON(original)
copy // { name: 'a', tags: ['x'] }
copy.tags === original.tags // false — fresh references all the way down

roundTripJSON(-0) // 0 — JSON has no negative zero
captureError(() => roundTripJSON({ a: [{ b: NaN }] }))
// Error: JSON values must contain finite numbers — at any depth, rather than a silent null
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

### Refuse an escaping path in your own fixture

`readInventory` and `createScratch` refuse an escape with these two predicates. Reach for the same
pair when a fixture of your own walks a directory the test created.

```ts
import { createScratch, hasSymbolicLink, resolveContained } from '@orkestrel/test/server'

const scratch = createScratch({ files: { 'src/index.ts': 'export {}\n' } })
const root = scratch.path

resolveContained(root, 'src/index.ts') // `${root}/src/index.ts`
resolveContained(root, '../escape.ts') // undefined — lexically outside
resolveContained(root, '/etc/passwd') // undefined — an absolute target never resolves

// Lexical containment is not enough: a contained path can still leave through a link.
hasSymbolicLink(root, `${root}/src/index.ts`) // false — every segment is a real directory or file
hasSymbolicLink(root, `${root}/link/x.ts`) // true, once `link` is a symlink — refuse before reading
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
  real elapsed interval, `captureError` on both outcomes and on the exact thrown value,
  `requireValue` across `0` / `''` / `false` / `null` / `undefined`, `collect` and `collectStream` on
  empty and ordered sources, `roundTripJSON` reference freshness and its non-finite refusal at every
  depth, and `resolveRoot`.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createRecorder` call
  order and typed tuples, and the `clear()` truncation ruling against a captured reference.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — `resolveContained` on
  lexical and physical escapes, `hasSymbolicLink` on linked, regular, and missing segments, and
  `readInventory` key sorting, extension filtering, exact-path exclusion, empty input with root
  validation, a root-level `__proto__` file, symlinked root and requested directory refusal,
  descendant-link skipping, escaping-directory refusal, and host case behavior probed at runtime
  rather than assumed.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — `createScratch`
  allocation below the temporary directory, nested seeding, containment refusals including through a
  symlink, cleanup after a failed seed, idempotent `destroy()`, and a replacement directory left
  alone at the allocated path.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ source bijection, the
  barrel ↔ source bijection, the behavioral-interface ↔ `## Methods` bijection and each group's
  members, the fence imports, and link resolution for this guide.

## See also

- [`README.md`](README.md) — the guides index.
- `AGENTS.md` at the workspace root — the rules this package's own source and tests follow.
