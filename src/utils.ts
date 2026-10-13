/**
 * Drops repeated values, keeping each at its first position.
 */
export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)]
}

/**
 * Tells blank text apart from text worth keeping, for filtering cleaned strings.
 */
export function isNonEmpty(text: string): boolean {
  return text !== ''
}

/**
 * Joins lists into one, keeping each value at its first position.
 */
export function union<T>(lists: T[][]): T[] {
  return unique(lists.flat())
}
