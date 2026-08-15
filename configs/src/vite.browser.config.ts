import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcBrowser, resolveWorkspacePath } from '../../vite.config.ts'

// This face is ES only. Nothing consumes it from CommonJS, because `vitest/browser` — the peer it
// is built on — is an ES-only module itself, so no `.d.cts` is emitted and no copy step follows.
export default defineConfig(
	srcBrowser({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.browser.json'),
				bundleTypes: true,
			}),
		],
	}),
)
