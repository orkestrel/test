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
filesystem helpers and the pure leaves they are built from. Core touches neither `node:*` nor the
DOM, so a browser test project imports it unchanged.

## Surface

Twenty exports: thirteen values and seven types, across two environments.

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

| Type                | Kind      | Shape                                                                                                                                                                                                       |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecorderInterface` | interface | `{ calls, count, handler }` plus `clear` — the recorded calls of one callback.                                                                                                                              |
| `JSONValue`         | type      | `string \| number \| boolean \| null \| readonly JSONValue[] \| { readonly [key: string]: JSONValue }`.                                                                                                     |
| `JSONSafe`          | type      | `JSONSafe<T>` — `T` with each member JSON preserves kept, and each member it drops, including one typed `undefined`, mapped to `never`. `unknown` passes through, so `Record<string, unknown>` is accepted. |

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

| Type               | Kind      | Shape                                                                                                     |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------- |
| `ScratchInterface` | interface | `{ path }` plus `write` / `read` / `has` / `names` / `ensure` / `link` / `destroy` — one owned directory. |
| `ScratchIdentity`  | interface | `{ device, inode, birth }` — the three fields that together name one allocation on its host.              |
| `ScratchOptions`   | interface | `{ parent?: string, prefix?: string, files?: Readonly<Record<string, string>> }`.                         |
| `InventoryOptions` | interface | `{ extensions?: readonly string[], exclude?: readonly string[] }`.                                        |

#### Helpers

| API                | Kind     | Signature                                                                                                           | Summary                                                                          |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `readInventory`    | function | `(root: URL \| string, targets: readonly string[], options?: InventoryOptions) => Readonly<Record<string, string>>` | Named files and walked directories, keyed by root-relative path in sorted order. |
| `resolveContained` | function | `(root: string, target: string) => string \| undefined`                                                             | The absolute target below `root`, or `undefined` when it escapes.                |
| `isExcluded`       | function | `(key: string, exclusions: readonly string[]) => boolean`                                                           | Whether an exclusion names the key or one of its ancestors.                      |
| `matchesIdentity`  | function | `(current: ScratchIdentity, allocation: ScratchIdentity) => boolean`                                                | Whether two identities name the same allocation.                                 |

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

`isExcluded` is the exclusion rule itself, and `readInventory` applies it to a named target and a
walked entry alike. An exclusion matches whole segments of a root-relative key, so it drops the key
it names and every key below it, and it leaves a sibling whose name merely starts the same way. It
takes exclusions already normalized: `readInventory` normalizes the spellings its `exclude` option
accepts before calling it, so a caller applying the rule to its own keys normalizes its own list. It
is exported because a consumer walking its own tree wants that rule rather than a second reading of
what `exclude` means.

`matchesIdentity` is the comparison `destroy()` makes before it removes anything: whether the
identity read from the allocated path now is the identity recorded when the directory was allocated.
All three fields are compared because none of them alone identifies an allocation. A device is
shared by every directory on one filesystem, an index node is reused once its directory is removed,
and a creation time repeats within the host's timestamp resolution. It is exported so a fixture that
manages its own directory can make the same check rather than trusting a path.

#### Factories

| API             | Kind     | Signature                                        | Summary                                                            |
| --------------- | -------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `createScratch` | function | `(options?: ScratchOptions) => ScratchInterface` | Allocates a directory below `parent` the caller owns and destroys. |

A refused `ScratchOptions` key leaves nothing behind, by two different mechanisms. `parent` and
`prefix` are checked before `mkdtempSync` runs, so a refused value allocates nothing. `files` is
seeded after the directory exists, so a refused key removes the directory that was just made and
rethrows.

`parent` is the existing directory the allocation is created in, and defaults to the host temporary
directory; allocation throws when it is missing, is a symbolic link, or is not a directory. `prefix`
starts the generated directory name, and defaults to `orkestrel-test-`; allocation throws when it
contains `/` or `\`, which is what stops a prefix steering the allocation out of its parent. Nothing
else is refused: a fragment carrying no separator is one path segment, so `release-0..2-` allocates.
`files` seeds files on allocation, keyed by path below the scratch directory; allocation removes the
directory it just made and rethrows when a key escapes or the host refuses a write.

## Methods

The call-signature members of each behavioral interface. Their `readonly` data members stay in the
[Surface](#surface) rows above.

#### `RecorderInterface`

| Method  | Returns | Behavior                                                                     |
| ------- | ------- | ---------------------------------------------------------------------------- |
| `clear` | `void`  | Truncates the recorded calls in place; the recorder stays usable afterwards. |

#### `ScratchInterface`

| Method    | Returns               | Behavior                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write`   | `void`                | Writes a file at a path lexically contained by the directory, creating missing parents. Throws on an escaping path, and on a root that is missing, a link, or not a directory.                                                                                                                                                                                                                     |
| `read`    | `string \| undefined` | Reads a file, or `undefined` when no file can be read, including through a link whose target is missing and after the allocation is gone. Throws `Scratch path is a directory: <target>` on a directory, and throws on an escaping path and on a root that is a link or not a directory. Reading follows links, so a link the host cannot resolve, such as a cycle, surfaces the host's own error. |
| `has`     | `boolean`             | Whether the entry at a contained path is present, without following its final link, so a link whose target is missing still reports `true`. `false` once the allocated directory itself is gone. Throws on an escaping path, and on a root that is a link or not a directory.                                                                                                                      |
| `names`   | `readonly string[]`   | The entry names directly inside a lexically contained directory, sorted, without their parent paths — the allocated directory itself when the target is omitted. Throws on an escaping path, on a target that is missing or is not a directory, and on a root that is missing, a link, or not a directory.                                                                                         |
| `ensure`  | `string`              | Creates a directory at a lexically contained path and every missing parent, and returns that lexical path. It is the one member that produces an empty directory, because `write` always creates a file. Idempotent on a directory that already exists. Throws when the target exists and is not a directory, on an escaping path, and on a root that is missing, a link, or not a directory.      |
| `link`    | `void`                | Creates a symbolic link at a contained path, creating its missing parents. The source is link text rather than a checked path, so it may point outside the directory. Throws on an escaping path, on a root that is missing, a link, or not a directory, and when the host refuses the link — `EEXIST` when something already occupies the path.                                                   |
| `destroy` | `void`                | Removes the directory this call allocated, and only that: it removes the entry at the allocated path while `matchesIdentity` holds against the allocation, and removes nothing when it does not. Idempotent.                                                                                                                                                                                       |

