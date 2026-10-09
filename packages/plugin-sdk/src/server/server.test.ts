import { describe, expect, it } from 'vitest'
import { PluginRouteError, isUuid } from './index.js'

describe('PluginRouteError', () => {
  it('carries the status and code the host answers with', () => {
    const error = new PluginRouteError('Pick a date.', 422, 'bad_date')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Pick a date.')
    expect(error.statusCode).toBe(422)
    expect(error.code).toBe('bad_date')
    expect(error.issues).toBeUndefined()
    expect(error.name).toBe('PluginRouteError')
  })

  it('keeps field-level issues', () => {
    const issues = [{ path: ['columns', 'date'], message: 'Choose a column.' }]
    expect(new PluginRouteError('x', 400, 'c', issues).issues).toBe(issues)
  })

  it('can be subclassed, keeping the subclass name and shape', () => {
    class BudgetError extends PluginRouteError {}
    const error = new BudgetError('nope', 409, 'conflict')
    expect(error).toBeInstanceOf(PluginRouteError)
    expect(error.name).toBe('BudgetError')
    expect(error.statusCode).toBe(409)
  })
})

describe('isUuid', () => {
  it.each([
    '123e4567-e89b-42d3-a456-426614174000', // v4
    '123E4567-E89B-42D3-A456-426614174000', // uppercase
    '0190a2b4-7c3d-7abc-8def-0123456789ab', // v7
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8', // v1
    '00000000-0000-0000-0000-000000000000', // nil
    'ffffffff-ffff-ffff-ffff-ffffffffffff', // max
  ])('accepts %s', (value) => {
    expect(isUuid(value)).toBe(true)
  })

  it.each([
    ['braces', '{123e4567-e89b-42d3-a456-426614174000}'],
    ['urn prefix', 'urn:uuid:123e4567-e89b-42d3-a456-426614174000'],
    ['no hyphens', '123e4567e89b42d3a456426614174000'],
    ['too short', '123e4567-e89b-42d3-a456-42661417400'],
    ['too long', '123e4567-e89b-42d3-a456-4266141740000'],
    ['non-hex digit', '123e4567-e89b-42d3-a456-42661417400g'],
    ['version 0', '123e4567-e89b-02d3-a456-426614174000'],
    ['version 9', '123e4567-e89b-92d3-a456-426614174000'],
    ['bad variant', '123e4567-e89b-42d3-c456-426614174000'],
    ['almost nil', '00000000-0000-0000-0000-000000000001'],
    ['padded', ' 123e4567-e89b-42d3-a456-426614174000 '],
    ['trailing newline', '123e4567-e89b-42d3-a456-426614174000\n'],
    ['empty', ''],
  ])('refuses %s', (_name, value) => {
    expect(isUuid(value)).toBe(false)
  })

  it.each([undefined, null, 0, 1, true, {}, [], ['123e4567-e89b-42d3-a456-426614174000']])(
    'refuses a non-string (%s)',
    (value) => {
      expect(isUuid(value)).toBe(false)
    },
  )

  it('narrows unknown to string', () => {
    const value: unknown = '123e4567-e89b-42d3-a456-426614174000'
    if (isUuid(value)) expect(value.length).toBe(36)
  })
})
