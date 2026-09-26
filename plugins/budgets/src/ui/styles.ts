// Imported from the runtime subpath, not the barrel: the barrel re-exports the
// Zod manifest schemas, which are server-side concerns no plugin should ship.
import { adoptPluginStyles } from '@wickermoney/plugin-sdk/runtime'
import css from './budgets.css?inline'

/**
 * Injects this plugin's stylesheet into the host document.
 *
 * A federated remote's emitted stylesheet is never requested — see
 * `adoptPluginStyles` — so the CSS travels as text inside the bundle. Both
 * exposed modules import this, and adopting twice is a no-op.
 */
adoptPluginStyles('wickermoney.budgets', css)
