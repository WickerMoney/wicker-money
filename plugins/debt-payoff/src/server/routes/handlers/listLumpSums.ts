import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'

/**
 * Registers `GET /lump-sums`: the person's lump sums, soonest first.
 *
 * Responds `200` with `{ lumpSums }`, each `{ id, onDate, amount, note,
 * allocations: [{ debtId, amount }] }`. Past-dated ones are listed too: the
 * plan ignores them (see `GET /plan`, `lumpSums`) but the person can still see
 * and remove them.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerListLumpSums({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('GET', '/lump-sums', async ({ userId }) => ({ lumpSums: await service.listLumpSums(userId) }))
}
