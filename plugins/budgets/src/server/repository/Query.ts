/**
 * A parameterised query runner.
 *
 * Usable only as a tagged template, so values are always sent as bound
 * parameters and nothing is ever interpolated into the SQL text.
 */
export type Query = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>
