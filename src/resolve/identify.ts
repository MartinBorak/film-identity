import { FilmLookupError } from '../catalogues/errors.js'
import {
  buildTmdbPosterUrl,
  fetchTmdbDirectorCredits,
  fetchTmdbMovie,
  fetchTmdbPeople,
  fetchTmdbPosterPaths,
  fetchTmdbSearchResults,
  toCast,
  toDirectors,
  toFilm,
  toKnownTitles,
  toReleaseYear,
  type TmdbCrewCredit,
  type TmdbMovie,
  type TmdbPerson,
  type TmdbSearchResult,
} from '../catalogues/tmdb.js'
import type { Context } from '../config.js'
import {
  isCorroboratedBy,
  narrowToFilmsMadeAround,
  pickBestMatch,
  pickCorroboratedMatch,
  pickFilmRunningForStatedTime,
  type DirectedFilm,
  type FilmCandidate,
} from '../match/matchFilm.js'
import { titlesMatch, toTitleCandidates } from '../match/titles.js'
import { selectFilmAmongCandidates, toSelectableCandidate } from '../model/candidateSelector.js'
import { proposeSearchQueries } from '../model/queryProposer.js'
import { fetchPosterHash, toHashDistance, type PosterHash } from '../poster/posterHash.js'
import type { FilmMatch, Listing } from '../types.js'
import { union, unique } from '../utils.js'
import { mergeEvidence, toEvidence, type Evidence } from './evidence.js'
import { groupRelatedTitles } from './groupTitles.js'

/**
 * How many results to fetch in full. TMDB ranks by relevance, not identity, so the screening film
 * can sit third behind an older namesake.
 */
const FULL_TITLE_LOOKUP_LIMIT = 5

/**
 * Turns a search result into a candidate to match against, knowing only its two titles and year.
 */
function toSearchCandidate(result: TmdbSearchResult): FilmCandidate {
  return {
    tmdbId: result.id,
    titles: [result.title, result.original_title],
    releaseYear: toReleaseYear(result.release_date),
    directors: [],
    cast: [],
    runtimeMinutes: null,
  }
}

/**
 * Turns a fully fetched film into a candidate to match against, with all its titles and credits.
 */
function toMovieCandidate(movie: TmdbMovie): FilmCandidate {
  return {
    tmdbId: movie.id,
    titles: toKnownTitles(movie),
    releaseYear: toReleaseYear(movie.release_date),
    directors: toDirectors(movie),
    cast: toCast(movie),
    runtimeMinutes: movie.runtime,
  }
}

/**
 * Picks the film the listing names from one batch of search results, if any is clearly it.
 * Tries the results' own two titles before fetching any in full, because a neighbouring
 * language's title is only in the translations, which search results omit.
 */
async function matchSearchResults(
  context: Context,
  isOriginalTitle: boolean,
  queryTitles: string[],
  results: TmdbSearchResult[],
  evidence: Evidence,
): Promise<TmdbMovie | null> {
  const searchMatch = pickBestMatch(queryTitles, results.map(toSearchCandidate), evidence)

  if (searchMatch) {
    return fetchTmdbMovie(context, searchMatch.tmdbId)
  }

  const movies = await Array.fromAsync(results.slice(0, FULL_TITLE_LOOKUP_LIMIT), (result) =>
    fetchTmdbMovie(context, result.id),
  )
  const candidates = movies.map(toMovieCandidate)

  // Corroboration alone admits a film only for the cinema's original title, never a split form.
  const match =
    pickBestMatch(queryTitles, candidates, evidence) ??
    (isOriginalTitle ? pickCorroboratedMatch(candidates, evidence) : null)

  return movies.find((movie) => movie.id === match?.tmdbId) ?? null
}

/**
 * Merges several batches of search results into one list without repeats.
 * Keeps first-seen order, so the strongest query's ranking leads.
 */
function poolResults(batches: TmdbSearchResult[][]): TmdbSearchResult[] {
  return [...new Map(batches.flat().map((result) => [result.id, result])).values()]
}

type TitleSearch = { movie: TmdbMovie | null; seen: TmdbSearchResult[] }

