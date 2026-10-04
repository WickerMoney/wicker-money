import type { RegisteredPlugin } from '../../../models/index.js'

const LABEL: Record<RegisteredPlugin['status'], string> = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  failed: 'Failed to load',
}

/** Props for {@link PluginStatus}. */
export interface PluginStatusProps {
  /** The plugin's status. */
  readonly status: RegisteredPlugin['status']
}

/** A plugin's status as a labelled dot: the word is always there, the colour only reinforces it. */
export function PluginStatus({ status }: PluginStatusProps) {
  return <span className={`plugin-status plugin-status--${status}`}>{LABEL[status]}</span>
}
