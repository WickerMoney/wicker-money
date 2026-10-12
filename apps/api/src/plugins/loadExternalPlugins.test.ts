import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadExternalPlugins } from './loadExternalPlugins.js'

let dir: string
const lines: string[] = []
const log = { info: (m: string) => lines.push(`info: ${m}`), warn: (m: string) => lines.push(`warn: ${m}`) }

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wm-load-')); lines.length = 0 })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('loadExternalPlugins', () => {
  it('does nothing and says nothing when the directory is not configured', () => {
    expect(loadExternalPlugins(undefined, log)).toEqual([])
    expect(lines).toEqual([])
  })

  it('logs what it found, and that each plugin starts switched off', () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ id: 'acme.a' }))
    const plugins = loadExternalPlugins(dir, log)
    expect(plugins).toHaveLength(1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('1 found')
    expect(lines[0]).toContain('acme.a')
    expect(lines[0]).toContain('switched off')
  })

  it('logs every skipped file as a warning', () => {
    writeFileSync(join(dir, 'bad.json'), 'nope')
    writeFileSync(join(dir, 'shadow.json'), JSON.stringify({ id: 'wickermoney.budgets' }))
    expect(loadExternalPlugins(dir, log)).toEqual([])
    expect(lines.filter((l) => l.startsWith('warn:'))).toHaveLength(2)
    expect(lines.at(-1)).toContain('none found')
  })

  it('warns, and loads nothing, for a directory that cannot be read', () => {
    expect(loadExternalPlugins(join(dir, 'missing'), log)).toEqual([])
    expect(lines[0]).toMatch(/^warn: .*cannot read PLUGIN_MANIFEST_DIR/)
  })
})
