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
`ReadableStream`), `roundTripJSON` (copies a `JSONValue`, and throws rather than turning a non-finite
number into `null`), and `resolveRoot` (the directory above the calling module, from `import.meta`).
The server face adds `readInventory` for a sorted root-relative file map, plus the two predicates it
refuses escapes with, `resolveContained` and `hasSymbolicLink`.

One boundary is worth stating up front. This package operates on directories the test itself
created. It is not a sandbox against hostile filesystem content: the symlink refusals stop
accidental escape, not an adversary who can create hard links where the test process already writes.

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
