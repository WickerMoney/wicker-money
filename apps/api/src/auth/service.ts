import type { Config } from '../config.js'
import { DuplicateKeyError } from '../data/DuplicateKeyError.js'
import type { UnitOfWork } from '../data/UnitOfWork.js'
import type { UserRole } from '../db/models/index.js'
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js'
import { hashPassword, verifyPassword } from './password.js'
import type { AuthUser } from './service/AuthUser.js'
import { canonicalTimezone } from './service/canonicalTimezone.js'
import type { UserIdentity } from './repository/UserIdentity.js'
import { Semaphore } from './Semaphore.js'
import type { AuthPolicy } from './service/AuthPolicy.js'
import type { AuthSession } from './service/AuthSession.js'
import { DEAD_SESSION_RETENTION_SECONDS } from './service/DEAD_SESSION_RETENTION_SECONDS.js'
import { DUMMY_PASSWORD_HASH } from './service/DUMMY_PASSWORD_HASH.js'
import { normalizeEmail } from './service/normalizeEmail.js'
import { PURGE_INTERVAL_SECONDS } from './service/PURGE_INTERVAL_SECONDS.js'
import { toAuthPolicy } from './service/toAuthPolicy.js'
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type AccessClaims,
} from './tokens.js'

/**
 * Registration, login, refresh-token rotation and password management.
 *
 * Users are created and looked up through SECURITY DEFINER database functions
 * because no user context (and therefore no row-level-security visibility)
 * exists before authentication; everything after that runs as the user.
 *
 * Refresh tokens are single-use and grouped into families, one per login. A
 * rotation revokes the presented token atomically and issues a successor in
 * the same family; presenting a token that was already revoked is treated as
 * theft and revokes the whole family. Access tokens carry the family as their
 * `sid` claim and are only accepted while the family is live, so revoking
 * sessions takes effect immediately rather than when the token expires.
 */
export class AuthService {
  private readonly hashSlots: Semaphore
  private readonly authPolicy: AuthPolicy
  private lastPurgeAt = 0

  /**
   * @param uow - Transaction boundary for all persistence.
   * @param config - Configuration providing token secrets, lifetimes and limits.
   */
  constructor(
    private readonly uow: UnitOfWork,
    private readonly config: Config,
  ) {
    this.hashSlots = new Semaphore(config.AUTH_MAX_CONCURRENT_HASHES)
    this.authPolicy = toAuthPolicy(config)
  }

  /** The configured rules the HTTP layer applies around this service (cookie attributes, rate limits). */
  get policy(): AuthPolicy {
    return this.authPolicy
  }

  /**
   * Creates an account and signs it in.
   *
   * Reporting an already-registered email as a conflict reveals that the
   * address has an account. That is a deliberate choice for a self-hosted
   * instance, where the operator controls who can register and a clear error is
   * worth more than enumeration resistance; the endpoint is rate-limited per
   * address and per email to bound probing.
   *
   * The time zone is a best guess from the browser, so one the server does not
   * recognise is ignored (the account keeps the `UTC` default and the user can
   * set it in Settings) rather than failing a sign-up over it.
   *
   * @param email - Email address; trimmed and lower-cased.
   * @param password - Plaintext password, hashed with Argon2id before storage.
   * @param timezone - Optional IANA zone name, normally the browser's own.
   * @returns Tokens and the new user.
   * @throws {AppError} With code `registration_disabled` (403) when registration is turned off.
   * @throws {ConflictError} With code `email_taken` if the email is already registered.
   */
  async register(email: string, password: string, timezone?: string): Promise<AuthSession> {
    if (!this.authPolicy.registrationEnabled) {
      throw new AppError('Registration is disabled on this server.', 403, 'registration_disabled')
    }
    const normalized = normalizeEmail(email)
    const digest = await this.hashSlots.run(() => hashPassword(password))

    let created: UserIdentity
    try {
      created = await this.uow.forSystem((repos) => repos.users.register(normalized, digest, this.config.BOOTSTRAP_OWNER_EMAIL))
    } catch (error) {
      // Caught out here: a failed statement aborts the transaction it ran in.
      if (error instanceof DuplicateKeyError) {
        throw new ConflictError('An account with that email already exists.', 'email_taken')
      }
      throw error
    }

    const zone = timezone === undefined ? undefined : canonicalTimezone(timezone)
    if (zone !== undefined && zone !== created.timezone) {
      created = (await this.uow.forUser(created.id, (repos) => repos.users.updateTimezone(created.id, zone))) ?? created
    }

    return this.issue(created)
  }

