import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseWith } from '../helpers/parseWith.js'
import { planQuery } from '../schemas/planQuery.js'

/**
 * Registers `GET /plan`: the payoff plan for the user's active debts.
 *
 * Query parameters, all optional: `strategy` (`snowball` or `avalanche`) and
 * `extra` (the monthly extra, a decimal string) default to the saved settings,
 * and `tz` (an IANA time zone) decides what today is and defaults to `UTC`.
 * The request writes nothing; the settings are not changed by asking for a
 * different strategy or extra.
 *
 * Responds `200` with the plan: the month-by-month schedule, each debt's
 * payoff date, total interest, the debt-free date, and the comparison with
 * paying only the minimums. See `PayoffPlan` for every field. Responds `400
 * validation_failed` for an invalid parameter.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerGetPlan({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('GET', '/plan', async ({ userId, query }) => {
    const { strategy, extra, tz } = parseWith(planQuery, query)
    return service.getPlan(userId, {
      timezone: tz ?? 'UTC',
      ...(strategy === undefined ? {} : { strategy }),
      ...(extra === undefined ? {} : { extraPayment: extra }),
    })
  })
}
