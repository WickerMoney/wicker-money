/** Supplies the current instant. Injected so date-dependent logic can be tested at a fixed time. */
export type Clock = () => Date
