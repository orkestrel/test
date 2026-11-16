import type { AnyFunction } from '@orkestrel/contract'
import type { BrowserCommandContext, BrowserConfigOptions } from 'vitest/node'
import { isFunction, isObject, isString } from '@orkestrel/contract'
import { fileURLToPath } from 'node:url'
import { isFileLoadingAllowed, normalizePath } from 'vite'

const SERVER_ENTRY = fileURLToPath(new URL('../src/server/index.ts', import.meta.url))

function readCommand(loaded: unknown, name: string): AnyFunction | undefined {
	if (!isObject(loaded)) return undefined
	const command: unknown = Reflect.get(loaded, name)
	return isFunction(command) ? command : undefined
}

export const commands: Readonly<NonNullable<BrowserConfigOptions['commands']>> = Object.freeze({
	chooseFiles: async (context: BrowserCommandContext, request: unknown): Promise<void> => {
		const chooseFiles = readCommand(
			await context.project.vitest.import<unknown>(SERVER_ENTRY),
			'chooseFiles',
		)
		if (chooseFiles === undefined)
			throw new Error('The server entry exports no chooseFiles function')
		await chooseFiles(context, request)
	},
	readCapture: async (context: BrowserCommandContext, path: string): Promise<string> => {
		const normalized = normalizePath(path)
		if (
			!isFileLoadingAllowed(context.project.vite.config, normalized) &&
			!isFileLoadingAllowed(context.project.vitest.vite.config, normalized)
		) {
			throw new Error(
				`Access denied to "${path}". See Vite config documentation for "server.fs": https://vitejs.dev/config/server-options.html#server-fs-strict.`,
			)
		}
		const readCapture = readCommand(
			await context.project.vitest.import<unknown>(SERVER_ENTRY),
			'readCapture',
		)
		if (readCapture === undefined)
			throw new Error('The server entry exports no readCapture function')
		const digest: unknown = await readCapture(path)
		if (!isString(digest)) throw new Error('The readCapture command returned no digest string')
		return digest
	},
})
