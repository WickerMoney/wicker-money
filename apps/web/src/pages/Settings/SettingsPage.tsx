import { AboutSection } from './components/AboutSection.js'
import { ConfigSection } from './components/ConfigSection.js'
import { DangerZone } from './components/DangerZone.js'
import { ExportSection } from './components/ExportSection.js'
import { PluginsSection } from './components/PluginsSection.js'
import { TimezoneSection } from './components/TimezoneSection.js'

/**
 * The settings page: About, Time zone, Plugins, Config, Export and the danger zone, one
 * surface per section. Plugins is reachable directly as `/settings#plugins`.
 *
 * Plugin-contributed settings pages do not render inside this component. They
 * are ordinary routed plugin pages that the app shell groups into the same
 * navigation section as this one.
 */
export function SettingsPage() {
  return (
    <div className="page">
      <h1 className="page__title">Settings</h1>
      <AboutSection />
      <TimezoneSection />
      <PluginsSection />
      <ConfigSection />
      <ExportSection />
      <DangerZone />
    </div>
  )
}
