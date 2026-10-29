import type { PlaywrightProviderOptions } from '@vitest/browser-playwright'
import type { SpawnSyncReturns } from 'node:child_process'
import type { TestContext } from 'vitest'
import type { DistributionResolution, Format } from './setup.js'
import { attempt, isArray, isObject, isString } from '@orkestrel/contract'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import {
	DECLARATION_CONDITIONS,
	DECLARATION_EXTENSIONS,
	MODULE_EXTENSIONS,
	PING,
	RESOLUTIONS,
	RUNTIME_CONDITIONS,
} from './setup.js'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Browser, FrameLocator, Page } from 'playwright'
import { chromium } from 'playwright'
import { resolveBrowser, resolvePinnedBrowser } from '../configs/browsers.js'
import { invokeUnchecked, readProperty, requireValue } from '@src/core'
import {
	supportsBytes,
	supportsCase,
	supportsDirectoryLinks,
	supportsFileLinks,
	supportsMode,
} from '@src/server'

/** Reads the installed Playwright page's native event-emitter listener count for chooser cleanup proofs. */
export function readChooserListeners(page: Page, event: 'filechooser' | 'close'): number {
	const count = invokeUnchecked<unknown>(page, readProperty(page, 'listenerCount'), [event])
	if (typeof count !== 'number') throw new Error('Provider listener count is not a number')
	return count
}

/** Creates a real browser page with the tester-frame boundary a chooser command receives. */
export async function createChooserFixture(): Promise<{
	readonly browser: Browser
	readonly page: Page
	readonly iframe: FrameLocator
	readonly selector: string
	readonly duplicate: string
}> {
	const options = resolveBrowser(resolvePinnedBrowser(), process.platform, process.env)
	const browser =
		options.connectOptions === undefined
			? await chromium.launch({ headless: true, ...options.launchOptions })
			: await chromium.connect(options.connectOptions)
	try {
		const page = await browser.newPage()
		await page.setContent('<iframe title="Chooser fixture"></iframe>')
		const frame = page.frames()[1]
		if (frame === undefined) throw new Error('Missing chooser fixture frame')
		await frame.setContent(
			'<label>Attachments<input type="file" multiple></label><label>Other<input type="file"></label>',
		)
		return {
			browser,
			page,
			iframe: page.frameLocator('iframe'),
			selector: 'input[type=file] >> nth=0',
			duplicate: 'input[type=file]',
		}
	} catch (error) {
		await browser.close()
		throw error
	}
}

// The package ships one probe per host capability, and each is proved against real fixtures in
// tests/src/server/helpers.test.ts. Reading them here makes the suites consumers of the shipped
// mechanism rather than of a second one that can answer differently. Setup calls each probe a
// single time, so a suite gating on a capability pays for one allocation rather than one per case.

/** Reports whether this host links a file, as {@link supportsFileLinks} reads it. */
export const FILE_LINKS = supportsFileLinks()

/** Reports whether this host links a directory, as {@link supportsDirectoryLinks} reads it. */
export const DIRECTORY_LINKS = supportsDirectoryLinks()

/** Reports whether this host stores POSIX permission bits, as {@link supportsMode} reads it. */
export const POSIX_MODE = supportsMode()

/** Reports whether this host distinguishes filenames by case, as {@link supportsCase} reads it. */
export const CASE_SENSITIVE_FS = supportsCase()

/**
 * Reports whether this host accepts a filename carrying a raw byte no UTF-8 decoder resolves, as
 * {@link supportsBytes} reads it.
 */
export const RAW_BYTE_NAMES = supportsBytes()

/**
 * Lists every host-capability probe, paired with the name its failures are reported under. The
 * pairs are a case matrix rather than test registration, so a residue or boolean proof runs once
 * per probe instead of being written out per probe.
 */
export const HOST_PROBES: ReadonlyArray<readonly [name: string, probe: () => boolean]> =
	Object.freeze([
		Object.freeze<readonly [name: string, probe: () => boolean]>([
			'supportsDirectoryLinks',
			supportsDirectoryLinks,
		]),
		Object.freeze<readonly [name: string, probe: () => boolean]>([
			'supportsFileLinks',
			supportsFileLinks,
		]),
		Object.freeze<readonly [name: string, probe: () => boolean]>(['supportsMode', supportsMode]),
		Object.freeze<readonly [name: string, probe: () => boolean]>(['supportsCase', supportsCase]),
		Object.freeze<readonly [name: string, probe: () => boolean]>(['supportsBytes', supportsBytes]),
	])

