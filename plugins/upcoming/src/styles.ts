// Imported from the runtime subpath, not the barrel: the barrel re-exports the
// Zod manifest schemas, which are server-side concerns no plugin should ship.
import { adoptPluginStyles } from '@wickermoney/plugin-sdk/runtime'
import css from './upcoming.css?inline'

/**
 * Injects the widget's styles into the host document.
 *
 * Imported for its side effect by the widget. A federated remote's emitted
 * stylesheet is never requested by the host, so the CSS travels as text and is
 * adopted at import time. Every class is prefixed `upc` so it cannot collide
 * with another plugin's.
 */
adoptPluginStyles('wickermoney.upcoming', css)
