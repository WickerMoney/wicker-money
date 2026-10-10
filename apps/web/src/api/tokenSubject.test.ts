import { describe, expect, it } from 'vitest'
import { tokenSubject } from './tokenSubject.js'

const jwt = (claims: unknown): string => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`

describe('tokenSubject', () => {
  it('reads the sub claim', () => {
    expect(tokenSubject(jwt({ sub: 'user-1', exp: 1 }))).toBe('user-1')
  })

  it.each([
    ['a token that is not a JWT', 'tok-1'],
    ['a payload that is not JSON', 'h.!!!.s'],
    ['a payload without sub', jwt({ exp: 1 })],
    ['a non-string sub', jwt({ sub: 7 })],
    ['a payload that is not an object', jwt('text')],
  ])('returns null for %s', (_label, token) => {
    expect(tokenSubject(token)).toBeNull()
  })
})
