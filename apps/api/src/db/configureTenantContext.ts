import { deriveTenantContextKey } from './deriveTenantContextKey.js'
import { tenantContextKeyStore } from './tenantContextKeyStore.js'

/**
 * Sets the key every {@link bindTenantContext} call signs with, for the whole
 * process. Call it once at startup, before any database work, with the same
 * `AUTH_SECRET` the database key was installed from. Calling it again replaces
 * the key (tests use this to simulate a rotated secret).
 *
 * @param authSecret - The `AUTH_SECRET` configuration value.
 */
export function configureTenantContext(authSecret: string): void {
  tenantContextKeyStore.key = deriveTenantContextKey(authSecret)
}