/**
 * Lists every environment variable a host's `os.tmpdir()` reads. Each platform reads its own name
 * first — win32 takes `TEMP`, then `TMP`; POSIX takes `TMPDIR`, then `TMP`, then `TEMP` — so an
 * override that sets one name steers one platform, and an override that sets the whole set steers
 * either.
 */
export const TEMPORARY_VARIABLES: readonly string[] = Object.freeze(['TMPDIR', 'TEMP', 'TMP'])

/**
 * Lists absolute target spellings that carry a root of their own. `relative` compares spellings and
 * reads no filesystem, so neither the drive nor the share has to exist for the comparison to
 * answer.
 */
export const FOREIGN_ROOT_PATHS: readonly string[] = Object.freeze([
	'Z:\\orkestrel-test-outside',
	'\\\\orkestrel-test-host\\share\\outside',
])

/**
 * Attempts the permission hold `destroyScratch`'s POSIX case is built on, and report whether the host
 * really refused the removal.
 *
 * @returns True if removing a directory entry under a parent stripped of write permission was
 * refused; false if the host removed it anyway.
 */
export function probePermissionHold(): boolean {
	const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-hold-probe-'))
	const held = join(parent, 'held')
	mkdirSync(held)
	chmodSync(parent, 0o500)
	try {
		rmSync(held, { force: true, recursive: true })
		return false
	} catch {
		return true
	} finally {
		chmodSync(parent, 0o700)
		rmSync(parent, { force: true, recursive: true })
	}
}

/**
 * Counts the socket handles holding this process's event loop open.
 *
 * @returns The number of live TCP socket resources, server listeners excluded.
 */
export function countSocketHandles(): number {
	return process.getActiveResourcesInfo().filter((name) => name === 'TCPSocketWrap').length
}

/**
 * Points every temporary-directory environment variable at one directory.
 *
 * @param path - The directory `os.tmpdir()` reports while the override holds.
 * @returns A function restoring each variable to the value it held before the call.
 */
export function overrideTemporaryDirectory(path: string): () => void {
	const saved = new Map<string, string | undefined>()
	for (const name of TEMPORARY_VARIABLES) {
		saved.set(name, process.env[name])
		process.env[name] = path
	}
	// Assigning `undefined` writes the string `'undefined'`, so a variable that was unset before the
	// override is restored by deleting it rather than by assigning its saved value back.
	return () => {
		for (const [name, value] of saved) {
			if (value === undefined) delete process.env[name]
			else process.env[name] = value
		}
	}
}

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The built output directory convention a browser face may publish from. Every
// selection reads this prefix off the export target and never off the subpath name. A
// workspace whose only published face is the browser one publishes that face at the
// root subpath, so a rule keyed on the subpath name drives a browser bundle through
// Node and the miss is silent.
export const BROWSER_OUTPUT = './dist/src/browser/'
export const ABSENT_SUBPATH = '/no-subpath-is-published-under-this-name'
// A compiler diagnostic that says where it is: the path relative to the directory
// the compiler ran in, the 1-based line and column, the code, and the message. The
// diagnostics are the verdict rather than the exit code, which differs between the
// compiler majors this toolchain supports, so a reported line matching nothing here
// came from something other than a check of a consumer module.
export const DIAGNOSTIC_PATTERN = /^(.+?)\(\d+,\d+\): error TS\d+: /u
export const ESM_DRIVER = 'drive.mjs'
export const CJS_DRIVER = 'drive.cjs'
export const CONSUMER_MANIFEST = `{ "name": "distribution-consumer", "private": true, "type": "module" }\n`
export const ESM_DRIVER_SOURCE = `const entry = await import(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(entry).sort()))
`
export const CJS_DRIVER_SOURCE = `const entry = require(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(entry).sort()))
`

// The extensions a JavaScript handler loads as modules. Node loads a native addon
// through its addon handler instead, so that extension is named separately.
export const ADDON_EXTENSION = '.node'

export interface TargetResolution {
	readonly target: string
}

// The driver a bundled consumer reads declarations under. A browser application
// compiles through a bundler, so the browser drive answers under this one alone,
// and naming it here is what keeps that selection tied to the driver it selects.
export const BROWSER_DRIVER = requireValue(
	RESOLUTIONS.find((candidate) => candidate.label === 'bundler'),
	"RESOLUTIONS carries no 'bundler' row",
)

