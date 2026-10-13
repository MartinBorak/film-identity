import {
  fetchWikidataLinksByImdbId,
  fetchWikidataLinksByTmdbId,
  type WikidataLinks,
} from '../catalogues/wikidata.js'
import type { Context } from '../config.js'
import type { Film } from '../types.js'
import { fetchWikidataLinksBySearch } from './wikidataSearch.js'

/*
 * TMDB states no Wikidata item and none of the ids only Wikidata holds. Films are joined on the
 * TMDB id, then the IMDb id for items lacking a TMDB id, then by a name search.
 */

type Lookup = { tmdbId: number; imdbId: string | null; film: Film }

/**
 * Prepares a film for lookup, or gives null when it has no TMDB id or already has every link.
 */
function toLookup(context: Context, film: Film): Lookup | null {
  const isComplete =
    film.imdbId !== null &&
    film.wikidataId !== null &&
    context.wikidata.idProperties.every((property) => property in film.catalogueIds)

  return film.tmdbId === null || isComplete
    ? null
    : { tmdbId: film.tmdbId, imdbId: film.imdbId, film }
}

/**
 * Tells whether a lookup has an IMDb id to join on.
 */
function hasImdbId(lookup: Lookup): lookup is Lookup & { imdbId: string } {
  return lookup.imdbId !== null
}

/**
 * Adds Wikidata's links to a film, filling only what the film lacks.
 * The catalogue that identified the film is the closer source, so its own values win.
 */
export function withLinks(film: Film, links: WikidataLinks | undefined): Film {
  if (links === undefined) {
    return film
  }

  return {
    ...film,
    imdbId: film.imdbId ?? links.imdbId,
    wikidataId: film.wikidataId ?? links.wikidataId,
    catalogueIds: { ...links.catalogueIds, ...film.catalogueIds },
  }
}

/**
 * Finds Wikidata links by IMDb id, keyed by TMDB id, for films that have one.
 */
async function fetchLinksByImdbId(
  context: Context,
  lookups: Lookup[],
): Promise<Map<number, WikidataLinks>> {
  const withImdbId = lookups.filter(hasImdbId)
  const found = await fetchWikidataLinksByImdbId(
    context,
    withImdbId.map(({ imdbId }) => imdbId),
  )

  return new Map(
    withImdbId
      .map(({ tmdbId, imdbId }) => [tmdbId, found.get(imdbId)] as const)
      .filter((pair): pair is readonly [number, WikidataLinks] => pair[1] !== undefined),
  )
}

/**
 * Finds Wikidata links by searching each film's titles, keyed by TMDB id.
 */
async function fetchLinksBySearch(
  context: Context,
  lookups: Lookup[],
): Promise<Map<number, WikidataLinks>> {
  const searched = await Array.fromAsync(
    lookups,
    async ({ tmdbId, film }) => [tmdbId, await fetchWikidataLinksBySearch(context, film)] as const,
  )

  return new Map(
    searched.filter((pair): pair is readonly [number, WikidataLinks] => pair[1] !== null),
  )
}

/**
 * Looks up each film's Wikidata links, keyed by TMDB id, joining on the TMDB id, then the IMDb id,
 * then a name search.
 */
export async function fetchFilmLinks(
  context: Context,
  films: Film[],
): Promise<Map<number, WikidataLinks>> {
  const lookups = [
    ...new Map(
      films
        .map((film) => toLookup(context, film))
        .filter((lookup) => lookup !== null)
        .map((lookup) => [lookup.tmdbId, lookup]),
    ).values(),
  ]

  const found = await fetchWikidataLinksByTmdbId(
    context,
    lookups.map(({ tmdbId }) => tmdbId),
  )
  const byImdbId = await fetchLinksByImdbId(
    context,
    lookups.filter(({ tmdbId }) => !found.has(tmdbId)),
  )
  const bySearch = await fetchLinksBySearch(
    context,
    lookups.filter(({ tmdbId }) => !found.has(tmdbId) && !byImdbId.has(tmdbId)),
  )

  return new Map([...found, ...byImdbId, ...bySearch])
}

/**
 * Fills in each film's Wikidata item and the catalogue ids that only Wikidata holds.
 */
export async function linkFilms(context: Context, films: Film[]): Promise<Film[]> {
  const links = await fetchFilmLinks(context, films)

  return films.map((film) =>
    withLinks(film, film.tmdbId === null ? undefined : links.get(film.tmdbId)),
  )
}
