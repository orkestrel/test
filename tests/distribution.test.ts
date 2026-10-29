// The artifact a consumer installs, measured rather than described. This workspace
// is packed and installed into a throwaway consumer, and every following claim is read
// off that installed tree: the exports map it publishes, the declarations it ships,
// and the module objects a real runtime hands a consumer. Nothing here names this
// package, one of its exports, or how many there are, so the proof stays true as
// the published surface moves.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveBrowser, resolvePinnedBrowser } from '../configs/browsers.js'
import { afterAll, describe, expect, it } from 'vitest'
import { FORMATS, RESOLUTIONS } from './setup.js'
import {
	ABSENT_SUBPATH,
	ESM_DRIVER,
	CJS_DRIVER,
	BROWSER_DRIVER,
	isNonArrayObject,
	readJson,
	readManifestName,
	writeFile,
	readOutput,
	runNode,
	resolvesBrowser,
	resolvesCommonJS,
	selectEntries,
	selectDrivers,
	selectUntypable,
	writeProject,
	checkProject,
	checkSurface,
	writeConsumerProbe,
	driveRuntime,
	describeBrowser,
	launchBrowser,
	bundleEntry,
	readBrowserExports,
	openStage,
	requireStage,
} from './setupServer.js'

// `prepublishOnly` runs this proof as `npm run test:distribution -- --mode release`.
// Release is the publish gate, so evidence it cannot obtain fails there and skips
// everywhere else: a gate that passes on missing evidence proves nothing.
const RELEASE = import.meta.env.MODE === 'release'
const SCRATCH = mkdtempSync(join(tmpdir(), 'distribution-'))
const CACHE = join(SCRATCH, 'cache')
mkdirSync(CACHE, { recursive: true })
// The scratch tree holds the npm cache, the packed archive, and the installed
// consumer, so its removal is registered before the first thing that can throw.
afterAll(() => {
	rmSync(SCRATCH, { force: true, recursive: true })
})

const STAGE = openStage(SCRATCH, RELEASE)

describe('distribution classifiers', () => {
	it('classifies synthetic export mappings without a registry stage', () => {
		const root = join(SCRATCH, 'classifiers')
		writeFile(
			join(root, 'package.json'),
			JSON.stringify({
				type: 'commonjs',
				exports: {
					condition: { browser: './b.js', default: './n.js' },
					convention: { default: './dist/src/browser/index.js' },
					universal: { default: './shared.js' },
					'import-shared': {
						browser: './shared.mjs',
						import: './shared.mjs',
						default: './node.js',
					},
					'require-shared': {
						browser: './shared.cjs',
						require: './shared.cjs',
						default: './node.js',
					},
					node: { node: './node.js', default: './node.js' },
					silent: { 'module-sync': './x.cjs', import: './x.mjs' },
					module: { require: './x.mjs' },
					'nested-module': { require: './module/x.js' },
					'nested-commonjs': { require: './commonjs/x.js' },
					esm: { import: './x.mjs' },
				},
			}),
		)
		writeFile(join(root, 'module/package.json'), '{ "type": "module" }\n')
		writeFile(join(root, 'commonjs/package.json'), '{ "type": "commonjs" }\n')
		const manifest = readJson(join(root, 'package.json'))
		if (!isNonArrayObject(manifest) || !isNonArrayObject(manifest.exports)) {
			throw new Error('The classifier fixture declares no exports map')
		}
		const mappings = manifest.exports
		expect({
			condition: resolvesBrowser(mappings.condition),
			convention: resolvesBrowser(mappings.convention),
			universal: resolvesBrowser(mappings.universal),
			import: resolvesBrowser(mappings['import-shared']),
			require: resolvesBrowser(mappings['require-shared']),
			node: resolvesBrowser(mappings.node),
		}).toStrictEqual({
			condition: true,
			convention: true,
			universal: false,
			import: false,
			require: false,
			node: false,
		})
		expect({
			silent: resolvesCommonJS(mappings.silent, root),
			module: resolvesCommonJS(mappings.module, root),
			nestedModule: resolvesCommonJS(mappings['nested-module'], root),
			nestedCommonJS: resolvesCommonJS(mappings['nested-commonjs'], root),
			esm: resolvesCommonJS(mappings.esm, root),
		}).toStrictEqual({
			silent: true,
			module: false,
			nestedModule: false,
			nestedCommonJS: true,
			esm: false,
		})
	})
})

