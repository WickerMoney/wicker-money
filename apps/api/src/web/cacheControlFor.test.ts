import { describe, expect, it } from 'vitest'
import { cacheControlFor } from './cacheControlFor.js'

describe('cacheControlFor', () => {
  it('makes the host’s hashed assets immutable', () => {
    expect(cacheControlFor('assets/index-Dd2HQNmI.css')).toBe('public, max-age=31536000, immutable')
  })

  it.each([
    'index.html',
    'remoteEntry-DwTuQysg.js',
    'plugins/budgets/remoteEntry.js',
    // A plugin's own assets directory is not the host's, and its entry point
    // that names them is unhashed, so the whole tree revalidates.
    'plugins/budgets/assets/chunk-1.js',
  ])('revalidates %s on every load', (path) => {
    expect(cacheControlFor(path)).toBe('no-cache')
  })
})
