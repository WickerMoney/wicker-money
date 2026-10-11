import type { UserRole } from '../../db/models/index.js'
import type { ManagedUser } from './ManagedUser.js'

/** What the database reports after a role change. */
export interface RoleChangeResult {
  /** The account as it is now. */
  readonly user: ManagedUser
  /** The role it had before the call; equal to `user.role` when nothing changed. */
  readonly previousRole: UserRole
}
