/** What the current wizard selection would create, as returned by `POST /onboarding/preview`. */
export interface PreviewResult {
  /** Total categories that would exist. */
  readonly total: number
  /** How many of them are top-level groups. */
  readonly parents: number
}
