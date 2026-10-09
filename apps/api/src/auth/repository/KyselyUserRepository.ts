import { sql } from 'kysely'
import { translateDuplicateKey } from '../../data/translateDuplicateKey.js'
import type { UserRole } from '../../db/models/index.js'
import type { Trx } from '../../db/Trx.js'
import { BOOTSTRAP_OWNER_SETTING } from './BOOTSTRAP_OWNER_SETTING.js'
import type { LoginCandidate } from './LoginCandidate.js'
import type { UserIdentity } from './UserIdentity.js'
import type { UserRepository } from './UserRepository.js'

/** Kysely implementation of {@link UserRepository} over a single transaction. */
export class KyselyUserRepository implements UserRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(private readonly trx: Trx) {}

  /** @inheritdoc */
  async register(email: string, passwordHash: string, bootstrapOwnerEmail?: string): Promise<UserIdentity> {
    // The database cannot read the environment, so the configured owner email
    // travels as a setting that ends with this transaction. See migration 027.
    if (bootstrapOwnerEmail !== undefined) {
      await sql`SELECT set_config(${BOOTSTRAP_OWNER_SETTING}, ${bootstrapOwnerEmail}, true)`.execute(this.trx)
    }
    // A plain INSERT is denied by row-level security: no user context exists
    // yet, and a fresh row cannot satisfy a policy keyed on its own id.
    const result = await translateDuplicateKey(() =>
      sql<{ id: string; email: string; timezone: string }>`
        SELECT * FROM core.register_user(${email}, ${passwordHash})
      `.execute(this.trx),
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error('core.register_user returned no row.')
    return { id: row.id, email: row.email, timezone: row.timezone }
  }

  /** @inheritdoc */
  async findForLogin(email: string): Promise<LoginCandidate | undefined> {
    const result = await sql<{
      id: string
      email: string
      timezone: string
      password_hash: string
    }>`SELECT * FROM core.find_user_for_login(${email})`.execute(this.trx)
    const row = result.rows[0]
    if (row === undefined) return undefined
    return { id: row.id, email: row.email, timezone: row.timezone, passwordHash: row.password_hash }
  }

  /** @inheritdoc */
  async findIdentity(userId: string): Promise<UserIdentity | undefined> {
    return this.trx
      .selectFrom('core.users')
      .select(['id', 'email', 'timezone'])
      .where('id', '=', userId)
      .executeTakeFirst()
  }

  /** @inheritdoc */
  async findRole(userId: string): Promise<UserRole | undefined> {
    const row = await this.trx
      .selectFrom('core.users')
      .select('role')
      .where('id', '=', userId)
      .executeTakeFirst()
    return row?.role
  }

  /** @inheritdoc */
  async findPasswordHash(userId: string): Promise<string | undefined> {
    const row = await this.trx
      .selectFrom('core.users')
      .select('password_hash')
      .where('id', '=', userId)
      .executeTakeFirst()
    return row?.password_hash
  }

  /** @inheritdoc */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.trx
      .updateTable('core.users')
      .set({ password_hash: passwordHash, updated_at: sql<Date>`now()` })
      .where('id', '=', userId)
      .execute()
  }

  /** @inheritdoc */
  async updateTimezone(userId: string, timezone: string): Promise<UserIdentity | undefined> {
    return this.trx
      .updateTable('core.users')
      .set({ timezone, updated_at: sql<Date>`now()` })
      .where('id', '=', userId)
      .returning(['id', 'email', 'timezone'])
      .executeTakeFirst()
  }
}
