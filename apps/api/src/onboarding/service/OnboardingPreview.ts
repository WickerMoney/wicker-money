/** What a set of answers would create. */
export interface OnboardingPreview {
  /** Categories the answers select, top-level and child. */
  readonly total: number
  /** How many of them are top-level. */
  readonly parents: number
  /** The catalog slugs selected, in creation order. */
  readonly slugs: readonly string[]
}
