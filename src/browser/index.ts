/**
 * Loads only inside Vitest Browser Mode, where it drives a real browser through the installed
 * provider.
 *
 * @remarks
 * This entry imports `vitest/browser` at module scope, so importing it from a Node host throws at
 * module load. That throw is the contract: it arrives at the import that caused it rather than
 * inside the first helper call, and no Node host half-loads a surface whose every verb assumes the
 * Browser Mode runner.
 *
 * A module that must load under Node as well reaches this entry through a dynamic import behind a
 * DOM guard. A setup file that a Node project and a browser project both register is the case that
 * needs it.
 *
 * @example
 * ```ts
 * let render: ((markup: string) => HTMLDivElement) | undefined
 * if (typeof document !== 'undefined') {
 * 	;({ render } = await import('@orkestrel/test/browser'))
 * }
 * ```
 *
 * @packageDocumentation
 */
export * from './types.js'
export * from './constants.js'
export * from './helpers.js'
export * from './factories.js'
