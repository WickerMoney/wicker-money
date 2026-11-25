import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseBody } from '../helpers/parseBody.js'
import { whatIfBody } from '../schemas/whatIfBody.js'

/**
 * Registers `POST /plan/what-if`: what one more lump sum would change, without
 * saving anything.
 *
 * Body: `onDate` and `amount` of the lump sum to try, optionally `allocations`
 * (as `POST /lump-sums`), and optionally `strategy`, `extra` and `tz`, which
 * default to the saved settings and `UTC`. It is a `POST` only because it takes
 * a body; nothing is written.
 *
 * Responds `200` with `{ current, withLumpSum, interestSaved, monthsSaved,
 * lumpSum }`: the headline of the plan as it stands (the saved lump sums
 * included) and with the candidate added (`debtFreeDate`, `months`,
 * `totalInterest`, `capped`), the difference (`null` when either plan never
 * ends), and what the plan did with the candidate (a past-dated one reports
 * `status: "past"` and changes nothing). Responds `400` as `POST /lump-sums`.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerWhatIf({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('POST', '/plan/what-if', async ({ userId, body }) => {
    const { onDate, amount, allocations, strategy, extra, tz } = parseBody(whatIfBody, body)
    return service.whatIf(userId, {
      candidate: { onDate, amount, ...(allocations === undefined ? {} : { allocations }) },
      timezone: tz ?? 'UTC',
      ...(strategy === undefined ? {} : { strategy }),
      ...(extra === undefined ? {} : { extraPayment: extra }),
    })
  })
}
