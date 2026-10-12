import { describe, expect, it } from 'vitest'
import { frameUrl } from './frameUrl.js'

const target = { pluginId: 'acme.report', remoteEntry: 'https://p.example/a/remoteEntry.js', module: './W', kind: 'widget' as const }

describe('frameUrl', () => {
  it('has no integrity parameter without a pin', () => {
    expect(frameUrl(target)).not.toContain('integrity')
  })

  it('carries the pin as JSON in the fragment', () => {
    const pin = { 'remoteEntry.js': `sha384-${'A'.repeat(64)}` }
    const hash = new URL(frameUrl({ ...target, integrity: pin }), 'https://h.example').hash
    expect(JSON.parse(new URLSearchParams(hash.slice(1)).get('integrity') ?? '')).toEqual(pin)
  })
})
