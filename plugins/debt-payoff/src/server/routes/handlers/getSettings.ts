import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'

/**
 * Registers `GET /settings`: the saved plan settings.
 *
 * Responds `200` with `{ extraPayment, strategy, saved }`. Before the user has
 * saved anything the defaults come back with `saved: false`: no extra payment
 * and the avalanche strategy.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerGetSettings({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('GET', '/settings', async ({ userId }) => service.getSettings(userId))
}
