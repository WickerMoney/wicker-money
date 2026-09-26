import { sql } from 'kysely'
import type { Db } from './client.js'
import { requireTenantContextKey } from './requireTenantContextKey.js'

/**
 * Installs (or replaces) the tenant-context key in the database, from the
 * configured `AUTH_SECRET`. Idempotent.
 *
 * @param db - Database handle connected as the database OWNER; the application
 *   role cannot execute the underlying function.
 * @throws {Error} If the tenant context has not been configured, or the role
 *   may not execute `core.install_tenant_context_key`.
 */
export async function installTenantContextKey(db: Db): Promise<void> {
  const key = requireTenantContextKey()
  await sql`SELECT core.install_tenant_context_key(${key})`.execute(db)
}
