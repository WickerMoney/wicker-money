import { createContext, useContext } from 'react'

/**
 * How a toast looks and is announced.
 *
 * @experimental Part of the toast API, which may change in any 0.x release.
 */
export type ToastKind = 'success' | 'info' | 'warning' | 'error'

/**
 * An Undo button on a toast.
 *
 * @experimental Part of the toast API, which may change in any 0.x release;
 *   `undo` in particular is new and the least settled part of it.
 */
export interface ToastUndo {
  /** The button's text. Defaults to `"Undo"`. */
  readonly label?: string
  /**
   * What the button does. While the returned promise is pending the button is
   * `busy` (it keeps focus and ignores a second click). When it resolves the toast
   * closes; show the outcome with your own toast, which should carry no `undo`
   * (there is no Undo of an Undo). When it rejects the toast stays and the button
   * works again: raise your own error toast, the rejection itself is not reported.
   */
  readonly run: () => Promise<void>
}

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
  /**
   * Adds an Undo button before Close, for `success` and `info` toasts (ignored on
   * `warning` and `error`, with a console warning outside production).
   *
   * An Undo toast follows the same rules as any other, with two differences. It is
   * announced with " Undo is available." added, because the button inside the stack
   * is not announced. And it **survives a route change**, as an error does, because
   * clearing it would remove the only way back. Nothing closes it on a timer: the
   * limit on how long the action can be undone belongs to the caller (the API
   * answers an Undo that is too late with an error, which `run` shows). Give each
   * Undo toast its own `key`, or a later one replaces the earlier one's button.
   *
   * Plugins get no `undo`: a plugin toast (the later `ctx.notify`) carries no callback.
   *
   * @experimental New in 0.9.0 and the least settled part of the toast API.
   */
  readonly undo?: ToastUndo
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
  /** The Undo button, when the caller asked for one. */
  readonly undo?: ToastUndo
}

/** What the viewport reads. Internal: not exported from the package. */
export interface ToastView {
  /** The toasts on screen, newest first. */
  readonly visible: readonly ToastItem[]
  readonly dismissMany: (ids: readonly string[]) => void
  /** Whether a toast with this id is queued to replace the one showing. */
  readonly replacementWaiting: (id: string) => boolean
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
