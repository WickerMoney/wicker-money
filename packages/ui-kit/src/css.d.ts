/**
 * Side-effect CSS imports. tsc has no concept of a stylesheet module, so it
 * needs telling these resolve to nothing at the type level — the bundler
 * handles the actual file.
 */
declare module '*.css'
