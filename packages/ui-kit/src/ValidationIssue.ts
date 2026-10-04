/**
 * One problem the server found with a request, tied to the field it came from.
 *
 * The shape of each entry in a `validation_failed` response's `issues`.
 * `path` spells the field as the request body does (`['conditions', 0,
 * 'amountMin']`); an empty path means the request as a whole. `message` is a
 * sentence about the field that does not repeat its name.
 */
export interface ValidationIssue {
  /** Where in the request body the problem is; empty for the whole request. */
  readonly path: readonly (string | number)[]
  /** What is wrong, as a sentence. */
  readonly message: string
}
