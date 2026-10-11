import { AboutSection } from './components/AboutSection.js'
import { ConfigSection } from './components/ConfigSection.js'
import { ExportSection } from './components/ExportSection.js'
import { PeopleSection } from './components/PeopleSection.js'
import { PluginsSection } from './components/PluginsSection.js'
import { TimezoneSection } from './components/TimezoneSection.js'

/**
 * The settings page: About, Time zone, Plugins, People (owners only), Config
 * and Export, one surface per section. Plugins and People are reachable
 * directly as `/settings#plugins` and `/settings#people`.
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
      <PeopleSection />
      <ConfigSection />
      <ExportSection />
    </div>
  )
}