type Found = { movie: TmdbMovie; evidence: 'title' | 'director' | 'poster' | 'model' }

/**
 * Lists the titles to search for, strongest first: the cinema's original titles, then whole
 * printed titles, then split forms.
 */
function toQueries(rawTitles: string[], originalTitles: string[]): string[] {
  const candidateLists = rawTitles.map(toTitleCandidates)

  return union([
    originalTitles,
    ...candidateLists.map((candidates) => candidates.slice(0, 1)),
    ...candidateLists,
  ])
}

/**
 * Searches the catalogue by each of the listing's titles in turn until one settles the film.
 * Returns every result seen even on failure, so later routes still tie against these namesakes
 * instead of crowning one they find alone.
 */
async function searchByTitle(
  context: Context,
  rawTitles: string[],
  evidence: Evidence,
): Promise<TitleSearch> {
  const queries = toQueries(rawTitles, evidence.originalTitles)

  /**
   * Runs the remaining queries one at a time, carrying along every result seen so far.
   */
  async function searchFrom(remaining: string[], seen: TmdbSearchResult[]): Promise<TitleSearch> {
    const [query, ...rest] = remaining

    if (query === undefined) {
      return { movie: null, seen }
    }

    const results = await fetchTmdbSearchResults(context, query)
    const movie = await matchSearchResults(
      context,
      evidence.originalTitles.includes(query),
      queries,
      results,
      evidence,
    )
    const pooled = poolResults([seen, results])

    return movie ? { movie, seen: pooled } : searchFrom(rest, pooled)
  }

  return searchFrom(queries, [])
}

/**
 * Reduces a director's credit to the film's id and release year.
 */
function toDirectedFilm(credit: TmdbCrewCredit): DirectedFilm {
  return { tmdbId: credit.id, releaseYear: toReleaseYear(credit.release_date) }
}

/**
 * Finds everyone in the catalogue with exactly this name.
 * Keeps them all rather than TMDB's top-ranked person; the year and runtime narrow them later.
 */
async function findNamedPeople(context: Context, name: string): Promise<TmdbPerson[]> {
  return (await fetchTmdbPeople(context, name)).filter((person) => titlesMatch(person.name, name))
}

/**
 * Collects every film directed by anyone who bears one of the listed directors' names.
 */
async function findDirectedFilms(context: Context, directors: string[]): Promise<DirectedFilm[]> {
  const people = await Array.fromAsync(directors, (director) => findNamedPeople(context, director))
  const credits = await Array.fromAsync(people.flat(), (person) =>
    fetchTmdbDirectorCredits(context, person.id),
  )

  return [...new Map(credits.flat().map((credit) => [credit.id, toDirectedFilm(credit)])).values()]
}

/**
 * Finds the film among the listed director's work when a stated year or runtime singles it out.
 * Narrows by year first since credits carry one; checking runtime needs a full fetch.
 */
async function searchByDirector(context: Context, evidence: Evidence): Promise<TmdbMovie | null> {
  const hasDiscriminator =
    evidence.productionYears.length > 0 || evidence.runtimesInMinutes.length > 0

  if (evidence.directors.length === 0 || !hasDiscriminator) {
    return null
  }

  const madeAround = narrowToFilmsMadeAround(
    await findDirectedFilms(context, evidence.directors),
    evidence.productionYears,
  )

  if (madeAround.length === 1) {
    return fetchTmdbMovie(context, madeAround[0].tmdbId)
  }

  if (madeAround.length > FULL_TITLE_LOOKUP_LIMIT) {
    return null
  }

  const movies = await Array.fromAsync(madeAround, (film) => fetchTmdbMovie(context, film.tmdbId))
  const match = pickFilmRunningForStatedTime(
    movies.map(toMovieCandidate),
    evidence.runtimesInMinutes,
  )

  return movies.find((movie) => movie.id === match?.tmdbId) ?? null
}

/**
 * Maximum hash distance in bits (of 128) for one artwork, and the minimum lead over the runner-up.
 * On eleven cinema posters the right film was 7 to 20 bits away (one outlier at 30) and the
 * nearest of 38 wrong films never under 36. Tight on purpose: a false match costs a wrong schedule.
 */
