import type { NotifyMessage } from '@wickermoney/plugin-sdk/isolated'

/**
 * @module
 * What the host does to a plugin's `notify` before it becomes a toast (ADR 0009, question 5).
 *
 * A plugin's text is untrusted: it must not be able to pass for the host's own message, hide part of itself with
 * control characters or bidirectional overrides, or take more room than a sentence. The toast API takes a plain
 * string and renders it as a text node, so there is no markup to strip; what is left is to clean the text, cap it,
 * and say whose it is.
 */

/** Most characters of a plugin's text the host shows (the SDK validator accepts more; this is the host's own cap). */
export const MAX_PLUGIN_NOTIFY_LENGTH = 200

/** Longest plugin name shown in the prefix. */
const MAX_NAME_LENGTH = 60

/** Control characters, bidirectional overrides and isolates, and the direction marks. Replaced by a space (newlines included). */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g

/**
 * Cleans plugin-supplied text for display on one line.
 *
 * @param text - What the plugin sent.
 * @returns The text with control characters, newlines and bidirectional controls turned into single spaces,
 *   runs of whitespace collapsed and the ends trimmed. May be empty.
 */
export function cleanPluginText(text: string): string {
  return text.normalize('NFC').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The line shown for a plugin's notification: the plugin's manifest name first, so a plugin cannot pass for the host.
 * No host toast starts with "<name> plugin:", and the plugin's text cannot contain a newline to fake a second line.
 *
 * @param pluginName - The manifest's `name`.
 * @param text - Already cleaned and length-checked text.
 */
export function pluginToastText(pluginName: string, text: string): string {
  const name = cleanPluginText(pluginName).slice(0, MAX_NAME_LENGTH)
  return `${name === '' ? 'A' : name} plugin: ${text}`
}

/** The toast kinds a plugin may ask for: the protocol's four levels, which are the host's own toast kinds. */
export type PluginToastLevel = NotifyMessage['level']

/** Slots a plugin may fill at once: a third toast from the same plugin replaces its oldest, so it cannot stack the page. */
const SLOTS = 2

/**
 * Hands out toast keys so a plugin has at most two toasts showing, however many frames it has.
 *
 * The toast API replaces a toast that has the same `key` in place, so two keys per plugin id is a hard cap of two
 * visible (or waiting) toasts per plugin. The cost is that a third notification replaces the first instead of
 * queueing behind it, which is the ADR's rule: excess is dropped, not queued.
 */
export class PluginToastSlots {
  private readonly next = new Map<string, number>()

  /** The key for this plugin's next toast, alternating between its two slots. */
  keyFor(pluginId: string): string {
    const n = this.next.get(pluginId) ?? 0
    this.next.set(pluginId, (n + 1) % SLOTS)
    return `plugin-notify:${pluginId}:${n}`
  }
}
