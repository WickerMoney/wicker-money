import { z } from 'zod'

/** Validates one entry of a manifest's `contributes.pages`: a full page the plugin adds to the shell. */
export const pageContributionSchema = z.object({
  /** Path the page is mounted at, appended to `/p/<pluginId>/`. The host owns that prefix. */
  path: z.string().min(1),
  /** Human-readable page title. */
  title: z.string().min(1),
  /** When present, adds the page to the navigation. Omit for a page reachable only by link. */
  nav: z
    .object({
      /** Text shown for the navigation entry. */
      label: z.string().min(1),
      /** Name of the icon shown beside the label, if any. */
      icon: z.string().min(1).optional(),
      /** Navigation group the entry is listed under. Defaults to `main`. */
      section: z.enum(['main', 'reports', 'settings']).default('main'),
      /** Sort position within the section, lowest first. Defaults to 100. */
      order: z.number().int().default(100),
    })
    .optional(),
  /** Name of the module the plugin's Module Federation build exposes for this page. */
  module: z.string().min(1),
})
