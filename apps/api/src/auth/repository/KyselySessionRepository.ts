import { sql } from 'kysely'
import type { Trx } from '../../db/Trx.js'
import type { CreatedSession } from './CreatedSession.js'
import type { NewRefreshToken } from './NewRefreshToken.js'
import type { NewSession } from './NewSession.js'
import type { RotatedSession } from './RotatedSession.js'
import type { SessionRepository } from './SessionRepository.js'

/** Kysely implementation of {@link SessionRepository} over a single transaction. */
export class KyselySessionRepository implements SessionRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(private readonly trx: Trx) {}

  /** @inheritdoc */
  async insert(input: NewSession): Promise<CreatedSession> {
    const row = await this.trx
      .insertInto('core.sessions')
      .values({
        user_id: input.userId,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
      })
      .returning(['id', 'family_id'])
      .executeTakeFirstOrThrow()
    return { id: row.id, familyId: row.family_id }
  }

  /** @inheritdoc */
  async rotate(tokenHash: string, next: NewRefreshToken): Promise<RotatedSession | undefined> {
    const result = await sql<{
      session_id: string
      user_id: string
      family_id: string
      email: string
      timezone: string
    }>`SELECT * FROM core.rotate_refresh_token(${tokenHash}, ${next.tokenHash}, ${next.expiresAt})`.execute(this.trx)
    const row = result.rows[0]
    if (row === undefined) return undefined
    return {
      sessionId: row.session_id,
      familyId: row.family_id,
      user: { id: row.user_id, email: row.email, timezone: row.timezone },
    }
  }

  /** @inheritdoc */
  async revokeFamilyOf(tokenHash: string): Promise<boolean> {
    const result = await sql<{ known: boolean }>`
      SELECT core.revoke_session_family(${tokenHash}) AS known
    `.execute(this.trx)
    return result.rows[0]?.known === true
  }

  /** @inheritdoc */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.trx
      .updateTable('core.sessions')
      .set({ revoked_at: sql<Date>`now()` })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute()
  }

  /** @inheritdoc */
  async isFamilyActive(familyId: string): Promise<boolean> {
    const result = await sql<{ active: boolean }>`
      SELECT core.session_is_active(${familyId}::uuid) AS active
    `.execute(this.trx)
    return result.rows[0]?.active === true
  }

  /** @inheritdoc */
  async purgeDead(retainSeconds: number): Promise<number> {
    const result = await sql<{ purged: string }>`
      SELECT core.purge_expired_sessions(make_interval(secs => ${retainSeconds})) AS purged
    `.execute(this.trx)
    return Number(result.rows[0]?.purged ?? 0)
  }
}
