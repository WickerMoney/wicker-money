import type { WIDGET_SLOTS } from './WIDGET_SLOTS.js'

/** A place in the shell where a widget may mount. */
export type WidgetSlot = (typeof WIDGET_SLOTS)[number]
