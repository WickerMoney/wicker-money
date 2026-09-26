import { z } from 'zod'
import { WIDGET_SIZES } from './WIDGET_SIZES.js'
import { WIDGET_SLOTS } from './WIDGET_SLOTS.js'

/** Validates one entry of a manifest's `contributes.widgets`: a component the plugin mounts into a shell slot. */
export const widgetContributionSchema = z.object({
  /** Identifier of the widget, unique within the plugin. */
  id: z.string().min(1),
  /** The place in the shell the widget mounts into. */
  slot: z.enum(WIDGET_SLOTS),
  /** Human-readable widget title. */
  title: z.string().min(1),
  /** Size the widget renders at until the user changes it. Defaults to `md`. */
  defaultSize: z.enum(WIDGET_SIZES).default('md'),
  /** Sort position within the slot, lowest first. Defaults to 100. */
  order: z.number().int().default(100),
  /** Name of the module the plugin's Module Federation build exposes for this widget. */
  module: z.string().min(1),
})
