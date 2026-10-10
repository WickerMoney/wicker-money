/**
 * A parameterised query runner bound to the plugin's database role.
 *
 * Usable only as a tagged template, so values are always sent as bound
 * parameters and nothing is ever interpolated into the SQL text.
 *
 * @typeParam T - The row shape each result row is typed as.
 * @returns The result rows.
 */
export type Query = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>
