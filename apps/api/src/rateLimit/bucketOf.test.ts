import { describe, expect, it } from 'vitest'
import { bucketOf } from './bucketOf.js'

describe('bucketOf', () => {
  it.each([
    ['GET', '/healthz', '/healthz'],
    ['GET', '/readyz', '/readyz'],
    ['GET', '/', '/*'],
    ['GET', '/assets/index-abc.js', '/*'],
    ['GET', '/plugin-frame', '/plugin-frame'],
    ['GET', '/plugin-frame.html', '/plugin-frame.html'],
    ['GET', '/plugins/insights/remoteEntry.js', '/*'],
  ])('does not limit %s %s', (method, path, pattern) => {
    expect(bucketOf(method, path, pattern)).toBeNull()
  })

  it('puts the import analyze and commit routes in the import bucket', () => {
    expect(bucketOf('POST', '/api/v1/p/wickermoney.import-csv/analyze', '/api/v1/p/wickermoney.import-csv/analyze')).toBe('import')
    expect(bucketOf('POST', '/api/v1/p/wickermoney.import-csv/commit', '/api/v1/p/wickermoney.import-csv/commit')).toBe('import')
  })

  it('leaves the rest of the import plugin in the general bucket', () => {
    expect(bucketOf('GET', '/api/v1/p/wickermoney.import-csv/batches', '/api/v1/p/wickermoney.import-csv/batches')).toBe('general')
    expect(bucketOf('POST', '/api/v1/p/wickermoney.import-csv/mappings', '/api/v1/p/wickermoney.import-csv/mappings')).toBe('general')
  })

  it('puts the export download in the export bucket, but not the ticket that precedes it', () => {
    expect(bucketOf('GET', '/api/v1/settings/export', '/api/v1/settings/export')).toBe('export')
    expect(bucketOf('POST', '/api/v1/settings/export-ticket', '/api/v1/settings/export-ticket')).toBe('general')
  })

  it('counts every other API route, and an API path no route matched, as general', () => {
    expect(bucketOf('GET', '/api/v1/transactions', '/api/v1/transactions')).toBe('general')
    expect(bucketOf('POST', '/api/v1/auth/login', '/api/v1/auth/login')).toBe('general')
    expect(bucketOf('GET', '/api/v1/nope', undefined)).toBe('general')
    expect(bucketOf('GET', '/api/v1/nope', '/*')).toBe('general')
  })
})
