import { titlesMatch, titlesNearlyMatch } from './titles.js'

/**
 * A catalogue entry reduced to what matching needs.
 */
export type FilmCandidate = {
  tmdbId: number
  // Every known title, but only the search result's own two until the full record is fetched.
  titles: string[]
  releaseYear: number | null
  // These three stay empty until the full record is fetched; a search result carries none.
  directors: string[]
  cast: string[]
  runtimeMinutes: number | null
}

/**
 * A film found through its director's filmography rather than its title.
 */
export type DirectedFilm = {
  tmdbId: number
  releaseYear: number | null
}

/**
 * What the cinemas printed about the film. Usually empty, in which case ties stay unbroken.
 */
export type FilmEvidence = {
  screeningYear: number
  productionYears: number[]
  directors: string[]
  runtimesInMinutes: number[]
  synopses: string[]
}

/**
 * Lowercases text and strips accents so names can be compared loosely.
 */
function toComparable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Checks whether a person's name appears in any of the texts, ignoring case and accents.
 * Single-word names never count, since they could mean anything in a blurb.
 */
function isNamedIn(name: string, texts: string[]): boolean {
  return (
    name.trim().includes(' ') &&
    texts.some((text) => toComparable(text).includes(toComparable(name)))
  )
}

/**
 * Checks whether the cinema's synopsis mentions the film's director or any of its cast.
 */
function isDescribedByBlurb(film: FilmCandidate, synopses: string[]): boolean {
  return [...film.directors, ...film.cast].some((name) => isNamedIn(name, synopses))
}

/**
 * Checks whether the printed title is one of the film's known titles, ignoring case and accents.
 */
function isSameTitle(title: string, film: FilmCandidate): boolean {
  return film.titles.some((filmTitle) => titlesMatch(title, filmTitle))
}

/**
 * Checks whether the printed title is a small typo away from one of the film's known titles.
 */
function isNearMiss(title: string, film: FilmCandidate): boolean {
  return film.titles.some((filmTitle) => titlesNearlyMatch(title, filmTitle))
}

/**
 * Checks whether the film was out by the screening year, so it could be the one on show.
 * Undated films fail, while old films of any age pass.
 */
function couldHaveScreened(film: FilmCandidate, screeningYear: number): boolean {
  return film.releaseYear !== null && film.releaseYear <= screeningYear
}

// Cinemas print the production year, TMDB the release year.
const PRODUCTION_YEAR_TOLERANCE = 1

/**
 * Checks whether the film came out within a year of any printed production year.
 */
function isMadeAround({ releaseYear }: DirectedFilm, productionYears: number[]): boolean {
  return (
    releaseYear !== null &&
    productionYears.some((year) => Math.abs(releaseYear - year) <= PRODUCTION_YEAR_TOLERANCE)
  )
}

/**
 * Checks whether one of the film's directors is a director the cinema printed, ignoring
 * case and accents.
 */
function isByStatedDirector(film: FilmCandidate, directors: string[]): boolean {
  return film.directors.some((filmDirector) =>
    directors.some((director) => titlesMatch(director, filmDirector)),
  )
}

/**
 * Checks whether the printed director or year rules the film out.
 * Each check applies only when both the film and the cinema supply a value.
 */
function contradictsStatement(film: FilmCandidate, evidence: FilmEvidence): boolean {
  const byDirector =
    evidence.directors.length > 0 &&
    film.directors.length > 0 &&
    !isByStatedDirector(film, evidence.directors)
  const byYear =
    evidence.productionYears.length > 0 &&
    film.releaseYear !== null &&
    !isMadeAround(film, evidence.productionYears)

  return byDirector || byYear
}

/**
 * Checks whether the film runs exactly as long as a printed runtime, to the minute.
 */
function runsForStatedTime(film: FilmCandidate, runtimesInMinutes: number[]): boolean {
  return film.runtimeMinutes !== null && runtimesInMinutes.includes(film.runtimeMinutes)
}

/**
 * Keeps only the films that pass the check, or all of them when none pass, so evidence that
 * fits nothing changes nothing.
 */
function narrow<Film>(films: Film[], matches: (film: Film) => boolean): Film[] {
  const narrowed = films.filter((film) => matches(film))

  return narrowed.length === 0 ? films : narrowed
}

/**
 * Picks the one film the printed titles name, or null unless the evidence settles on one.
 * Earlier title candidates outrank TMDB's ordering, and an exact title beats a near miss.
 */
