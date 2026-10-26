import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

/** Where every `.recur-link {` rule starts, with the declarations it holds. */
function recurLinkRules(): { at: number; body: string }[] {
  return [...css.matchAll(/(?<![\w-])\.recur-link\s*\{([^}]*)\}/g)].map((m) => ({ at: m.index, body: m[1] ?? '' }))
}

describe('.recur-link in app.css', () => {
  it('declares the phone hit area after the base rule, so the base padding cannot cancel it', () => {
    const rules = recurLinkRules()
    const base = rules.find((r) => /padding:\s*0\b/.test(r.body))
    const phone = rules.find((r) => /padding:\s*10px 4px/.test(r.body))
    expect(base).toBeDefined()
    expect(phone).toBeDefined()
    // Same specificity, so the later rule wins; the phone padding must be the later one.
    expect(phone!.at).toBeGreaterThan(base!.at)
  })

  it('never pairs a negative margin with a padding that a later rule resets', () => {
    const rules = recurLinkRules()
    for (const r of rules.filter((x) => /margin:\s*-/.test(x.body))) {
      const resets = rules.filter((x) => x.at > r.at && /padding:/.test(x.body))
      expect(resets).toEqual([])
    }
  })
})
