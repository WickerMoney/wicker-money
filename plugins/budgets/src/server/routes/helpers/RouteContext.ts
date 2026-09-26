/** The per-request input a route handler receives from the host. */
export interface RouteContext {
  /** The authenticated user the request runs as. */
  readonly userId: string
  /** The parsed JSON body, unvalidated. */
  readonly body: unknown
  /** Path parameters. */
  readonly params: Record<string, string>
  /** Query-string parameters; a parameter that was not sent is `undefined`. */
  readonly query: Record<string, string | undefined>
}
