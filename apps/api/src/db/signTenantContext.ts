import { createHmac } from 'node:crypto'

/**
 * Signs a user id for use as the `app.user_sig` setting.
 *
 * @param key - Key from {@link deriveTenantContextKey}.
 * @param userId - The exact text that will be bound as `app.user_id`.
 * @returns Lowercase hex HMAC-SHA256 of `userId`, which is what
 *   `core.current_user_id()` verifies.
 */
export function signTenantContext(key: Buffer, userId: string): string {
  return createHmac('sha256', key).update(userId, 'utf8').digest('hex')
}
