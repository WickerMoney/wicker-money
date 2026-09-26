import type { AnalyzeInput } from './AnalyzeInput.js'

/** An {@link AnalyzeInput} plus what the user decided about the preview. */
export interface CommitInput extends AnalyzeInput {
  /** The uploaded file's name, already truncated to the column width. */
  readonly fileName: string
  /** Row numbers of flagged rows the user confirmed are genuinely new. */
  readonly acceptRowNumbers: readonly number[]
  /**
   * The client's key for this commit. A later commit with the same key does not
   * import again; it reports the outcome of the first.
   */
  readonly idempotencyKey?: string
}
