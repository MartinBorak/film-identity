import {
  buildWikidataSearchUrl,
  DIRECTOR,
  fetchWikidataApi,
  fetchWikidataEntities,
  IMDB_ID,
  searchResponseSchema,
  TMDB_ID,
  toCatalogueIds,
  toItemIds,
  toLabels,
  toStrings,
  toYears,
  type WikidataLinks,
} from '../catalogues/wikidata.js'
import type { Context } from '../config.js'
import { titlesMatch } from '../match/titles.js'
import type { Film } from '../types.js'
import { isNonEmpty, union, unique } from '../utils.js'

/*
 * For items neither id join reaches: a new local release often has a Wikidata item that states no
 * TMDB or IMDb id yet.
 */

const RESULTS_PER_SEARCH = 5

// Wikidata dates a release, which can be a year off TMDB's.
const PUBLICATION_YEAR_TOLERANCE = 1

export type SearchedItem = {
  wikidataId: string
  labels: string[]
  years: number[]
  directors: string[]
  imdbId: string | null
  tmdbId: number | null
  catalogueIds: Record<string, string>
}

/**
 * Tells whether a Wikidata search hit is the same film as ours.
 * A label must match one of the film's titles; year, TMDB id and director need agree only where
 * both sides state them.
 */
export function isSameFilm(item: SearchedItem, film: Film): boolean {
  const titles = [film.title, film.englishTitle, film.originalTitle].filter(isNonEmpty)
  const releaseYear = film.releaseYear
  const isNamedAlike = item.labels.some((label) =>
    titles.some((title) => titlesMatch(label, title)),
  )
  const isDatedAlike =
    item.years.length === 0 ||
    releaseYear === null ||
    item.years.some((year) => Math.abs(year - releaseYear) <= PUBLICATION_YEAR_TOLERANCE)
  const isSameTmdbFilm = item.tmdbId === null || item.tmdbId === film.tmdbId
  const isDirectedAlike =
    item.directors.length === 0 ||
    film.directors.length === 0 ||
    item.directors.some((director) => film.directors.some((name) => titlesMatch(director, name)))

  return isNamedAlike && isDatedAlike && isSameTmdbFilm && isDirectedAlike
}

/**
 * Gives the links of the one search hit that is this film, or null when none or several are.
 */
export function pickSearchedFilm(items: SearchedItem[], film: Film): WikidataLinks | null {
  const same = items.filter((item) => isSameFilm(item, film))

  return same.length === 1
    ? { wikidataId: same[0].wikidataId, imdbId: same[0].imdbId, catalogueIds: same[0].catalogueIds }
    : null
}

/**
 * Searches Wikidata for the film's titles in each configured language and collects the items hit.
 */
async function searchItemIds(context: Context, film: Film): Promise<string[]> {
  const texts = unique([film.originalTitle, film.title].filter(isNonEmpty))
  const searches = texts.flatMap((text) =>
    context.wikidata.languages.map((language) => ({ text, language })),
  )
  const found = await Array.fromAsync(searches, ({ text, language }) =>
    fetchWikidataApi(
      context,
      buildWikidataSearchUrl(text, language, RESULTS_PER_SEARCH),
      searchResponseSchema,
    ),
  )

  return union(found.map((response) => response.search.map((hit) => hit.id)))
}

/**
 * Fetches the found items with the facts needed to compare them to the film, directors by name.
 */
async function fetchSearchedItems(context: Context, itemIds: string[]): Promise<SearchedItem[]> {
  const entities = await fetchWikidataEntities(context, itemIds)
  const directorIds = union(Object.values(entities).map((entity) => toItemIds(entity, DIRECTOR)))
  // Labels in every language, since TMDB's spelling of a name may be any of them.
  const directors = await fetchWikidataEntities(context, directorIds)

  return Object.entries(entities).map(([wikidataId, entity]) => ({
    wikidataId,
    labels: toLabels(entity),
    years: toYears(entity),
    directors: toItemIds(entity, DIRECTOR).flatMap((id) =>
      directors[id] === undefined ? [] : toLabels(directors[id]),
    ),
    imdbId: toStrings(entity, IMDB_ID)[0] ?? null,
    tmdbId: toStrings(entity, TMDB_ID).map(Number)[0] ?? null,
    catalogueIds: toCatalogueIds(context, entity),
  }))
}

/**
 * Finds a film's Wikidata links by searching its titles, for items that state no usable id yet.
 */
export async function fetchWikidataLinksBySearch(
  context: Context,
  film: Film,
): Promise<WikidataLinks | null> {
  return pickSearchedFilm(
    await fetchSearchedItems(context, await searchItemIds(context, film)),
    film,
  )
}
