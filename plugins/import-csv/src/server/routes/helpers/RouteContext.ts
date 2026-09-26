/** What the host passes to a plugin route handler for one request. */
export interface RouteContext {
  /** The authenticated user making the request. */
  readonly userId: string
  /** The parsed JSON request body, unvalidated. */
  readonly body: unknown
  /** Path parameters, such as `id` in `/batches/:id/revert`. */
  readonly params: Record<string, string>
  /** Query-string parameters. */
  readonly query: Record<string, string | undefined>
}