// One published subpath, resolved to what this proof can drive: the specifier a
// consumer writes, whether the declarations its consumer formats resolve at all,
// whether its target is a browser bundle, and whether it answers `import` and
// `require` at all.
export interface Entry {
	readonly subpath: string
	readonly specifier: string
	readonly mapping: unknown
	readonly declaration: {
		readonly module: boolean
		readonly commonjs: boolean
		readonly browser: boolean
	}
	readonly browser: boolean
	readonly module: boolean
	readonly commonjs: boolean
	readonly required: boolean
}

// The installed tree every claim is read from. Every subpath the exports map names
// lands in exactly one of `entries`, `undeclared`, and `excluded`, so a subpath this
// proof cannot drive is reported rather than dropped.
export interface InstalledConsumerFixture {
	readonly consumer: string
	readonly installed: string
	readonly archives: readonly string[]
	readonly entries: readonly Entry[]
	readonly subpaths: readonly string[]
	readonly undeclared: readonly string[]
	readonly excluded: readonly string[]
	readonly targets: readonly string[]
}

export function isNonArrayObject(value: unknown): value is Readonly<Record<string, unknown>> {
	return isObject(value) && !isArray(value)
}

export function isNames(value: unknown): value is readonly string[] {
	return isArray(value) && value.every((name) => isString(name))
}

// Whether a string is a valid package target. Node rejects a target outside the
// package and a target containing a dot, parent, or node_modules segment during
// package-target resolution. A later module-resolution failure is not the same
// thing: an array falls through the former and keeps the latter.
export function isPackageTarget(target: string): boolean {
	if (!target.startsWith('./')) return false
	for (const segment of target.slice(2).split(/[\\/]/u)) {
		const result = attempt(() => decodeURIComponent(segment))
		const decoded = result.success ? result.value : segment
		const normalized = decoded.toLowerCase()
		if (normalized === '.' || normalized === '..' || normalized === 'node_modules') return false
	}
	return true
}

export function readJson(path: string): unknown {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
	return parsed
}

export function readManifestName(path: string): string {
	const manifest = readJson(path)
	if (!isNonArrayObject(manifest) || typeof manifest.name !== 'string') {
		throw new Error(`The manifest at ${path} declares no package name`)
	}
	return manifest.name
}

export function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, content)
}

export function readOutput(result: SpawnSyncReturns<string>): string {
	return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

export function runNpm(
	args: readonly string[],
	cwd: string,
	cache: string,
): SpawnSyncReturns<string> {
	const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
	// Windows needs a shell to launch a `.cmd`: Node refuses one directly since the
	// batch-argument hardening, and `spawnSync` returns `EINVAL` with a null status
	// rather than an exit code a caller can read. Every following argument is a literal or
	// a path this file built, so the shell has nothing to escape.
	const SHELL = process.platform === 'win32'
	return spawnSync(NPM, [...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, npm_config_cache: cache },
		shell: SHELL,
		windowsHide: true,
	})
}

export function runNode(args: readonly string[], cwd: string): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [...args], { cwd, encoding: 'utf8', windowsHide: true })
}

// Node's own condition matching, read in declaration order.
export function resolvePackageTarget(
	entry: unknown,
	conditions: readonly string[],
): TargetResolution | undefined {
	if (typeof entry === 'string') return { target: entry }
	if (isArray(entry)) {
		for (const member of entry) {
			const resolved = resolvePackageTarget(member, conditions)
			if (resolved !== undefined && isPackageTarget(resolved.target)) return resolved
		}
		return undefined
	}
	if (!isNonArrayObject(entry)) return undefined
	for (const [condition, nested] of Object.entries(entry)) {
		if (condition !== 'default' && !conditions.includes(condition)) continue
		const resolved = resolvePackageTarget(nested, conditions)
		if (resolved !== undefined) return resolved
	}
	return undefined
}

// A flat entry, a condition-nested entry, and a fallback list all resolve through
// one walker. An entry may declare `types` beside `default` at its top level
// rather than inside `import`, so a fixed `entry.import.types` lookup is not
// equivalent to condition resolution.
export function resolveTarget(entry: unknown, conditions: readonly string[]): string | undefined {
	return resolvePackageTarget(entry, conditions)?.target
}

// Whether a path is a physical file. TypeScript's file-existence check refuses a
// directory at the same spelling and continues to the outer package scope.
export function matchesFile(path: string): boolean {
	try {
		return statSync(path).isFile()
	} catch {
		return false
	}
}

