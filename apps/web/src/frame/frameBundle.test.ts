// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

/**
 * Keeps the plugin frame light.
 *
 * A sandboxed frame downloads and parses its whole bootstrap once per frame, and a dashboard has several. The SDK
 * root (`@wickermoney/plugin-sdk`) carries the Zod manifest schemas, about 85 kB, that a frame does not need, so
 * importing even one function from it puts all of them in. Frame code takes what it needs from `/runtime`, `/money`,
 * `/date` and `/isolated`; `fragment.ts` is the one place that reaches the root, with a dynamic `import()` that only a
 * pinned (third-party) plugin triggers.
 *
 * Two guards. The build one is exact (it asks the bundler what the frame loads at start, however it got there); the
 * source one covers the bundled plugins, whose own bundles the frame loads, and names the file at fault.
 */

const here = import.meta.dirname
const webRoot = join(here, '../..')
const pluginsRoot = join(here, '../../../../plugins')

/**
 * The most the frame's start-up JavaScript may weigh, raw bytes, as this test builds it. Module Federation does not
 * run under Vitest, so React and react-dom are inlined here instead of split into shared chunks: the number is bigger
 * than what the browser downloads, but it is steady, and it moves when the frame's own code does. Measured when the
 * SDK root and zod left the bootstrap (519,809 bytes); about 5%
 * of room. Raise it with a reason, not to make a test pass.
 */
const START_UP_BUDGET_BYTES = 545_000

describe('the plugin frame bootstrap', () => {
  it('does not load the SDK root or zod at start, and stays under its size budget', async () => {
    const result = await build({
      root: webRoot,
      configFile: join(webRoot, 'vite.frame.config.ts'),
      logLevel: 'silent',
      build: { write: false, minify: true, reportCompressedSize: false },
    })
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []))
    const chunks = outputs.filter((o) => o.type === 'chunk')
    const byName = new Map(chunks.map((c) => [c.fileName, c]))
    const entry = chunks.find((c) => c.isEntry && c.name === 'plugin-frame')
    expect(entry, 'the frame entry chunk').toBeDefined()

    // Everything reachable by static import from the entry; dynamic imports are on-demand and are not counted.
    const start = new Map<string, (typeof chunks)[number]>()
    const visit = (name: string): void => {
      const chunk = byName.get(name)
      if (chunk === undefined || start.has(name)) return
      start.set(name, chunk)
      for (const next of chunk.imports) visit(next)
    }
    visit(entry!.fileName)

    const modules = [...start.values()].flatMap((c) => c.moduleIds)
    const offenders = modules.filter((id) => /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?zod[\\/]/.test(id)
      || /[\\/]plugin-sdk[\\/]dist[\\/]index\.js$/.test(id))
    expect(offenders, 'modules of the SDK root or zod that the frame loads at start').toEqual([])

    const bytes = [...start.values()].reduce((sum, c) => sum + Buffer.byteLength(c.code), 0)
    expect(bytes, `start-up JavaScript (${start.size} files)`).toBeLessThanOrEqual(START_UP_BUDGET_BYTES)
  }, 120_000)
})

/** Source files of a plugin that can run in a frame: everything under `src` except tests and the plugin's server half. */
function uiSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'server' || entry.name === 'testing' ? [] : uiSources(path)
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** Imports (and re-exports) from the SDK root that carry a value, as opposed to `import type` or all-`type` names. */
function rootValueImports(source: string): string[] {
  const found: string[] = []
  for (const m of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]@wickermoney\/plugin-sdk['"]/gms)) {
    if (m[1] !== undefined) continue
    const names = (m[2] ?? '').replace(/[{}]/g, '').split(',').map((n) => n.trim()).filter((n) => n !== '')
    if (names.some((n) => !n.startsWith('type '))) found.push(m[0].trim().replace(/\s+/g, ' '))
  }
  return found
}

describe('bundled plugin UI code', () => {
  const plugins = readdirSync(pluginsRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'node_modules')

  it('finds the plugins it should check', () => {
    expect(plugins.length).toBeGreaterThanOrEqual(7)
  })

  it.each(plugins.map((d) => [d.name]))('%s imports no value from the SDK root', (name) => {
    const src = join(pluginsRoot, name!, 'src')
    const bad = uiSources(src).flatMap((file) => rootValueImports(readFileSync(file, 'utf8')).map((line) => `${file.slice(pluginsRoot.length + 1)}: ${line}`))
    expect(bad, 'use `import type`, or a sub-path (/runtime, /money, /date), or a local copy with a test').toEqual([])
  })

  it('the check itself sees a value import and ignores a type import', () => {
    expect(rootValueImports("import { monthsInRange, type PluginWidgetProps } from '@wickermoney/plugin-sdk'")).toHaveLength(1)
    expect(rootValueImports("import type { PluginWidgetProps } from '@wickermoney/plugin-sdk'")).toEqual([])
    expect(rootValueImports("import { type A, type B } from '@wickermoney/plugin-sdk'")).toEqual([])
    expect(rootValueImports("import { money } from '@wickermoney/plugin-sdk/money'")).toEqual([])
  })
})
