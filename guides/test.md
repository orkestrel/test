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
filesystem helpers and their containment check. Core touches neither `node:*` nor the DOM, so a
browser test project imports it unchanged.

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
| `JSONValue`         | type      | `string \| number \| boolean \| null \| readonly JSONValue[] \| { readonly [key: string]: JSONValue }`. |
| `JSONSafe`          | type      | `JSONSafe<T>` — `T` with each member JSON preserves kept, and each member it drops mapped to `never`.   |

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
| `roundTripJSON` | function | `<T>(value: T & JSONSafe<T>) => T`                          | Copies a JSON value; throws on a non-finite number.         |
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

| API                | Kind     | Signature                                                                                                               | Summary                                                              |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `readInventory`    | function | `(root: URL \| string, directories: readonly string[], options?: InventoryOptions) => Readonly<Record<string, string>>` | File contents keyed by root-relative path, inserted in sorted order. |
| `resolveContained` | function | `(root: string, target: string) => string \| undefined`                                                                 | The absolute target below `root`, or `undefined` when it escapes.    |

`resolveContained` is the one lexical containment check, and `readInventory` and `createScratch`
both call it. It resolves the target against the root — relative or absolute — and returns
`undefined` when the result is not below it. An absolute target inside the root resolves, so a
caller hands it the path it already has rather than making it root-relative first. It is exported
because a consumer writing its own filesystem fixture needs the same check and would otherwise write
another copy of it.

`@orkestrel/scaffold` publishes `resolveContainedPath`, one word away, and the two are not the same
predicate. This one is lexical only and dependency-free. That one is lexical plus physical — it also
refuses a link that leaves the root and a dangling link whose raw target contains a `..` segment —
and it lives in a build tool. A test helper with zero runtime dependencies does not take a runtime
dependency on the scaffolding tool to obtain a path predicate. If that difference ever stops holding,
delete `resolveContained` and import `resolveContainedPath` from the `@orkestrel/scaffold` every
package already has, rather than adding a third variant.

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

