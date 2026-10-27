/**
 * Browser check for the ui-kit button variants on hover, focus and disabled.
 *
 * The bug it guards: `.wm-btn:hover:not(:disabled)` (three classes' worth of
 * specificity) out-ranked `.wm-btn--primary` (one), so a hovered primary button
 * lost its colours (white on light grey) and failed axe `color-contrast`.
 *
 * Loads the real tokens.css, components.css and app.css (the phone rules matter:
 * the original hit was at 561 px) into a static page of the real button markup.
 * No API, no database, no build. At 561 px and desktop, in light and dark, for
 * the default (neutral), primary, danger, icon and disabled buttons, it:
 *
 * - hovers each one, checks the computed text and background colours against the
 *   variant's resting ones where the hover must not change them (primary), and
 *   computes the WCAG contrast ratio of the colours the browser resolved;
 * - runs axe (`color-contrast` and the rest) with the pointer on that button;
 * - tabs to each enabled button and runs axe with the focus ring showing.
 *
 * Needs a Chromium (`CHROMIUM_PATH`), playwright-core (`PLAYWRIGHT_CORE`) and an
 * axe-core build (`AXE_PATH`, the path of `axe.min.js`; not a dependency of the repo).
 *
 *   cd apps/api
 *   AXE_PATH=/path/to/axe.min.js npx tsx ../web/browser-check/buttons.ts
 *
 * `BROWSER_CHECK_OUT=file.json` keeps the report (the measured ratios).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type * as Playwright from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium'
const AXE = readFileSync(process.env['AXE_PATH'] ?? 'axe.min.js', 'utf8')
const css = ['../../../packages/ui-kit/src/tokens.css', '../../../packages/ui-kit/src/components.css', '../src/app.css']
  .map((p) => readFileSync(join(here, p), 'utf8')).join('\n')

interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M3 6h18"/></svg>'
const BUTTONS = [
  { id: 'default', cls: 'wm-btn', text: 'Cancel', keepsColours: false },
  { id: 'primary', cls: 'wm-btn wm-btn--primary', text: 'Save', keepsColours: true },
  { id: 'danger', cls: 'wm-btn wm-btn--danger', text: 'Delete', keepsColours: false },
  { id: 'icon', cls: 'wm-btn wm-icon-btn', text: ICON, label: 'Edit', keepsColours: false },
  { id: 'icon-danger', cls: 'wm-btn wm-icon-btn wm-btn--danger', text: ICON, label: 'Delete', keepsColours: false },
] as const
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Buttons</title><style>${css}</style></head>
<body><main class="page"><h1>Buttons</h1><div style="display:flex;gap:12px;flex-wrap:wrap;padding:16px;background:var(--wm-bg)">
${BUTTONS.map((b) => `<button type="button" id="${b.id}" class="${b.cls}"${'label' in b ? ` aria-label="${b.label}"` : ''}>${b.text}</button>`).join('\n')}
<button type="button" id="disabled-primary" class="wm-btn wm-btn--primary" disabled>Saving</button>
<button type="button" id="disabled-default" class="wm-btn" disabled>Wait</button>
</div></main></body></html>`

/** Relative luminance of an `rgb()`/`rgba()` string (alpha ignored: no button here is translucent). */
function lum(c: string): number {
  const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((n) => {
    const v = Number(n) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

interface Axe { violations: { id: string; impact: string | null; nodes: { target: unknown[]; any: { data?: { contrastRatio?: number } }[] }[] }[] }
async function axeOf(page: Playwright.Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE })
  const result = await page.evaluate(() => (window as unknown as { axe: { run: () => Promise<Axe> } }).axe.run())
  return result.violations.map((v) => `${v.id} (${v.impact ?? '?'}): ${v.nodes.map((n) => `${String(n.target[0])} ${String(n.any[0]?.data?.contrastRatio ?? '')}`).slice(0, 3).join(', ')}`)
}
const paint = (page: Playwright.Page, id: string): Promise<{ color: string; background: string; border: string }> =>
  page.evaluate((i) => {
    const s = getComputedStyle(document.getElementById(i)!)
    return { color: s.color, background: s.backgroundColor, border: s.borderTopColor }
  }, id)

const report: Record<string, unknown> = {}

async function run(pw: typeof Playwright): Promise<void> {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  try {
    for (const vp of [{ name: '561', width: 561, height: 800 }, { name: 'desktop', width: 1280, height: 800 }]) {
      for (const scheme of ['light', 'dark'] as const) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme })
        const page = await ctx.newPage()
        await page.setContent(PAGE)
        const tag = `${vp.name}/${scheme}`

        let v = await axeOf(page)
        check(`${tag}: axe at rest`, v.length === 0, v)

        for (const b of [...BUTTONS, { id: 'disabled-primary', keepsColours: true }, { id: 'disabled-default', keepsColours: false }]) {
          const sel = page.locator(`#${b.id}`)
          await page.mouse.move(0, 0)
          const rest = await paint(page, b.id)
          if (b.id.startsWith('disabled')) {
            await sel.hover({ force: true })
            const hov = await paint(page, b.id)
            check(`${tag}: ${b.id} does not react to hover`, JSON.stringify(hov) === JSON.stringify(rest), { rest, hov })
            continue
          }
          await sel.hover()
          const hov = await paint(page, b.id)
          const r = ratio(hov.color, hov.background)
          report[`${tag}/${b.id}`] = { rest: ratio(rest.color, rest.background), hover: r, hovered: hov }
          if (b.keepsColours) {
            check(`${tag}: hovered ${b.id} keeps its colours`, hov.color === rest.color && hov.background === rest.background && hov.border === rest.border, { rest, hov })
          }
          check(`${tag}: hovered ${b.id} text contrast >= 4.5 (${r.toFixed(2)})`, r >= 4.5, hov)
          v = await axeOf(page)
          check(`${tag}: axe, ${b.id} hovered`, v.length === 0, v)
        }

        // Keyboard focus: tab to each enabled button, axe with the ring showing.
        await page.mouse.move(0, 0)
        await page.locator('h1').evaluate((h) => { h.tabIndex = -1; h.focus() })
        for (const b of BUTTONS) {
          await page.keyboard.press('Tab')
          const focused = await page.evaluate(() => ({ id: document.activeElement?.id, visible: document.activeElement?.matches(':focus-visible') }))
          check(`${tag}: Tab reaches ${b.id} with :focus-visible`, focused.id === b.id && focused.visible === true, focused)
          v = await axeOf(page)
          check(`${tag}: axe, ${b.id} focused`, v.length === 0, v)
        }
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
  }
}

const pw = (await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core')) as typeof Playwright
await run(pw)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
const out = process.env['BROWSER_CHECK_OUT']
if (out !== undefined) writeFileSync(out, JSON.stringify({ checks, contrast: report }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
