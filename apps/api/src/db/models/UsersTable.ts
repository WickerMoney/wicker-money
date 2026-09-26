import type { Generated, Selectable } from 'kysely'
import type { Timestamp, TimestampWithDefault } from './columns.js'
import type { UserRole } from './UserRole.js'

/** A person who can sign in. Owns every ledger row that carries their `user_id`. */
export interface UsersTable {
  id: Generated<string>
  email: string
  password_hash: string
  role: Generated<UserRole>
  timezone: Generated<string>
  /** `null` until first-run setup has been finished. */
  onboarded_at: Timestamp | null
  /** What the user said applies to them, as situation slugs. */
  onboarding_situations: Generated<string[]>
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}

export type User = Selectable<UsersTable>
