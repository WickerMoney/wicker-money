import type { UserRole } from '../../db/models/index.js'

/**
 * An account as an owner sees it when managing roles. Deliberately narrow: no
 * password digest, time zone or anything else about the account.
 */
export interface ManagedUser {
  /** User id. */
  readonly id: string
  /** Normalised email address. */
  readonly email: string
  /** What the account may do on this instance. */
  readonly role: UserRole
  /** When the account was created. */
  readonly createdAt: Date
}
