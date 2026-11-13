import { defineConfig } from 'vite'
import { declarationRollup, rewriteServerSpecifier } from '../helpers.js'
import { resolveWorkspacePath, srcReporter } from '../../vite.config.ts'

// Each external `@src/*` path resolves from `dist/reporter/` to the built environment.
export default defineConfig(
	srcReporter({
		plugins: [
			declarationRollup({
				project: resolveWorkspacePath('configs/src/tsconfig.reporter.json'),
				rewrite: rewriteServerSpecifier,
			}),
		],
		build: {
			rolldownOptions: {
				output: {
					paths: {
						'@src/core': '../src/core/index.js',
						'@src/browser': '../src/browser/index.js',
						'@src/server': '../src/server/index.js',
					},
				},
			},
		},
	}),
)
