import type { CoreTableName, PluginManifest } from '@wickermoney/plugin-sdk'
import type { PluginGrantAccess, PluginTokenGrants } from './pluginTokens.js'

/**
 * Folds a manifest's `requiredTables` into one access level per table.
 *
 * A table listed twice keeps the stronger level, `write`.
 *
 * @param manifest - A validated manifest.
 * @returns The tables the manifest asks for and how.
 */
export function grantsOfManifest(manifest: Pick<PluginManifest, 'requiredTables'>): PluginTokenGrants {
  const grants: Partial<Record<CoreTableName, PluginGrantAccess>> = {}
  for (const { table, access } of manifest.requiredTables) {
    if (grants[table] !== 'write') grants[table] = access
  }
  return grants
}

/**
 * Whether grants allow an access level on a table. A `write` grant also allows `read`.
 *
 * @param grants - The granted tables.
 * @param table - The core table the request needs.
 * @param access - The level the request needs.
 * @returns `true` when the grant is there and strong enough.
 */
export function grantAllows(grants: PluginTokenGrants, table: CoreTableName, access: PluginGrantAccess): boolean {
  const granted = grants[table]
  return granted === 'write' || (granted === 'read' && access === 'read')
}

/**
 * The grants two sets agree on: a table survives only if both have it, at the
 * weaker of the two levels.
 *
 * The server applies this to a token's grants and the plugin's current
 * manifest, so a token can never do more than either says, and a manifest
 * that has since narrowed takes effect before the token expires.
 *
 * @param a - One set of grants.
 * @param b - The other.
 * @returns The grants both allow.
 */
export function intersectGrants(a: PluginTokenGrants, b: PluginTokenGrants): PluginTokenGrants {
  const out: Partial<Record<CoreTableName, PluginGrantAccess>> = {}
  for (const table of Object.keys(a) as CoreTableName[]) {
    const left = a[table]
    const right = b[table]
    if (left === undefined || right === undefined) continue
    out[table] = left === 'write' && right === 'write' ? 'write' : 'read'
  }
  return out
}