describe('installed package consumer', () => {
	it('packs one archive and installs it in isolation [requires the registry]', (context) => {
		const stage = requireStage(context, STAGE)
		expect(stage.archives).toHaveLength(1)
		expect(existsSync(join(stage.installed, 'package.json'))).toBe(true)
		expect(stage.entries.length).toBeGreaterThan(0)
	})

	it('ships every relative target its exports map names [requires the registry]', (context) => {
		const stage = requireStage(context, STAGE)
		const relative = stage.targets.filter((target) => target.startsWith('./'))
		expect(relative).not.toStrictEqual([])
		expect(relative.filter((target) => !existsSync(join(stage.installed, target)))).toStrictEqual(
			[],
		)
	})

	// Every published subpath is driven, excluded by name, or reported here. A dropped
	// one leaves no trace: no runtime test, no declaration comparison, and no place in
	// the resolution compile, so the run reports success for a subpath it never
	// measured.
	it('declares types for every module it publishes [requires the registry]', (context) => {
		const stage = requireStage(context, STAGE)
		const partitioned = [
			...stage.entries.map((entry) => entry.subpath),
			...stage.undeclared,
			...stage.excluded,
		]
		expect(stage.undeclared).toStrictEqual([])
		expect(partitioned.sort()).toStrictEqual([...stage.subpaths].sort())
		// A driven subpath answers a runtime condition. One resolving a declaration and
		// no Node or browser target compiles for a consumer and throws when that consumer
		// loads it. Each later drive retires itself for that entry, so this assertion names
		// the subpath rather than counting it as driven.
		const unreachable = stage.entries.filter(
			(entry) => !entry.module && !entry.required && !entry.browser,
		)
		expect(unreachable.map((entry) => entry.subpath)).toStrictEqual([])
		const untypable = selectUntypable(stage.entries, stage.installed)
		expect(untypable.map((entry) => entry.subpath)).toStrictEqual([])
	})

	it('refuses a subpath its exports map does not name [requires the registry]', (context) => {
		const stage = requireStage(context, STAGE)
		const name = readManifestName(join(stage.installed, 'package.json'))
		const driver = join(stage.consumer, ESM_DRIVER)
		const result = runNode([driver, `${name}${ABSENT_SUBPATH}`], stage.consumer)
		expect(result.status).not.toBe(0)
		expect(readOutput(result)).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
	})

	// The absent subpath is the firing control: a resolution that reports nothing
	// for every published entry has not been shown to resolve anything at all. Each
	// module format carries its own control, because a format that resolves nothing
	// is silent for the same reason a resolution that resolves nothing is.
	it('compiles a consumer under every module resolution [requires the registry]', (context) => {
		const stage = requireStage(context, STAGE)
		const name = readManifestName(join(stage.installed, 'package.json'))
		const reported: string[] = []
		const silent: string[] = []
		for (const driver of RESOLUTIONS) {
			for (const [extension, format] of FORMATS) {
				const written = selectEntries(stage.entries, driver.conditions[format])
				if (written.length === 0) continue
				const label = `${driver.label}.${extension}`
				const probe = `probe.${label}`
				const specifiers = written.map((entry) => entry.specifier)
				writeConsumerProbe(stage, probe, specifiers)
				const project = writeProject(stage, probe, driver, [`./${probe}`])
				for (const message of checkProject(stage, project)) {
					reported.push(`${label}: ${message}`)
				}
				const control = `control.${label}`
				writeConsumerProbe(stage, control, [`${name}${ABSENT_SUBPATH}`])
				const refused = writeProject(stage, control, driver, [`./${control}`])
				if (checkProject(stage, refused).length === 0) silent.push(label)
			}
		}
		expect(reported).toStrictEqual([])
		expect(silent).toStrictEqual([])
	})
})

for (const entry of STAGE?.entries ?? []) {
	describe(`installed entry ${entry.subpath}`, () => {
		it.runIf(entry.module)(
			'publishes what it declares to a Node import, and no more',
			(context) => {
				const stage = requireStage(context, STAGE)
				// The exports-map walk resolved a declaration a typed importer reads, so an
				// entry reaching this drive without one is reported for that rather than for
				// what a consumer of a missing declaration goes on to say.
				if (!entry.declaration.module) {
					throw new Error(`${entry.subpath} publishes no import declaration`)
				}
				const published = driveRuntime(stage, entry.specifier, ESM_DRIVER)
				const drivers = selectDrivers(entry, 'module')
				expect(drivers).not.toStrictEqual([])
				const reported = drivers.flatMap((driver) =>
					checkSurface(stage, { entry, extension: 'ts', published, driver }),
				)
				expect(reported).toStrictEqual([])
			},
		)

		it.runIf(entry.required)(
			'publishes what it declares to a Node require, and no more',
			(context) => {
				const stage = requireStage(context, STAGE)
				if (!entry.declaration.commonjs) {
					throw new Error(`${entry.subpath} publishes no require declaration`)
				}
				const published = driveRuntime(stage, entry.specifier, CJS_DRIVER)
				// A subpath whose `require` resolves to a module that no typed CommonJS
				// consumer can compile against carries no declared side to compare here, and
				// whether it may publish one at all is the untypable set's question rather
				// than this drive's. The preceding runtime drive ran either way.
				const drivers = selectDrivers(entry, 'commonjs')
				expect(drivers).not.toStrictEqual([])
				const reported = drivers.flatMap((driver) =>
					checkSurface(stage, { entry, extension: 'cts', published, driver }),
				)
				expect(reported).toStrictEqual([])
			},
		)

		it.runIf(entry.browser)(
			'publishes what it declares to a real browser, and no more [requires a browser]',
			async (context) => {
				const stage = requireStage(context, STAGE)
				if (!entry.declaration.browser) {
					throw new Error(`${entry.subpath} publishes no browser declaration`)
				}
				const options = resolveBrowser(resolvePinnedBrowser(), process.platform, process.env)
				const browser = await launchBrowser(options).catch((error: unknown) => {
					const cause = `${describeBrowser(options)} was rejected: ${String(error)}`
					if (RELEASE) throw new Error(`The release gate requires a browser, and ${cause}`)
					return context.skip(`No browser launched. ${cause}`)
				})
				try {
					const bundle = await bundleEntry(stage, entry)
					const published = await readBrowserExports(browser, bundle)
					// A browser consumer reads the installed declarations through a bundler, so
					// that is the one driver this face answers under.
					const reported = checkSurface(stage, {
						entry,
						extension: 'ts',
						published,
						driver: BROWSER_DRIVER,
					})
					expect(reported).toStrictEqual([])
				} finally {
					await browser.close()
				}
			},
		)
	})
}
