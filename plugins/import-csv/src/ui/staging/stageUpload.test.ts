import { describe, expect, it } from 'vitest'
import { fakeImportApi, failure } from '../testing/fakeImportApi.js'
import { planUpload } from './planUpload.js'
import { RequestPacer } from './RequestPacer.js'
import type { StagingFailure } from './StagingFailure.js'
import { stageUpload, type StagingHandle } from './stageUpload.js'
import { utf8Bytes } from './utf8Bytes.js'

const noWait = async (): Promise<void> => undefined
const rows = (n: number): string => `Date,Description,Amount\n${Array.from({ length: n }, (_, i) => `03/04/2026,SHOP ${i},-${i}.50`).join('\n')}`
/** A file of about 7 MB: 36 pieces of 200,000 characters. */
const BIG = rows(300_000).slice(0, 7_100_000)

const failureOf = async (p: Promise<unknown>): Promise<StagingFailure> => {
  try { await p } catch (e) { return e as StagingFailure }
  throw new Error('did not fail')
}

describe('planUpload', () => {
  it('declares the UTF-8 size, which is not the number of characters', () => {
    const plan = planUpload('Date,Café\n€1,2')
    expect(plan.bytes).toBe(utf8Bytes('Date,Café\n€1,2'))
    expect(plan.bytes).toBeGreaterThan('Date,Café\n€1,2'.length)
  })

  it('refuses a file over 8,000,000 bytes before anything is sent', () => {
    expect(() => planUpload('x'.repeat(8_000_001))).toThrowError(/larger than 8 MB/)
  })

  it('cuts a 7 MB file into 36 pieces of about 200,000 characters', () => {
    expect(planUpload(BIG).chunks).toHaveLength(36)
  })
})

