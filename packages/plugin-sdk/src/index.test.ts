import { describe, expect, it } from 'vitest'
import { SDK_MAJOR_VERSION, checkRemoteEntry, isCompatible, pagePath, parseManifest } from './index.js'

const valid = {
  id: 'wickermoney.insights',
  name: 'Insights',
  version: '0.1.0',
  description: 'Spend trend and category donut.',
  author: 'Wicker',
  sdkVersion: SDK_MAJOR_VERSION,
  requiredTables: [
    { table: 'transactions', access: 'read' },
    { table: 'categories', access: 'read' },
  ],
  remoteEntry: '/plugins/insights/remoteEntry.js',
  contributes: {
    widgets: [
      { id: 'trend', slot: 'dashboard.primary', title: 'Spending trend', module: './TrendWidget' },
    ],
  },
}

describe('isCompatible', () => {
  it('accepts the host major and older', () => {
    expect(isCompatible(SDK_MAJOR_VERSION)).toBe(true)
    expect(isCompatible(1, 2)).toBe(true)
  })
  it('refuses a newer major', () => expect(isCompatible(3, 2)).toBe(false))
  it('refuses a non-integer', () => expect(isCompatible(1.5, 2)).toBe(false))
})

describe('parseManifest', () => {
  it('accepts a well-formed manifest and applies defaults', () => {
    const { manifest, error } = parseManifest(valid)
    expect(error).toBeUndefined()
    expect(manifest?.contributes.widgets[0]?.defaultSize).toBe('md')
    expect(manifest?.contributes.pages).toEqual([])
    expect(manifest?.permissions).toEqual([])
  })

  it('rejects an id that is not reverse-domain', () => {
    const { error } = parseManifest({ ...valid, id: 'insights' })
    expect(error).toContain('reverse-domain')
  })

  it('rejects a table outside the known core set', () => {
    const { error } = parseManifest({
      ...valid,
      requiredTables: [{ table: 'users', access: 'read' }],
    })
    expect(error).toBeDefined()
  })

  it('refuses a plugin built against a newer SDK', () => {
    const { manifest, error } = parseManifest({ ...valid, sdkVersion: SDK_MAJOR_VERSION + 1 })
    expect(manifest).toBeUndefined()
    expect(error).toContain('upgrade the host')
  })

  it('reports a malformed manifest rather than throwing', () => {
    expect(() => parseManifest(null)).not.toThrow()
    expect(parseManifest(null).error).toBeDefined()
  })
})

describe('pagePath', () => {
  it('namespaces plugin routes under the host prefix', () => {
    expect(pagePath('wickermoney.budgets', { path: 'overview', title: 'x', module: './P' }))
      .toBe('/p/wickermoney.budgets/overview')
  })
  it('tolerates a leading slash', () => {
    expect(pagePath('wickermoney.budgets', { path: '/overview', title: 'x', module: './P' }))
      .toBe('/p/wickermoney.budgets/overview')
  })
})

describe('remoteEntry shape', () => {
  const entry = (remoteEntry: string) => parseManifest({ ...valid, remoteEntry })

  it.each([
    '/plugins/insights/remoteEntry.js',
    '/plugins/import-csv/assets/entry.mjs',
    'https://plugins.example.com/insights/remoteEntry.js',
    'https://plugins.example.com:8443/x.js',
  ])('accepts %s', (value) => {
    expect(entry(value).error).toBeUndefined()
  })

  it.each([
    ['a protocol-relative URL', '//evil.example/x.js'],
    ['plain http', 'http://plugins.example.com/x.js'],
    ['a data: URL', 'data:text/javascript,alert(1)'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a path outside /plugins/', '/assets/remoteEntry.js'],
    ['a path with traversal', '/plugins/insights/../../secret.js'],
    ['a path with a doubled slash', '/plugins//insights/x.js'],
    ['a percent-encoded path', '/plugins/insights/%2e%2e/x.js'],
    ['a backslash path', '/plugins/insights\\x.js'],
    ['a bare relative path', 'plugins/insights/x.js'],
    ['embedded credentials', 'https://user:pw@plugins.example.com/x.js'],
    ['an https URL with a backslash', 'https://plugins.example.com\\@evil.example/x.js'],
    ['an empty string', ''],
  ])('rejects %s', (_what, value) => {
    expect(entry(value).manifest).toBeUndefined()
    expect(entry(value).error).toContain('remoteEntry')
  })
})

describe('checkRemoteEntry', () => {
  it('always allows a same-origin path', () => {
    expect(checkRemoteEntry('/plugins/insights/remoteEntry.js')).toBeUndefined()
    expect(checkRemoteEntry('/plugins/insights/remoteEntry.js', ['https://a.example'])).toBeUndefined()
  })

  it('refuses every remote origin when the allowlist is empty', () => {
    expect(checkRemoteEntry('https://plugins.example.com/x.js')).toContain('PLUGIN_REMOTE_ORIGINS')
    expect(checkRemoteEntry('https://plugins.example.com/x.js', [])).toContain('not in the allowed')
  })

  it('allows an https URL whose origin is listed, and only that origin', () => {
    const allowed = ['https://plugins.example.com']
    expect(checkRemoteEntry('https://plugins.example.com/insights/x.js', allowed)).toBeUndefined()
    expect(checkRemoteEntry('https://plugins.example.com:8443/x.js', allowed)).toBeDefined()
    expect(checkRemoteEntry('https://evil.example/x.js', allowed)).toBeDefined()
    expect(checkRemoteEntry('https://plugins.example.com.evil.example/x.js', allowed)).toBeDefined()
  })
})
