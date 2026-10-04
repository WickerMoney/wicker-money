/** Props for {@link PluginSwitch}. */
export interface PluginSwitchProps {
  /** The plugin's display name, for the accessible label. */
  readonly name: string
  /** Whether the plugin is on, as currently shown. */
  readonly on: boolean
  /** True while a change is being saved; the switch cannot be used meanwhile. */
  readonly saving: boolean
  /** Called with the requested state. */
  readonly onChange: (next: boolean) => void
}

/**
 * An on/off switch for one plugin.
 *
 * A native `<button role="switch">`, so it is focusable, toggles with Space or
 * Enter, and announces its state. The visible On/Off text means the state is
 * never carried by colour or thumb position alone.
 */
export function PluginSwitch({ name, on, saving, onChange }: PluginSwitchProps) {
  return (
    <div className="plugin-switch-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Enable ${name}`}
        aria-busy={saving}
        disabled={saving}
        className={`plugin-switch${on ? ' is-on' : ''}`}
        onClick={() => { onChange(!on) }}
      >
        <span className="plugin-switch__thumb" aria-hidden="true" />
      </button>
      <span className="plugin-switch__text" aria-hidden="true">{saving ? 'Saving…' : on ? 'On' : 'Off'}</span>
    </div>
  )
}