const POSTER_MATCH_DISTANCE = 26
const POSTER_MATCH_MARGIN = 8

/**
 * Results looked at per query, films hashed in all, and posters hashed per film.
 */
const POSTER_CANDIDATES_PER_QUERY = 3
const POSTER_CANDIDATES = 8
const POSTERS_PER_CANDIDATE = 4

/**
 * Measures how closely the best of a film's catalogue posters resembles any of the cinema's.
 */
async function toPosterDistance(
  context: Context,
  tmdbId: number,
  cinemaHashes: PosterHash[],
): Promise<{ tmdbId: number; distance: number } | null> {
  const paths = (await fetchTmdbPosterPaths(context, tmdbId)).slice(0, POSTERS_PER_CANDIDATE)
  const hashes = await Array.fromAsync(paths, (path) =>
    fetchPosterHash(context, buildTmdbPosterUrl(path), 'tmdb'),
  )
  const distances = hashes.flatMap((hash) =>
    cinemaHashes.map((cinemaHash) => toHashDistance(hash, cinemaHash)),
  )

  return distances.length === 0 ? null : { tmdbId, distance: Math.min(...distances) }
}

/**
 * Picks the one candidate whose poster clearly resembles the cinema's, since a distributor's
 * retitling keeps the artwork.
 */
async function pickFilmByPoster(
  context: Context,
  rawTitles: string[],
  candidateIds: number[],
  evidence: Evidence,
): Promise<TmdbMovie | null> {
  if (candidateIds.length === 0 || evidence.posterUrls.length === 0) {
    return null
  }

  const cinemaHashes = await Array.fromAsync(evidence.posterUrls, (url) =>
    fetchPosterHash(context, url, 'poster'),
  )
  const distances = (
    await Array.fromAsync(candidateIds, (tmdbId) => toPosterDistance(context, tmdbId, cinemaHashes))
  )
    .filter((candidate) => candidate !== null)
    .toSorted((a, b) => a.distance - b.distance)

  const [nearest, runnerUp] = distances
  const isAlike = nearest !== undefined && nearest.distance <= POSTER_MATCH_DISTANCE
  const isAlone =
    runnerUp === undefined || runnerUp.distance - nearest.distance >= POSTER_MATCH_MARGIN

  if (!isAlike || !isAlone) {
    return null
  }

  context.log(
    `Admitted "${rawTitles[0]}" as tmdb:${nearest.tmdbId} on its poster, ${nearest.distance} bits away${runnerUp === undefined ? '' : `, next film ${runnerUp.distance}`}`,
  )

  return fetchTmdbMovie(context, nearest.tmdbId)
}

const SELECTION_CANDIDATES = 10

/**
 * Lets the model choose among the search results, accepting its pick only where the cinema's own
 * facts back it up. A listing that printed nothing beyond a title therefore stays unmatched.
 */
async function pickFilmBySelection(
  context: Context,
  rawTitles: string[],
  evidence: Evidence,
  pool: TmdbSearchResult[],
): Promise<TmdbMovie | null> {
  const movies = await Array.fromAsync(pool.slice(0, SELECTION_CANDIDATES), (result) =>
    fetchTmdbMovie(context, result.id),
  )
  const selectedId = await selectFilmAmongCandidates(
    context,
    rawTitles,
    evidence,
    movies.map(toSelectableCandidate),
  )
  const selected = movies.find((movie) => movie.id === selectedId)

  if (selected === undefined || !isCorroboratedBy(toMovieCandidate(selected), evidence)) {
    return null
  }

  context.log(
    `Admitted "${rawTitles[0]}" as tmdb:${selected.id} on a model's choice among ${movies.length}, corroborated by the cinema`,
  )

  return selected
}

/**
 * Searches with the model's proposed queries, then matches by title, poster or the model's pick.
 * The model never names a film itself, and its results are pooled with the earlier searches, so a
 * namesake a proposal finds alone still ties.
 */
