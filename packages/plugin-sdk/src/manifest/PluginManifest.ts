import type { z } from 'zod'
import type { pluginManifestSchema } from './pluginManifestSchema.js'

/** A validated plugin manifest, with every default applied. */
export type PluginManifest = z.infer<typeof pluginManifestSchema>
