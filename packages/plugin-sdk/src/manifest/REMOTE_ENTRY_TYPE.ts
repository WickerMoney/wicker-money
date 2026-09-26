/**
 * How the host loads a plugin's remote entry: as an ES module.
 *
 * Plugins build with `target: 'esnext'` and the bundler emits the entry as an
 * ES module with top-level `import` statements. The federation runtime defaults
 * to injecting a classic `<script>` tag, which parses that file as a script and
 * fails with "Cannot use import statement outside a module", one opaque error
 * per widget at mount time, long after the manifest validated. Declaring the
 * type makes the runtime use a dynamic `import()` instead.
 *
 * This is a contract, not a preference: a remote entry that is not an ES module
 * will not load.
 */
export const REMOTE_ENTRY_TYPE = 'module' as const