// TypeScript resolves a declaration target by accepting an existing declaration
// directly or by substituting beside a JavaScript target. A missing target leaves
// the containing condition or fallback list unresolved, so the walk continues.
export function targetToDeclaration(target: string, installed: string): string | undefined {
	if (!isPackageTarget(target)) return undefined
	const declaration = target.endsWith('.cjs')
		? `${target.slice(0, -4)}.d.cts`
		: target.endsWith('.mjs')
			? `${target.slice(0, -4)}.d.mts`
			: target.endsWith('.js')
				? `${target.slice(0, -3)}.d.ts`
				: isDeclaration(target)
					? target
					: undefined
	if (declaration === undefined) return undefined
	return matchesFile(join(installed, declaration)) ? declaration : undefined
}

// The declaration TypeScript resolves through one importing format's conditions.
// Condition objects keep manifest order, and arrays keep fallback order.
export function resolveDeclaration(
	entry: unknown,
	conditions: readonly string[],
	installed: string,
): string | undefined {
	if (typeof entry === 'string') return targetToDeclaration(entry, installed)
	if (isArray(entry)) {
		for (const member of entry) {
			const resolved = resolveDeclaration(member, conditions, installed)
			if (resolved !== undefined) return resolved
		}
		return undefined
	}
	if (!isNonArrayObject(entry)) return undefined
	for (const [condition, nested] of Object.entries(entry)) {
		if (condition !== 'default' && !conditions.includes(condition)) continue
		const resolved = resolveDeclaration(nested, conditions, installed)
		if (resolved !== undefined) return resolved
	}
	return undefined
}

// The nearest package scope that decides a `.d.ts` declaration's module format. A
// physical nested manifest starts a scope even when it omits `type` or cannot be
// parsed. A directory at that spelling is not a manifest, so the walk continues.
export function readPackageType(installed: string, target: string): unknown {
	return readDirectoryType(installed, dirname(join(installed, target)))
}

export function readDirectoryType(installed: string, directory: string): unknown {
	const path = join(directory, 'package.json')
	if (matchesFile(path)) {
		try {
			const manifest = readJson(path)
			return isNonArrayObject(manifest) ? manifest.type : undefined
		} catch {
			return undefined
		}
	}
	if (directory === installed) return undefined
	const parent = dirname(directory)
	return parent === directory ? undefined : readDirectoryType(installed, parent)
}

export function resolvesBrowser(entry: unknown): boolean {
	const module = resolveTarget(entry, RUNTIME_CONDITIONS.browser)
	if (module !== undefined && module.startsWith(BROWSER_OUTPUT)) return true
	if (module === undefined) return false
	const imported = resolveTarget(entry, RUNTIME_CONDITIONS.module)
	const required = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
	return module !== imported && module !== required
}

// Whether the target selected by Node's CommonJS conditions is a module require can
// load. A JavaScript target takes its own nearest package scope. Native addons and
// extensionless targets have their own CommonJS handlers.
export function resolvesCommonJS(entry: unknown, installed: string): boolean {
	const target = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
	if (target === undefined) return false
	const name = target.slice(target.lastIndexOf('/') + 1)
	if (name.endsWith('.cjs')) return true
	if (name.endsWith('.mjs')) return false
	if (name.endsWith('.node')) return true
	if (!name.includes('.')) return true
	return name.endsWith('.js') && readPackageType(installed, target) !== 'module'
}

// Whether the declaration selected by a typed CommonJS consumer admits that entry.
// A `.d.cts` declaration admits and a `.d.mts` declaration refuses. A `.d.ts`
// declaration takes its own nearest package scope.
export function declaresCommonJS(entry: unknown, installed: string): boolean {
	const declaration = resolveDeclaration(entry, DECLARATION_CONDITIONS.commonjs, installed)
	if (declaration === undefined) return false
	if (declaration.endsWith('.d.cts')) return true
	if (declaration.endsWith('.d.mts')) return false
	return declaration.endsWith('.d.ts') && readPackageType(installed, declaration) !== 'module'
}

// Every target an entry names under any condition. A fallback list omits members
// Node rejects during package-target validation, because no reader can take them.
export function collectTargets(entry: unknown): readonly string[] {
	if (typeof entry === 'string') return [entry]
	if (isArray(entry)) return entry.flatMap(collectTargets).filter(isPackageTarget)
	if (!isNonArrayObject(entry)) return []
	return Object.values(entry).flatMap((nested) => collectTargets(nested))
}

