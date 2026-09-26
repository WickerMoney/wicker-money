import { sql, type Kysely } from 'kysely'
import { createIndexIfMissing } from './support/index.js'

/**
 * Creates `core.users` and `core.sessions`.
 *
 * Email uniqueness is case-insensitive (unique index on `lower(email)`).
 * Sessions store only a hash of the bearer token and cascade-delete with their
 * user. Safe to re-run: existing tables and indexes are left as they are.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS core.users (
      id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      email         varchar(320) NOT NULL,
      password_hash text        NOT NULL,
      role          core.user_role NOT NULL DEFAULT 'owner',
      -- IANA zone name. Period boundaries and "today" are computed in the
      -- user's zone, never UTC.
      timezone      text        NOT NULL DEFAULT 'UTC',
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await createIndexIfMissing(db, 'core.ux_users_email', 'ON core.users (lower(email))', { unique: true })

  await sql`
    CREATE TABLE IF NOT EXISTS core.sessions (
      id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id       uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      -- Only the hash is stored; the token itself never touches the database.
      token_hash    char(64)    NOT NULL,
      expires_at    timestamptz NOT NULL,
      revoked_at    timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await createIndexIfMissing(db, 'core.ux_sessions_token_hash', 'ON core.sessions (token_hash)', { unique: true })
  await createIndexIfMissing(db, 'core.ix_sessions_user_id', 'ON core.sessions (user_id)')
}

/**
 * Drops `core.sessions` and `core.users`.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS core.sessions`.execute(db)
  await sql`DROP TABLE IF EXISTS core.users`.execute(db)
}