  /**
   * Reads the signed-in user's identity, time zone included.
   *
   * @param userId - The authenticated user.
   * @returns The user.
   * @throws {NotFoundError} If the account no longer exists.
   */
  async me(userId: string): Promise<AuthUser> {
    const found = await this.uow.forUser(userId, (repos) => repos.users.findIdentity(userId), { readOnly: true })
    if (found === undefined) throw new NotFoundError('User')
    return this.withRole(found)
  }

  /**
   * Reads what the signed-in user may do on this instance.
   *
   * Read fresh on every call rather than carried in the access token, so a
   * demotion takes effect on the next request instead of when the token
   * expires.
   *
   * @param userId - The authenticated user.
   * @returns The account's role, or `undefined` if the account no longer exists.
   */
  roleOf(userId: string): Promise<UserRole | undefined> {
    return this.uow.forUser(userId, (repos) => repos.users.findRole(userId), { readOnly: true })
  }

  /**
   * Sets the time zone that decides where the user's days and months end:
   * "today" for recurring items and the forecast, and month boundaries in
   * reports.
   *
   * @param userId - The authenticated user.
   * @param timezone - An IANA zone name; matched case-insensitively and stored canonically.
   * @returns The user as it now is.
   * @throws {ValidationError} If the zone is not a known IANA zone.
   * @throws {NotFoundError} If the account no longer exists.
   */
  async setTimezone(userId: string, timezone: string): Promise<AuthUser> {
    const zone = canonicalTimezone(timezone)
    if (zone === undefined) {
      throw new ValidationError(`timezone: "${timezone.slice(0, 64)}" is not a time zone this server knows, such as America/New_York.`)
    }
    const updated = await this.uow.forUser(userId, (repos) => repos.users.updateTimezone(userId, zone))
    if (updated === undefined) throw new NotFoundError('User')
    return this.withRole(updated)
  }

  /**
   * Verifies credentials and signs the user in.
   *
   * A password check runs even for unknown emails so response time does not
   * reveal whether an address is registered. A successful login also purges
   * long-dead sessions, at most once per {@link PURGE_INTERVAL_SECONDS}.
   *
   * @param email - Email address; trimmed and lower-cased.
   * @param password - Plaintext password.
   * @returns Tokens and the user.
   * @throws {UnauthorizedError} If the email is unknown or the password is wrong (same message for both).
   */
  async login(email: string, password: string): Promise<AuthSession> {
    const normalized = normalizeEmail(email)
    const found = await this.uow.forSystem((repos) => repos.users.findForLogin(normalized))

    // Always run a verification, even with no user, so response time does not
    // reveal whether the address is registered.
    const ok = await this.hashSlots.run(() =>
      verifyPassword(found?.passwordHash ?? DUMMY_PASSWORD_HASH, password),
    )
    if (found === undefined || !ok) {
      throw new UnauthorizedError('Email or password is incorrect.')
    }

    const session = await this.issue(found)
    await this.purgeIfDue()
    return session
  }

  /**
   * Exchanges a refresh token for a new pair, revoking the presented one.
   *
   * The presented token is revoked and its successor stored by a single
   * conditional update, so two concurrent requests with the same token cannot
   * both succeed. A token that is no longer active is a replay: the whole family
   * is revoked, ending the legitimate holder's session too, because there is no
   * way to tell which copy of the token is the stolen one.
   *
   * @param refreshToken - The refresh token previously issued.
   * @returns A new token pair in the same family.
   * @throws {UnauthorizedError} If the token is unknown, revoked, expired or replayed.
   */
  async refresh(refreshToken: string): Promise<AuthSession> {
    const digest = hashRefreshToken(refreshToken)
    const next = generateRefreshToken()
    const nextToken = { tokenHash: next.hash, expiresAt: this.refreshExpiry() }

    const rotated = await this.uow.forSystem((repos) => repos.sessions.rotate(digest, nextToken))
    if (rotated === undefined) {
      await this.uow.forSystem((repos) => repos.sessions.revokeFamilyOf(digest))
      throw new UnauthorizedError('Refresh token is invalid or expired.')
    }

    return this.toSession(rotated.user, rotated.familyId, next.token)
  }

  /**
   * Ends the session a refresh token belongs to, including every token issued
   * from it, so its access tokens stop working at once. Unknown tokens are
   * ignored: logging out is idempotent.
   *
   * @param refreshToken - The refresh token of the session to end.
   */
  async logout(refreshToken: string): Promise<void> {
    const digest = hashRefreshToken(refreshToken)
    await this.uow.forSystem((repos) => repos.sessions.revokeFamilyOf(digest))
  }

  /**
   * Changes a user's password and revokes all of their sessions.
   *
   * @param userId - The authenticated user.
   * @param current - Current plaintext password, verified first.
   * @param next - New plaintext password.
   * @throws {UnauthorizedError} If `current` is wrong.
   */
  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const digest = await this.uow.forUser(userId, (repos) => repos.users.findPasswordHash(userId), {
      readOnly: true,
    })

