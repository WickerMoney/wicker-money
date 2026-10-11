import { useEffect, useState } from 'react'

/* A deliberately nosy plugin. It tries everything a hostile one would and reports what happened, so the
   browser check can assert that the sandbox, the CSP and the broker each held. It is not a model of a
   real plugin. */

interface Ctx {
  session: { userId: string; email: string }
  api: { get<T>(path: string): Promise<T>; post<T>(path: string, body: unknown): Promise<T> }
  navigate(path: string): void
}

const message = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

async function attempt(fn: () => unknown): Promise<string> {
  try { await fn(); return 'allowed' } catch (e) { return `blocked ${message(e).slice(0, 80)}` }
}

async function probe(ctx: Ctx): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  out['origin'] = self.origin
  out['cookie'] = await attempt(() => document.cookie)
  out['localStorage'] = await attempt(() => localStorage.getItem('x'))
  out['parentDom'] = await attempt(() => window.parent.document.title)
  out['topLocation'] = await attempt(() => (window.top as Window).location.href)
  out['fetchExternal'] = await attempt(() => fetch('https://example.com/'))
  out['fetchSameOrigin'] = await attempt(() => fetch('/api/v1/core/accounts/summary'))
  out['websocket'] = await attempt(() => { new WebSocket('wss://example.com/') })
  out['email'] = ctx.session.email
  try {
    const rows = await ctx.api.get<{ rows: unknown[] }>('/core/transactions/monthly-summary?months=1')
    out['granted'] = Array.isArray(rows.rows) ? 'ok' : 'unexpected'
  } catch (e) { out['granted'] = message(e) }
  try { await ctx.api.get('/core/accounts/summary'); out['denied'] = 'ALLOWED' } catch (e) { out['denied'] = (e as { code?: string }).code ?? message(e) }
  try { await ctx.api.post('/core/transactions', {}); out['coreWrite'] = 'ALLOWED' } catch (e) { out['coreWrite'] = (e as { code?: string }).code ?? message(e) }
  try { await ctx.api.get('/core/transactions/../accounts/summary'); out['dotdot'] = 'ALLOWED' } catch (e) { out['dotdot'] = (e as { code?: string }).code ?? message(e) }
  out['ctxKeys'] = Object.keys(ctx).sort()
  out['apiKeys'] = Object.keys(ctx.api).sort()
  const root = document.documentElement
  out['theme'] = root.getAttribute('data-theme')
  out['bg'] = getComputedStyle(root).getPropertyValue('--wm-bg').trim()
  return out
}

export default function Widget({ ctx }: { ctx: Ctx }) {
  const [report, setReport] = useState<Record<string, unknown>>({})
  const [extra, setExtra] = useState(0)
  useEffect(() => { void probe(ctx).then(setReport) }, [ctx])
  return (
    <section>
      <h3>Fixture widget</h3>
      <p id="who">{ctx.session.email}</p>
      <button id="first" type="button">first</button>
      <button id="grow" type="button" onClick={() => { setExtra(500) }}>grow</button>
      <button id="huge" type="button" onClick={() => { setExtra(5000) }}>huge</button>
      <button id="reload" type="button" onClick={() => { location.reload() }}>reload</button>
      <div style={{ height: extra }} />
      <pre id="probe">{Object.keys(report).length === 0 ? '' : JSON.stringify(report)}</pre>
      <button id="last" type="button">last</button>
    </section>
  )
}
