/** What `GET /settings/erase-instance` tells an owner before they confirm. */
export interface InstanceEraseCheck {
  /** The database this server is using, so the owner can tell instances apart. */
  readonly databaseName: string
  /** `false` when registration is switched off. */
  readonly registrationEnabled: boolean
  /** The only address allowed to become the owner afterwards, or `null`. */
  readonly bootstrapOwnerEmail: string | null
  /** Live sessions other than this one. */
  readonly otherSessions: number
  /** Other accounts with a live session. */
  readonly otherUsers: number
  /** Why the erase cannot go ahead, or `null`. */
  readonly blocker: 'registration_disabled' | 'bootstrap_owner_mismatch' | null
}
