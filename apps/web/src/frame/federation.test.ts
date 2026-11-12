import { describe, expect, it } from 'vitest'
import { REMOTE_ENTRY_TYPE as sdkType, federationName as sdkName } from '@wickermoney/plugin-sdk'
import { REMOTE_ENTRY_TYPE, federationName } from './federation.js'

// The SDK root is imported here, in a test, and nowhere in the frame's shipped code.
describe('federation (frame copy of the SDK rules)', () => {
  it('loads a remote the way the SDK says', () => {
    expect(REMOTE_ENTRY_TYPE).toBe(sdkType)
  })

  it.each([
    'wickermoney.insights', 'wickermoney.spending-trends', 'acme.report', 'a-b.c_d', 'with space', 'ünï/cödé', '', '1.2.3',
  ])('names %j as the SDK does', (id) => {
    expect(federationName(id)).toBe(sdkName(id))
  })
})
