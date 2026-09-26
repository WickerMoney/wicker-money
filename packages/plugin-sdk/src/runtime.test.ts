import { describe, expect, it } from 'vitest'
import { adoptPluginStyles } from './runtime.js'

describe('adoptPluginStyles', () => {
  // This file runs in the node environment on purpose. The API imports the SDK
  // in a Node process to validate manifests, so every value the barrel reaches
  // has to survive being imported without a DOM. The browser behaviour is
  // covered end to end in the insights plugin's suite, where a real document
  // exists.
  it('is a no-op without a document rather than throwing', () => {
    expect(typeof document).toBe('undefined')
    expect(() => adoptPluginStyles('wickermoney.example', '.x { color: red }')).not.toThrow()
  })
})
