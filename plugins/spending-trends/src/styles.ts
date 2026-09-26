// Imported from the runtime subpath, not the barrel: the barrel re-exports the
// Zod manifest schemas, which are server-side concerns no plugin should ship.
import { adoptPluginStyles } from '@wickermoney/plugin-sdk/runtime'
import css from './spending-trends.css?inline'

/**
 * Injects the chart's styles and palette into the host document.
 *
 * Imported for its side effect by the widget. A federated remote's emitted
 * stylesheet is never requested by the host, so the CSS travels as text inside
 * the bundle and is adopted into the host document at import time.
 *
 * Every class here is prefixed `spt`, not the `viz` the insights plugin uses:
 * both plugins' CSS lands in the same document, and a shared class name would
 * let whichever loaded second restyle the other's charts.
 */
adoptPluginStyles('wickermoney.spending-trends', css)
