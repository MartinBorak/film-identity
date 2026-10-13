import type { Listing } from '../types.js'
import { union } from '../utils.js'

export type Evidence = Required<Omit<Listing, 'titles'>>

const DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

/**
 * Returns a listing's first screening date padded to YYYY-MM-DD.
 * The padding lets dates be compared as strings.
 * Without a date, returns January 1 of the screening year.
 */
function toFirstScreeningDate(listing: Listing): Evidence['firstScreeningDate'] {
  const date = listing.firstScreeningDate

  if (date === undefined) {
    return `${listing.screeningYear}-01-01`
  }

  const parts = DATE_PATTERN.exec(date)

  if (parts === null) {
    throw new Error(
      `Listing "${listing.titles[0]}" has firstScreeningDate "${date}", expected YYYY-MM-DD`,
    )
  }

  const [, year, month, day] = parts

  /** Prefixes a single digit with a zero. */
  function pad(part: string): string {
    return part.padStart(2, '0')
  }

  return `${year}-${pad(month)}-${pad(day)}` as Evidence['firstScreeningDate']
}

/**
 * Gathers a listing's facts other than its titles, with empty defaults for those it left out.
 */
export function toEvidence(listing: Listing): Evidence {
  return {
    originalTitles: listing.originalTitles ?? [],
    screeningYear: listing.screeningYear,
    firstScreeningDate: toFirstScreeningDate(listing),
    productionYears: listing.productionYears ?? [],
    directors: listing.directors ?? [],
    runtimesInMinutes: listing.runtimesInMinutes ?? [],
    synopses: listing.synopses ?? [],
    posterUrls: listing.posterUrls ?? [],
  }
}

/**
 * Combines the facts of several listings of one film.
 * Keeps the earliest screening, the tightest bound on the release date.
 */
export function mergeEvidence(evidence: Evidence[]): Evidence {
  /** Collects one fact from every listing. */
  function all<K extends keyof Evidence>(key: K): Evidence[K][] {
    return evidence.map((each) => each[key])
  }

  return {
    originalTitles: union(all('originalTitles')),
    screeningYear: Math.min(...all('screeningYear')),
    firstScreeningDate: all('firstScreeningDate').reduce((earliest, date) =>
      date < earliest ? date : earliest,
    ),
    productionYears: union(all('productionYears')),
    directors: union(all('directors')),
    runtimesInMinutes: union(all('runtimesInMinutes')),
    synopses: union(all('synopses')),
    posterUrls: union(all('posterUrls')),
  }
}
