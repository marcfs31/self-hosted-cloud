/**
 * The shape of a namespace, derived from its English source: every string leaf widens to
 * `string` and functions keep their signatures, so another locale must supply exactly the
 * same keys and parameters. A missing or extra key is a compile error.
 */
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;
