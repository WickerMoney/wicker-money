/** One link in the sidebar navigation. */
export interface NavEntry {
  /** Route path the link navigates to. */
  readonly to: string
  /** Link text. */
  readonly label: string
  /** Sort key within a section; lower comes first. */
  readonly order: number
}
