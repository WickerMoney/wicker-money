/**
 * RFC 9562 UUID in its canonical 8-4-4-4-12 form: a version of 1 to 8 and a
 * variant of 8, 9, a or b, plus the nil and max UUIDs. Either case. This is
 * the rule Zod 4's `z.uuid()` applies, which the API uses for `:id` params.
 */
const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i

/**
 * Tests whether a value is a UUID string, before it is sent to PostgreSQL.
 *
 * A malformed id that reached a `uuid` column would fail with an invalid-text
 * error and surface as a 500; checking first lets a handler answer 400.
 *
 * The rule is strict: the canonical hyphenated form only, in either case, with
 * a valid RFC 9562 version and variant (the nil and max UUIDs are allowed).
 * Every id PostgreSQL generates (`uuid_generate_v4()`, `gen_random_uuid()`,
 * version 7) passes. PostgreSQL itself would also accept braces, no hyphens
 * and arbitrary hex digits; those are refused here, so an id has one spelling
 * and one meaning.
 *
 * @param value - Anything, usually unvalidated request input.
 * @returns `true` when `value` is a string in that form, narrowing it to `string`.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
