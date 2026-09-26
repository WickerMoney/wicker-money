import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { configureTenantContext } from '../configureTenantContext.js'
import { installTenantContextKey } from '../installTenantContextKey.js'
import { TEST_ADMIN_DATABASE_URL, TEST_AUTH_SECRET } from '../../testing/harness.js'
import { down, up } from './018_tenant_context_signature.js'

let admin: Db

/** The installed key as hex, or `undefined` if the table is empty or absent. */
async function installedKey(): Promise<string | undefined> {
  const r = await sql<{ k: string }>`SELECT encode(key, 'hex') AS k FROM core.tenant_context_key`.execute(admin)
  return r.rows[0]?.k
}

beforeAll(() => {
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  configureTenantContext(TEST_AUTH_SECRET)
})

afterAll(async () => {
  // Leave the database as the suite expects it whatever a test did.
  await up(admin)
  await installTenantContextKey(admin)
  await admin.destroy()
})

describe('migration 018', () => {
  it('can run again without touching an installed key', async () => {
    await installTenantContextKey(admin)
    const before = await installedKey()
    expect(before).toBeDefined()
    await up(admin)
    await up(admin)
    expect(await installedKey()).toBe(before)
  })

  it('reverts to the unsigned function and back', async () => {
    await down(admin)
    const gone = await sql<{ t: string | null }>`SELECT to_regclass('core.tenant_context_key')::text AS t`.execute(admin)
    expect(gone.rows[0]?.t).toBeNull()
    const def = await sql<{ secdef: boolean; src: string }>`
      SELECT prosecdef AS secdef, prosrc AS src FROM pg_proc WHERE proname = 'current_user_id'
    `.execute(admin)
    expect(def.rows[0]?.secdef).toBe(false)
    expect(def.rows[0]?.src).toContain("current_setting('app.user_id', true)")
    expect(def.rows[0]?.src).not.toContain('hmac')

    await up(admin)
    expect(await installedKey()).toBeUndefined()
    await installTenantContextKey(admin)
    expect(await installedKey()).toBeDefined()
  })
})