| Method    | Returns               | Behavior                                                                                                                                                                                                                                                                                                                                                          |
| --------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write`   | `void`                | Writes a file at a path lexically contained by the directory, creating missing parents. Writing follows a symbolic link, so a link inside the directory writes through it to wherever it points, which may be outside. Throws on an escaping path, and on a root that is missing, a link, or not a directory.                                                     |
| `read`    | `string \| undefined` | Reads a file, or `undefined` when no file can be read, including through a link whose target is missing. Throws `Scratch path is a directory: <target>` on a directory, and throws on an escaping path and on a root that is a link or not a directory. Reading follows links, so a link the host cannot resolve, such as a cycle, surfaces the host's own error. |
| `exists`  | `boolean`             | Whether the entry at a contained path is present, including a link whose target is missing. Throws on an escaping path, and on a root that is a link or not a directory.                                                                                                                                                                                          |
| `destroy` | `void`                | Removes the directory this call allocated, and only that. Idempotent.                                                                                                                                                                                                                                                                                             |

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
5. **`roundTripJSON` bounds its parameter by `JSONSafe<T>`, and throws rather than returning `null`
   quietly.** The parameter is `T & JSONSafe<T>` rather than `T extends JSONValue`, because a
   `JSONValue` constraint rejects every `interface`: TypeScript grants an implicit index signature
   to a type alias and never to an interface, and interfaces are what this fleet's public types are.
   The projection accepts an interface-typed value, keeps `T` as the return type, and refuses a
   `Date`, a `Map`, or any method-bearing type at the member that carries it. Two consequences come
   with the wider bound. `undefined` satisfies it, so a member typed `undefined` is accepted and
   dropped by serialization — `{ a: undefined }` copies to `{}`, which the copy's type still
   describes — and a top-level `undefined` is accepted and fails inside `JSON.parse` with
   `SyntaxError: "undefined" is not valid JSON` rather than with this helper's own message. The
   bound is also not enough on its own: `NaN`, `Infinity`, and `-Infinity` are numbers, they satisfy
   it, and `JSON.stringify` turns each of them into `null`. So the helper rejects a
   non-finite number at any depth with `JSON values must contain finite numbers`, and the copy's
   type claim holds for every value it does return. The replacer alone would not close it: a
   `JSON.rawJSON` value carries text `JSON.stringify` emits without inspecting, so
   `JSON.rawJSON('1e400')` passes the replacer untouched and parses back as `Infinity`. The helper
   therefore checks the parsed graph as well, and both doors report the same message. One
   normalization remains and is not an error: `-0` serializes as `0`, so the copy is `0`.
6. **`readInventory` refuses links.** It throws when the root or a requested directory is a symbolic
   link, or is not a directory, or resolves outside the root. It skips a symlink met while walking
   rather than following it. A requested directory may be written relative to the root or as an
   absolute path inside it, and one that escapes is refused either way. Keys are root-relative and
   separated by `/` whatever the host separator is. The suite runs on POSIX, where `/` is already
   the separator, so it proves the key shape and not the conversion. The map is built by inserting
   the keys in sorted order. Read back, non-integer keys hold that order. Integer-like keys do not,
   because a plain object enumerates them numerically first: four files named `0`, `2`, `10`, and
   `a.txt` insert as `0`, `10`, `2`, `a.txt` and enumerate as `0`, `2`, `10`, `a.txt`. Returning a
   `ReadonlyMap` would keep the order and break the structural match with `@orkestrel/guide`'s
   `SourceOptions.files` that the whole helper is shaped for, so the guarantee narrows instead. Case
   is the host's decision, not this package's: whether two names differing only in case are one file
   varies by filesystem, so the suite probes the running host and asserts what the probe returned
   instead of assuming either answer.
7. **`createScratch` refuses a lexical escape, not a symbolic link.** It allocates with
   `mkdtempSync`, which creates the directory at POSIX mode `0700`. The suite asserts that mode
   unguarded, so it is proven on POSIX and unproven on a host that emulates permission bits. Every
   `write`, `read`, and `exists` path that lexically escapes the allocated directory throws, and a
   failed seed removes the directory before rethrowing. It does not walk the path's segments for
   symbolic links: that is sandbox behavior and this is not a sandbox, so `write` and `read` follow
   a link inside the allocation and can reach outside it. The [threat model](#threat-model) says who
   creates such a link. `destroy()` is idempotent, and it removes only the directory this call
   allocated. It compares the entry at the allocated path against the allocation's device, inode,
   and birth time, so a replacement directory left there is not removed, and an allocation moved
   elsewhere is not removed at all.
8. **Zero runtime dependencies, and no foreign type in a signature.** `dependencies` is empty and
   stays empty. No exported signature names an `@orkestrel/*` type, so no consumer can be handed a
   two-copies type failure by installing this package.

### Threat model

The two filesystem helpers make different promises, because they work on different directories.
Read rule 7 against the `createScratch` paragraphs below and rule 6 against the `readInventory` one.

`createScratch` allocates its own directory with `mkdtempSync` at POSIX mode `0700`, and the suite
asserts that mode on POSIX, the only host CI runs. The mode keeps another uid out. It does not keep
out a sibling test worker or the code under test, because both run as the same uid, and they are the
population that would create a link here. Its containment check is lexical: it refuses a relative
path that escapes the allocated directory, which is the accident that actually happens — a test
writing `../foo`. It does not walk the path's segments for symbolic links, because per-segment
walking is sandbox behavior and this is not a sandbox.

So a link inside the allocation was created by the test process or by the code the test drives, and
handing `scratch.path` to the code under test is the ordinary use of this helper. `write` and `read`
follow such a link, so either one can reach outside the allocation through it. This helper does not
defend against that.

`readInventory` walks a directory the caller supplies, usually a real checkout the test did not
create, so it does refuse links. It keeps three separate refusals with three outcomes: it throws on
a symlinked root, throws on a symlinked requested directory, and skips a symlink met while walking.
They are three decisions rather than one rule, which is why they are three inline checks and not a
shared predicate.

Neither helper stops hard links. A hard link is an ordinary directory entry: `lstat` reports a
regular file, so `readInventory` reads the outside inode and `createScratch` writes through it.
Detecting that would need inode bookkeeping on every entry, and it would buy nothing, because
anyone able to create a hard link where the test process writes already writes there. So no
hard-link detection is added, and the boundary is documented instead.

## Limits

This package ships what the fleet repeats, not everything the fleet has.

The membership rule is a threshold a candidate must clear to be **considered**. It is never a
guarantee of shipping. A candidate is considered when it has **three or more members that are not
all inside one dependency cluster, or five or more members regardless** — where a cluster is a set
of packages one of which runtime-depends on another. Two related packages sharing a helper is one
team's convention, not a fleet pattern. A candidate that clears the threshold can still be excluded,
and several below are. The threshold is therefore necessary and not sufficient: a candidate that
fails it is excluded, and a candidate that clears it either ships or appears below with the second
reason that excluded it.

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

// An interface, not a type alias: the bound is a projection rather than an index signature, so an
// interface-typed value copies and keeps its own type.
interface Snapshot {
	readonly name: string
	readonly tags: readonly string[]
}

const original: Snapshot = { name: 'a', tags: ['x'] }
const copy: Snapshot = roundTripJSON(original)
copy // { name: 'a', tags: ['x'] }
copy.tags === original.tags // false — fresh references all the way down

// roundTripJSON(new Date()) — does not compile; a member JSON cannot carry is typed `never`.

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
scratch.read('src') // throws Error: Scratch path is a directory: src
scratch.read('missing.ts') // undefined
scratch.write('../escape.ts', '') // throws Error: Path outside scratch directory: ../escape.ts

scratch.destroy()
scratch.destroy() // no-op — destroy is idempotent
```

### Refuse an escaping path in your own fixture

`readInventory` and `createScratch` refuse an escape with this predicate. Reach for it when a
fixture of your own resolves a caller-supplied path below a root.

```ts
import { createScratch, resolveContained } from '@orkestrel/test/server'

const scratch = createScratch({ files: { 'src/index.ts': 'export {}\n' } })
const root = scratch.path

resolveContained(root, 'src/index.ts') // `${root}/src/index.ts`
resolveContained(root, `${root}/src/index.ts`) // `${root}/src/index.ts` — absolute and inside
resolveContained(root, '../escape.ts') // undefined — lexically outside
resolveContained(root, `${root}/../escape.ts`) // undefined — absolute and outside
resolveContained(root, '/etc/passwd') // undefined — absolute and outside

scratch.destroy()
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
  `requireValue` across `0` / `''` / `false` / `null` / `undefined` and its default message,
  `collect` and `collectStream` on empty and ordered sources plus the reader lock released after
  collection, `roundTripJSON` reference freshness, its copies of a flat and a nested interface-typed
  value with fresh references, its non-finite refusal at every depth, inside an interface-typed
  value, and through `JSON.rawJSON`, its `-0` normalization, and a 300,000-element array and object
  copied without exceeding the host's argument limit, and `resolveRoot`.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createRecorder` call
  order and typed tuples, and the `clear()` truncation ruling against a captured reference.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — `resolveContained` on
  relative and absolute contained targets and on relative and absolute escapes, and `readInventory`
  key sorting, extension filtering, exact-path exclusion and directory exclusion that prunes the
  subtree, relative and absolute contained directories, empty input with root validation, a
  root-level `__proto__` file, symlinked root refusal for a path and for a trailing-slash file URL,
  symlinked requested-directory refusal, a non-directory root and a requested file refused,
  descendant-link skipping, escaping-directory refusal, and host case behavior probed at runtime
  rather than assumed.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — `createScratch`
  allocation below the temporary directory at POSIX mode `0700`, nested seeding, the prefix guard,
  lexical containment refusals, a symbolic-link segment left unwalked, a dangling link that `exists`
  reports and `read` returns `undefined` for, the directory-read refusal, cleanup after a failed
  seed, refusal after destruction, a symbolic-link root and a file root, idempotent `destroy()`, and
  both a replacement directory and a moved allocation left alone.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ source bijection, the
  barrel ↔ source bijection, the behavioral-interface ↔ `## Methods` bijection and each group's
  members, the fence imports, and link resolution for this guide.

## See also

- [`README.md`](README.md) — the guides index.
- `AGENTS.md` at the workspace root — the rules this package's own source and tests follow.
