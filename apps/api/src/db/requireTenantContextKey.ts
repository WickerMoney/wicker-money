import { tenantContextKeyStore } from './tenantContextKeyStore.js'

/**
 * Returns the configured tenant-context key.
 *
 * @returns The 32-byte key.
 * @throws {Error} If {@link configureTenantContext} has not been called;
 *   proceeding unsigned would make every query silently return no rows.
 */
export function requireTenantContextKey(): Buffer {
  const key = tenantContextKeyStore.key
  if (key === undefined) {
    throw new Error(
      'Tenant context is not configured: call configureTenantContext(AUTH_SECRET) at startup.',
    )
  }
  return key
}
