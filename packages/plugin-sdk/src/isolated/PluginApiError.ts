import type { PluginApiIssue, PluginErrorPayload } from './protocol.js'

/**
 * The error a failed `ctx.api` call rejects with inside an isolated frame.
 *
 * The fields match the host's own `ApiError` (`status`, `code`, `issues`), so a
 * plugin's `catch` blocks and ui-kit's `formErrorsFrom` read it the same way in
 * either runtime. `status` is `0` when the failure did not come from an HTTP
 * response (a grant refusal, an abort, a lost connection). An aborted request
 * has `name === 'AbortError'`, like a rejected `fetch`.
 */
export class PluginApiError extends Error {
  /** The HTTP status of the API response, or `0` when there was none. */
  readonly status: number
  /** A code to branch on; see `PLUGIN_ERROR_CODES` for the ones the host promises. */
  readonly code: string
  /** Field-by-field problems; empty when there are none. */
  readonly issues: readonly PluginApiIssue[]

  constructor(payload: PluginErrorPayload) {
    super(payload.message)
    this.name = payload.code === 'aborted' ? 'AbortError' : 'PluginApiError'
    this.status = payload.status ?? 0
    this.code = payload.code
    this.issues = payload.issues ?? []
  }
}
