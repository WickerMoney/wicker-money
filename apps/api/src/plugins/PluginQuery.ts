/**
 * A parameterised query runner handed to bundled plugin code.
 *
 * Usable only as a tagged template, so values are always sent as bound
 * parameters and nothing is interpolated into the SQL text.
 */
export type PluginQuery = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>
