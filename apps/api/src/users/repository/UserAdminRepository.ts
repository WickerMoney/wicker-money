import type { UserRole } from '../../db/models/index.js'
import type { ManagedUser } from './ManagedUser.js'
import type { RoleChangeResult } from './RoleChangeResult.js'

/**
 * Persistence for instance-wide account administration.
 *
 * Both operations need to see accounts other than the caller's, which row-level
 * security on `core.users` forbids, so they call `SECURITY DEFINER` functions
 * (migration 029). Each function checks for itself that the caller, taken from
 * the unit of work's signed user context, is an owner.
 */
export interface UserAdminRepository {
  /**
   * Lists every account on the instance, oldest first.
   *
   * @returns The accounts.
   * @throws {OwnerRequiredError} When the unit of work's user is not an owner.
   */
  list(): Promise<ManagedUser[]>

  /**
   * Sets an account's role. Setting the role it already has changes nothing.
   *
   * @param userId - The account to change.
   * @param role - The role it should have.
   * @returns The account as it now is, and the role it had.
   * @throws {OwnerRequiredError} When the unit of work's user is not an owner.
   * @throws {NotFoundError} When no account has that id.
   * @throws {LastOwnerError} When the change would leave no owner.
   */
  setRole(userId: string, role: UserRole): Promise<RoleChangeResult>
}
