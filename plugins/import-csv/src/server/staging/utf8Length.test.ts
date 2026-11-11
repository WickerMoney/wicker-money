import { describe, expect, it } from 'vitest'
import { utf8Length } from './utf8Length.js'

describe('utf8Length', () => {
  it('counts bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('é')).toBe(2)
    expect(utf8Length('€')).toBe(3)
    expect(utf8Length('😀')).toBe(4)
  })

  it('adds up to the whole text when a surrogate pair is cut between two chunks', () => {
    const text = 'a😀b'
    const cut = 2 // between the two halves of the emoji
    expect(utf8Length(text.slice(0, cut)) + utf8Length(text.slice(cut))).toBe(utf8Length(text))
    expect(utf8Length(text.slice(0, cut)) + utf8Length(text.slice(cut))).toBe(6)
  })

  it('counts an empty chunk as zero', () => {
    expect(utf8Length('')).toBe(0)
  })
})
