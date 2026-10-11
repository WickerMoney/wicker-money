import { describe, expect, it } from 'vitest'
import { grantAllows, grantsOfManifest, intersectGrants } from './pluginGrants.js'

describe('grantsOfManifest', () => {
  it('maps each requested table to its access level', () => {
    expect(
      grantsOfManifest({ requiredTables: [{ table: 'transactions', access: 'read' }, { table: 'accounts', access: 'write' }] }),
    ).toEqual({ transactions: 'read', accounts: 'write' })
  })

  it('keeps write when a table is listed as read and as write, in either order', () => {
    const readFirst = grantsOfManifest({ requiredTables: [{ table: 'accounts', access: 'read' }, { table: 'accounts', access: 'write' }] })
    const writeFirst = grantsOfManifest({ requiredTables: [{ table: 'accounts', access: 'write' }, { table: 'accounts', access: 'read' }] })
    expect(readFirst).toEqual({ accounts: 'write' })
    expect(writeFirst).toEqual({ accounts: 'write' })
  })

  it('grants nothing to a manifest that asks for nothing', () => {
    expect(grantsOfManifest({ requiredTables: [] })).toEqual({})
  })
})

describe('grantAllows', () => {
  it('lets write satisfy read and write, and read satisfy only read', () => {
    expect(grantAllows({ accounts: 'write' }, 'accounts', 'read')).toBe(true)
    expect(grantAllows({ accounts: 'write' }, 'accounts', 'write')).toBe(true)
    expect(grantAllows({ accounts: 'read' }, 'accounts', 'read')).toBe(true)
    expect(grantAllows({ accounts: 'read' }, 'accounts', 'write')).toBe(false)
  })

  it('refuses a table that is not granted', () => {
    expect(grantAllows({ accounts: 'write' }, 'transactions', 'read')).toBe(false)
    expect(grantAllows({}, 'accounts', 'read')).toBe(false)
  })
})

describe('intersectGrants', () => {
  it('keeps only tables both sides have, at the weaker level', () => {
    expect(
      intersectGrants(
        { accounts: 'write', transactions: 'read', categories: 'write' },
        { accounts: 'read', transactions: 'write', recurring_items: 'read' },
      ),
    ).toEqual({ accounts: 'read', transactions: 'read' })
  })

  it('is empty when either side is empty', () => {
    expect(intersectGrants({}, { accounts: 'read' })).toEqual({})
    expect(intersectGrants({ accounts: 'read' }, {})).toEqual({})
  })

  it('is symmetric', () => {
    const a = { accounts: 'write', transactions: 'read' } as const
    const b = { accounts: 'read', categories: 'read' } as const
    expect(intersectGrants(a, b)).toEqual(intersectGrants(b, a))
  })
})
