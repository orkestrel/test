import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractProgressEvents, readProgress } from '@src/server'
import {
	CAPTURE_FLAGS,
	createServerFixture,
	readOutput,
	renderPluginConfig,
	runVitestFixture,
} from '../../setupServer.js'

// Each case builds the server entry and spawns a Vitest process, which costs about half a second
// alone and more under a full suite.
describe('the progress plugin in a spawned Vitest run', { timeout: 30_000 }, () => {
	it('createProgressPlugin keeps its reporter under command-line reporter flags', async ({
		onTestFinished,
	}) => {
		const scratch = await createServerFixture('pin-')
		onTestFinished(() => scratch.destroy())
		const run = runVitestFixture(
			scratch,
			renderPluginConfig({ root: true, projects: false, listed: false, named: false }),
			CAPTURE_FLAGS,
		)
		expect([run.result.status, readOutput(run.result)]).toStrictEqual([0, expect.any(String)])
		expect(run.instances).toBe(1)
		expect(JSON.parse(run.report ?? 'null')).toMatchObject({
			success: true,
			numTotalTests: 2,
			numPassedTests: 2,
		})
		const events = extractProgressEvents(run.progress ?? '').map((event) => event.event)
		expect([events.at(0), events.at(-1)]).toStrictEqual(['init', 'end'])
		expect(events.filter((event) => event === 'init')).toStrictEqual(['init'])
		expect(
			readProgress(join(scratch.path, 'progress.jsonl')).map((progress) => ({
				state: progress.state,
				done: progress.done,
				planned: progress.planned,
				projects: progress.projects.map((project) => project.name),
			})),
		).toStrictEqual([{ state: 'passed', done: 2, planned: 2, projects: ['alpha', 'beta'] }])
	})

	it('writes no progress file under the same flags from a listed reporter and no plugin', async ({
		onTestFinished,
	}) => {
		const scratch = await createServerFixture('listed-')
		onTestFinished(() => scratch.destroy())
		const run = runVitestFixture(
			scratch,
			renderPluginConfig({ root: false, projects: false, listed: true, named: false }),
			CAPTURE_FLAGS,
		)
		expect([run.result.status, readOutput(run.result)]).toStrictEqual([0, expect.any(String)])
		expect(run.instances).toBe(0)
		expect(JSON.parse(run.report ?? 'null')).toMatchObject({ success: true, numPassedTests: 2 })
		expect(run.progress).toBeUndefined()
	})

	it('exits 0 and writes no progress file from the plugin when no progress file is named', async ({
		onTestFinished,
	}) => {
		const scratch = await createServerFixture('unnamed-')
		onTestFinished(() => scratch.destroy())
		const run = runVitestFixture(
			scratch,
			renderPluginConfig({ root: true, projects: false, listed: false, named: false }),
			CAPTURE_FLAGS.filter((flag) => !flag.startsWith('--outputFile.progress=')),
		)
		expect([run.result.status, readOutput(run.result)]).toStrictEqual([0, expect.any(String)])
		expect(run.instances).toBe(0)
		expect(JSON.parse(run.report ?? 'null')).toMatchObject({ success: true, numPassedTests: 2 })
		expect(run.progress).toBeUndefined()
	})

	it('adds its reporter when only the configuration names the progress file', async ({
		onTestFinished,
	}) => {
		const scratch = await createServerFixture('configured-')
		onTestFinished(() => scratch.destroy())
		const run = runVitestFixture(
			scratch,
			renderPluginConfig({ root: true, projects: false, listed: false, named: true }),
			CAPTURE_FLAGS.filter((flag) => !flag.startsWith('--outputFile.')),
		)
		expect([run.result.status, readOutput(run.result)]).toStrictEqual([0, expect.any(String)])
		expect(run.instances).toBe(1)
		expect(JSON.parse(run.report ?? 'null')).toMatchObject({ success: true, numPassedTests: 2 })
		const events = extractProgressEvents(run.progress ?? '').map((event) => event.event)
		expect([events.at(0), events.at(-1)]).toStrictEqual(['init', 'end'])
	})

	it('holds one reporter from a listed reporter and the plugin under no reporter flag', async ({
		onTestFinished,
	}) => {
		const scratch = await createServerFixture('both-')
		onTestFinished(() => scratch.destroy())
		const run = runVitestFixture(
			scratch,
			renderPluginConfig({ root: true, projects: false, listed: true, named: false }),
			['--outputFile.progress=progress.jsonl'],
		)
		expect([run.result.status, readOutput(run.result)]).toStrictEqual([0, expect.any(String)])
		expect(run.instances).toBe(1)
		const events = extractProgressEvents(run.progress ?? '').map((event) => event.event)
		expect(events.filter((event) => event === 'init' || event === 'end')).toStrictEqual([
			'init',
			'end',
		])
	})

	it('writes exactly one init line from the plugin on the root and on each project', async ({
		onTestFinished,
	}) => {
		const scratch = await createServerFixture('mounted-')
		onTestFinished(() => scratch.destroy())
		const run = runVitestFixture(
			scratch,
			renderPluginConfig({ root: true, projects: true, listed: false, named: false }),
			CAPTURE_FLAGS,
		)
		expect([run.result.status, readOutput(run.result)]).toStrictEqual([0, expect.any(String)])
		expect(run.instances).toBe(1)
		const events = extractProgressEvents(run.progress ?? '').map((event) => event.event)
		expect(events.filter((event) => event === 'init' || event === 'end')).toStrictEqual([
			'init',
			'end',
		])
	})
})
