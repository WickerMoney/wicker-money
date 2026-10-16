import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_MANIFEST_BYTES, MAX_MANIFEST_FILES, readManifestDirectory } from './manifestDirectory.js'

let dir: string
const NONE: ReadonlySet<string> = new Set()

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wm-manifests-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const write = (name: string, value: unknown): void => {
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value))
}
const ids = (result: ReturnType<typeof readManifestDirectory>): unknown[] =>
  result.plugins.map((p) => (p.manifest as { id: string }).id)

describe('readManifestDirectory', () => {
  it('reads every .json file, in file name order, and reports where each came from', () => {
    write('b.json', { id: 'acme.b' })
    write('a.json', { id: 'acme.a', anything: 'else' })
    const result = readManifestDirectory(dir, NONE)
    expect(result.problems).toEqual([])
    expect(result.plugins.map((p) => p.source)).toEqual(['a.json', 'b.json'])
    expect(ids(result)).toEqual(['acme.a', 'acme.b'])
  })

  it('hands the manifests over unvalidated: a refusal is the registry\'s to report, not this reader\'s', () => {
    write('a.json', { id: 'acme.a', remoteEntry: 'javascript:alert(1)', permissions: ['notify'] })
    expect(readManifestDirectory(dir, NONE).plugins).toHaveLength(1)
  })

  it('ignores files that are not .json, and does not look inside subdirectories', () => {
    write('readme.txt', 'hello')
    write('a.json.bak', { id: 'acme.a' })
    write('A.JSON', { id: 'acme.upper' })
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'nested', 'c.json'), JSON.stringify({ id: 'acme.c' }))
    expect(readManifestDirectory(dir, NONE)).toEqual({ plugins: [], problems: [] })
  })

  it('returns a problem, never throws, for a directory that is missing or is a file', () => {
    const missing = readManifestDirectory(join(dir, 'nope'), NONE)
    expect(missing.plugins).toEqual([])
    expect(missing.problems[0]).toContain('cannot read PLUGIN_MANIFEST_DIR')
    write('a.json', { id: 'acme.a' })
    expect(readManifestDirectory(join(dir, 'a.json'), NONE).problems[0]).toContain('not a directory')
  })

  it('skips a file that is not JSON, naming it, and still reads the others', () => {
    write('bad.json', '{ not json')
    write('good.json', { id: 'acme.good' })
    const result = readManifestDirectory(dir, NONE)
    expect(ids(result)).toEqual(['acme.good'])
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toMatch(/^bad\.json: skipped, not valid JSON/)
  })

  it.each([
    ['an array', []],
    ['a string', 'text'],
    ['null', null],
    ['no id', { name: 'x' }],
    ['a numeric id', { id: 5 }],
    ['an id that is not reverse-domain', { id: 'Acme Report' }],
    ['an id with a path in it', { id: '../../etc/passwd' }],
    ['an id with a newline', { id: 'acme.report\nINJECT' }],
    ['an id over 100 characters', { id: `acme.${'a'.repeat(100)}` }],
  ])('skips a file whose JSON is %s', (_what, value) => {
    write('x.json', JSON.stringify(value))
    const result = readManifestDirectory(dir, NONE)
    expect(result.plugins).toEqual([])
    expect(result.problems[0]).toContain('x.json: skipped')
  })

  it('does not read a symbolic link, so a manifest cannot point at a file outside the directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'wm-outside-'))
    try {
      writeFileSync(join(outside, 'secret.json'), JSON.stringify({ id: 'acme.linked' }))
      symlinkSync(join(outside, 'secret.json'), join(dir, 'link.json'))
      const result = readManifestDirectory(dir, NONE)
      expect(result.plugins).toEqual([])
      expect(result.problems[0]).toContain('link.json: skipped, not a regular file')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('skips a file over the size limit without reading it', () => {
    write('big.json', JSON.stringify({ id: 'acme.big', pad: 'x'.repeat(MAX_MANIFEST_BYTES) }))
    const result = readManifestDirectory(dir, NONE)
    expect(result.plugins).toEqual([])
    expect(result.problems[0]).toContain('over the')
  })

  it('reads only the first MAX_MANIFEST_FILES files, and says so', () => {
    for (let i = 0; i < MAX_MANIFEST_FILES + 5; i += 1) write(`p${String(i).padStart(3, '0')}.json`, { id: `acme.p${i}` })
    const result = readManifestDirectory(dir, NONE)
    expect(result.plugins).toHaveLength(MAX_MANIFEST_FILES)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain(`${MAX_MANIFEST_FILES + 5} manifest files`)
  })

  it('never lets a manifest take the id of a bundled plugin', () => {
    write('impostor.json', { id: 'wickermoney.budgets' })
    write('fine.json', { id: 'acme.fine' })
    const result = readManifestDirectory(dir, new Set(['wickermoney.budgets']))
    expect(ids(result)).toEqual(['acme.fine'])
    expect(result.problems[0]).toContain("'wickermoney.budgets' is a bundled plugin")
  })

  it('keeps the first of two files that claim one id, and says which', () => {
    write('a.json', { id: 'acme.same', n: 1 })
    write('b.json', { id: 'acme.same', n: 2 })
    const result = readManifestDirectory(dir, NONE)
    expect(result.plugins).toHaveLength(1)
    expect((result.plugins[0]?.manifest as { n: number }).n).toBe(1)
    expect(result.problems[0]).toContain('b.json: skipped')
    expect(result.problems[0]).toContain('already declared by a.json')
  })

  it('does not put the contents of a bad file in its messages', () => {
    write('bad.json', '{"id": "acme.a", "secret": "hunter2" nope}')
    const message = readManifestDirectory(dir, NONE).problems.join('\n')
    expect(message).not.toContain('hunter2')
  })
})
