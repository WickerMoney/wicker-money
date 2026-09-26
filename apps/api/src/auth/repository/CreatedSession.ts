/** Identifiers of a session that was just stored. */
export interface CreatedSession {
  /** Session row id. */
  readonly id: string
  /** Rotation chain the session belongs to; the `sid` claim of access tokens. */
  readonly familyId: string
}
