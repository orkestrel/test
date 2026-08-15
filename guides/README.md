# Guides

A dual-axis index into this repository's guides — by concept, and by directory.

## By concept

| Concept | Spec                 | Source                                                                                    | Tests                                                                                                                         |
| ------- | -------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Test    | [`test.md`](test.md) | [`src/core`](../src/core), [`src/browser`](../src/browser), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/browser`](../tests/src/browser), [`tests/src/server`](../tests/src/server) |

## By directory

| Directory     | Guide                |
| ------------- | -------------------- |
| `src/core`    | [`test.md`](test.md) |
| `src/browser` | [`test.md`](test.md) |
| `src/server`  | [`test.md`](test.md) |

## Dependency reference

This package has **no runtime dependencies**, so no runtime dependency is mirrored here.

[`guide.md`](guide.md) is a byte-identical mirror of the guide for `@orkestrel/guide` — the
devDependency powering this repository's guides-parity suite ([`tests/guides.test.ts`](../tests/guides.test.ts)).
It documents **that package's** surface (`Guide` / `Source`, the manifest and comparison helpers),
not anything sourced here; it is kept so a reader of the parity suite can see the primitives it is
built from without leaving this guide set.

[`scaffold.md`](scaffold.md) is a byte-identical mirror of the guide for `@orkestrel/scaffold` — the
devDependency that generated and maintains this workspace's configuration. It documents **that
package's** surface, not anything sourced here.

## See also

- `AGENTS.md` at the workspace root — the rules; the documentation contract this index serves.