// Whether a target is a file a runtime loads for its names, which is what a
// declaration is owed for. The extension on the target's own file name decides it,
// and a name carrying no extension is code: `require` reads such a file through its
// JavaScript handler, so an extensionless target loads and publishes names. Node
// loads `.node` through its native-addon handler. Every other extension is an asset
// a consumer reads rather than imports — a stylesheet, a WebAssembly binary, the
// `"./package.json"` manifest pointer, and a declaration alike.
// The cost is an extensionless file published for a reader, such as a `LICENSE`:
// that target reports undeclared until it is given an extension or a declaration.
export function isModule(target: string): boolean {
	const name = target.slice(target.lastIndexOf('/') + 1)
	const dot = name.lastIndexOf('.')
	if (name.endsWith(ADDON_EXTENSION)) return true
	return dot === -1 || MODULE_EXTENSIONS.includes(name.slice(dot))
}

// Whether a resolved target is a declaration rather than the JavaScript a
// `default` branch answers with when the entry declares no `types` condition.
export function isDeclaration(target: string): boolean {
	return DECLARATION_EXTENSIONS.some((extension) => target.endsWith(extension))
}

// The declarations the Node module, Node CommonJS, and browser drives compare
// against. Each field uses the conditions of the TypeScript consumer paired with
// that runtime. A JavaScript target resolves through TypeScript's adjacent
// declaration substitution rather than standing in for the declaration itself.
export function readDeclaration(
	entry: unknown,
	installed: string,
): {
	readonly module: string | undefined
	readonly commonjs: string | undefined
	readonly browser: string | undefined
} {
	return {
		module: resolveDeclaration(entry, DECLARATION_CONDITIONS.module, installed),
		commonjs: resolveDeclaration(entry, DECLARATION_CONDITIONS.commonjs, installed),
		browser: resolveDeclaration(entry, DECLARATION_CONDITIONS.browser, installed),
	}
}

// The entries one compile driver can resolve under its own conditions.
export function selectEntries(
	entries: readonly Entry[],
	conditions: readonly string[],
): readonly Entry[] {
	return entries.filter(
		(entry) =>
			resolveTarget(entry.mapping, conditions) !== undefined &&
			(!conditions.includes('require') || entry.commonjs),
	)
}

// The compile drivers whose conditions reach one entry under one importing format.
// A driver that resolves no target for that entry compiles nothing, so a consumer
// written under it would report a resolution failure this package never made.
export function selectDrivers(entry: Entry, format: Format): readonly DistributionResolution[] {
	return RESOLUTIONS.filter(
		(driver) => selectEntries([entry], driver.conditions[format]).length > 0,
	)
}

// Require-loadable entries that declare CommonJS support but a typed CommonJS
// consumer cannot compile against. A default branch resolving under the require
// condition set makes no CommonJS claim.
export function selectUntypable(entries: readonly Entry[], installed: string): readonly Entry[] {
	return entries.filter(
		(entry) =>
			entry.required &&
			isNonArrayObject(entry.mapping) &&
			Object.hasOwn(entry.mapping, 'require') &&
			!declaresCommonJS(entry.mapping, installed),
	)
}

// One surface comparison, written as the consumer module that proves it: the
// installed entry that consumer imports, the file extension fixing its importing
// format, the names a real runtime published off it, and the driver whose scratch
// project compiles it.
export interface ConsumerSurfaceFixture {
	readonly entry: Entry
	readonly extension: string
	readonly published: readonly string[]
	readonly driver: DistributionResolution
}

// A scratch project over named consumer modules, written beside them so their own
// resolution reaches the installed package. Nothing is emitted and no ambient types
// are pulled in, so what the check reads is the installed declarations alone.
export function writeProject(
	stage: InstalledConsumerFixture,
	name: string,
	driver: DistributionResolution,
	files: readonly string[],
): string {
	const path = join(stage.consumer, `tsconfig.${name}.json`)
	const project = {
		compilerOptions: {
			module: driver.module,
			moduleResolution: driver.resolution,
			noEmit: true,
			skipLibCheck: true,
			strict: true,
			target: 'esnext',
			types: [],
		},
		files: [...files],
	}
	writeFile(path, `${JSON.stringify(project, undefined, '\t')}\n`)
	return path
}

