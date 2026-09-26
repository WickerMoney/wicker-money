import type { Generated } from 'kysely'
import type { Timestamp, TimestampWithDefault } from './columns.js'

/** A refresh-token session. Only the hash of the token is stored, and it is single-use. */
export interface SessionsTable {
  id: Generated<string>
  user_id: string
  /** Shared by every token in one rotation chain; the `sid` claim of access tokens. */
  family_id: Generated<string>
  token_hash: string
  expires_at: Timestamp
  revoked_at: Timestamp | null
  created_at: TimestampWithDefault
}
