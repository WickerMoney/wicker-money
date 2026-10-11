import type { UserRole } from '../../db/models/index.js'
import type { ManagedUser } from '../repository/ManagedUser.js'

/** The outcome of a role change request. */
export interface RoleChange {
  /** The account as it is now. */
  readonly user: ManagedUser
  /** The role it had before the request. */
  readonly previousRole: UserRole
  /** `false` when the account already had the requested role and nothing was written. */
  readonly changed: boolean
}