// The diagnostics the compiler this workspace installs reports for one scratch
// project. The compiler runs as a command, so nothing here reaches an API that
// moves between its majors, and the located lines it prints are the verdict rather
// than the exit code, which moves between them. A line carrying no location, a line
// naming the scratch project rather than a consumer module, and anything at all on
// the error stream are faults of this proof rather than of the package under proof,
// so each is raised where it happens instead of counted against the package.
export function checkProject(stage: InstalledConsumerFixture, project: string): readonly string[] {
	// The compiler this workspace installs, run as a command rather than called in
	// process: the command and its plain-text diagnostics are the same across the
	// compiler majors this toolchain supports, and its in-process API is not. It is
	// resolved from the workspace under proof, so a consumer of the packed artifact is
	// checked by the same compiler that workspace's own `check` script runs.
	const TSC = join(
		dirname(createRequire(join(ROOT, 'package.json')).resolve('typescript/package.json')),
		'bin/tsc',
	)
	const result = runNode([TSC, '--noEmit', '--pretty', 'false', '-p', project], stage.consumer)
	const refused = `${result.stderr ?? ''}`.trim()
	if (refused.length > 0) {
		throw new Error(`The consumer compiler wrote ${refused} to its error stream`)
	}
	const reported: string[] = []
	for (const line of `${result.stdout ?? ''}`.split(/\r\n|\n/u)) {
		if (line.trim().length === 0) continue
		const last = reported.at(-1)
		// An elaborated diagnostic prints its detail on indented lines under its own
		// first line, so each of those joins the diagnostic it elaborates.
		if (/^\s/u.test(line) && last !== undefined) {
			reported[reported.length - 1] = `${last} ${line.trim()}`
			continue
		}
		const located = DIAGNOSTIC_PATTERN.exec(line)?.[1]
		if (located === undefined) {
			throw new Error(`The consumer compiler reported ${line}, which names no location`)
		}
		if (resolve(stage.consumer, located) === project) {
			throw new Error(`The scratch project is itself at fault: ${line}`)
		}
		reported.push(line)
	}
	if (reported.length === 0 && result.status !== 0) {
		throw new Error(`The consumer compiler refused the project: ${readOutput(result)}`)
	}
	return reported
}

// One installed entry's published names checked against its own declarations by
// the compiler this workspace installs, in the direction each divergence surfaces
// under. The runtime's key list is written into the consumer as a literal, so the
// published side comes from a real process and the declared side from the
// declarations that process's package ships, and the two can disagree. A name the
// declarations carry and the runtime does not lands on `declared`. A name the
// runtime carries and the declarations do not, and a name the declarations publish
// as a type alone, land on `surfaced`: a variable widens into the type
// `declared` annotates, and only `surfaced` reads the literal's own keys back.
// Each names the member it is about, so the failure says which export moved.
export function checkSurface(
	stage: InstalledConsumerFixture,
	surface: ConsumerSurfaceFixture,
): readonly string[] {
	const slug = surface.entry.subpath.replaceAll(/[^\w]+/gu, '-')
	const name = `surface.${surface.driver.label}${slug}.${surface.extension}`
	const module = `${name}`
	const keys = surface.published.map((key) => `${JSON.stringify(key)}: true`).join(', ')
	writeFile(
		join(stage.consumer, module),
		`import * as entry from ${JSON.stringify(surface.entry.specifier)}
const published = {${keys.length === 0 ? '' : ` ${keys} `}} as const
const declared: Record<keyof typeof entry, true> = published
const surfaced: Record<keyof typeof published, true> = declared
`,
	)
	const project = writeProject(stage, name, surface.driver, [`./${module}`])
	return checkProject(stage, project).map((line) => `${surface.driver.label}: ${line}`)
}

// One consumer module importing every installed entry, written where its own
// resolution finds the installed package.
export function writeConsumerProbe(
	stage: InstalledConsumerFixture,
	path: string,
	specifiers: readonly string[],
): void {
	const names: string[] = []
	const bindings: string[] = []
	for (const [index, specifier] of specifiers.entries()) {
		const binding = `entry${String(index)}`
		names.push(binding)
		bindings.push(`import * as ${binding} from ${JSON.stringify(specifier)}`)
	}
	const source = `${bindings.join('\n')}\nexport const surface = [${names.join(', ')}]\n`
	writeFile(join(stage.consumer, path), source)
}

// The runtime key set a real process reads off one installed entry under one
// condition. The driver is a file rather than an `--eval` string, so the specifier
// travels as an argument and nothing needs escaping.
export function driveRuntime(
	stage: InstalledConsumerFixture,
	specifier: string,
	driver: string,
): readonly string[] {
	const result = runNode([join(stage.consumer, driver), specifier], stage.consumer)
	if (result.status !== 0) {
		throw new Error(`Loading ${specifier} from the consumer failed: ${readOutput(result)}`)
	}
	const published: unknown = JSON.parse(result.stdout)
	if (!isNames(published)) throw new Error(`The driver printed no name list for ${specifier}`)
	return published
}

