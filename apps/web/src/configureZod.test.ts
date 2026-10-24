import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

/** The path named by the first import of a module, `import './x.js'` (side effect) or `import { a } from './x.js'`. */
const firstImport = (source: string): string | undefined =>
  /^\s*import\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/m.exec(source)?.[1]

describe('configureZod', () => {
  it('turns off zod just-in-time compilation', async () => {
    await import('./configureZod.js')
    expect(z.config().jitless).toBe(true)
  })

  // zod probes `new Function` when the first object schema is built, so this has to run before every other
  // module of the entry. Import order is the only thing that guarantees it, and a sorter or an editor can change it.
  it.each([
    ['the app entry', './main.tsx', './configureZod.js'],
    ['the plugin frame entry', './frame/main.tsx', '../configureZod.js'],
  ])('is the first import of %s', (_name, entry, expected) => {
    expect(firstImport(read(entry))).toBe(expected)
  })
})
