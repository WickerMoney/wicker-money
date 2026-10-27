import { screen, waitFor } from '@testing-library/react'
import { ToastProvider, ToastViewport } from '@wickermoney/ui-kit'
import type { ReactNode } from 'react'

/**
 * A `wrapper` for `renderHook` (or `render`) that mounts the toast provider and
 * draws its viewport, so a hook that calls `useToast` can be tested and what it
 * raised can be read back with {@link toastTexts}.
 */
export function ToastsWrapper({ children }: { readonly children: ReactNode }) {
  return (
    <ToastProvider>
      <ToastViewport />
      {children}
    </ToastProvider>
  )
}

/**
 * The messages on screen in the notification stack, oldest first as drawn.
 *
 * Reads the visible stack, not the hidden announcer, so a message is not
 * counted twice. An `error` toast reads "Error: ..." here, as it does to a
 * screen reader.
 *
 * @returns The text of each toast, or an empty array when none shows.
 */
export function toastTexts(): string[] {
  const stack = screen.queryByRole('group', { name: 'Notifications' })
  return Array.from(stack?.querySelectorAll('.wm-toast__text') ?? []).map((e) => e.textContent ?? '')
}

/**
 * Waits for a toast to be delivered (a toast shows on the next animation frame)
 * and returns the stack's messages.
 *
 * @param expected - Text a toast must contain; waits for any toast when omitted.
 * @returns The messages on screen once one matches.
 */
export async function findToast(expected?: string | RegExp): Promise<string[]> {
  await waitFor(() => {
    const texts = toastTexts()
    const hit = expected === undefined
      ? texts.length > 0
      : texts.some((t) => (typeof expected === 'string' ? t.includes(expected) : expected.test(t)))
    if (!hit) throw new Error(`No toast matching ${String(expected)}; showing: ${JSON.stringify(texts)}`)
  })
  return toastTexts()
}
