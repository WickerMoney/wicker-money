import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { UserRole } from '../../db/models/index.js'
import type { ManagedUser } from '../repository/ManagedUser.js'
import type { RoleChange } from './RoleChange.js'

/**
 * Owner-only administration of the instance's accounts: who they are and
 * what role each has.
 *
 * Authorization is the caller's job in the HTTP layer (`requireOwner`) and
 * is also enforced by the database functions behind this service, using the
 * user the unit of work is bound to. The rules that protect the instance
 * (it always keeps an owner; two owners demoting each other cannot leave
 * none) live in `core.set_user_role`, because they depend on a count taken
 * under a lock, which only the database can do correctly.
 *
 * Changing a role does not touch the affected account's sessions: the role
 * is read from the database on every request, so it applies on that
 * account's next request.
 */
export class UserAdminService {
  /** @param uow - Transaction boundary for all persistence. */
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Lists every account on the instance, oldest first.
   *
   * @param callerId - The authenticated owner.
   * @returns The accounts, with email, role and creation time.
   * @throws {OwnerRequiredError} If the caller is not an owner.
   */
  list(callerId: string): Promise<ManagedUser[]> {
    return this.uow.forUser(callerId, (repos) => repos.userAdmin.list(), { readOnly: true })
  }

  /**
   * Gives an account a role.
   *
   * Promoting an account to `owner` is how an instance gets a second owner.
   * Demoting is refused when it would remove the last one, including an
   * owner demoting themselves while they are the only owner. Asking for the
   * role an account already has succeeds and reports `changed: false`.
   *
   * @param callerId - The authenticated owner.
   * @param userId - The account to change; may be the caller's own.
   * @param role - The role it should have.
   * @returns The account as it now is and what it was before.
   * @throws {OwnerRequiredError} If the caller is not an owner (including one demoted a moment ago).
   * @throws {NotFoundError} If no account has that id.
   * @throws {LastOwnerError} If the change would leave the instance with no owner.
   */
  async setRole(callerId: string, userId: string, role: UserRole): Promise<RoleChange> {
    const { user, previousRole } = await this.uow.forUser(callerId, (repos) => repos.userAdmin.setRole(userId, role))
    return { user, previousRole, changed: previousRole !== user.role }
  }
}