export const BROWSER_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>Distribution</title>
	</head>
	<body>
		<script type="module" src="./main.js"></script>
	</body>
</html>
`

export function readContentType(path: string): string {
	if (path.endsWith('.html')) return 'text/html'
	if (path.endsWith('.js')) return 'text/javascript'
	if (path.endsWith('.css')) return 'text/css'
	if (path.endsWith('.json') || path.endsWith('.map')) return 'application/json'
	return 'application/octet-stream'
}

// `resolveBrowser` answers with provider options and never reports absence: its
// last resort is a channel nothing verified. So the launch is attempted and its
// rejection classified, rather than probed for and ruled on.
export function describeBrowser(options: PlaywrightProviderOptions): string {
	const endpoint = options.connectOptions?.wsEndpoint
	if (endpoint !== undefined) return `the browser server at ${endpoint}`
	const executable = options.launchOptions?.executablePath
	if (executable !== undefined) return `the executable at ${executable}`
	const channel = options.launchOptions?.channel
	if (channel !== undefined) return `the ${channel} channel`
	return 'the Chromium Playwright installed for itself'
}

export async function launchBrowser(options: PlaywrightProviderOptions): Promise<Browser> {
	const endpoint = options.connectOptions?.wsEndpoint
	if (endpoint !== undefined) return chromium.connect(endpoint)
	return chromium.launch({ ...options.launchOptions, headless: true })
}

// A consumer of one installed browser entry, bundled by the Vite toolchain this
// workspace already declares. Nothing is stubbed: the bundle resolves the installed
// package and its whole transitive graph as an application consuming it would.
export async function bundleEntry(stage: InstalledConsumerFixture, entry: Entry): Promise<string> {
	const page = join(stage.consumer, 'pages', entry.subpath.replaceAll(/[^\w]+/gu, '-'))
	const specifier = JSON.stringify(entry.specifier)
	writeFile(join(page, 'index.html'), BROWSER_PAGE)
	writeFile(
		join(page, 'main.js'),
		`import * as entry from ${specifier}\nglobalThis.subject = Object.keys(entry).sort()\n`,
	)
	await build({
		base: './',
		build: { emptyOutDir: true, outDir: 'bundle' },
		configFile: false,
		logLevel: 'error',
		root: page,
	})
	return join(page, 'bundle')
}

// The key set the bundled module publishes in a real browser, read off the page
// after it has loaded over a loopback server. A module that never evaluated
// publishes nothing, and a page error is raised rather than compared away.
export async function readBrowserExports(
	browser: Browser,
	bundle: string,
): Promise<readonly string[]> {
	const server = createServer((request, response) => {
		const asked = request.url === undefined || request.url === '/' ? '/index.html' : request.url
		const path = join(bundle, decodeURIComponent(asked))
		if (!path.startsWith(bundle) || !existsSync(path)) {
			response.writeHead(404)
			response.end()
			return
		}
		response.writeHead(200, { 'content-type': readContentType(path) })
		response.end(readFileSync(path))
	})
	try {
		await new Promise<void>((settle) => {
			server.listen(0, '127.0.0.1', settle)
		})
		const address = server.address()
		if (address === null || typeof address === 'string') {
			throw new Error('The bundle server bound no port')
		}
		const page = await browser.newPage()
		const failures: string[] = []
		page.on('pageerror', (error) => failures.push(String(error)))
		await page.goto(`http://127.0.0.1:${String(address.port)}/`, { waitUntil: 'load' })
		const published: unknown = await page.evaluate('globalThis.subject')
		if (failures.length > 0) throw new Error(`The bundle raised ${failures.join(' | ')}`)
		if (!isNames(published)) throw new Error('The bundled module published no name list')
		return published
	} finally {
		server.close()
	}
}