export function pickBestMatch(
  titleCandidates: string[],
  films: FilmCandidate[],
  evidence: FilmEvidence,
): FilmCandidate | null {
  /**
   * Returns the films matched by the earliest title candidate that matches any film at all.
   */
  function findNamedFilms(
    isMatch: (title: string, film: FilmCandidate) => boolean,
  ): FilmCandidate[] {
    for (const title of titleCandidates) {
      const named = films.filter((film) => isMatch(title, film))

      if (named.length > 0) {
        return named
      }
    }

    return []
  }

  /**
   * Returns the one film a title names, breaking ties by printed year, director and synopsis.
   * Search ranking never breaks a tie, so this gives null if more than one film still stands.
   */
  function findOnlyNamedFilm(
    isMatch: (title: string, film: FilmCandidate) => boolean,
  ): FilmCandidate | null {
    const named = findNamedFilms(isMatch)

    if (named.length === 1) {
      return contradictsStatement(named[0], evidence) ? null : named[0]
    }

    const madeInStatedYear = narrow(named, (film) =>
      film.releaseYear === null ? false : evidence.productionYears.includes(film.releaseYear),
    )
    const madeByStatedDirector = narrow(madeInStatedYear, (film) =>
      isByStatedDirector(film, evidence.directors),
    )
    const describedByBlurb = narrow(madeByStatedDirector, (film) =>
      isDescribedByBlurb(film, evidence.synopses),
    )

    return describedByBlurb.length === 1 && !contradictsStatement(describedByBlurb[0], evidence)
      ? describedByBlurb[0]
      : null
  }

  /**
   * Accepts a title one typo away from the film's, but only if the film could have been showing.
   */
  function isTypoAway(title: string, film: FilmCandidate): boolean {
    return isNearMiss(title, film) && couldHaveScreened(film, evidence.screeningYear)
  }

  return findOnlyNamedFilm(isSameTitle) ?? findOnlyNamedFilm(isTypoAway)
}

/**
 * Picks a film found by the cinema's original title, for when no title matched, or null.
 * Only the printed director or exact runtime count, not the year, and exactly one film must agree.
 */
export function pickCorroboratedMatch(
  films: FilmCandidate[],
  evidence: FilmEvidence,
): FilmCandidate | null {
  const corroborated = films.filter(
    (film) =>
      couldHaveScreened(film, evidence.screeningYear) &&
      (isByStatedDirector(film, evidence.directors) ||
        runsForStatedTime(film, evidence.runtimesInMinutes)),
  )

  return corroborated.length === 1 ? corroborated[0] : null
}

/**
 * Checks whether the printed year, director or exact runtime backs a film found other than by
 * title, with nothing printed contradicting it. A model's pick is admitted only on this.
 */
export function isCorroboratedBy(film: FilmCandidate, evidence: FilmEvidence): boolean {
  const corroborated =
    isMadeAround(film, evidence.productionYears) ||
    isByStatedDirector(film, evidence.directors) ||
    runsForStatedTime(film, evidence.runtimesInMinutes)

  return (
    corroborated &&
    couldHaveScreened(film, evidence.screeningYear) &&
    !contradictsStatement(film, evidence)
  )
}

/**
 * Sources round or count the credits differently. Tolerated only here, because this chooses among
 * one director's films rather than admitting one from the whole catalogue.
 */
const RUNTIME_TOLERANCE_MINUTES = 3

/**
 * Keeps a director's films made around a printed year, or all of them when none fit.
 * Keeping all lets the runtime decide when the printed year is wrong.
 */
export function narrowToFilmsMadeAround(
  films: DirectedFilm[],
  productionYears: number[],
): DirectedFilm[] {
  return narrow(films, (film) => isMadeAround(film, productionYears))
}

/**
 * Picks the one film whose runtime is within a few minutes of a printed runtime.
 * Expects films already narrowed by year; null on a tie or when no runtime was printed.
 */
export function pickFilmRunningForStatedTime(
  films: FilmCandidate[],
  runtimesInMinutes: number[],
): FilmCandidate | null {
  const running = films.filter(
    ({ runtimeMinutes }) =>
      runtimeMinutes !== null &&
      runtimesInMinutes.some(
        (runtime) => Math.abs(runtimeMinutes - runtime) <= RUNTIME_TOLERANCE_MINUTES,
      ),
  )

  return running.length === 1 ? running[0] : null
}
