import { describe, expect, it, vi } from 'vitest'
import { FIRST_REGISTRATION_WARNING, warnIfFirstRegistrationOpen } from './warnIfFirstRegistrationOpen.js'

const RISKY = { NODE_ENV: 'production', REGISTRATION_ENABLED: true, BOOTSTRAP_OWNER_EMAIL: undefined } as const

describe('warnIfFirstRegistrationOpen', () => {
  it('warns when production, registration is open, no owner email is set and no accounts exist', async () => {
    const warn = vi.fn()
    await expect(warnIfFirstRegistrationOpen(RISKY, () => Promise.resolve(false), warn)).resolves.toBe(true)
    expect(warn).toHaveBeenCalledExactlyOnceWith(FIRST_REGISTRATION_WARNING)
    expect(FIRST_REGISTRATION_WARNING).toContain('BOOTSTRAP_OWNER_EMAIL')
  })

  it.each([
    ['not in production', { ...RISKY, NODE_ENV: 'development' as const }],
    ['in test', { ...RISKY, NODE_ENV: 'test' as const }],
    ['registration is closed', { ...RISKY, REGISTRATION_ENABLED: false }],
    ['an owner email is set', { ...RISKY, BOOTSTRAP_OWNER_EMAIL: 'me@example.com' }],
  ])('stays quiet, without asking the database, when %s', async (_name, config) => {
    const hasUsers = vi.fn(() => Promise.resolve(false))
    const warn = vi.fn()
    await expect(warnIfFirstRegistrationOpen(config, hasUsers, warn)).resolves.toBe(false)
    expect(hasUsers).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays quiet once an account exists', async () => {
    const warn = vi.fn()
    await expect(warnIfFirstRegistrationOpen(RISKY, () => Promise.resolve(true), warn)).resolves.toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays quiet, and does not throw, when the database cannot say', async () => {
    const warn = vi.fn()
    const failing = (): Promise<boolean> => Promise.reject(new Error('function core.instance_has_users() does not exist'))
    await expect(warnIfFirstRegistrationOpen(RISKY, failing, warn)).resolves.toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })
})
