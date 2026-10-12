import { describe, expect, it } from 'vitest'
import { parseFrameFragment } from './fragment.js'

const base = 'https://money.example.com/plugin-frame'
const frag = (o: Record<string, string>): string => `#${new URLSearchParams(o).toString()}`
const ok = { id: 'acme.report', entry: '/plugins/acme/remoteEntry.js', module: './Widget', kind: 'widget' }

describe('parseFrameFragment', () => {
  it('reads a valid fragment and resolves a relative entry', () => {
    expect(parseFrameFragment(frag(ok), base)).toEqual({
      pluginId: 'acme.report', entry: 'https://money.example.com/plugins/acme/remoteEntry.js', module: './Widget', kind: 'widget',
    })
  })

  it.each([
    ['no id', { ...ok, id: '' }],
    ['an id with a slash', { ...ok, id: 'a/b' }],
    ['an id with uppercase', { ...ok, id: 'Acme' }],
    ['a module without ./', { ...ok, module: 'Widget' }],
    ['a module that climbs', { ...ok, module: './../x' }],
    ['an unknown kind', { ...ok, kind: 'popup' }],
    ['a javascript: entry', { ...ok, entry: 'javascript:alert(1)' }],
    ['a data: entry', { ...ok, entry: 'data:text/javascript,1' }],
  ])('refuses %s', (_name, params) => {
    expect(parseFrameFragment(frag(params), base)).toHaveProperty('error')
  })

  it('refuses an empty fragment', () => {
    expect(parseFrameFragment('', base)).toHaveProperty('error')
  })
})

describe('parseFrameFragment integrity', () => {
  const pin = { 'remoteEntry.js': `sha384-${'A'.repeat(64)}` }

  it('carries a valid pin', () => {
    const result = parseFrameFragment(frag({ ...ok, integrity: JSON.stringify(pin) }), base)
    expect(result).toMatchObject({ integrity: pin })
  })

  it('has none when the host sent none', () => {
    expect(parseFrameFragment(frag(ok), base)).not.toHaveProperty('integrity')
  })

  it.each([
    ['text that is not JSON', 'nope'],
    ['a JSON array', '[]'],
    ['a key that climbs', JSON.stringify({ '../x.js': pin['remoteEntry.js'] })],
    ['a value that is not an SRI hash', JSON.stringify({ 'remoteEntry.js': 'abc' })],
  ])('refuses %s', (_name, integrity) => {
    expect(parseFrameFragment(frag({ ...ok, integrity }), base)).toHaveProperty('error')
  })
})
