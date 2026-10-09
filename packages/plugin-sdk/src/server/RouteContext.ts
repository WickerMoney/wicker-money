/** The per-request input a route handler receives from the host. */
export interface RouteContext {
  /** The authenticated user the request runs as, taken from the verified token, never from the plugin. */
  readonly userId: string
  /** The parsed JSON body, unvalidated. */
  readonly body: unknown
  /** Path parameters, such as `id` in `/batches/:id/revert`. */
  readonly params: Record<string, string>
  /** Query-string parameters; a parameter that was not sent is `undefined`. */
  readonly query: Record<string, string | undefined>
}
