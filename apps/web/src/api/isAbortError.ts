/**
 * Reports whether a rejection came from an aborted request.
 *
 * Matches on the error name rather than `instanceof`: the `DOMException` a
 * `fetch` rejects with can come from a different realm than the one this code
 * runs in.
 *
 * @param error - Anything caught from an API call.
 * @returns `true` for the `AbortError` a cancelled `fetch` rejects with.
 */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}
