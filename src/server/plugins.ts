import type { VitestPluginContext } from 'vitest/node'
import type { ProgressPluginInterface } from './types.js'
import { matchesProgressReporter } from './helpers.js'
import { ProgressReporter } from './reporters/ProgressReporter.js'

/**
 * Creates a Vitest plugin that adds one `ProgressReporter` to every run naming a progress file, so
 * the reporter still runs when command-line `--reporter` flags replace the configured reporters.
 *
 * @remarks Mount the value in the root `plugins` of a configuration. Vitest calls its hook once per
 * project that carries it, and the hook adds a reporter only while the run's reporters hold no
 * `ProgressReporter` from any copy of this package, read by its `PROGRESS_BRAND` brand, so a run
 * writes one `init` line wherever the plugin is mounted, a configuration that imports the package
 * by a file path included. The hook adds
 * a reporter when the resolved `outputFile` names `progress`, from `--outputFile.progress` or from
 * the configuration's `outputFile`, and adds none otherwise, because `ProgressReporter` refuses to
 * initialize without that file.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vitest/config'
 * import { createProgressPlugin } from '@orkestrel/test/server'
 *
 * export default defineConfig({
 * 	plugins: [createProgressPlugin()],
 * 	test: { projects: [() => ({ test: { name: 'unit' } })] },
 * })
 * // npx vitest run --reporter=dot --outputFile.progress=tmp/runs/progress.jsonl
 * ```
 */
export function createProgressPlugin(): ProgressPluginInterface {
	return {
		name: 'orkestrel:progress',
		configureVitest({ vitest }: VitestPluginContext): void {
			const output = vitest.config.outputFile
			if (typeof output !== 'object' || output.progress === undefined) return
			// A project that mounts the plugin evaluates the configuration again, so the run's
			// reporters, not the plugin value, decide whether a progress reporter is already present.
			if (vitest.config.reporters.some((entry) => matchesProgressReporter(entry))) return
			// Vitest builds the run's reporters from this array after the last configureVitest hook.
			vitest.config.reporters.push(new ProgressReporter())
		},
	}
}