// Pack this workspace, install the archive into an isolated consumer, and read the
// published surface back off the installed tree. Every later claim reads this
// result, so a failure here is raised where it happens rather than once per entry.
export function buildStage(scratch: string): InstalledConsumerFixture {
	const packed = join(scratch, 'packed')
	const consumer = join(scratch, 'consumer')
	mkdirSync(packed, { recursive: true })
	const pack = runNpm(
		['pack', '--ignore-scripts', '--pack-destination', packed],
		ROOT,
		join(scratch, 'cache'),
	)
	if (pack.status !== 0) throw new Error(`npm pack refused this workspace: ${readOutput(pack)}`)
	const archives = readdirSync(packed).filter((name) => name.endsWith('.tgz'))
	const archive = archives[0]
	if (archives.length !== 1 || archive === undefined) {
		throw new Error(`npm pack wrote no single archive: ${archives.join(', ')}`)
	}
	writeFile(join(consumer, 'package.json'), CONSUMER_MANIFEST)
	writeFile(join(consumer, ESM_DRIVER), ESM_DRIVER_SOURCE)
	writeFile(join(consumer, CJS_DRIVER), CJS_DRIVER_SOURCE)
	const install = runNpm(
		['install', '--ignore-scripts', '--no-audit', '--no-fund', join(packed, archive)],
		consumer,
		join(scratch, 'cache'),
	)
	if (install.status !== 0) {
		throw new Error(`Installing the packed archive failed: ${readOutput(install)}`)
	}
	const name = readManifestName(join(ROOT, 'package.json'))
	const installed = join(consumer, 'node_modules', ...name.split('/'))
	const manifest = readJson(join(installed, 'package.json'))
	if (!isNonArrayObject(manifest) || !isNonArrayObject(manifest.exports)) {
		throw new Error('The installed manifest publishes no exports map')
	}
	const entries: Entry[] = []
	const targets: string[] = []
	const subpaths: string[] = []
	const undeclared: string[] = []
	const excluded: string[] = []
	for (const [subpath, entry] of Object.entries(manifest.exports)) {
		const files = collectTargets(entry)
		targets.push(...files)
		subpaths.push(subpath)
		const declaration = readDeclaration(entry, installed)
		// A subpath resolving no declaration is partitioned rather than dropped. It is a
		// defect when a runtime loads one of its targets for names, because a consumer
		// importing it compiles against nothing under `node16`. It is an excluded
		// publication otherwise: the `"./package.json"` manifest pointer and a stylesheet
		// are published for a reader rather than an importer.
		if (
			declaration.module === undefined &&
			declaration.commonjs === undefined &&
			declaration.browser === undefined
		) {
			if (files.some(isModule)) undeclared.push(subpath)
			else excluded.push(subpath)
			continue
		}
		const imported = resolveTarget(entry, RUNTIME_CONDITIONS.module)
		const requiredTarget = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
		const browserTarget = resolveTarget(entry, RUNTIME_CONDITIONS.browser)
		const browser = resolvesBrowser(entry)
		const required = requiredTarget !== undefined && !(browser && requiredTarget === browserTarget)
		const commonjs = required && resolvesCommonJS(entry, installed)
		entries.push({
			subpath,
			specifier: subpath === '.' ? name : `${name}${subpath.slice(1)}`,
			mapping: entry,
			declaration: {
				module: declaration.module !== undefined,
				commonjs: declaration.commonjs !== undefined,
				browser: declaration.browser !== undefined,
			},
			browser,
			module: imported !== undefined && !(browser && imported === browserTarget),
			commonjs,
			required,
		})
	}
	return { consumer, installed, archives, entries, subpaths, undeclared, excluded, targets }
}

// Installing the packed archive resolves its own runtime dependencies, so an
// unreachable registry leaves nothing to measure. Under release that is the gate
// failing; anywhere else the suite skips and names the mechanism it wanted.
//
// A module that throws while loading never reaches the `afterAll` it registered,
// so every throw here removes the scratch tree on its way out.
export function openStage(scratch: string, release: boolean): InstalledConsumerFixture | undefined {
	try {
		if (runNpm(PING, ROOT, join(scratch, 'cache')).status !== 0) {
			if (!release) return undefined
			throw new Error(
				'The release gate requires a reachable npm registry, and npm ping did not answer',
			)
		}
		return buildStage(scratch)
	} catch (error) {
		rmSync(scratch, { force: true, recursive: true })
		throw error
	}
}

// The staged consumer, or a skip naming what the run could not reach. `it.skipIf`
// carries no reason, so the gate sits here where the test context can state one.
export function requireStage(
	context: TestContext,
	stage: InstalledConsumerFixture | undefined,
): InstalledConsumerFixture {
	if (stage === undefined) {
		return context.skip('`npm ping` did not answer, so nothing was packed or installed')
	}
	return stage
}
