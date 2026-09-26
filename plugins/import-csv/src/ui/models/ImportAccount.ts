/** An account the user can import into, as returned by the core account listing. */
export interface ImportAccount {
  readonly id: string
  readonly name: string
  readonly type: string
}
