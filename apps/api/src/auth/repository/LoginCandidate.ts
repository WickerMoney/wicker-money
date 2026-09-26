import type { UserIdentity } from './UserIdentity.js'

/** An account found by email, with the stored password digest to verify against. */
export interface LoginCandidate extends UserIdentity {
  /** Stored Argon2 digest. */
  readonly passwordHash: string
}
