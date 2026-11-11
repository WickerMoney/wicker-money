import { describe, expect, it } from 'vitest'
import type { ImportError } from '../service/ImportError.js'
import { MAX_CHUNK_BYTES, MAX_STAGED_BYTES_TOTAL, UPLOAD_TTL_MS } from './limits.js'
import { UploadStore } from './UploadStore.js'

const U1 = 'user-1'
const U2 = 'user-2'

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000
  return { now: () => t, advance: (ms) => { t += ms } }
}

function codeOf(fn: () => unknown): string {
  try { fn() } catch (e) { return (e as ImportError).code }
  return 'no error'
}

describe('UploadStore', () => {
  it('stages chunks that arrive out of order and joins them in index order', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 3, 9)
    s.addChunk(U1, uploadId, 2, 'ccc')
    s.addChunk(U1, uploadId, 0, 'aaa')
    s.addChunk(U1, uploadId, 1, 'bbb')
    expect(s.finish(U1, uploadId)).toEqual({ chunks: 3, received: 3, bytes: 9 })
    expect(s.lookup(U1, uploadId)).toEqual({ state: 'ready', csv: 'aaabbbccc' })
  })

  it('accepts the same chunk twice but refuses different text for a stored index', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 2, 6)
    s.addChunk(U1, uploadId, 0, 'aaa')
    expect(s.addChunk(U1, uploadId, 0, 'aaa')).toEqual({ chunks: 2, received: 1, bytes: 3 })
    expect(codeOf(() => s.addChunk(U1, uploadId, 0, 'xxx'))).toBe('chunk_conflict')
  })

  it('refuses a chunk past the declared size when it arrives, and discards the upload', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 2, 4)
    s.addChunk(U1, uploadId, 0, 'aaa')
    expect(codeOf(() => s.addChunk(U1, uploadId, 1, 'bbb'))).toBe('upload_too_large')
    expect(codeOf(() => s.addChunk(U1, uploadId, 1, 'b'))).toBe('upload_not_found')
    expect(s.liveCount(U1)).toBe(0)
  })

  it('refuses a chunk over 256 KiB without storing it', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 2, MAX_CHUNK_BYTES + 10)
    expect(codeOf(() => s.addChunk(U1, uploadId, 0, 'x'.repeat(MAX_CHUNK_BYTES + 1)))).toBe('chunk_too_large')
    expect(s.addChunk(U1, uploadId, 0, 'x'.repeat(MAX_CHUNK_BYTES))).toMatchObject({ received: 1 })
  })

  it('refuses an index outside the declared range and empty or non-string text', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 2, 4)
    for (const index of [-1, 2, 1.5, '0', undefined]) expect(codeOf(() => s.addChunk(U1, uploadId, index, 'aa'))).toBe('import_failed')
    expect(codeOf(() => s.addChunk(U1, uploadId, 0, ''))).toBe('import_failed')
    expect(codeOf(() => s.addChunk(U1, uploadId, 0, 5))).toBe('import_failed')
  })

  it('refuses begin numbers that are out of range or cannot fit together', () => {
    const s = new UploadStore()
    for (const [chunks, bytes] of [[0, 5], [65, 100], [1.5, 5], ['2', 5], [1, 0], [1, 8_000_001], [5, 3], [1, MAX_CHUNK_BYTES + 1]]) {
      expect(codeOf(() => s.begin(U1, chunks, bytes)), `${chunks}/${bytes}`).toBe('import_failed')
    }
    expect(s.liveCount(U1)).toBe(0)
    expect(() => s.begin(U1, 64, 8_000_000)).not.toThrow()
  })

  it('allows two live uploads per user and a third only after one is gone', () => {
    const s = new UploadStore()
    const a = s.begin(U1, 1, 3)
    s.begin(U1, 1, 3)
    expect(codeOf(() => s.begin(U1, 1, 3))).toBe('too_many_uploads')
    expect(() => s.begin(U2, 1, 3)).not.toThrow()
    s.addChunk(U1, a.uploadId, 0, 'abc')
    s.finish(U1, a.uploadId)
    s.markCommitted(U1, a.uploadId, undefined)
    expect(() => s.begin(U1, 1, 3)).not.toThrow()
  })

  it('refuses finish with a missing chunk, names it, and lets the upload be completed', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 3, 6)
    s.addChunk(U1, uploadId, 0, 'aa')
    s.addChunk(U1, uploadId, 2, 'cc')
    expect(() => s.finish(U1, uploadId)).toThrow(/1 of 3 chunks.*first missing: 1/)
    s.addChunk(U1, uploadId, 1, 'bb')
    expect(s.finish(U1, uploadId).received).toBe(3)
  })

  it('discards an upload whose bytes fall short of what was declared', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 2, 10)
    s.addChunk(U1, uploadId, 0, 'aa')
    s.addChunk(U1, uploadId, 1, 'bb')
    expect(codeOf(() => s.finish(U1, uploadId))).toBe('upload_size_mismatch')
    expect(codeOf(() => s.lookup(U1, uploadId))).toBe('upload_not_found')
  })

  it('counts multi-byte text in bytes and accepts a pair cut between chunks', () => {
    const s = new UploadStore()
    const text = 'é€a😀b'
    const bytes = Buffer.byteLength(text)
    const { uploadId } = s.begin(U1, 2, bytes)
    s.addChunk(U1, uploadId, 1, text.slice(4))
    s.addChunk(U1, uploadId, 0, text.slice(0, 4))
    s.finish(U1, uploadId)
    expect(s.lookup(U1, uploadId)).toEqual({ state: 'ready', csv: text })
  })

  it('refuses text with an unpaired surrogate at finish', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 1, 2)
    s.addChunk(U1, uploadId, 0, '\ud83d')
    expect(codeOf(() => s.finish(U1, uploadId))).toBe('upload_not_text')
  })

  it('finishing twice repeats the answer, and a chunk after finish is refused', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 1, 3)
    s.addChunk(U1, uploadId, 0, 'abc')
    const first = s.finish(U1, uploadId)
    expect(s.finish(U1, uploadId)).toEqual(first)
    expect(codeOf(() => s.addChunk(U1, uploadId, 0, 'abc'))).toBe('upload_finished')
  })

  it('does not let analyze or commit read an upload that has not finished', () => {
    const s = new UploadStore()
    const { uploadId } = s.begin(U1, 1, 3)
    expect(codeOf(() => s.lookup(U1, uploadId))).toBe('upload_incomplete')
  })

  it('answers another user\'s id, an unknown id and an expired id with the same error', () => {
    const c = clock()
    const s = new UploadStore({ now: c.now })
    const { uploadId } = s.begin(U1, 1, 3)
    const expired = s.begin(U1, 1, 3).uploadId
    const errors = (fn: () => unknown): { status: number; code: string; message: string } => {
      try { fn() } catch (e) { const x = e as ImportError; return { status: x.statusCode, code: x.code, message: x.message } }
      throw new Error('expected an error')
    }
    const other = errors(() => s.addChunk(U2, uploadId, 0, 'abc'))
    const unknown = errors(() => s.addChunk(U1, '0b9a2f4e-7c1d-4e0a-9d63-5a1f2c3b4d5e', 0, 'abc'))
    c.advance(UPLOAD_TTL_MS)
    const gone = errors(() => s.addChunk(U1, expired, 0, 'abc'))
    expect(other).toEqual(unknown)
    expect(other).toEqual(gone)
    expect(other.status).toBe(404)
    expect(errors(() => s.finish(U2, uploadId))).toEqual(other)
    expect(errors(() => s.lookup(U2, uploadId))).toEqual(other)
  })

  it('expires 15 minutes after the last new chunk, not after begin, and a duplicate does not extend it', () => {
    const c = clock()
    const s = new UploadStore({ now: c.now })
    const { uploadId } = s.begin(U1, 2, 4)
    c.advance(UPLOAD_TTL_MS - 1000)
    s.addChunk(U1, uploadId, 0, 'aa') // new chunk: extends
    c.advance(UPLOAD_TTL_MS - 1000)
    s.addChunk(U1, uploadId, 0, 'aa') // duplicate: does not
    c.advance(1000)
    expect(codeOf(() => s.addChunk(U1, uploadId, 1, 'bb'))).toBe('upload_not_found')
  })

  it('frees an expired upload\'s quota and reserved bytes', () => {
    const c = clock()
    const s = new UploadStore({ now: c.now })
    s.begin(U1, 1, 100)
    s.begin(U1, 1, 100)
    expect(s.reservedBytes()).toBe(200)
    c.advance(UPLOAD_TTL_MS)
    expect(s.liveCount(U1)).toBe(0)
    expect(s.reservedBytes()).toBe(0)
    expect(() => s.begin(U1, 1, 100)).not.toThrow()
  })

  it('refuses a begin that would pass the cap across users, before any data, and recovers when space frees', () => {
    const c = clock()
    const s = new UploadStore({ now: c.now, maxTotalBytes: 1000 })
    s.begin(U1, 1, 600)
    s.begin(U2, 1, 400)
    const err = (() => { try { s.begin('user-3', 1, 1) } catch (e) { return e as ImportError & { retryAfterSeconds: number } } throw new Error('no error') })()
    expect(err.statusCode).toBe(503)
    expect(err.code).toBe('staging_full')
    expect(err.retryAfterSeconds).toBeGreaterThan(0)
    c.advance(UPLOAD_TTL_MS)
    expect(() => s.begin('user-3', 1, 1)).not.toThrow()
  })

  it('has a production cap of eight largest uploads', () => {
    expect(MAX_STAGED_BYTES_TOTAL).toBe(64_000_000)
  })

  it('removes the text on commit, and keeps a receipt only when the commit had a key', () => {
    const s = new UploadStore()
    const a = s.begin(U1, 1, 3)
    s.addChunk(U1, a.uploadId, 0, 'abc')
    s.finish(U1, a.uploadId)
    s.markCommitted(U1, a.uploadId, { idempotencyKey: 'k1', failed: 2 })
    expect(s.lookup(U1, a.uploadId)).toEqual({ state: 'committed', receipt: { idempotencyKey: 'k1', failed: 2 } })
    expect(s.reservedBytes()).toBe(0)
    expect(s.liveCount(U1)).toBe(0)

    const b = s.begin(U1, 1, 3)
    s.addChunk(U1, b.uploadId, 0, 'abc')
    s.finish(U1, b.uploadId)
    s.markCommitted(U1, b.uploadId, undefined)
    expect(codeOf(() => s.lookup(U1, b.uploadId))).toBe('upload_not_found')
  })

  it('does nothing when a commit finishes after its upload has expired', () => {
    const c = clock()
    const s = new UploadStore({ now: c.now })
    const a = s.begin(U1, 1, 3)
    s.addChunk(U1, a.uploadId, 0, 'abc')
    s.finish(U1, a.uploadId)
    c.advance(UPLOAD_TTL_MS)
    s.liveCount(U1) // sweeps
    s.markCommitted(U1, a.uploadId, { idempotencyKey: 'k', failed: 0 })
    expect(s.entryCount(U1)).toBe(0)
  })

  it('keeps at most eight receipts per user and drops them after the expiry period', () => {
    const c = clock()
    const s = new UploadStore({ now: c.now })
    const ids: string[] = []
    for (let i = 0; i < 10; i += 1) {
      const u = s.begin(U1, 1, 3)
      s.addChunk(U1, u.uploadId, 0, 'abc')
      s.finish(U1, u.uploadId)
      c.advance(10)
      s.markCommitted(U1, u.uploadId, { idempotencyKey: `k${i}`, failed: 0 })
      ids.push(u.uploadId)
    }
    expect(s.entryCount(U1)).toBe(8)
    expect(codeOf(() => s.lookup(U1, ids[0] as string))).toBe('upload_not_found')
    expect(s.lookup(U1, ids[9] as string).state).toBe('committed')
    c.advance(UPLOAD_TTL_MS)
    expect(s.entryCount(U1)).toBe(0)
  })
})
