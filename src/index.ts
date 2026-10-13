import { fetchTmdbMovie, toFilm } from './catalogues/tmdb.js'
import {
  fetchWikidataFilm as fetchFromWikidata,
  type WikidataLinks,
} from './catalogues/wikidata.js'
import { resolveConfig, type FilmIdentityConfig } from './config.js'
import { identifyFilm as identifyOne, identifyFilms as identifyMany } from './resolve/identify.js'
import { fetchFilmLinks as fetchLinks, linkFilms as link } from './resolve/linkFilms.js'
import type { Film, FilmMatch, Listing } from './types.js'

export type { FilmIdentityConfig, ModelConfig, TmdbConfig, WikidataConfig } from './config.js'
export { FilmLookupError, type FilmLookupSource } from './catalogues/errors.js'
export type { Film, FilmMatch, Listing } from './types.js'
export type { WikidataLinks } from './catalogues/wikidata.js'

export type FilmResolver = {
  /** Finds the film one listing names, or reports it unmatched rather than guess. */
  identify: (listing: Listing) => Promise<FilmMatch>
  /** Identifies many listings at once, keyed by title; titles of the same film share one match. */
  identifyAll: (listings: Listing[]) => Promise<Map<string, FilmMatch>>
  /** Fills in each film's Wikidata, IMDb and further catalogue ids where Wikidata has them. */
  linkFilms: (films: Film[]) => Promise<Film[]>
  /** Looks up the Wikidata ids for films without changing them, keyed by TMDB id. */
  fetchFilmLinks: (films: Film[]) => Promise<Map<number, WikidataLinks>>
  /** Fetches a film from TMDB by its id. */
  fetchTmdbFilm: (tmdbId: number) => Promise<Film>
  /** Fetches a film from Wikidata by its item id. */
  fetchWikidataFilm: (wikidataId: string) => Promise<Film>
}

/**
 * Creates a resolver that identifies listings and fetches films using the given configuration.
 * A resolver serves one configuration, so a program covering several markets creates one for each.
 */
export function createFilmResolver(config: FilmIdentityConfig): FilmResolver {
  const context = resolveConfig(config)

  return {
    identify: (listing) => identifyOne(context, listing),
    identifyAll: (listings) => identifyMany(context, listings),
    linkFilms: (films) => link(context, films),
    fetchFilmLinks: (films) => fetchLinks(context, films),
    fetchTmdbFilm: async (tmdbId) => toFilm(await fetchTmdbMovie(context, tmdbId)),
    fetchWikidataFilm: (wikidataId) => fetchFromWikidata(context, wikidataId),
  }
}
