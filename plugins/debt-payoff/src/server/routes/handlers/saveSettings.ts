import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseBody } from '../helpers/parseBody.js'
import { settingsBody } from '../schemas/settingsBody.js'

/**
 * Registers `PUT /settings`: saves the plan settings.
 *
 * Body: `extraPayment` (a decimal string), `strategy` (`snowball` or
 * `avalanche`), or both; one not sent keeps its value.
 *
 * Responds `200` with `{ extraPayment, strategy, saved: true }`, or `400` for
 * an invalid body.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerSaveSettings({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('PUT', '/settings', async ({ userId, body }) => service.saveSettings(userId, parseBody(settingsBody, body)))
}
