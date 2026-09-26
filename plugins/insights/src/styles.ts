// Imported from the runtime subpath, not the barrel: the barrel re-exports the
// Zod manifest schemas, which are server-side concerns no plugin should ship.
import { adoptPluginStyles } from '@wickermoney/plugin-sdk/runtime'
import css from './viz.css?inline'

/**
 * Injects the chart palette into the host document.
 *
 * Imported for its side effect by every widget in this plugin. A federated
 * remote's emitted stylesheet is never requested by the host, so the CSS
 * travels as text inside the bundle and is adopted into the host document at
 * import time.
 *
 * The plugin id is written once, here, rather than in each widget.
 */
adoptPluginStyles('wickermoney.insights', css)
