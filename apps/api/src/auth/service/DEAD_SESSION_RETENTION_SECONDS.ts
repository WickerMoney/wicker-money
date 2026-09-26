/**
 * How long expired or revoked sessions are kept before purging: long enough
 * that a replay of a recently rotated refresh token is still recognised as
 * theft rather than as an unknown token.
 */
export const DEAD_SESSION_RETENTION_SECONDS = 7 * 24 * 60 * 60