describe('stageUpload', () => {
  it('sends begin with the exact byte size, every chunk with at most 6 in flight, then finish, and the server holds the text', async () => {
    const server = fakeImportApi()
    let inFlight = 0
    let peak = 0
    server.intercept('/upload/chunk', async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 2))
      inFlight -= 1
    })
    const text = `${BIG}é`
    const plan = planUpload(text)
    const progress: number[] = []
    const handle = stageUpload(server.api, plan, { sleep: noWait, onProgress: (sent) => progress.push(sent) })

    const id = await handle.ready

    expect(server.callsTo('/upload/begin')[0]?.body).toEqual({ chunks: plan.chunks.length, bytes: utf8Bytes(text) })
    expect(server.callsTo('/upload/chunk')).toHaveLength(plan.chunks.length)
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
    expect(server.callsTo('/upload/finish')).toHaveLength(1)
    expect(server.store.lookup('user-1', id)).toEqual({ state: 'ready', csv: text })
    expect(progress.at(-1)).toBe(plan.chunks.length)
    expect(handle.state()).toBe('ready')
  })

  it('keeps every request under the broker\'s 256 KiB, escaping included', async () => {
    const server = fakeImportApi()
    const text = '"2026-03-04","COFFEE BAR #12","-4.50"\n'.repeat(60_000)
    await stageUpload(server.api, planUpload(text), { sleep: noWait }).ready
    for (const c of server.callsTo('/upload/chunk')) expect(utf8Bytes(JSON.stringify(c.body))).toBeLessThan(256 * 1024)
  })

  it('paces its requests through the pacer it is given', async () => {
    const server = fakeImportApi()
    const stamps: number[] = []
    let t = 0
    const pacer = new RequestPacer(10, 10, { now: () => t, sleep: async (ms) => { t += ms } })
    server.intercept('/upload/chunk', () => { stamps.push(t) })
    await stageUpload(server.api, planUpload(rows(100_000).slice(0, 4_000_000)), { pacer, sleep: noWait }).ready
    expect(stamps.length).toBeGreaterThan(15)
    // 10 at once, then one every 100 ms.
    expect(stamps[stamps.length - 1]).toBeGreaterThan(500)
  })

  it('sends a chunk again when the request failed on the connection, and succeeds', async () => {
    const server = fakeImportApi()
    server.intercept('/upload/chunk', (call, nth) => {
      if (nth === 2) throw Object.assign(new Error('Could not reach Wicker Money.'), { status: 0, code: 'network_error' })
      return undefined
    })
    const plan = planUpload(rows(10_000))
    await stageUpload(server.api, plan, { sleep: noWait }).ready
    expect(server.callsTo('/upload/chunk')).toHaveLength(plan.chunks.length + 1)
  })

  it('sends again after a 429 and a 500, then gives up and gives the upload back when requests keep failing', async () => {
    const server = fakeImportApi()
    server.intercept('/upload/chunk', (call) => {
      if (call.body['index'] === 0) throw failure(500, 'request_failed', 'Request failed (500)')
      return undefined
    })
    const handle = stageUpload(server.api, planUpload(rows(10_000)), { sleep: noWait })
    const f = await failureOf(handle.ready)
    expect(f.kind).toBe('interrupted')
    expect(f.message).toMatch(/could not be sent/)
    expect(handle.state()).toBe('failed')
    // Initial try plus two retries of that chunk, and the half-sent upload was aborted.
    expect(server.callsTo('/upload/chunk').filter((c) => c.body['index'] === 0)).toHaveLength(3)
    expect(server.callsTo('/upload/abort')).toHaveLength(1)
    expect(server.store.liveCount('user-1')).toBe(0)
  })

  it('does not retry a refusal of what it sent', async () => {
    const server = fakeImportApi()
    server.intercept('/upload/chunk', () => { throw failure(409, 'chunk_conflict', 'Chunk 0 was already sent with different text.') })
    const f = await failureOf(stageUpload(server.api, planUpload(rows(10)), { sleep: noWait }).ready)
    expect(f.kind).toBe('interrupted')
    expect(server.callsTo('/upload/chunk')).toHaveLength(1)
  })

  it('says so, with the server\'s words, when the server is full (503 staging_full)', async () => {
    const server = fakeImportApi({ store: { maxTotalBytes: 10 } })
    const f = await failureOf(stageUpload(server.api, planUpload(rows(50)), { sleep: noWait }).ready)
    expect(f.kind).toBe('busy')
    expect(f.message).toMatch(/Try again in about 30 seconds/)
    // It did not retry a full server, and has nothing to give back.
    expect(server.callsTo('/upload/begin')).toHaveLength(1)
    expect(server.callsTo('/upload/abort')).toHaveLength(0)
  })

  it('reports the two-upload limit (409 too_many_uploads) in the server\'s words', async () => {
    const server = fakeImportApi({ store: { maxLivePerUser: 0 } })
    const f = await failureOf(stageUpload(server.api, planUpload(rows(50)), { sleep: noWait }).ready)
    expect(f.kind).toBe('too_many')
  })

  it('starts over once when the server has lost the upload mid-way (404), and says so when it happens twice', async () => {
    const server = fakeImportApi()
    server.intercept('/upload/chunk', (call, nth) => { if (nth === 3) server.restartServer() })
    const plan = planUpload(rows(20_000))
    const id = await stageUpload(server.api, plan, { sleep: noWait }).ready
    expect(server.callsTo('/upload/begin')).toHaveLength(2)
    expect(server.store.lookup('user-1', id).state).toBe('ready')

    const again = fakeImportApi()
    again.intercept('/upload/chunk', () => { again.restartServer() })
    const f = await failureOf(stageUpload(again.api, plan, { sleep: noWait }).ready)
    expect(f.kind).toBe('gone')
    expect(again.callsTo('/upload/begin')).toHaveLength(2)
  })

  it('sends the chunks again when finish says one is missing (409), then finishes', async () => {
    const server = fakeImportApi()
    server.intercept('/upload/finish', (call, nth) => {
      if (nth === 1) throw failure(409, 'upload_incomplete', '1 of 2 chunks have not arrived (first missing: 1).')
      return undefined
    })
    const plan = planUpload(rows(10_000))
    expect(plan.chunks.length).toBeGreaterThan(0)
    const id = await stageUpload(server.api, plan, { sleep: noWait }).ready
    expect(server.callsTo('/upload/finish')).toHaveLength(2)
    // Nothing was unacknowledged, so every chunk went again (the server accepts the same text twice).
    expect(server.callsTo('/upload/chunk')).toHaveLength(plan.chunks.length * 2)
    expect(server.store.lookup('user-1', id).state).toBe('ready')
  })

  it('tells the person to choose the file again when finish answers 400 (the upload is gone), without a pointless abort', async () => {
    const server = fakeImportApi()
    server.intercept('/upload/finish', () => { throw failure(400, 'upload_size_mismatch', 'The chunks hold 5 bytes but the upload declared 9. Start again.') })
    const f = await failureOf(stageUpload(server.api, planUpload(rows(10)), { sleep: noWait }).ready)
    expect(f.kind).toBe('restart')
    expect(f.message).toMatch(/Choose the file again/)
    expect(server.callsTo('/upload/abort')).toHaveLength(0)
  })

  it('aborts: stops sending and gives the upload back, so the person is not held at two', async () => {
    const server = fakeImportApi()
    // eslint-disable-next-line prefer-const -- the interceptor below needs the handle before it exists
    let handle!: StagingHandle
    server.intercept('/upload/chunk', (call, nth) => { if (nth === 4) handle.abort() })
    handle = stageUpload(server.api, planUpload(BIG), { sleep: noWait })
    const f = await failureOf(handle.ready)
    expect(f.kind).toBe('cancelled')
    expect(server.callsTo('/upload/chunk').length).toBeLessThan(36)
    expect(server.callsTo('/upload/abort')).toHaveLength(1)
    expect(server.store.liveCount('user-1')).toBe(0)
  })

  it('gives the id back when it is aborted before begin has answered', async () => {
    const server = fakeImportApi()
    const handle = stageUpload(server.api, planUpload(rows(100)), { sleep: noWait })
    handle.abort()
    const f = await failureOf(handle.ready)
    expect(f.kind).toBe('cancelled')
    expect(server.callsTo('/upload/chunk')).toHaveLength(0)
    expect(server.store.liveCount('user-1')).toBe(0)
  })

  it('aborting a finished upload discards it on the server too', async () => {
    const server = fakeImportApi()
    const handle = stageUpload(server.api, planUpload(rows(100)), { sleep: noWait })
    await handle.ready
    expect(server.store.liveCount('user-1')).toBe(1)
    handle.abort()
    await new Promise((r) => setTimeout(r, 0))
    expect(server.store.liveCount('user-1')).toBe(0)
  })
})
