import { titlesMatch, titlesNearlyMatch, toTitleCandidates } from '../match/titles.js'

type TitleForms = { rawTitle: string; candidates: string[]; position: number }

/**
 * Tells whether any shortened form of one title matches, or nearly matches, the other whole title.
 * Near matches count because TMDB search misses a typo too, so grouping is the only place a
 * misspelling meets its correct spelling.
 */
function matchesWholeTitle(from: TitleForms, to: TitleForms): boolean {
  return from.candidates.some(
    (candidate) => titlesMatch(candidate, to.rawTitle) || titlesNearlyMatch(candidate, to.rawTitle),
  )
}

/**
 * Tells whether two printed titles name the same film, checking both ways since only one may carry
 * the framing. Never compares two shortened forms: unrelated films can share a subtitle.
 */
function namesSameFilm(a: TitleForms, b: TitleForms): boolean {
  return matchesWholeTitle(a, b) || matchesWholeTitle(b, a)
}

/**
 * Adds a title to the groups gathered so far, merging it with every group it relates to.
 * Fusing all of them, not just the first, makes grouping transitive.
 */
function addToGroups(gathered: TitleForms[][], titleForms: TitleForms): TitleForms[][] {
  const related = gathered.filter((group) =>
    group.some((member) => namesSameFilm(titleForms, member)),
  )
  const unrelated = gathered.filter((group) => !related.includes(group))

  return [...unrelated, [...related.flat(), titleForms]]
}

/**
 * Groups the printed titles that name the same film, in order of first appearance.
 * Judges from the titles alone, relying on another cinema printing the film without one cinema's
 * strand or anniversary framing.
 */
export function groupRelatedTitles(rawTitles: string[]): string[][] {
  const titleForms: TitleForms[] = rawTitles.map((rawTitle, position) => ({
    rawTitle,
    candidates: toTitleCandidates(rawTitle),
    position,
  }))

  const groups = titleForms.reduce<TitleForms[][]>(addToGroups, [])

  return groups
    .map((group) => ({
      group,
      firstAppearance: Math.min(...group.map((member) => member.position)),
    }))
    .sort((a, b) => a.firstAppearance - b.firstAppearance)
    .map(({ group }) => group.map((member) => member.rawTitle))
}