async function matchProposals(
  context: Context,
  rawTitles: string[],
  evidence: Evidence,
  seen: TmdbSearchResult[],
): Promise<Found | null> {
  const cinemaTitles = toQueries(rawTitles, evidence.originalTitles)
  const queries = await proposeSearchQueries(context, rawTitles, evidence)
  const proposed = await Array.fromAsync(queries, (query) => fetchTmdbSearchResults(context, query))
  const pool = poolResults([seen, ...proposed])

  const byTitle = await matchSearchResults(context, false, cinemaTitles, pool, evidence)

  if (byTitle) {
    return { movie: byTitle, evidence: 'title' }
  }

  const byPoster = await pickFilmByPoster(
    context,
    rawTitles,
    poolResults([
      ...proposed.map((results) => results.slice(0, POSTER_CANDIDATES_PER_QUERY)),
      seen.slice(0, POSTER_CANDIDATES_PER_QUERY),
    ])
      .slice(0, POSTER_CANDIDATES)
      .map((result) => result.id),
    evidence,
  )

  if (byPoster) {
    return { movie: byPoster, evidence: 'poster' }
  }

  const byModel = await pickFilmBySelection(context, rawTitles, evidence, pool)

  return byModel ? { movie: byModel, evidence: 'model' } : null
}

/**
 * Asks the model for help when the titles and directors found nothing, if a model is configured.
 * A model or poster host failure leaves this listing unmatched rather than failing the run.
 */
async function searchByProposal(
  context: Context,
  rawTitles: string[],
  evidence: Evidence,
  seen: TmdbSearchResult[],
): Promise<Found | null> {
  if (context.model === null) {
    return null
  }

  try {
    return await matchProposals(context, rawTitles, evidence, seen)
  } catch (error: unknown) {
    if (
      error instanceof FilmLookupError &&
      (error.source === 'model' || error.source === 'poster')
    ) {
      context.log(`Could not ask about "${rawTitles[0]}", which stays unresolved: ${error.message}`)

      return null
    }

    throw error
  }
}

/**
 * Tries each way of finding the film in turn: by title, by director, then with the model's help.
 * Directors come second because names, unlike titles, are not translated.
 */
async function search(
  context: Context,
  rawTitles: string[],
  evidence: Evidence,
): Promise<Found | null> {
  const byTitle = await searchByTitle(context, rawTitles, evidence)

  if (byTitle.movie) {
    return { movie: byTitle.movie, evidence: 'title' }
  }

  const byDirector = await searchByDirector(context, evidence)

  if (byDirector) {
    return { movie: byDirector, evidence: 'director' }
  }

  return searchByProposal(context, rawTitles, evidence, byTitle.seen)
}

/**
 * Finds the catalogue film that the titles and facts describe, or reports none.
 */
async function identify(
  context: Context,
  rawTitles: string[],
  evidence: Evidence,
): Promise<FilmMatch> {
  const found = await search(context, rawTitles, evidence)

  return found
    ? { evidence: found.evidence, film: toFilm(found.movie) }
    : { evidence: 'unmatched', film: null }
}

/**
 * Finds the catalogue film one cinema listing refers to.
 * Returns unmatched rather than a plausible guess: a wrong film silently merges two schedules.
 */
export async function identifyFilm(context: Context, listing: Listing): Promise<FilmMatch> {
  return identify(context, listing.titles, toEvidence(listing))
}

/**
 * Identifies the films behind many listings, resolving each set of titles that name one film once.
 * Pools the facts of a group's listings, and every title in the group gets the group's match.
 */
export async function identifyFilms(
  context: Context,
  listings: Listing[],
): Promise<Map<string, FilmMatch>> {
  const listingsByTitle = new Map(
    listings.flatMap((listing) => listing.titles.map((title) => [title, listing] as const)),
  )
  const groups = groupRelatedTitles([...listingsByTitle.keys()])
  const resolved = await Array.fromAsync(groups, async (group) => {
    const members = unique(group.map((title) => listingsByTitle.get(title))).filter(
      (listing) => listing !== undefined,
    )
    const match = await identify(context, group, mergeEvidence(members.map(toEvidence)))

    return group.map((title): [string, FilmMatch] => [title, match])
  })

  return new Map(resolved.flat())
}
