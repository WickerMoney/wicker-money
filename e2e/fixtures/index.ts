import { expect, test as base, type Page } from '@playwright/test'
import { apiAs, type ApiClient } from './api.js'
import { PERSONAS, type PersonaKey } from './personas.js'

export { expect } from '@playwright/test'
export { PERSONAS, type PersonaKey } from './personas.js'
export type { ApiClient } from './api.js'

/** Everything a page reported that a healthy page does not. */
export interface Watch {
  /** Console errors and warnings (this is also where Content Security Policy violations land), page errors and failed or 4xx/5xx requests. */
  readonly problems: string[]
}

/**
 * Runs first in every document of the page, sandboxed plugin frames included.
 * Chromium logs most Content Security Policy refusals as console errors, but
 * not all (and a frame with an opaque origin reports nothing else out), so each
 * `securitypolicyviolation` event is also written to the console under a tag
 * the watcher recognises.
 */
const REPORT_CSP_VIOLATIONS = `(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    console.error('CSP violation: ' + e.effectiveDirective + ' blocked ' + (e.blockedURI || 'inline') + ' in ' + location.pathname + (e.sample ? ' (' + e.sample + ')' : ''))
  })
})()`

interface Fixtures {
  /** Signs the page in through the sign-in form, the way docs/screenshots/capture.mjs does. */
  signIn: (persona: PersonaKey) => Promise<void>
  /** A signed-in API client for a persona (bearer token, no browser). */
  api: (persona: PersonaKey) => Promise<ApiClient>
  /** Starts recording problems on the page. Call it after sign-in: the signed-out first load legitimately sees a 401 on refresh. */
  watch: () => Watch
}

export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    await context.addInitScript(REPORT_CSP_VIOLATIONS)
    await use(context)
  },
  signIn: async ({ page }, use) => {
    await use(async (persona) => {
      const { email, password } = PERSONAS[persona]
      await page.goto('/')
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/password/i).first().fill(password)
      await page.getByRole('button', { name: /sign in/i }).first().click()
      // The shell's own navigation: present once the session is established.
      await page.locator('nav a[href="/"]').first().waitFor()
    })
  },
  api: async ({ playwright, baseURL }, use) => {
    const contexts: { dispose(): Promise<void> }[] = []
    await use(async (persona) => {
      // A context of its own per client, so two personas never share cookies.
      const request = await playwright.request.newContext({ baseURL: baseURL ?? '' })
      contexts.push(request)
      return apiAs(request, persona)
    })
    await Promise.all(contexts.map((c) => c.dispose()))
  },
  watch: async ({ page }, use) => {
    await use(() => watchPage(page))
  },
})

function watchPage(page: Page): Watch {
  const problems: string[] = []
  page.on('console', (message) => {
    const type = message.type()
    if (type === 'error' || type === 'warning') problems.push(`console ${type}: ${message.text()} (${message.location().url})`)
  })
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('requestfailed', (request) => {
    problems.push(`request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`)
  })
  return { problems }
}

/** Fails with the full list when anything was recorded. */
export function expectNoProblems(w: Watch): void {
  expect(w.problems, w.problems.join('\n')).toEqual([])
}
