import { describe, expect, it } from 'vitest'
import { splitIntoChunks } from './splitIntoChunks.js'
import { MAX_CHUNK_JSON_BYTES } from './stagingLimits.js'
import { utf8Bytes } from './utf8Bytes.js'

const jsonSize = (s: string): number => utf8Bytes(JSON.stringify(s))

describe('splitIntoChunks', () => {
  it('gives back no pieces for empty text and one for short text', () => {
    expect(splitIntoChunks('')).toEqual([])
    expect(splitIntoChunks('a,b\n1,2')).toEqual(['a,b\n1,2'])
  })

  it('cuts plain text at about 200,000 characters and joins back to the text', () => {
    const text = 'x'.repeat(450_000)
    const pieces = splitIntoChunks(text)
    expect(pieces.map((p) => p.length)).toEqual([200_000, 200_000, 50_000])
    expect(pieces.join('')).toBe(text)
  })

  it('cuts a file of quoted fields shorter, so every request body stays under the limit', () => {
    // Every quote becomes two characters in JSON; half of this text is quotes, so 200,000 characters are 300,000 bytes.
    const text = '"a","b","c","d"\n'.repeat(60_000)
    const pieces = splitIntoChunks(text)
    expect(pieces.join('')).toBe(text)
    for (const p of pieces) expect(jsonSize(p)).toBeLessThanOrEqual(MAX_CHUNK_JSON_BYTES)
    expect(Math.max(...pieces.map((p) => p.length))).toBeLessThan(200_000)
  })

  it('counts bytes, not characters, for text outside ASCII', () => {
    const text = '日本語の明細'.repeat(60_000)
    const pieces = splitIntoChunks(text)
    expect(pieces.join('')).toBe(text)
    for (const p of pieces) expect(jsonSize(p)).toBeLessThanOrEqual(MAX_CHUNK_JSON_BYTES)
  })

  it('never ends a piece between the halves of a surrogate pair', () => {
    // An emoji is two UTF-16 units; with a 5-unit target every cut would land on one half or another.
    const text = 'ab😀'.repeat(50)
    const pieces = splitIntoChunks(text, 5, MAX_CHUNK_JSON_BYTES)
    expect(pieces.join('')).toBe(text)
    for (const p of pieces) {
      const first = p.charCodeAt(0)
      const last = p.charCodeAt(p.length - 1)
      expect(first >= 0xdc00 && first <= 0xdfff, 'starts with a low surrogate').toBe(false)
      expect(last >= 0xd800 && last <= 0xdbff, 'ends with a high surrogate').toBe(false)
    }
  })
})
