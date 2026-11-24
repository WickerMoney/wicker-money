import { useCallback, useMemo, useRef } from 'react'
import { useToast } from '@wickermoney/ui-kit'
import { PluginToastSlots, pluginToastText, type PluginToastLevel } from './pluginNotify.js'

/** One set of slots for the whole page, so two frames of the same plugin share its two. */
const slots = new PluginToastSlots()

/** What a plugin frame's owner uses to show and withdraw the frame's notifications. */
export interface PluginToasts {
  /** Shows `text` (already cleaned and length-checked by the broker) as a toast attributed to the plugin. */
  readonly show: (level: PluginToastLevel, text: string) => void
  /** Tells the person the host saved `filename` for the plugin: "Saved <name> from <plugin>", a host toast of its own. */
  readonly saved: (filename: string) => void
  /** Dismisses every toast this frame raised that is still showing or waiting. Call when the frame goes away. */
  readonly withdraw: () => void
}

/**
 * The host side of a plugin's `ctx.notify`: turns an accepted notification into a toast through the existing toast
 * API and nothing else. The text goes in as a plain string (the provider renders it as a text node), prefixed with the
 * plugin's manifest name; the plugin's kind is the toast kind. Two keys per plugin id cap it at two toasts at a time.
 *
 * Needs a `ToastProvider` above it, as the app has (`AuthenticatedRoutes`).
 *
 * @param pluginId - The manifest id.
 * @param pluginName - The manifest name, shown in the prefix.
 */
export function usePluginToasts(pluginId: string, pluginName: string): PluginToasts {
  const toast = useToast()
  const shown = useRef(new Set<string>())
  const show = useCallback((level: PluginToastLevel, text: string): void => {
    const id = toast.show(pluginToastText(pluginName, text), { kind: level, key: slots.keyFor(pluginId) })
    shown.current.add(id)
  }, [toast, pluginId, pluginName])
  const saved = useCallback((filename: string): void => {
    toast.show(`Saved ${filename} from ${pluginName}`, { kind: 'success', key: `plugin-saved:${pluginId}` })
  }, [toast, pluginId, pluginName])
  const withdraw = useCallback((): void => {
    for (const id of shown.current) toast.dismiss(id)
    shown.current.clear()
  }, [toast])
  return useMemo(() => ({ show, saved, withdraw }), [show, saved, withdraw])
}
