import { describe, expect, it } from 'vitest'
import { OwnerRequiredError } from '../../auth/OwnerRequiredError.js'
import { NotFoundError } from '../../errors.js'
import { LastOwnerError } from '../LastOwnerError.js'
import { translateRoleChangeError } from './translateRoleChangeError.js'

const fails = (code: unknown) => translateRoleChangeError(() => Promise.reject(Object.assign(new Error('db'), { code })))

describe('translateRoleChangeError', () => {
  it('passes a result through', async () => {
    expect(await translateRoleChangeError(() => Promise.resolve(7))).toBe(7)
  })

  it('turns insufficient_privilege (42501) into owner_required', async () => {
    const error = await fails('42501').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OwnerRequiredError)
    expect(error).toMatchObject({ statusCode: 403, code: 'owner_required' })
  })

  it('turns no_data_found (P0002) into a 404 for the account', async () => {
    const error = await fails('P0002').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error).toMatchObject({ statusCode: 404, message: 'Account not found.' })
  })

  it('turns WM001 into last_owner with a message that says what to do', async () => {
    const error = await fails('WM001').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LastOwnerError)
    expect(error).toMatchObject({ statusCode: 409, code: 'last_owner' })
    expect((error as Error).message).toMatch(/another account an owner first/)
  })

  it.each(['25000', '23505', '40001', undefined])('rethrows anything else unchanged (%s)', async (code) => {
    const error = await fails(code).catch((e: unknown) => e)
    expect(error).toMatchObject({ message: 'db', code })
  })

  it('rethrows errors that are not objects with a code', async () => {
    await expect(translateRoleChangeError(() => Promise.reject('boom'))).rejects.toBe('boom')
  })
})
