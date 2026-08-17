# @orkestrel/test

The test helpers the `@orkestrel` fleet kept rewriting, published once. A call recorder that is a
real callback rather than a spy. A real host delay. A throw-to-value converter and a presence
narrower, so `!` and `as` stay banned in tests. Two async collectors and a JSON copier. A frozen
hostile-value corpus for proving guards are total. A cleanup list that gives every owned resource
back, newest first. A scratch directory the test owns and destroys, a loopback port for a server the
test built, and a symlink-refusing source-file walker. And the browser journey layer, which drives
a real interface by role and accessible name through the installed Vitest provider. A helper ships
here only when enough packages had already written their own; the guide's
[Limits](guides/test.md#limits) section states that rule, what it excluded, and the one door the
journey layer came through instead. Add it as a devDependency; nothing here runs in production
code. Part of the `@orkestrel` line.

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

`@orkestrel/test` is the host-independent core. `@orkestrel/test/server` is the Node face.
`@orkestrel/test/browser` is the journey layer, which drives a real browser through the installed
Vitest provider. Core touches neither `node:*` nor the DOM, so a browser test project imports it
unchanged.

```ts
import {
	captureError,
	createRecorder,
	createTeardown,
	requireValue,
	waitForDelay,
} from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'

// A cleanup list the test adds to as it goes, and a temporary directory seeded with the input.
const teardown = createTeardown()
const scratch = createScratch({ prefix: 'loader-', files: { 'input.txt': 'hello' } })
teardown.add(() => scratch.destroy()) // idempotent, and it removes only the directory it allocated

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

scratch.remove('input.txt') // one contained entry, subtree and all; a missing target is a no-op
await teardown.destroy() // newest registration first, and every handler runs even after one throws
```

The list registers no hook of its own. The consumer writes `afterEach(() => teardown.destroy())`
once, in its own setup, because registering it here would take a runtime dependency on the test
runner. A handler that throws does not stop the run: one failure is rethrown by identity, so the
test can assert on the value it threw, and several arrive as an `AggregateError` in run order.

The rest of core is `collect` (drains an async iterable), `collectStream` (drains a
`ReadableStream`), `roundTripJSON` (copies any value `JSONSafe` accepts, including an
interface-typed one, and throws rather than turning a non-finite number into `null`), `resolveRoot`
(the directory above the calling module, from `import.meta`), and `createHostileValues` (a frozen
array of fresh values that each make a naive reader throw).

The server face adds `readInventory`, which reads a checkout into a map of root-relative path to
file text that a parity suite can assert against, and `createLoopback`, which binds a server the
test built to an ephemeral loopback port. Behind `readInventory` and `createScratch` sit three pure
leaves: `resolveContained`, the lexical check both refuse escapes with; `isExcluded`, the exclusion
rule the walk applies; and `matchesIdentity`, the comparison `destroy()` makes before it removes
anything.

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
create, so it throws on a symlinked root or named target, throws on a named target whose real path
leaves the root through a link in the middle, and skips a symlink met while walking. Neither is a
sandbox against hostile filesystem content: those refusals stop accidental escape, not an adversary
who can create hard links where the test process already writes.

The browser face is the journey layer: an accessible-name resolver with exact failure voices,
region and disclosure targeting, input and traversal verbs, perception readers, a WCAG contrast
instrument that composites translucent layers, and the capture portfolio. Every acting verb
resolves its own target from a role and an accessible name — none takes an element, a component
instance, or a selector — and the whole environment imports `vitest/browser` and DOM globals and
nothing else, with `vitest` declared as a peer dependency. The guide's
[Browser](guides/test.md#browser) section carries every export and every voice.

`createLoopback` binds a server the test built. The caller constructs it and keeps every route,
header, and status on it; this package supplies the bind and the release and nothing else.

```ts
import { createServer } from 'node:http'
import { createLoopback } from '@orkestrel/test/server'

const server = createServer((_request, response) => {
	response.end('ok')
})

const loopback = await createLoopback(server)

loopback.port // the number the host assigned; this package neither picks a port nor reserves one
loopback.url // `http://127.0.0.1:${loopback.port}` — IPv4 loopback, no trailing slash

const response = await fetch(loopback.url) // a real request, answered by the caller's own server
await response.text() // 'ok'

await loopback.destroy() // drops every live connection, then closes; idempotent
```

It listens on port `0` at `127.0.0.1`, so the host assigns the number and the address is IPv4
loopback rather than `::1`, which a host resolving `localhost` can hand back instead. The scheme in
`url` is spelled `http` unconditionally, so a TLS server's origin is `port` plus a scheme the caller
writes. `destroy()` drops live connections on a server that carries `closeAllConnections` — both
`node:http`'s and `node:https`'s do — so a keep-alive client cannot hold the port past the test that
opened it. A plain `node:net` server has no such method, so `destroy()` waits for its open sockets
to end.

## Guide

For the full surface — every export, the behavioral contract each one holds to, and the measured
rule deciding what ships and what stays in the package that owns it — see
[`guides/test.md`](guides/test.md).

## Package

Published as three typed entry points per the `exports` field in `package.json`: `@orkestrel/test`
for the host-independent core, `@orkestrel/test/browser` for the journey layer, and
`@orkestrel/test/server` for the Node helpers. Core and server ship ESM and CommonJS; the browser
face ships ESM only, because `vitest/browser` is an ES-only module.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
