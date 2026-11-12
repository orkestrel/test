import type {
	Reporter,
	SerializedError,
	TestCase,
	TestModule,
	TestRunEndReason,
	TestSpecification,
	Vitest,
} from 'vitest/node'
import type { ProgressError, ProgressEvent, ProgressStamp } from '../types.js'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { PROGRESS_VERSION } from '../constants.js'
import { extractProgressError, matchesPlannedCase, normalizeProgressPath } from '../helpers.js'

/**
 * Appends one JSON line per Vitest run event to the file `--outputFile.progress` names, so a live
 * run's progress and each failure's first error can be read before the run ends.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vitest/config'
 * import { ProgressReporter } from '@orkestrel/test/server'
 *
 * export default defineConfig({
 * 	test: {
 * 		reporters: ['dot', new ProgressReporter()],
 * 		outputFile: { progress: 'tmp/runs/progress.jsonl' },
 * 	},
 * })
 * ```
 */
export class ProgressReporter implements Reporter {
	readonly #origin = performance.now()
	readonly #listener: (reason: string) => void
	readonly #planned = new WeakSet<TestCase>()
	#vitest: Vitest | undefined
	#path: string | undefined
	#overhead = 0

	constructor() {
		this.#listener = this.#cancel.bind(this)
	}

	onInit(vitest: Vitest): void {
		this.#measure(() => {
			const output = vitest.config.outputFile
			const named = typeof output === 'object' ? output.progress : undefined
			if (named === undefined) {
				throw new Error(
					'ProgressReporter writes no file: pass --outputFile.progress=<file>, or set outputFile: { progress: <file> } in the test config',
				)
			}
			this.#vitest = vitest
			this.#path = resolve(vitest.config.root, named)
			mkdirSync(dirname(this.#path), { recursive: true })
			this.#write({
				event: 'init',
				version: PROGRESS_VERSION,
				wall: Date.now(),
				bail: vitest.config.bail ?? 0,
				...this.#stamp(),
			})
		})
	}

	// Vitest clears its cancel listeners after `onTestRunStart`, so each run registers on its queued
	// modules; the listener set holds one copy of the bound listener.
	onTestModuleQueued(): void {
		this.#vitest?.onCancel(this.#listener)
	}

	onTestRunStart(specifications: readonly TestSpecification[]): void {
		this.#measure(() => {
			this.#write({
				event: 'start',
				specifications: specifications.map((specification) => ({
					project: specification.project.name,
					module: this.#relative(specification.moduleId),
				})),
				...this.#stamp(),
			})
		})
	}

	onTestModuleCollected(module: TestModule): void {
		this.#measure(() => {
			// A name filter leaves its removed cases collected with mode `skip`, and Vitest still
			// readies and reports them, so only the cases planned here are ever written.
			const planned = [...module.children.allTests()].filter((test) => matchesPlannedCase(test))
			for (const test of planned) this.#planned.add(test)
			this.#write({
				event: 'collected',
				project: module.project.name,
				module: this.#relative(module.moduleId),
				planned: planned.length,
				errors: module.errors().map((error) => this.#error(error)),
				...this.#stamp(),
			})
		})
	}

	onTestCaseReady(test: TestCase): void {
		this.#measure(() => {
			if (!this.#planned.has(test)) return
			this.#write({
				event: 'ready',
				project: test.project.name,
				id: test.id,
				name: test.fullName,
				...this.#stamp(),
			})
		})
	}

	onTestCaseResult(test: TestCase): void {
		this.#measure(() => {
			// A case a bail cuts off reports its result twice; the first report takes it off the plan.
			if (!this.#planned.delete(test)) return
			const result = test.result()
			const diagnostic = test.diagnostic()
			this.#write({
				event: 'case',
				project: test.project.name,
				module: this.#relative(test.module.moduleId),
				id: test.id,
				name: test.fullName,
				state: result.state,
				...(diagnostic === undefined
					? {}
					: { duration: Math.round(diagnostic.duration), start: Math.round(diagnostic.startTime) }),
				...(result.state === 'failed'
					? { errors: result.errors.map((error) => this.#error(error)) }
					: {}),
				...this.#stamp(),
			})
		})
	}

	onTestModuleEnd(module: TestModule): void {
		this.#measure(() => {
			this.#write({
				event: 'module',
				project: module.project.name,
				module: this.#relative(module.moduleId),
				state: module.state(),
				duration: Math.round(module.diagnostic().duration),
				...this.#stamp(),
			})
		})
	}

	// The first parameter only holds the position Vitest passes the modules in.
	onTestRunEnd(
		_modules: readonly TestModule[],
		unhandled: readonly SerializedError[],
		reason: TestRunEndReason,
	): void {
		const errors = unhandled.map((error) => this.#error(error))
		this.#write({
			event: 'end',
			reason,
			overhead: Math.round(this.#overhead * 100) / 100,
			unhandled: errors,
			...this.#stamp(),
		})
	}

	#cancel(reason: string): void {
		this.#measure(() => {
			this.#write({ event: 'cancel', reason, wall: Date.now(), ...this.#stamp() })
		})
	}

	#error(error: SerializedError): ProgressError {
		return extractProgressError(error, this.#vitest?.config.root ?? process.cwd())
	}

	#relative(file: string): string {
		return normalizeProgressPath(file, this.#vitest?.config.root ?? process.cwd())
	}

	#stamp(): ProgressStamp {
		return { time: Math.round(performance.now() - this.#origin), pid: process.pid }
	}

	#measure(work: () => void): void {
		const begin = performance.now()
		try {
			work()
		} finally {
			this.#overhead += performance.now() - begin
		}
	}

	#write(event: ProgressEvent): void {
		if (this.#path === undefined) return
		appendFileSync(this.#path, `${JSON.stringify(event)}\n`)
	}
}
