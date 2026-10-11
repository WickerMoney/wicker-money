import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'

/**
 * Registers `GET /account-suggestions`: the loan and credit card accounts a
 * debt could be started from.
 *
 * Responds `200` with `{ accounts }`: each account that is not archived, with
 * the debt already tracking it (`debtId`) or `null`. Balances are not
 * included; the plugin's `accounts` grant lets the page read them from core.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerListAccountSuggestions(
  { route }: Pick<DebtPayoffRouteDeps, 'route'>,
  service: DebtPayoffService,
): void {
  route('GET', '/account-suggestions', async ({ userId }) => ({
    accounts: await service.listAccountSuggestions(userId),
  }))
}
