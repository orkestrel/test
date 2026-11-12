import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
	createScratch,
	extractProgressEvents,
	filterProgressEvents,
	ProgressReporter,
	readProgress,
	renderProgress,
} from '@src/server'
import { PROGRESS_MODULES, recordProgressRun } from '../../../setupServer.js'

describe('ProgressReporter', () => {
	it('writes one stamped line per run event, from init to end', { timeout: 60_000 }, async () => {
		const { progress } = await recordProgressRun({ reporters: [new ProgressReporter()] })
		const events = extractProgressEvents(progress ?? '')
		expect(events.at(0)).toMatchObject({ event: 'init', version: 1, bail: 0 })
		expect(events.at(-1)).toMatchObject({ event: 'end', reason: 'failed', unhandled: [] })
		expect(events.every((event) => event.pid === process.pid && event.time >= 0)).toBe(true)
		expect(filterProgressEvents(events, 'start').at(0)?.modules).toEqual(
			expect.arrayContaining([
				{ project: '', module: 'fails.test.js' },
				{ project: '', module: 'waits.test.js' },
			]),
		)
		const planned = Object.fromEntries(
			filterProgressEvents(events, 'collected').map((entry) => [entry.module, entry.planned]),
		)
		expect(planned).toEqual({ 'fails.test.js': 1, 'waits.test.js': 4 })
		const lines = (PROGRESS_MODULES['fails.test.js'] ?? '').split('\n')
		const row = lines.findIndex((line) => line.includes('new Error('))
		const column = (lines[row] ?? '').indexOf('new Error(') + 1
		const failed = filterProgressEvents(events, 'case').find((entry) => entry.state === 'failed')
		expect(failed).toMatchObject({
			module: 'fails.test.js',
			name: 'fails first',
			errors: [
				{ message: 'Error: planted failure', location: `fails.test.js:${row + 1}:${column}` },
			],
		})
		expect(failed?.duration).toBeGreaterThanOrEqual(0)
		expect(failed?.start).toBeGreaterThan(0)
		expect(
			filterProgressEvents(events, 'case')
				.map((entry) => entry.state)
				.sort(),
		).toEqual(['failed', 'passed', 'passed', 'passed', 'passed'])
		expect(
			filterProgressEvents(events, 'module')
				.map((entry) => entry.state)
				.sort(),
		).toEqual(['failed', 'passed'])
		expect(filterProgressEvents(events, 'ready')).toHaveLength(5)
		expect(filterProgressEvents(events, 'end').at(0)?.overhead).toBeGreaterThan(0)
	})

	it('writes a cancel line when bail cancels the run', { timeout: 60_000 }, async () => {
		const { progress } = await recordProgressRun({ reporters: [new ProgressReporter()], bail: 1 })
		const events = extractProgressEvents(progress ?? '')
		expect(filterProgressEvents(events, 'cancel').at(0)).toMatchObject({ reason: 'test-failure' })
		expect(filterProgressEvents(events, 'end').at(0)?.reason).toBe('interrupted')
	})

	it('writes nothing for a case a name filter removed', { timeout: 60_000 }, async () => {
		const { progress } = await recordProgressRun({
			reporters: [new ProgressReporter()],
			pattern: 'kept by the filter',
		})
		const events = extractProgressEvents(progress ?? '')
		expect(
			filterProgressEvents(events, 'collected').reduce((total, entry) => total + entry.planned, 0),
		).toBe(1)
		expect(filterProgressEvents(events, 'ready').map((entry) => entry.name)).toEqual([
			'kept by the filter',
		])
		expect(filterProgressEvents(events, 'case').map((entry) => entry.name)).toEqual([
			'kept by the filter',
		])
	})

	it('writes exactly one case line for each planned case', { timeout: 60_000 }, async () => {
		const { progress } = await recordProgressRun({ reporters: [new ProgressReporter()], bail: 1 })
		const events = extractProgressEvents(progress ?? '')
		const ids = filterProgressEvents(events, 'case').map((entry) => entry.id)
		expect(ids).toHaveLength(new Set(ids).size)
		expect(ids).toHaveLength(
			filterProgressEvents(events, 'collected').reduce((total, entry) => total + entry.planned, 0),
		)
	})

	it(
		'writes its file beside the dot and JSON reporters under the arguments capture passes',
		{ timeout: 60_000 },
		async () => {
			const { progress, report } = await recordProgressRun({
				reporters: ['dot', 'json', new ProgressReporter()],
				bail: 1,
				loader: true,
			})
			expect(JSON.parse(report ?? '')).toMatchObject({ numFailedTests: 1 })
			expect(extractProgressEvents(progress ?? '').at(-1)).toMatchObject({ event: 'end' })
		},
	)

	it('refuses to initialize without an outputFile.progress path', { timeout: 60_000 }, async () => {
		await expect(
			recordProgressRun({ reporters: [new ProgressReporter()], named: false }),
		).rejects.toThrow(
			'ProgressReporter writes no file: pass --outputFile.progress=<file>, or set outputFile: { progress: <file> } in the test config',
		)
	})

	// guides/test.md → Patterns → "Read a long run while it runs". The configuration fence lists the
	// reporter beside `dot`; the read fence summarizes the file that run wrote.
	it('reads the file the guide configuration writes', { timeout: 60_000 }, async () => {
		const { progress } = await recordProgressRun({ reporters: ['dot', new ProgressReporter()] })
		const scratch = createScratch({ files: { 'progress.jsonl': progress ?? '' } })
		try {
			const runs = readProgress(join(scratch.path, 'progress.jsonl'))
			expect(runs[0]?.state).toBe('failed')
			expect(runs[0]?.failures[0]?.relation).toBe('first')
			expect(renderProgress(runs)).toContain('  FIRST ')
		} finally {
			scratch.destroy()
		}
	})
})
