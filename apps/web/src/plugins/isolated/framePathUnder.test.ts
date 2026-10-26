import { describe, expect, it } from 'vitest'
import { framePathUnder } from './framePathUnder.js'

const BASE = '/p/acme.reports/report'

describe('framePathUnder', () => {
  it('is the root at the page\'s own address, with or without a trailing slash', () => {
    expect(framePathUnder(BASE, BASE, '')).toBe('/')
    expect(framePathUnder(BASE, `${BASE}/`, '')).toBe('/')
  })

  it('is what follows the route, with the query', () => {
    expect(framePathUnder(BASE, `${BASE}/2026/10`, '')).toBe('/2026/10')
    expect(framePathUnder(BASE, `${BASE}/2026/10`, '?tab=2')).toBe('/2026/10?tab=2')
    expect(framePathUnder(BASE, BASE, '?tab=2')).toBe('/?tab=2')
  })

  it('does not treat a longer sibling route as under the page', () => {
    expect(framePathUnder(BASE, `${BASE}-two/x`, '')).toBe('/')
  })

  it.each([
    ['a protocol-relative start', `${BASE}//evil.test/x`],
    ['a backslash', `${BASE}/a%5Cb`.replace('%5C', '\\')],
    ['a control character', `${BASE}/a\u0001b`],
    ['more than the protocol allows', `${BASE}/${'a'.repeat(3000)}`],
  ])('falls back to the root for %s', (_what, pathname) => {
    expect(framePathUnder(BASE, pathname, '')).toBe('/')
  })
})
