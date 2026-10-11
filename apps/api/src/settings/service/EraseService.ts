import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { Repositories } from '../../data/Repositories.js'
import { AppError, ConflictError, ValidationError } from '../../errors.js'
import { databaseNameFromUrl } from './databaseNameFromUrl.js'
import { CORE_ERASE_ORDER, PLUGIN_ERASE_PLANS, plannedTables } from './ERASE_PLAN.js'
import { ERASE_PHRASES } from './ERASE_PHRASES.js'
import type { EraseServiceDeps } from './EraseServiceDeps.js'
import type { EraseSummary } from './EraseSummary.js'
import type { InstanceEraseBlocker } from './InstanceEraseBlocker.js'
import type { InstanceEraseCheck } from './InstanceEraseCheck.js'

/** The signed-in owner asking about or running an instance erase. */
export interface InstanceEraseCaller {
  /** The owner's user id. */
  readonly id: string
  /** The owner's email address. */
  readonly email: string
  /** The session family their access token was issued under, left out of the "other sessions" count. */
  readonly sessionFamilyId: string
}

/** What a person must supply, besides being who they say, to erase their own data. */
export interface EraseMyDataInput {
  /** The account password, checked again. */
  readonly password: string
  /** The typed confirmation phrase. */
  readonly confirmation: string
}

/** What an owner must supply to erase the instance. */
export interface EraseInstanceInput extends EraseMyDataInput {
  /** Go ahead although other sessions are live; without it the erase is refused while any are. */
  readonly acknowledgeActiveSessions: boolean
}

/**
 * The two danger-zone actions: erasing the calling user's own data, and, for an
 * owner, erasing the whole instance. Distinct on purpose: different phrases,
 * different routes, different checks, so confirming one cannot be mistaken for
 * the other.
 *
 * **Erase my data** empties every table the user has rows in, across `core` and
 * every bundled plugin's schema, deletes all of the user's sessions (which
 * signs them out on every device) and puts the setup wizard back. It keeps the
 * account itself: the email, the password, the role and the time zone. That is
 * a decision, not an omission. Keeping the row means the only owner can never
 * remove the instance's last owner by erasing their data, nothing else has to
 * be repaired afterwards (invitations, role changes, a half-owned instance),
 * and the person can sign straight back in to a clean slate. Deleting the
 * account as well is a different action with a last-owner rule of its own; it
 * is not part of this one.
 *
 * Everything runs in one transaction, so a failure part-way leaves everything
 * as it was. Plugin tables are emptied under each plugin's own database role
 * and core tables as the application role, so the erase reaches nothing a
 * plugin or the user's own requests could not already reach, and no per-plugin
 * hook or SDK entry point is involved: the plan in {@link PLUGIN_ERASE_PLANS}
 * names the tables, and the erase refuses to start if the database holds a
 * table with a `user_id` column the plan does not name.
 *
 * **Erase this instance** is one database function (migration 031) that
 * empties every account and every plugin schema. See {@link InstanceEraseCheck}
 * for the conditions that stop it.
 */
export class EraseService {
  /**
   * @param uow - Opens transactions and supplies repositories.
   * @param deps - Password check and the settings that decide whether an erased instance can be set up again.
   */
  constructor(
    private readonly uow: UnitOfWork,
    private readonly deps: EraseServiceDeps,
  ) {}

  /**
   * Erases everything the user owns and ends all of their sessions.
   *
   * Safe to run again: with nothing left it deletes nothing and succeeds,
   * provided the caller can still authenticate.
   *
   * @param userId - The signed-in user.
   * @param input - Their password and the typed phrase.
   * @returns How many rows were removed.
   * @throws {ValidationError} If the phrase is not the expected one (issue on `confirmation`).
   * @throws {AppError} `password_incorrect` (403) for a wrong password.
   * @throws {AppError} `erase_unplanned_tables` (500) if the database has user-data
   *   tables the erase does not know; nothing is deleted.
   */
  async eraseMyData(userId: string, input: EraseMyDataInput): Promise<EraseSummary> {
    requirePhrase(input.confirmation, ERASE_PHRASES.myData)
    await this.deps.auth.confirmPassword(userId, input.password)

    return this.uow.forUser(userId, async ({ erase, onboarding }) => {
      const planned = plannedTables()
      const unplanned = (await erase.userTables()).filter((table) => !planned.has(table))
      if (unplanned.length > 0) {
        throw new AppError(
          `Nothing was erased. These tables hold user data that the erase does not know how to empty: ${unplanned.join(', ')}.`,
          500,
          'erase_unplanned_tables',
        )
      }

      let rows = 0
      for (const { pluginId, tables } of PLUGIN_ERASE_PLANS) {
        for (const table of tables) rows += await erase.deletePluginRows(pluginId, table, userId)
      }
      for (const table of CORE_ERASE_ORDER) rows += await erase.deleteCoreRows(table, userId)
      await onboarding.clear(userId)
      // Last, so the person is signed out only once everything else has gone.
      rows += await erase.deleteSessions(userId)
      return { rows }
    })
  }

