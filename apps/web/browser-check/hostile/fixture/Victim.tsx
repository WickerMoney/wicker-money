import { useEffect, useState } from 'react'

/* An honest neighbour. It records what it made of anything a sibling frame throws at it. */

interface Ctx { session: { email: string }; api: { get(path: string): Promise<unknown> } }

declare global {
  interface Window { __victim?: { info(): Promise<Record<string, unknown>>; messages: Array<{ type: unknown; fromParent: boolean; ports: number }> } }
}

export default function Victim({ ctx, size }: { ctx: Ctx; size?: string }) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    const messages: Array<{ type: unknown; fromParent: boolean; ports: number }> = []
    window.addEventListener('message', (e) => {
      const d = e.data as { type?: unknown } | null
      messages.push({ type: d?.type, fromParent: e.source === window.parent, ports: e.ports.length })
    })
    window.__victim = {
      messages,
      async info() {
        const read = await ctx.api.get('/core/transactions/monthly-summary?months=1&victim=1').then(() => 'ok', (e: { code?: string }) => e.code ?? 'error')
        return {
          email: ctx.session.email,
          theme: document.documentElement.getAttribute('data-theme'),
          bg: getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim(),
          size: document.getElementById('size')?.textContent,
          read,
          forgedConnectsReceived: messages.filter((m) => m.type === 'wm.connect' && !m.fromParent).length,
          forgedConnectsFromParent: messages.filter((m) => m.type === 'wm.connect' && m.fromParent).length,
        }
      },
    }
  }, [ctx])
  useEffect(() => { setShown(size ?? '') }, [size])
  return <section><h3>Victim widget</h3><p id="who">{ctx.session.email}</p><p id="size">{shown}</p></section>
}
