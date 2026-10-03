/**
 * An amount of money as a decimal string, such as `'-81.2000'` or `'450'`.
 *
 * Money is `numeric(19,4)` in PostgreSQL and a string everywhere in
 * TypeScript, never a `number`: a double holds about fifteen significant
 * digits and cannot represent `0.1` exactly, so `Number` arithmetic drifts by
 * a cent nobody can find afterwards. The alias documents intent only; any
 * plain decimal string is accepted, and the functions in this module return
 * the canonical four-decimal form.
 */
export type Money = string
