import { sql } from 'kysely'
import type { UserRole } from '../../db/models/index.js'
import type { Trx } from '../../db/Trx.js'
import type { ManagedUser } from './ManagedUser.js'
import type { RoleChangeResult } from './RoleChangeResult.js'
import { translateRoleChangeError } from './translateRoleChangeError.js'
import type { UserAdminRepository } from './UserAdminRepository.js'

/** What `core.list_users_for_owner` and `core.set_user_role` return. */
interface UserRow {
  id: string
  email: string
  role: UserRole
  created_at: Date
}

const toManagedUser = (row: UserRow): ManagedUser => ({
  id: row.id,
  email: row.email,
  role: row.role,
  createdAt: row.created_at,
})

/** Kysely implementation of {@link UserAdminRepository} over a single transaction. */
export class KyselyUserAdminRepository implements UserAdminRepository {
  /** @param trx - The transaction all queries run on; it must be bound to the calling user. */
  constructor(private readonly trx: Trx) {}

  /** @inheritdoc */
  async list(): Promise<ManagedUser[]> {
    const result = await translateRoleChangeError(() =>
      sql<UserRow>`SELECT * FROM core.list_users_for_owner()`.execute(this.trx),
    )
    return result.rows.map(toManagedUser)
  }

  /** @inheritdoc */
  async setRole(userId: string, role: UserRole): Promise<RoleChangeResult> {
    const result = await translateRoleChangeError(() =>
      sql<UserRow & { previous_role: UserRole }>`
        SELECT * FROM core.set_user_role(${userId}::uuid, ${role}::core.user_role)
      `.execute(this.trx),
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error('core.set_user_role returned no row.')
    return { user: toManagedUser(row), previousRole: row.previous_role }
  }
}
