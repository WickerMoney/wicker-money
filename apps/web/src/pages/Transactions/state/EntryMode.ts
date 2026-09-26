/**
 * Which kind of entry the record form is creating.
 *
 * A transfer is not a transaction with an unusual category: it is two linked
 * rows, one per account. Entering one as ordinary spending would count money
 * moved between the user's own accounts as money spent.
 */
export type EntryMode = 'spend' | 'transfer'
