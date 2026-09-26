import { createHmac } from 'node:crypto'

/** Domain-separation label; changing it invalidates every installed key. */
const LABEL = 'wickermoney/tenant-context/v1'

/**
 * Derives the tenant-context signing key from the deployment's auth secret.
 *
 * The key is `HMAC-SHA256(authSecret, 'wickermoney/tenant-context/v1')`, so it is
 * stable for a given secret, differs from the secret and from every other key
 * derived from it under another label, and is 32 bytes long.
 *
 * @param authSecret - The `AUTH_SECRET` configuration value.
 * @returns The 32-byte key, as installed in `core.tenant_context_key`.
 */
export function deriveTenantContextKey(authSecret: string): Buffer {
  return createHmac('sha256', authSecret).update(LABEL).digest()
}
