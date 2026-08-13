# @orkestrel/test

The test helpers every `@orkestrel` package had already written for itself, published once. A call
recorder that is a real callback rather than a spy. A real host delay. A throw-to-value converter and
a presence narrower, so `!` and `as` stay banned in tests. Two async collectors and a JSON copier. A
scratch directory the test owns and destroys, and a symlink-refusing source-file walker. Add it as a
devDependency; nothing here runs in production code. Part of the `@orkestrel` line.

It has **zero runtime dependencies**, and no exported signature names an `@orkestrel/*` type. Both
rules exist for one reason: a test helper hands its types straight into the consumer's assertions,
and a second copy of a package inside its own repository makes the compiler read one type as two.

## Install

```sh
npm install -D @orkestrel/test
```

## Requirements

- Node.js >= 22.12.0
- ESM and CommonJS

## Usage

`@orkestrel/test` is the host-independent core. `@orkestrel/test/server` is the Node face. Core
touches neither `node:*` nor the DOM, so a browser test project imports it unchanged.

```ts
import { captureError, createRecorder, requireValue, waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'

// A temporary directory the test owns, seeded with the input under test.
const scratch = createScratch({ prefix: 'loader-', files: { 'input.txt': 'hello' } })

// A real callback, not a spy: hand `handler` to the code under test.
const recorder = createRecorder<[path: string]>()
loader.on('read', recorder.handler)

loader.watch(scratch.path)
await waitForDelay(10) // let a real host timer elapse

recorder.count // how many reads arrived
recorder.calls // the arguments of each, oldest first
recorder.clear() // truncates in place, so a `calls` reference captured earlier empties too

// A throw becomes a value; absence becomes a throw. The test still does the asserting.
captureError(() => loader.read('missing.txt')) // the thrown value, or undefined
requireValue(scratch.read('input.txt')) // 'hello' — narrows `string | undefined` without `!`

scratch.destroy() // idempotent, and it removes only the directory it allocated
```

The rest of core is `collect` (drains an async iterable), `collectStream` (drains a
`ReadableStream`), `roundTripJSON` (copies any value `JSONSafe` accepts, including an
interface-typed one, and throws rather than turning a non-finite number into `null`), and
`resolveRoot` (the directory above the calling module, from `import.meta`).

The server face adds `readInventory`, which reads a checkout into a map of root-relative path to
file text that a parity suite can assert against, plus the three pure leaves behind it and
`createScratch`: `resolveContained`, the lexical check both refuse escapes with; `isExcluded`, the
exclusion rule the walk applies; and `matchesIdentity`, the comparison `destroy()` makes before it
removes anything.

```ts
import { resolveRoot } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'

// A suite in tests/ is one directory below the workspace root, which is what `resolveRoot` returns.
const root = resolveRoot(import.meta)

// Nothing is walked by default, so the targets are a required argument rather than an option.
const sources = readInventory(root, ['src/core', 'src/server'], { extensions: ['.ts'] })

Object.keys(sources)
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts', 'src/core/types.ts',
//  'src/server/factories.ts', 'src/server/helpers.ts', 'src/server/index.ts', 'src/server/types.ts']

// The keys are paths; the values are the file contents.
sources['src/core/index.ts']
// "export * from './types.js'\nexport * from './helpers.js'\nexport * from './factories.js'\n"

// A target is a file or a directory. A named file is read whatever the extension filter says.
Object.keys(readInventory(root, ['package.json', 'src/core'], { extensions: ['.ts'] }))
// ['package.json', 'src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts',
//  'src/core/types.ts']

// An `exclude` entry matches whole key segments. A file key drops that file.
Object.keys(
	readInventory(root, ['src/core'], { extensions: ['.ts'], exclude: ['src/core/index.ts'] }),
)
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/types.ts']

// A directory key prunes its whole subtree.
Object.keys(readInventory(root, ['src'], { extensions: ['.ts'], exclude: ['src/server'] }))
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts', 'src/core/types.ts']
```

Keys are root-relative and `/`-separated whatever the host separator is, though this package's own
suite runs on POSIX, where that conversion is an identity, so it proves the key shape and not the
conversion. Keys are inserted in sorted order, and a plain object reads that order back for every
key that is not integer-like.

Two boundaries are worth stating up front, because the two filesystem helpers promise different
things. `createScratch` allocates its own directory at POSIX mode `0700` — under the host temporary
directory, or under a `parent` you name — and refuses a path that lexically escapes it. The suite
asserts those bits on POSIX and proves nothing about a host that emulates them. The mode keeps
another uid out, and neither a sibling test worker nor the code under test is another uid. It does
not walk segments for symbolic links. A link inside its own allocation was created by the test
process, by the code the test drives, or by this package's own `link` — handing that code
`scratch.path` is the ordinary use of this helper — and a contained path reaches outside the
allocation through one. The guide's [traversal](guides/test.md#traversal) section states what each
member does with a link it meets. Naming a `parent` inside a package tree costs one more thing:
while the allocation exists, everything that walks that tree sees it. `destroy()` is unaffected by
where the allocation sits, because it matches the allocation's identity rather than its path. One
field of that identity is the host's to supply: where a host reports no real creation time, libuv
reports `ctime` in its place, the first write moves it, and `destroy()` then removes nothing and
returns as if it had. `readInventory` walks a checkout you supply, usually one the test did not
create, so it throws on a symlinked root or named target and skips a symlink met while walking.
Neither is a sandbox against hostile filesystem content: those refusals stop accidental escape, not
an adversary who can create hard links where the test process already writes.

## Guide

For the full surface — every export, the behavioral contract each one holds to, and the measured
rule deciding what ships and what stays in the package that owns it — see
[`guides/test.md`](guides/test.md).

## Package

Published as two typed entry points per the `exports` field in `package.json`: `@orkestrel/test` for
the host-independent core, `@orkestrel/test/server` for the Node helpers. Both ship ESM and
CommonJS.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
