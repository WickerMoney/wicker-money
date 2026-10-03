/**
 * Where one occurrence of a recurring item stands, as the server works it out.
 *
 * `cleared` means every leg has a matched transaction; `due` and `late` are
 * expected and not yet matched on an item that is matched (tracked);
 * `missed` is older than a week and no longer projected; `assumed` is a past
 * occurrence of an item that has never been matched, so it is assumed to have
 * posted, as before matching existed.
 */
export type OccurrenceStatus = 'upcoming' | 'due' | 'late' | 'missed' | 'cleared' | 'skipped' | 'assumed'
