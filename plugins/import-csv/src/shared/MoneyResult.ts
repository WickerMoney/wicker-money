/** The outcome of reading money: a plain decimal string, or the reason it could not be read. */
export type MoneyResult = { value: string } | { error: string }
