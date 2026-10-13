import { distance } from 'fastest-levenshtein'

import { isNonEmpty, unique } from '../utils.js'

/**
 * Collapses every run of whitespace into one space and trims the ends, so identical-looking text
 * compares equal. Non-breaking spaces count as whitespace; case and accents are left untouched.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Always "en": a language's own tailoring can treat an accented letter as distinct from its base
 * even at base sensitivity.
 */
const TITLE_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', ignorePunctuation: true })

/**
 * Decides whether two titles are the same, ignoring case, accents, punctuation and spacing.
 * Typos and translated titles still count as different.
 */
export function titlesMatch(a: string, b: string): boolean {
  return TITLE_COLLATOR.compare(a, b) === 0
}

const LONG_TITLE_LENGTH = 20

const DIGIT_RUN = /\d+/gu

/**
 * Extracts the numbers in a title, so sequels that differ by one digit can be told apart.
 */
function toNumbering(title: string): string {
  return (title.match(DIGIT_RUN) ?? []).join(' ')
}

/**
 * Decides whether two titles differ only by a small typo: one edit, or two for long titles.
 * Titles with different numbers never match, so sequels stay apart.
 */
export function titlesNearlyMatch(a: string, b: string): boolean {
  const allowance = a.length > LONG_TITLE_LENGTH ? 2 : 1

  return (
    toNumbering(a) === toNumbering(b) && distance(a.toLowerCase(), b.toLowerCase()) <= allowance
  )
}

/**
 * Unlike the candidate separators, a `+` joins separate items on one bill, not alternative names
 * for one film. Spaced on both sides, so a `+` inside a title stays part of it.
 */
const COMPONENT_SEPARATOR = /\s\+\s/u

/**
 * Splits a listing that bills several items together with `+`, such as two shorts, into those
 * items in printed order.
 */
export function toTitleComponents(rawTitle: string): string[] {
  const title = normalizeWhitespace(rawTitle)
  const components = title.split(COMPONENT_SEPARATOR).map(normalizeWhitespace).filter(isNonEmpty)
  return components.length > 0 ? components : [title]
}

/**
 * Each captures the parts of a title worth searching for on their own: the text after the first
 * colon, provided something comes before it, and the text on either side of the first spaced dash.
 */
const SPLIT_PATTERNS = [/^[^:]+:(.*)$/u, /^(.*?)\s\p{Pd}\s(.*)$/u]

/**
 * Gives the parts of a title that each split pattern captures, or nothing when none applies.
 */
function toSplitParts(title: string): string[] {
  return SPLIT_PATTERNS.flatMap((pattern) => pattern.exec(title)?.slice(1) ?? [])
}

const BRACKETED_GROUP = /\([^)]*\)|\[[^\]]*\]/gu

/**
 * Gives a part both with and without its bracketed groups, since a title sometimes starts with a
 * bracket and the bracketed form is then the real one.
 */
function toBracketVariants(part: string): string[] {
  return [part, part.replace(BRACKETED_GROUP, '')]
}

/**
 * Lists the titles a printed listing might name a film under, whole title first. Tries the text
 * after the first colon but never the franchise prefix before it, and splits on spaced dashes only.
 */
export function toTitleCandidates(rawTitle: string): string[] {
  const title = normalizeWhitespace(rawTitle)
  return unique(
    [title, ...toSplitParts(title)]
      .flatMap(toBracketVariants)
      .map(normalizeWhitespace)
      .filter(isNonEmpty),
  )
}
