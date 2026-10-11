import type * as Playwright from 'playwright-core'

/** How an attempt was stopped, in the vocabulary of ADR 0005's exit criteria. */
export type Stopped = 'browser-block' | 'broker-refusal' | 'server-refusal' | 'contained'

export interface AttackResult {
  readonly id: string
  readonly group: string
  readonly title: string
  /** How the suite expects the attempt to fail. `residual` is a channel the platform does not stop; see ADR 0005. */
  readonly expected: Stopped | 'residual'
  /** What happened, in a few words that name the mechanism (a CSP directive, a broker code, a status). */
  readonly reason: string
  readonly pass: boolean
  readonly detail?: unknown
}

/** Collects verdicts and prints each as it arrives. */
export class Recorder {
  readonly results: AttackResult[] = []
  readonly checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []

  attack(r: AttackResult): void {
    this.results.push(r)
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.group}] ${r.id}: ${r.title}  -> ${r.expected}: ${r.reason}${r.pass || r.detail === undefined ? '' : `\n        ${JSON.stringify(r.detail).slice(0, 600)}`}`)
  }

  /** A property that is not one attack: an invariant, a header, an attribute set. */
  check(name: string, pass: boolean, detail?: unknown): void {
    this.checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `\n        ${JSON.stringify(detail).slice(0, 600)}`}`)
  }

  get failed(): number { return this.results.filter((r) => !r.pass).length + this.checks.filter((c) => !c.pass).length }
}

// ---------------------------------------------------------------------------
// What the API saw.
// ---------------------------------------------------------------------------

export interface ApiEntry {
  readonly seq: number
  readonly method: string
  readonly url: string
  readonly path: string
  /** `none`, `host` (an access token), `plugin` (audience ends `:plugin`) or `other`. */
  readonly auth: 'none' | 'host' | 'plugin' | 'other'
  readonly pluginId: string | null
  readonly hasCookie: boolean
  readonly origin: string | undefined
  status: number | null
}

function decodeClaims(token: string): { aud?: string; plg?: string } | null {
  try { return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aud?: string; plg?: string } } catch { return null }
}

/** Records every request the server receives, with who it claimed to be and how the server answered. */
export class ApiLog {
  readonly entries: ApiEntry[] = []
  private seq = 0

  /** Hooks a Fastify app (typed structurally: this folder does not depend on Fastify itself). */
  install(app: { addHook: unknown }): void {
    const byRequest = new WeakMap<object, ApiEntry>()
    interface Req { method: string; url: string; headers: { authorization?: string; cookie?: string; origin?: string } }
    const addHook = (app.addHook as (name: string, fn: (...a: never[]) => Promise<void>) => void).bind(app)
    addHook('onRequest', async (request: Req) => {
      const header = request.headers.authorization
      let auth: ApiEntry['auth'] = 'none'
      let pluginId: string | null = null
      if (header !== undefined) {
        const claims = header.startsWith('Bearer ') ? decodeClaims(header.slice(7)) : null
        auth = claims === null ? 'other' : typeof claims.aud === 'string' && claims.aud.endsWith(':plugin') ? 'plugin' : 'host'
        pluginId = claims?.plg ?? null
      }
      const entry: ApiEntry = {
        seq: this.seq++, method: request.method, url: request.url, path: request.url.split('?')[0] ?? request.url,
        auth, pluginId, hasCookie: request.headers.cookie !== undefined, origin: request.headers.origin, status: null,
      }
      byRequest.set(request, entry)
      this.entries.push(entry)
    })
    addHook('onResponse', async (request: Req, reply: { statusCode: number }) => {
      const entry = byRequest.get(request)
      if (entry !== undefined) entry.status = reply.statusCode
    })
  }

  get mark(): number { return this.seq }
  since(mark: number): ApiEntry[] { return this.entries.filter((e) => e.seq >= mark) }
  /** Requests that carried the marker `hx=<id>` (the fixture puts it on every URL it builds). */
  withMarker(id: string, from = 0): ApiEntry[] { return this.since(from).filter((e) => new RegExp(`[?&]hx=${id}(?:&|$)`).test(e.url)) }
}

// ---------------------------------------------------------------------------
// What the browser said.
// ---------------------------------------------------------------------------

export interface ConsoleEntry { readonly seq: number; readonly type: string; readonly text: string; readonly url: string }

/** Console output and new windows, from every page and frame of one browser context. */
export class BrowserLog {
  readonly console: ConsoleEntry[] = []
  readonly pages: Playwright.Page[] = []
  readonly requestUrls: Array<{ seq: number; url: string; method: string; frame: string; type: string; headers: Record<string, string> }> = []
  private seq = 0

  attach(context: Playwright.BrowserContext): void {
    const onPage = (page: Playwright.Page): void => {
      this.pages.push(page)
      page.on('console', (m) => { this.console.push({ seq: this.seq++, type: m.type(), text: m.text(), url: m.location().url }) })
      page.on('pageerror', (e) => { this.console.push({ seq: this.seq++, type: 'pageerror', text: String(e.message), url: '' }) })
      page.on('requestfailed', (r) => { this.console.push({ seq: this.seq++, type: 'requestfailed', text: `${r.url()} ${r.failure()?.errorText ?? ''}`, url: r.url() }) })
      page.on('request', (r) => {
        const entry = { seq: this.seq++, url: r.url(), method: r.method(), frame: safe(() => r.frame().url()), type: r.resourceType(), headers: r.headers() }
        this.requestUrls.push(entry)
        void r.allHeaders().then((h) => { entry.headers = h }, () => undefined)
      })
    }
    context.on('page', onPage)
    for (const p of context.pages()) onPage(p)
  }

  get mark(): number { return this.seq }
  consoleSince(mark: number): ConsoleEntry[] { return this.console.filter((c) => c.seq >= mark) }
  requestsSince(mark: number): typeof this.requestUrls { return this.requestUrls.filter((r) => r.seq >= mark) }
}

function safe(fn: () => string): string { try { return fn() } catch { return '' } }

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A one-line, readable reason from whatever evidence matched. */
export function snippet(text: string, re: RegExp): string {
  const m = re.exec(text)
  if (m === null) return ''
  const start = Math.max(0, m.index - 30)
  return text.slice(start, m.index + m[0].length + 60).replace(/\s+/g, ' ').trim()
}
