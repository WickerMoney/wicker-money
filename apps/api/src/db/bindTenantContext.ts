import { sql } from 'kysely'
import type { Trx } from './Trx.js'
import { requireTenantContextKey } from './requireTenantContextKey.js'
import { signTenantContext } from './signTenantContext.js'

/**
 * Binds `userId` and its signature to the current transaction so that
 * `core.current_user_id()` resolves to it.
 *
 * Both values are set with `set_config(..., true)` (transaction-local, so they
 * cannot leak to the next checkout of a pooled connection) and are passed as
 * bound parameters. This must be the only code that writes these settings.
 *
 * @param trx - An open transaction.
 * @param userId - The tenant to bind.
 * @throws {Error} If the tenant context has not been configured.
 */
export async function bindTenantContext(trx: Trx, userId: string): Promise<void> {
  const signature = signTenantContext(requireTenantContextKey(), userId)
  await sql`
    SELECT set_config('app.user_id', ${userId}, true),
           set_config('app.user_sig', ${signature}, true)
  `.execute(trx)
}
