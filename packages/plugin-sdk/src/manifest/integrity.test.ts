import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SDK_MAJOR_VERSION, checkRemoteEntryIntegrity, parseIntegrity, parseManifest } from '../index.js'

/** A real SRI value for some bytes, so the shapes under test are the ones a browser accepts. */
const sri = (algorithm: 'sha256' | 'sha384' | 'sha512', bytes: string): string =>
  `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`

const base = {
  id: 'acme.report',
  name: 'Report',
  version: '1.0.0',
  sdkVersion: SDK_MAJOR_VERSION,
  remoteEntry: 'https://plugins.example.com/acme-report/remoteEntry.js',
  contributes: { widgets: [{ id: 'w', slot: 'dashboard.primary', title: 'W', module: './W' }] },
}

const pin = { 'remoteEntry.js': sri('sha384', 'entry'), 'assets/chunk-1a2b3c.js': sri('sha384', 'chunk') }

describe('manifest integrity field', () => {
  it('is optional, and absent means no pin', () => {
    const { manifest, error } = parseManifest(base)
    expect(error).toBeUndefined()
    expect(manifest?.integrity).toBeUndefined()
  })

  it('accepts a map of relative paths to sha256, sha384 and sha512 values', () => {
    const integrity = {
      'remoteEntry.js': sri('sha384', 'a'),
      'assets/a.js': sri('sha256', 'b'),
      'assets/deep/b.js': sri('sha512', 'c'),
      // What a Module Federation build really emits.
      'assets/_virtual_mf-localSharedImportMap___mfe_internal__acme_victim__mf_owner__1-qDcFtkpz.js': sri('sha384', 'd'),
    }
    expect(parseManifest({ ...base, integrity }).manifest?.integrity).toEqual(integrity)
  })

  it.each([
    ['a parent directory', '../remoteEntry.js'],
    ['a parent directory inside the path', 'assets/../remoteEntry.js'],
    ['a leading slash', '/remoteEntry.js'],
    ['a backslash', 'assets\\a.js'],
    ['a doubled slash', 'assets//a.js'],
    ['a percent escape', 'assets/%2e%2e/a.js'],
    ['a query string', 'remoteEntry.js?v=2'],
    ['a fragment', 'remoteEntry.js#x'],
    ['a URL', 'https://evil.example/a.js'],
    ['a dot segment', './remoteEntry.js'],
    ['a hidden file', '.env'],
    ['an empty path', ''],
    ['a trailing slash', 'assets/'],
  ])('refuses a key with %s', (_what, key) => {
    const { manifest, error } = parseManifest({ ...base, integrity: { [key]: pin['remoteEntry.js'] } })
    expect(manifest).toBeUndefined()
    expect(error).toContain('integrity')
  })

  it.each([
    ['plain text', 'abc'],
    ['an unknown algorithm', `md5-${createHash('md5').update('x').digest('base64')}`],
    ['sha1', `sha1-${createHash('sha1').update('x').digest('base64')}`],
    ['two hashes', `${sri('sha384', 'a')} ${sri('sha384', 'b')}`],
    ['option suffix', `${sri('sha384', 'a')}?foo`],
    ['the URL-safe alphabet', sri('sha384', 'a').replace('+', '-').replace('/', '_') + '-_'],
    ['a digest of the wrong length', `sha384-${createHash('sha256').update('x').digest('base64')}`],
    ['a hex digest', `sha384-${createHash('sha384').update('x').digest('hex')}`],
    ['an empty string', ''],
  ])('refuses a value that is %s', (_what, value) => {
    const { manifest, error } = parseManifest({ ...base, integrity: { 'remoteEntry.js': value } })
    expect(manifest).toBeUndefined()
    expect(error).toContain('integrity')
  })

  it('refuses a pin that lists more than 500 files', () => {
    const integrity = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`assets/f${i}.js`, pin['remoteEntry.js']]))
    expect(parseManifest({ ...base, integrity }).error).toContain('At most 500')
  })

  it('does not let a key named like an object property reach the prototype', () => {
    const { manifest } = parseManifest({ ...base, integrity: { constructor: pin['remoteEntry.js'] } })
    expect(Object.hasOwn(manifest?.integrity ?? {}, 'constructor')).toBe(true)
    expect(Object.getPrototypeOf(manifest?.integrity)).toBe(Object.prototype)
  })
})

describe('checkRemoteEntryIntegrity', () => {
  const entry = 'https://plugins.example.com/acme-report/remoteEntry.js'

  it('accepts a pin that lists the entry file', () => {
    expect(checkRemoteEntryIntegrity(entry, pin)).toBeUndefined()
    expect(checkRemoteEntryIntegrity('/plugins/acme-report/remoteEntry.js', pin)).toBeUndefined()
  })

  it('refuses a missing or empty pin, and says what to add', () => {
    expect(checkRemoteEntryIntegrity(entry, undefined)).toContain('no integrity pin')
    expect(checkRemoteEntryIntegrity(entry, {})).toContain('no integrity pin')
  })

  it('refuses a pin that does not list the entry file, because a changed entry would still load', () => {
    const message = checkRemoteEntryIntegrity(entry, { 'assets/chunk-1a2b3c.js': pin['assets/chunk-1a2b3c.js'] })
    expect(message).toContain("'remoteEntry.js'")
    expect(message).toContain('would still load')
  })

  it('looks for the entry by its own file name, not by a prefix or the property chain', () => {
    expect(checkRemoteEntryIntegrity('https://p.example/x/entry.js', { 'entry.js.map': pin['remoteEntry.js'] })).toBeDefined()
    expect(checkRemoteEntryIntegrity('https://p.example/x/constructor', { 'assets/a.js': pin['remoteEntry.js'] })).toBeDefined()
    expect(checkRemoteEntryIntegrity('https://p.example/x/constructor', { constructor: pin['remoteEntry.js'] })).toBeUndefined()
  })

  it('refuses an entry with a query string or a fragment, which no key can name', () => {
    expect(checkRemoteEntryIntegrity(`${entry}?v=2`, pin)).toContain('query string')
    expect(checkRemoteEntryIntegrity(`${entry}#x`, pin)).toContain('query string')
  })

  it('refuses an entry that is a directory', () => {
    expect(checkRemoteEntryIntegrity('https://plugins.example.com/acme-report/', pin)).toBeDefined()
  })
})

describe('parseIntegrity', () => {
  it('accepts what the manifest accepts and refuses what it refuses', () => {
    expect(parseIntegrity(pin)).toEqual({ integrity: pin })
    expect(parseIntegrity({ '../x.js': pin['remoteEntry.js'] })).toHaveProperty('error')
    expect(parseIntegrity({ 'a.js': 'nope' })).toHaveProperty('error')
    expect(parseIntegrity('x')).toHaveProperty('error')
    expect(parseIntegrity(null)).toHaveProperty('error')
  })
})