An empty target names the allocation root. `ensure('')` returns the root path, `has('')` reports
`true`, and `names('')` lists the root. `write('', …)` surfaces the host's `EISDIR` and `link('', …)`
its `EEXIST`, because the root is a directory that already exists. The host code is the accurate
answer there, so this package adds no refusal of its own.

### Traversal

Every member that takes a target resolves that target's **intermediate** segments through a symbolic
link inside the allocation and acts at the destination. `write`, `read`, `has`, `names`, `ensure`,
and `link` all do this, so a lexically contained path can read, list, create, and write outside the
allocation. That is the contract rather than a hole in it: containment here is lexical, `link` is
the member that creates such a link, and the [threat model](#threat-model) names who else creates
one.

The **final** segment is where two members differ. `has` reads it with `lstat` rather than following
it, so `has('gate')` reports the link itself and stays `true` after whatever `gate` pointed at is
removed. `link` acts at the final segment rather than through it, so a second `link('gate', …)`
surfaces the host's `EEXIST` instead of creating a link inside the destination. `write`, `read`, and
`names` act at what a final-segment link points at.

`ensure` returns the lexical path it was given rather than the destination, so `ensure('gate/made')`
returns `<allocation>/gate/made` while the directory is made wherever `gate` points, and
`ensure('gate')` returns `<allocation>/gate` and leaves the directory it points at alone.

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
   `Date`, a `Map`, or any method-bearing type at the member that carries it. A member typed
   `undefined` meets `never` the same way, because serialization drops it from an object and
   rewrites it to `null` in an array, so the copy's type would claim a member the copy does not
   carry; `{ a: undefined }` and a top-level `undefined` are both refused at the call. One member
   type does pass through: `unknown`, so `Record<string, unknown>` is accepted and what its values
   hold is a runtime question rather than a typed one. The bound is not enough on its own either:
   `NaN`, `Infinity`, and `-Infinity` are numbers, they satisfy it, and `JSON.stringify` turns each
   of them into `null`. So the helper rejects a non-finite number at any depth with
   `JSON values must contain finite numbers`, and the copy's type claim holds for every value it
   does return. The replacer alone would not close it: a
   `JSON.rawJSON` value carries text `JSON.stringify` emits without inspecting, so
   `JSON.rawJSON('1e400')` passes the replacer untouched and parses back as `Infinity`. The helper
   therefore checks the parsed graph as well, and both doors report the same message. One
   normalization remains and is not an error: `-0` serializes as `0`, so the copy is `0`.
6. **`readInventory` refuses links.** A target is a file or a directory. A named file is read and
   keyed whatever `extensions` says, which is what lets one call take a package's root files and its
   source tree together; a named directory is walked under the filter. It throws when the root or a
   named target is a symbolic link, when the root is not a directory, when a target is neither a file
   nor a directory, or when a target resolves outside the root. A missing target surfaces the host's
   own `ENOENT` rather than a message from this package. It skips a symlink met while walking rather
   than following it. A target may be written relative to the root or as an absolute path inside it,
   and one that escapes is refused either way. An exclusion applies to a named target as well as a
   walked entry, so exclusion beats naming:
   `readInventory(root, ['src/core/index.ts'], { exclude: ['src/core'] })` returns `{}`. A
   `tsconfig` reader expects the more specific entry to win, the way a `files` entry survives
   `exclude`; here the more specific entry is the one that disappears. Express an exception with a
   second call that names the kept file and passes no exclusion, and merge the two maps. An
   exclusion is normalized before the rule applies: a leading `./` and a trailing `/` are stripped,
   and `''` and `'.'` both name the root, so either drops every key. Keys are root-relative and
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
   `mkdtempSync` below `parent`, which creates the directory at POSIX mode `0700`. The suite asserts
   that mode unguarded, so it is proven on POSIX and unproven on a host that emulates permission
   bits. Every member that takes a target — `write`, `read`, `has`, `names`, `ensure`, and `link` —
   throws when that target lexically escapes the allocated directory, and a failed seed removes the
   directory before rethrowing. `link` checks its target and not its source, so a contained link may
   point anywhere. It does not walk the path's segments for symbolic links: that is sandbox behavior
   and this is not a sandbox. So a lexically contained path can act outside the allocation;
   [Traversal](#traversal) states what each member does with a link it meets, and the
   [threat model](#threat-model) says who creates one.

   `names` sorts, and the suite discriminates a dropped `.sort()`. Two filenames written from raw
   bytes give `readdirSync` the reverse of sorted order: `0x80` is an invalid UTF-8 lead byte, so
   that name reaches JavaScript as `U+FFFD` and sorts after `é`, while on disk `0x80` sorts before
   `é`'s leading `0xc3`. The suite asserts the host's order, the sorted order, and that the two
   differ, so it fails rather than going quiet if that population ever stops discriminating.

   `destroy()` is idempotent, and identity is what makes it safe rather than location: it removes
   the entry at the allocated path only while `matchesIdentity` holds against the allocation. A
   replacement directory left at that path is not removed, and an allocation moved elsewhere is not
   removed at all. That comparison never consulted the host temporary directory, so it holds
   unchanged wherever `parent` puts the allocation. Two limits sit beside the `0700` one. The check
   reads the entry and then removes the path as two steps, so an allocation swapped between them is
   removed anyway; whoever swaps it runs as the same uid, which is the population the threat model
   already declines to defend against. And birth time is the host's to supply. This host supplies a
   real one — the allocation's `birthtimeMs` does not move when files are written into it, while its
   `ctimeMs` does — so `destroy()` is sound here. Where a host has none, libuv reports `ctime` in its
   place, the first seeded write moves it, and `destroy()` takes its early return. It returns `void`,
   so that refusal is indistinguishable from success and the allocation leaks silently.

8. **A destroyed allocation answers presence and refuses action.** `read` returns `undefined` and
   `has` returns `false`; `write`, `names`, `ensure`, and `link` throw
   `Scratch directory does not exist`. The split follows the return type: a member whose return type
   carries absence answers with it, and a member whose return type does not, refuses. `names` asks a
   question and changes nothing, and it refuses anyway, because `readonly string[]` has no value
   meaning gone. `write`, `ensure`, and `link` are why the refusal is written out rather than left to
   the host: each calls `mkdirSync` with `recursive`, which recreates every missing parent, so
   without the check any of the three would rebuild the allocation root and leave a destroyed
   fixture looking alive.
9. **Zero runtime dependencies, and no foreign type in a signature.** `dependencies` is empty and
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
handing `scratch.path` to the code under test is the ordinary use of this helper. `link` is this
package's own entry in that population: it creates a symbolic link on request, it refuses only an
escaping target, and its source may name anything. [Traversal](#traversal) states what each member
does with a link it meets, and a contained path reaching outside the allocation through one is the
result. This helper does not defend against that.

`parent` adds one limit, and it is visibility. An allocation under the host temporary directory is
seen by nothing in the repository. An allocation under a path inside a package tree is seen by
everything that walks that tree while it exists — `tsc`, the formatter, the linter, the policy
sweep, and the test runner's own globs. Set `parent` to a path those tools already ignore, or leave
it unset and take the host temporary directory. `destroy()` is unaffected either way, because it
matches on identity rather than on where the allocation sits.

`readInventory` walks a directory the caller supplies, usually a real checkout the test did not
create, so it does refuse links. It keeps three separate refusals with three outcomes: it throws on
a symlinked root, throws on a symlinked named target, and skips a symlink met while walking.
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

| Excluded                                                                                                                             | Members  | Rule   | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A recorder map over an emitter's events, with its map, event-map, subscriber, and totality types                                     | 13       | Clears | A published signature cannot import the consumer's event map, and an indexed access is not an inference site, so the map would have to be passed explicitly at 219 call sites — 18 of which read a property off a call argument and would hard-error with `as` and `!` banned. `createRecorder`, the kernel all 13 local copies are built from, ships instead.                                                                                                                                                                                                                                                                                                                  |
| An ephemeral-port HTTP fixture server — `middleware`, `router`, `server`                                                             | 3        | Clears | Two of the three are one cluster and `middleware` is independent, so the count stands. It is excluded because it needs a port guard `@orkestrel/server` already publishes, and depending on that package drags a six-package runtime closure into all 41 repositories to avoid a two-line predicate. Import `isAddressInfo` from `@orkestrel/server` directly.                                                                                                                                                                                                                                                                                                                  |
| Every browser helper — a DOM element builder, and the three helpers `database` and `indexeddb` share under five names                | 2 each   | Fails  | Each candidate has two members, and the `database` / `indexeddb` pair is one cluster. A published browser environment would also cost a build target, a scoped tsconfig, a barrel, and a Playwright test project. There is no `src/browser` here.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A hand-driven timer — `terminal`, `toolbox`                                                                                          | 2        | Fails  | Two members, and `toolbox` runtime-depends on `terminal`, so they are one cluster twice over. Its shape is also `@orkestrel/terminal`'s published `TimerHandler`, which a copy here would redeclare unversioned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A hand-driven clock — `mcp`, `middleware`                                                                                            | 2        | Fails  | Two members. Two is below the threshold under either half of the rule, and the two packages are independent, so no reading of it admits them. This shipped in the first draft as `createClock` and `ClockInterface` on taste alone, and is struck: a rule taste can override is not a rule. Both packages keep their local clocks until a third appears.                                                                                                                                                                                                                                                                                                                        |
| Numeric corpora, hostile-key tables, deep-freeze, raw invocation, revoked proxies, throwing getters, cyclic and deep record builders | 2–3 each | Fails  | Every group sits inside the guard-and-evaluator cluster, so no group reaches three independent members. A numeric corpus or a hostile-object table is test policy — what a given suite decided to check — rather than a reusable mechanism, and covering the variants would need a mode argument.                                                                                                                                                                                                                                                                                                                                                                               |
| Removing one contained entry from a scratch directory without destroying it — `scaffold`, `database`                                 | 2        | Fails  | Two members, `scaffold` at 23 sites and `database` at 8, and the two are independent, so the count is two groups — below three and below five. `sqlite` is not a third member: its one removal deletes a lone `.db` file with no enclosing directory, so that file is the whole fixture and removing it is `destroy` rather than this. `scaffold` has already promoted it to a `remove(relative)` method on the same interface as its `destroy()`, so the row is well-formed and fails on count alone. The cost is real: a migrating `scaffold` or `database` test reaches for `node:fs` beside the scratch, and mixing the two is the failure mode this package exists to end. |

The last row is a candidate for `ScratchInterface` rather than a member of it: `remove` has 2
members and is not published. The same rule ruled three names that are published, and each is
checkable against the same numbers. `ensure` has 5 members — `scaffold`, `database`, `sea`,
`middleware`, `browser` — so it clears on count alone. `names` has 4: `middleware` at 14 sites,
`scaffold` 11, `database` 5, `sea` 2. Four is below five, so `names` clears the three-member half
instead, on `middleware`, `scaffold`, and `sea` being mutually independent. `link` has 3, the same
three packages, and clears that half the same way. `has` renames the `exists` this interface already
carried, so it was never a candidate. `path`, `write`, `read`, and `destroy` are what an owned
directory is rather than candidates measured against the rule, so they carry no count.

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
root from `import.meta`, then the file map. Rule 6 states what an exclusion matches; the last call
below is the part that surprises people.

```ts
import { resolveRoot } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'

// From tests/guides.test.ts, one directory up is the workspace root.
const root = resolveRoot(import.meta)

Object.keys(readInventory(root, ['src/core'], { extensions: ['.ts'] }))
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts', 'src/core/types.ts']

// A named file is included whatever `extensions` says, so one call takes the root files a suite
// needs and the source tree it walks.
Object.keys(readInventory(root, ['package.json', 'src/core'], { extensions: ['.ts'] }))
// ['package.json', 'src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts',
//  'src/core/types.ts']

Object.keys(
	readInventory(root, ['src/core'], {
		extensions: ['.ts'],
		exclude: ['src/core/index.ts'],
	}),
)
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/types.ts']

// A directory key takes every key below it.
Object.keys(readInventory(root, ['src'], { extensions: ['.ts'], exclude: ['src/server'] }))
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts', 'src/core/types.ts']

// An exclusion also applies to a target you name, so naming one file below an excluded directory
// does not reinstate it.
readInventory(root, ['src/core/index.ts'], { extensions: ['.ts'], exclude: ['src/core'] })
// {} — take the exception in a second call, and merge the two maps
```

### Own a temporary directory

```ts
import { createScratch } from '@orkestrel/test/server'

const scratch = createScratch({ prefix: 'guide-', files: { 'src/index.ts': 'export {}\n' } })

scratch.read('src/index.ts') // 'export {}\n'
scratch.has('src') // true
scratch.read('src') // throws Error: Scratch path is a directory: src
scratch.read('missing.ts') // undefined
scratch.write('../escape.ts', '') // throws Error: Path outside scratch directory: ../escape.ts

// `ensure` is how you get an empty directory, because every `write` creates a file.
scratch.ensure('empty')
scratch.names() // ['empty', 'src']
scratch.names('empty') // []

// `parent` puts the allocation somewhere other than the host temporary directory.
const child = createScratch({ parent: scratch.path, prefix: 'child-' })
scratch.names().length // 3 — 'empty', 'src', and the child allocation
child.destroy()
scratch.names().length // 2 — the child removed itself and nothing else

// `link` creates the symbolic link the threat model names, and `read` follows it.
scratch.link('alias.ts', `${scratch.path}/src/index.ts`)
scratch.read('alias.ts') // 'export {}\n'

// A link pointing out of the allocation is resolved through, so a contained path acts outside it.
const outside = createScratch({ prefix: 'outside-' })
scratch.link('gate', outside.path)
scratch.ensure('gate/made') // `${scratch.path}/gate/made` — the lexical path, not the destination
outside.names() // ['made'] — the directory was made under `outside.path`
scratch.names('gate') // ['made'] — the same entries, listed through the link

// `link` acts at the final segment rather than through it, so `gate` is occupied.
scratch.link('gate', outside.path) // throws Error: EEXIST: file already exists

// `has` reads the final segment without following it, and `read` follows it.
scratch.link('dangling', 'missing.ts')
scratch.has('dangling') // true — the link is there
scratch.read('dangling') // undefined — what it points at is not

scratch.destroy()
scratch.destroy() // no-op — destroy is idempotent
outside.has('made') // true — destroy unlinks `gate` and leaves what it pointed at
outside.destroy()
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
- **Let `readInventory` refuse.** A symlinked root or an escaping target is an error, not a
  filtered result, so a misconfigured walk fails loudly instead of returning a short map.
- **Reach for `parent` only when the allocation must be somewhere named.** The default keeps it out
  of the repository, and a path inside a package tree is walked by every tool that reads that tree.

## Tests

Each entry names the rules its file proves. The test names carry the cases.

- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — rules 3, 4, and 5, plus
  `waitForDelay` against a real elapsed interval and `resolveRoot` against the calling file.
  `collect` and `collectStream` drain an empty and an ordered source, and the stream's reader lock is
  released afterwards. `roundTripJSON` carries the longest list: a copy of a flat and a nested
  interface-typed value with fresh references, a record of `unknown` values, the non-finite refusal
  at every depth and through `JSON.rawJSON`, the `-0` normalization, and a large array and object
  copied without exceeding the host's argument limit.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — rule 2. It records
  typed tuples in call order, and truncates a `calls` array the test captured before the `clear()`.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — rule 6, and each pure
  leaf against its own inputs. `resolveContained` takes contained relative and absolute targets and
  both spellings of an escape. `matchesIdentity` takes a triple matching in every field and one
  differing in each. `isExcluded` takes a key, an ancestor, the root, and a sibling that only looks
  like a match. `readInventory` takes key order, extension filtering, exclusion at the named door and
  at the walked one with its spellings normalized to one rule, its three link refusals, a root-level
  `__proto__` file, and the host's own case behavior probed rather than assumed.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — rules 7 and 8. The
  ungrouped cases take the `0700` mode, nested seeding, the cleanup after a failed seed, the lexical
  refusals, the empty target's answers, and every member refused at a symbolic-link root and at a
  file root; `destroy()` is idempotent, leaves a replacement directory standing, and leaves a moved
  allocation alone. Then one group per ruled member. `destruction` takes all six members after
  `destroy()`, with `write`, `ensure`, and `link` also proven not to rebuild the allocation root.
  `names` takes its sorted output, including the population that discriminates a dropped `.sort()`.
  `ensure` takes an empty directory, every missing parent, and a repeated call. `link` takes
  traversal through a planted link, the final segment `has` reports rather than follows, and the
  `EEXIST` an occupied final segment throws. `parent` and `prefix` take their own refusals.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — rule 1: the `## Surface` ↔ source bijection,
  the barrel ↔ source bijection, the behavioral-interface ↔ `## Methods` bijection and each group's
  members, the fence imports, and link resolution for this guide.

## See also

- [`README.md`](README.md) — the guides index.
- `AGENTS.md` at the workspace root — the rules this package's own source and tests follow.
