// A .tsx file only because tsconfig leaves *.test.tsx out of the build, and ui-kit has no Node types for readFileSync.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom cannot hover, so this asserts the CSS text. The browser check
// (apps/web/browser-check/buttons.ts) is the one that sees the colours.
const css = readFileSync(resolve(process.cwd(), 'src/components.css'), 'utf8')

/** Every rule whose selector is exactly `selector`, with its position and declarations. */
function rules(selector: string): { at: number; body: string }[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...css.matchAll(new RegExp(`(?<![\\w-])${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => ({ at: m.index, body: m[1] ?? '' }))
}

describe('button hover cascade in components.css', () => {
  const neutralHover = rules('.wm-btn:hover:not(:disabled)')
  const primaryHover = rules('.wm-btn--primary:hover:not(:disabled)')

  it('has one neutral hover rule that sets a background, which is why variants must restate theirs', () => {
    expect(neutralHover).toHaveLength(1)
    expect(neutralHover[0]!.body).toMatch(/background:\s*var\(--wm-surface-alt\)/)
  })

  it('restates the primary background on hover, in a rule after the neutral hover rule', () => {
    expect(primaryHover).toHaveLength(1)
    expect(primaryHover[0]!.body).toMatch(/background:\s*var\(--wm-accent\)/)
    // Equal specificity, so the later rule wins.
    expect(primaryHover[0]!.at).toBeGreaterThan(neutralHover[0]!.at)
  })

  it('never lets a hover rule change the text colour of a variant', () => {
    for (const r of [...neutralHover, ...primaryHover]) expect(r.body).not.toMatch(/(?<![\w-])color:/)
  })

  it('keeps the variant colours the hover rule must not undo (primary and danger)', () => {
    expect(rules('.wm-btn--primary')[0]!.body).toMatch(/color:\s*var\(--wm-accent-text\)/)
    expect(rules('.wm-btn--danger')[0]!.body).toMatch(/color:\s*var\(--wm-negative\)/)
    // A danger hover rule that set its own background would need the same care; today there is none.
    expect(rules('.wm-btn--danger:hover:not(:disabled)')).toHaveLength(0)
  })
})
