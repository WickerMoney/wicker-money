import { describe, expect, it } from 'vitest'
import { ImportError } from '../../service/ImportError.js'
import { readUploadId } from './readUploadId.js'

const ID = '0b9a2f4e-7c1d-4e0a-9d63-5a1f2c3b4d5e'

describe('readUploadId', () => {
  it('is undefined when the body carries csv or nothing', () => {
    expect(readUploadId({ csv: 'a,b' })).toBeUndefined()
    expect(readUploadId({ uploadId: null, csv: 'a,b' })).toBeUndefined()
    expect(readUploadId(undefined)).toBeUndefined()
  })

  it('returns a valid id', () => {
    expect(readUploadId({ uploadId: ID })).toBe(ID)
  })

  it('refuses an id that is not a UUID', () => {
    expect(() => readUploadId({ uploadId: 'nope' })).toThrow(ImportError)
    expect(() => readUploadId({ uploadId: 5 })).toThrow(ImportError)
  })

  it('refuses csv and uploadId together, so it is never open which is imported', () => {
    expect(() => readUploadId({ uploadId: ID, csv: 'a,b' })).toThrow(/not both/)
  })
})
