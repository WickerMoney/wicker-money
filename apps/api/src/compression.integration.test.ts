import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from './testing/harness.js'

let h: Harness
let user: TestUser
let sandbox: string
const BUNDLE = `export const x = ${JSON.stringify('wicker '.repeat(2000))}`

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'wickermoney-compress-'))
  mkdirSync(join(sandbox, 'assets'), { recursive: true })
  writeFileSync(join(sandbox, 'index.html'), '<!doctype html><title>Wicker Money</title>')
  writeFileSync(join(sandbox, 'assets', 'index-abc123.js'), BUNDLE)
  // Incompressible bytes with an image extension: already dense, must go out as is.
  writeFileSync(join(sandbox, 'logo.png'), randomBytes(4096))
  h = await createHarness({ WEB_DIST_DIR: sandbox })
  user = await createUser(h)
  for (let i = 0; i < 12; i++) {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(user),
      payload: { name: `Account number ${i} with a reasonably long name`, accountType: 'checking', initialBalance: '10.00' },
    })
    expect(res.statusCode).toBe(201)
  }
})
afterAll(async () => {
  await h.close()
  rmSync(sandbox, { recursive: true, force: true })
})

const get = (url: string, encoding?: string, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url, headers: { ...headers, ...(encoding === undefined ? {} : { 'accept-encoding': encoding }) } })

describe('response compression', () => {
  it('compresses a large JSON API response and says so, without changing its content', async () => {
    const plain = await get('/api/v1/accounts', undefined, auth(user))
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.rawPayload.length).toBeGreaterThan(1024)

    const gz = await get('/api/v1/accounts', 'gzip', auth(user))
    expect(gz.headers['content-encoding']).toBe('gzip')
    expect(gz.headers['vary']).toMatch(/accept-encoding/i)
    expect(gz.rawPayload.length).toBeLessThan(plain.rawPayload.length / 2)
    expect(gunzipSync(gz.rawPayload).toString()).toBe(plain.payload)

    const br = await get('/api/v1/accounts', 'br, gzip', auth(user))
    expect(br.headers['content-encoding']).toBe('br')
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(plain.payload)
  })

  it('keeps the security headers that were already on the response', async () => {
    const res = await get('/api/v1/accounts', 'gzip', auth(user))
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-type']).toMatch(/^application\/json/)
  })

  it('compresses the web bundle', async () => {
    const res = await get('/assets/index-abc123.js', 'gzip')
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['cache-control']).toMatch(/immutable/)
    expect(gunzipSync(res.rawPayload).toString()).toBe(BUNDLE)
    expect(res.rawPayload.length).toBeLessThan(BUNDLE.length / 5)
  })

  it('leaves small responses and already-compressed types alone', async () => {
    const small = await get('/healthz', 'gzip')
    expect(small.headers['content-encoding']).toBeUndefined()

    const png = await get('/logo.png', 'gzip')
    expect(png.statusCode).toBe(200)
    expect(png.headers['content-encoding']).toBeUndefined()
    expect(png.rawPayload.length).toBe(4096)
  })

  it('sends the identity form to a client that does not ask for compression', async () => {
    for (const encoding of [undefined, 'identity']) {
      const res = await get('/assets/index-abc123.js', encoding)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.payload).toBe(BUNDLE)
    }
  })

  it('still answers errors in plain JSON', async () => {
    const res = await get('/api/v1/accounts', 'gzip')
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBeDefined()
  })
})
