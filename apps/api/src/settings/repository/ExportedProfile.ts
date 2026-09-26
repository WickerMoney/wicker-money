/** The user's own row as exported: everything except credentials. */
export interface ExportedProfile {
  /** User id. */
  readonly id: string
  /** Sign-in email. */
  readonly email: string
  /** IANA time zone. */
  readonly timezone: string
  /** When setup was finished, or `null`. */
  readonly onboarded_at: Date | null
  /** Situation slugs chosen during setup. */
  readonly onboarding_situations: readonly string[]
  /** When the account was created. */
  readonly created_at: Date
}
