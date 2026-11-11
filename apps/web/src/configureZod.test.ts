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
  it('is the first import of the app entry', () => {
    expect(firstImport(read('./main.tsx'))).toBe('./configureZod.js')
  })

  // The frame entry has no zod at start (frameBundle.test.ts keeps it out); the pin check loads it on demand.
  // `await import()` is sequential, so configuring first is a matter of order in one function.
  it('is awaited before the SDK root in the frame pin check', () => {
    const source = read('./frame/fragment.ts')
    const configure = source.indexOf("await import('../configureZod.js')")
    const root = source.indexOf("await import('@wickermoney/plugin-sdk')")
    expect(configure).toBeGreaterThan(-1)
    expect(root).toBeGreaterThan(configure)
  })
})
