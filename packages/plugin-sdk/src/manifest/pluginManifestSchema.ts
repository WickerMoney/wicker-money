import { z } from 'zod'
import { integritySchema } from './integritySchema.js'
import { PERMISSIONS } from './PERMISSIONS.js'
import { pageContributionSchema } from './pageContributionSchema.js'
import { remoteEntrySchema } from './remoteEntrySchema.js'
import { tableGrantSchema } from './tableGrantSchema.js'
import { widgetContributionSchema } from './widgetContributionSchema.js'

/**
 * Validates a plugin manifest, applying defaults for every optional field.
 *
 * Use `parseManifest` to validate an untrusted value and also enforce SDK
 * version compatibility.
 */
export const pluginManifestSchema = z.object({
  /** Reverse-domain identifier, stable across versions, e.g. `wickermoney.insights`. */
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/, 'Must be reverse-domain, e.g. wickermoney.insights'),
  /** Human-readable plugin name. */
  name: z.string().min(1),
  /** Version of the plugin itself. */
  version: z.string().min(1),
  /** Short description of what the plugin does. Defaults to an empty string. */
  description: z.string().default(''),
  /** Who wrote the plugin. Defaults to an empty string. */
  author: z.string().default(''),
  /** Major version of the SDK the plugin was built against. */
  sdkVersion: z.number().int().nonnegative(),
  /**
   * Core tables the plugin needs, each with the access level requested.
   * Defaults to none.
   *
   * Enforced by a per-plugin PostgreSQL role for the plugin's server-side code.
   * It is a declaration and early feedback, not an enforced boundary, for the
   * plugin's UI code, which runs fully trusted in the host origin.
   */
  requiredTables: z.array(tableGrantSchema).default([]),
  /** Capabilities beyond table access the plugin asks for. Defaults to none. */
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
  /**
   * URL of the Module Federation entry: a same-origin `/plugins/<folder>/...`
   * path, or an `https:` URL whose origin the host has allowlisted.
   *
   * Whatever is loaded from here runs with full trust in the host's origin.
   * Third-party plugin install is not supported yet; do not allowlist an
   * origin you do not fully trust.
   *
   * The entry must be an ES module: the host registers every remote with
   * `type: 'module'` and loads it with a dynamic `import()`, never a classic
   * script tag.
   */
  remoteEntry: remoteEntrySchema,
  /**
   * Subresource Integrity values for the files of the plugin's build, keyed by
   * path relative to the directory of `remoteEntry` (the entry itself is
   * `remoteEntry.js`, a chunk is `assets/chunk-1a2b3c.js`).
   *
   * A host verifies each listed file before the plugin's code runs and does not
   * load a file whose bytes differ. It is how an operator vouches for one build
   * of a plugin the image did not ship: a host requires it for every such plugin
   * and for any entry it does not serve itself, and ignores it for a bundled
   * plugin served from the image. Only listed files are verified; a file the
   * entry loads that is not listed loads unchecked, so list the whole build.
   * Stylesheets are not covered.
   *
   * The hash is only as trustworthy as where it came from: a manifest fetched
   * from the same place as the code it pins proves nothing. Take it from the
   * file you reviewed, not from the server that will serve it.
   *
   * Optional with no default, so existing manifests stay valid unchanged.
   */
  integrity: integritySchema.optional(),
  /**
   * True if the plugin is built for the isolated runtime
   * (`@wickermoney/plugin-sdk/isolated`): its modules run in a sandboxed frame
   * and reach the host only through the message protocol.
   *
   * This says what the plugin was built for. It is not a grant and not a
   * request for privilege: it can only move a plugin towards isolation. Which
   * runtime a plugin actually gets is the host's decision, and the host never
   * runs a plugin it did not ship in the page's own realm, whatever this says.
   * Absent means `false`.
   *
   * Optional with no default, unlike the other fields, so existing manifests
   * (and code that builds a `PluginManifest` by hand) stay valid unchanged.
   */
  isolated: z.boolean().optional(),
  /** What the plugin adds to the application. Defaults to nothing. */
  contributes: z
    .object({
      /** Pages the plugin adds to the shell. */
      pages: z.array(pageContributionSchema).default([]),
      /** Widgets the plugin mounts into shell slots. */
      widgets: z.array(widgetContributionSchema).default([]),
      /**
       * True if the plugin serves its own HTTP endpoints.
       *
       * Endpoints run server-side code, so only a bundled plugin's code is
       * trusted to provide them.
       */
      endpoints: z.boolean().default(false),
      /**
       * True if the plugin can produce its own rows for a full data export.
       *
       * Same trust boundary as `endpoints`, and for the same reason: an
       * exporter runs server-side code that reads a plugin's own schema, which
       * only a bundled plugin's code is reviewed and sandboxed enough to do.
       * This is the contribution point that lets an "export everything"
       * feature include plugin data without core naming any plugin.
       */
      exporters: z.boolean().default(false),
    })
    .default({ pages: [], widgets: [], endpoints: false, exporters: false }),
})
