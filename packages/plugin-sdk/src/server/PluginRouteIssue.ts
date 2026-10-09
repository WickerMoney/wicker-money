/** One problem with a request, tied to the body field it is about. */
export interface PluginRouteIssue {
  /** The field, as the request body spells it; empty for the request as a whole. */
  readonly path: readonly (string | number)[]
  /** A sentence about that field that does not repeat its name. */
  readonly message: string
}