  /**
   * What an owner needs to know before confirming an instance erase: which
   * instance this is, who else is signed in, and whether anything stops it.
   *
   * @param caller - The signed-in owner.
   * @returns The facts and the blocker, if any.
   * @throws {Error} If the caller is not an owner; the database refuses (the route checks first).
   */
  check(caller: InstanceEraseCaller): Promise<InstanceEraseCheck> {
    return this.uow.forUser(caller.id, (repos) => this.checkIn(repos, caller), { readOnly: true })
  }

  /**
   * Erases every account and empties every plugin schema, leaving the instance
   * as it was before anyone registered: the first registration afterwards
   * becomes the owner under the usual rules (`BOOTSTRAP_OWNER_EMAIL` decides who
   * may be).
   *
   * @param caller - The signed-in owner.
   * @param input - Their password, the typed phrase, and whether other live sessions are acknowledged.
   * @throws {ValidationError} If the phrase is not the expected one (issue on `confirmation`).
   * @throws {AppError} `password_incorrect` (403) for a wrong password.
   * @throws {ConflictError} `registration_disabled` or `bootstrap_owner_mismatch` when the
   *   erased instance could not be set up again, or `active_sessions` when other sessions are live and not acknowledged.
   */
  async eraseInstance(caller: InstanceEraseCaller, input: EraseInstanceInput): Promise<void> {
    requirePhrase(input.confirmation, ERASE_PHRASES.instance)
    await this.deps.auth.confirmPassword(caller.id, input.password)

    await this.uow.forUser(caller.id, async (repos) => {
      // Read in the same transaction as the erase, so what was checked is what is erased.
      const check = await this.checkIn(repos, caller)
      if (check.blocker !== null) throw new ConflictError(describeBlocker(check.blocker, check), check.blocker)
      if (check.otherSessions > 0 && !input.acknowledgeActiveSessions) {
        throw new ConflictError(
          `${describeSessions(check)} signed in. Erasing the instance signs them out and deletes their data.`,
          'active_sessions',
        )
      }
      await repos.erase.eraseInstance()
    })
  }

  /** The check, on a transaction the caller already has open. */
  private async checkIn(repos: Repositories, caller: InstanceEraseCaller): Promise<InstanceEraseCheck> {
    const { REGISTRATION_ENABLED, BOOTSTRAP_OWNER_EMAIL, DATABASE_URL } = this.deps.config
    const activity = await repos.erase.instanceActivity(caller.sessionFamilyId)
    const bootstrap = BOOTSTRAP_OWNER_EMAIL ?? null
    return {
      databaseName: databaseNameFromUrl(DATABASE_URL),
      registrationEnabled: REGISTRATION_ENABLED,
      bootstrapOwnerEmail: bootstrap,
      otherSessions: activity.otherSessions,
      otherUsers: activity.otherUsers,
      blocker: blockerFor(REGISTRATION_ENABLED, bootstrap, caller.email),
    }
  }
}

/** Why the erase cannot go ahead, comparing the owner's email with the configured one as registration does. */
function blockerFor(registrationEnabled: boolean, bootstrap: string | null, callerEmail: string): InstanceEraseBlocker {
  if (!registrationEnabled) return 'registration_disabled'
  if (bootstrap !== null && bootstrap !== callerEmail.trim().toLowerCase()) return 'bootstrap_owner_mismatch'
  return null
}

/** "2 other sessions (1 other person) are" and its singular. */
function describeSessions(check: InstanceEraseCheck): string {
  const sessions = `${check.otherSessions} other ${check.otherSessions === 1 ? 'session is' : 'sessions are'}`
  const people = check.otherUsers === 0
    ? 'all on your own account'
    : `${check.otherUsers} other ${check.otherUsers === 1 ? 'person' : 'people'}`
  return `${sessions} (${people})`
}

/** The sentence an owner reads when a blocker stops the erase. */
function describeBlocker(blocker: NonNullable<InstanceEraseBlocker>, check: InstanceEraseCheck): string {
  if (blocker === 'registration_disabled') {
    return 'Registration is turned off (REGISTRATION_ENABLED=false), so nobody could register as the owner after the erase. Turn it on and restart the server first.'
  }
  return `BOOTSTRAP_OWNER_EMAIL is set to ${check.bootstrapOwnerEmail ?? 'another address'}, so after the erase only that address could become the owner, not you. Erase while signed in as that account, or change the setting and restart the server first.`
}

/**
 * Compares a typed confirmation with the phrase that was asked for.
 *
 * @throws {ValidationError} With an issue on `confirmation` when they differ.
 */
function requirePhrase(typed: string, expected: string): void {
  if (typed.trim().toLowerCase() === expected) return
  throw new ValidationError(`confirmation: Type "${expected}" to confirm.`)
}