    if (digest === undefined || !(await this.hashSlots.run(() => verifyPassword(digest, current)))) {
      throw new UnauthorizedError('Current password is incorrect.')
    }

    const updated = await this.hashSlots.run(() => hashPassword(next))
    await this.uow.forUser(userId, async (repos) => {
      await repos.users.updatePasswordHash(userId, updated)
      // Changing a password ends every session: otherwise a stolen refresh
      // token survives the very action taken to lock the thief out.
      await repos.sessions.revokeAllForUser(userId)
    })
  }

  /**
   * Sets a new password for the account with `email` and revokes all of its
   * sessions. For an operator with server access; performs no authentication.
   *
   * @param email - Email address; trimmed and lower-cased.
   * @param password - New plaintext password.
   * @returns The account's email as stored, or `undefined` if no account matches.
   */
  async resetPassword(email: string, password: string): Promise<string | undefined> {
    const normalized = normalizeEmail(email)
    const found = await this.uow.forSystem((repos) => repos.users.findForLogin(normalized))
    if (found === undefined) return undefined

    const digest = await this.hashSlots.run(() => hashPassword(password))
    await this.uow.forUser(found.id, async (repos) => {
      await repos.users.updatePasswordHash(found.id, digest)
      await repos.sessions.revokeAllForUser(found.id)
    })
    return found.email
  }

  /**
   * Authenticates an access token: its signature, expiry, issuer and audience
   * must be valid and the session family it was issued under must still be live.
   *
   * @param token - Signed access token (JWT).
   * @returns The token's claims, or `null` if it is invalid, expired or its session was revoked.
   */
  async authenticate(token: string): Promise<AccessClaims | null> {
    const claims = await verifyAccessToken(this.config, token)
    if (claims === null) return null
    const active = await this.uow.forSystem((repos) => repos.sessions.isFamilyActive(claims.sid), {
      readOnly: true,
    })
    return active ? claims : null
  }

  /**
   * Deletes sessions that expired or were revoked more than a week ago.
   *
   * @returns The number of sessions deleted.
   */
  async purgeDeadSessions(): Promise<number> {
    this.lastPurgeAt = Date.now()
    return this.uow.forSystem((repos) => repos.sessions.purgeDead(DEAD_SESSION_RETENTION_SECONDS))
  }

  /** Purges dead sessions if none were purged recently; a failure is swallowed so it never fails a login. */
  private async purgeIfDue(): Promise<void> {
    if (Date.now() - this.lastPurgeAt < PURGE_INTERVAL_SECONDS * 1000) return
    try {
      await this.purgeDeadSessions()
    } catch {
      // Housekeeping only; the scheduled purge reports failures.
    }
  }

  /**
   * Starts a new session family for a user: stores a session holding a new
   * refresh token's hash and packages the credentials.
   *
   * @param user - Identity to issue credentials for.
   */
  private async issue(user: UserIdentity): Promise<AuthSession> {
    const refresh = generateRefreshToken()
    const session = await this.uow.forUser(user.id, (repos) =>
      repos.sessions.insert({
        userId: user.id,
        tokenHash: refresh.hash,
        expiresAt: this.refreshExpiry(),
      }),
    )
    return this.toSession(user, session.familyId, refresh.token)
  }

  /** When a refresh token issued now stops being accepted. */
  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.AUTH_REFRESH_TTL_SECONDS * 1000)
  }

  /**
   * Signs an access token bound to a session family and packages the result.
   *
   * @param user - The authenticated user.
   * @param familyId - Family the refresh token belongs to; becomes the token's `sid` claim.
   * @param refreshToken - The plaintext refresh token to hand to the client.
   */
  private async toSession(
    user: UserIdentity,
    familyId: string,
    refreshToken: string,
  ): Promise<AuthSession> {
    const accessToken = await signAccessToken(this.config, {
      sub: user.id,
      email: user.email,
      sid: familyId,
    })
    return {
      accessToken,
      refreshToken,
      expiresInSeconds: this.config.AUTH_ACCESS_TTL_SECONDS,
      user: await this.withRole(user),
    }
  }

  /**
   * Adds the account's role to its identity for the client.
   *
   * A separate read rather than a column on the pre-authentication functions'
   * results, so those functions keep their signatures. It costs one primary-key
   * lookup per sign-in, refresh and profile read.
   *
   * @param user - The account's identity.
   * @returns The identity with its role; `member` if the account vanished
   * mid-request, the answer that grants nothing.
   */
  private async withRole(user: UserIdentity): Promise<AuthUser> {
    const role = (await this.roleOf(user.id)) ?? 'member'
    return { id: user.id, email: user.email, timezone: user.timezone, role }
  }
}
