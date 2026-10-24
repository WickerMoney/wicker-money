import { createContext, useContext } from 'react'

/**
 * How a toast looks and is announced.
 *
 * @experimental Part of the toast API, which may change in any 0.x release.
 */
export type ToastKind = 'success' | 'info' | 'warning' | 'error'

/**
 * Options for {@link ToastApi.show}.
 *
 * @experimental Part of the toast API, which may change in any 0.x release.
 */
export interface ToastOptions {
  /** Defaults to `'info'`. `warning` and `error` are announced with a "Warning: " or "Error: " prefix. */
  readonly kind?: ToastKind
  /**
   * A toast with the same key replaces the earlier one in place (visible or
   * waiting) and is announced again. Use it for repeated actions of one kind,
   * so they do not stack.
   */
  readonly key?: string
}

/**
 * What {@link useToast} returns. Both members keep the same identity for the
 * life of the provider.
 *
 * @experimental Part of the toast API, which may change in any 0.x release.
 */
export interface ToastApi {
  /**
   * Shows a plain-text message and returns its id. The message is delivered on
   * the next animation frame (or after an open modal closes, see
   * {@link ToastProvider}). Nothing dismisses a toast but the person or the same `key`.
   */
  readonly show: (message: string, options?: ToastOptions) => string
  /** Removes a visible, waiting or not yet delivered toast. An unknown id is ignored. */
  readonly dismiss: (id: string) => void
}

/** One toast as the provider holds it. Internal. */
export interface ToastItem {
  readonly id: string
  readonly message: string
  readonly kind: ToastKind
  /** Incremented when the same key replaces it, so the replacement is announced again. */
  readonly rev: number
}

/** What the viewport reads. Internal: not exported from the package. */
export interface ToastView {
  /** The toasts on screen, newest first. */
  readonly visible: readonly ToastItem[]
  readonly dismissMany: (ids: readonly string[]) => void
  /** Where focus was before it entered the stack, so closing a focused toast can give it back. */
  readonly originRef: { current: HTMLElement | null }
  readonly groupRef: { current: HTMLDivElement | null }
}

export const ToastApiContext = createContext<ToastApi | null>(null)
export const ToastViewContext = createContext<ToastView | null>(null)

/**
 * The toast API, for use in event handlers and effects.
 *
 * Throws outside a {@link ToastProvider}. Plugins cannot use it: a plugin's
 * copy of this package has no provider, and a way for plugins to notify
 * (`ctx.notify`) is planned for a later release.
 *
 * @experimental May change in any 0.x release; for the core app only until the plugin path ships.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastApiContext)
  if (api === null) {
    throw new Error(
      'useToast() was called outside a <ToastProvider>. Mount ToastProvider once above your routes '
      + '(ADR 0009, notifications and action feedback). Plugins cannot use useToast: they will use '
      + 'ctx.notify in a later release.',
    )
  }
  return api
}
