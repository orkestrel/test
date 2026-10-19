import { isFunction, isObject } from '@orkestrel/contract'
import { fileURLToPath } from 'node:url'
import type { AnyFunction } from '@orkestrel/contract'
import type { BrowserCommandContext, BrowserConfigOptions } from 'vitest/node'

const SERVER_ENTRY = fileURLToPath(new URL('../src/server/index.ts', import.meta.url))

function readChooser(loaded: unknown): AnyFunction | undefined {
	if (!isObject(loaded) || !('chooseFiles' in loaded)) return undefined
	return isFunction(loaded.chooseFiles) ? loaded.chooseFiles : undefined
}

export const commands: Readonly<NonNullable<BrowserConfigOptions['commands']>> = Object.freeze({
	chooseFiles: async (context: BrowserCommandContext, request: unknown): Promise<void> => {
		const chooseFiles = readChooser(await context.project.vitest.import<unknown>(SERVER_ENTRY))
		if (chooseFiles === undefined)
			throw new Error('The server entry exports no chooseFiles function')
		await chooseFiles(context, request)
	},
})
