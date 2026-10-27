import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { ToastProvider, ToastViewport } from '@wickermoney/ui-kit'
import type { ReactElement, ReactNode } from 'react'

/** Wraps a tree in the toast provider and draws the viewport, as the app shell does. */
function ToastsWrapper({ children }: { readonly children: ReactNode }) {
  return (
    <ToastProvider>
      <ToastViewport />
      {children}
    </ToastProvider>
  )
}

/**
 * Renders a page or component inside a `ToastProvider` with a `ToastViewport`,
 * because `useToast` throws without a provider (ADR 0009, section 7). Toasts
 * raised by the tree are then on screen and in the announcer, so a test can
 * assert on them like any other text.
 *
 * @param ui - The element to render.
 * @param options - Testing Library options; `wrapper` is not supported.
 * @returns Testing Library's render result.
 */
export function renderWithToasts(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return render(ui, { ...options, wrapper: ToastsWrapper })
}
