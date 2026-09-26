import { describe, expect, it } from 'vitest'
import { describePrivilegeViolation, type RolePrivileges } from './privileges.js'

const leastPrivileged: RolePrivileges = {
  role: 'wickermoney_app',
  isSuperuser: false,
  bypassesRls: false,
  ownsUsersTable: false,
}

describe('describePrivilegeViolation', () => {
  it('accepts a role that owns nothing and holds no bypass', () => {
    expect(describePrivilegeViolation(leastPrivileged)).toBeNull()
  })

  it('rejects a superuser — it bypasses RLS unconditionally', () => {
    const violation = describePrivilegeViolation({ ...leastPrivileged, isSuperuser: true })
    expect(violation).toContain('SUPERUSER')
    expect(violation).toContain('wickermoney_app')
  })

  it('rejects BYPASSRLS', () => {
    expect(describePrivilegeViolation({ ...leastPrivileged, bypassesRls: true })).toContain(
      'BYPASSRLS',
    )
  })

  it('rejects the owner of core.users', () => {
    // Load-bearing: FORCE is deliberately off on
    // core.users, so the owner is exempt from its policies. Connecting the API
    // as the owner would disable isolation with nothing appearing to break.
    const violation = describePrivilegeViolation({
      ...leastPrivileged,
      role: 'wickermoney',
      ownsUsersTable: true,
    })
    expect(violation).toContain('OWNS core.users')
    expect(violation).toContain('FORCE ROW LEVEL')
  })

  it('reports the most severe problem first when a role has several', () => {
    const violation = describePrivilegeViolation({
      ...leastPrivileged,
      isSuperuser: true,
      bypassesRls: true,
      ownsUsersTable: true,
    })
    expect(violation).toContain('SUPERUSER')
  })
})
