// Imported from the runtime subpath, not the barrel: the barrel re-exports the
// Zod manifest schemas, which are server-side concerns no plugin should ship.
import { adoptPluginStyles } from '@wickermoney/plugin-sdk/runtime'
import css from './import.css?inline'

/**
 * Injects this plugin's stylesheet into the host document.
 *
 * A federated remote's emitted stylesheet is never requested — see
 * `adoptPluginStyles` — so the CSS travels as text inside the bundle.
 */
adoptPluginStyles('wickermoney.import-csv', css)
