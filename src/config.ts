import { unique } from './utils.js'

export type TmdbConfig = {
  /** A v4 read access token from https://www.themoviedb.org/settings/api. */
  readAccessToken: string
  /** The locale of the titles returned, such as 'sk-SK'. Searches match titles in any language. */
  language: string
  /** Whose release dates TMDB reports, such as 'SK'. */
  region?: string
}

export type WikidataConfig = {
  /** Label languages, likeliest first. Defaults to the TMDB language, then English. */
  languages?: string[]
  /** Further ids to read, such as 'P2529' for ČSFD. */
  idProperties?: string[]
}

export type ModelConfig = {
  /** Sends a system prompt and a user message to any model and resolves to its text reply. */
  ask: (systemPrompt: string, message: string) => Promise<string>
  /** The language the listings are written in, such as 'Slovak'. */
  listingLanguage: string
  /** Languages TMDB often has titles in when it lacks the listing language, such as ['Czech']. */
  relatedLanguages?: string[]
  /** Where the listings come from, such as 'Bratislava'. */
  place?: string
}

export type FilmIdentityConfig = {
  tmdb: TmdbConfig
  /** Poster languages tried first. Defaults to the Wikidata languages, then no language. */
  posterLanguages?: (string | null)[]
  wikidata?: WikidataConfig
  /** Without a model, listings resolve on their titles, directors and posters only. */
  model?: ModelConfig
  /** Sent with every request. Wikidata asks that it name your project and how to reach you. */
  userAgent: string
  /** Receives the admissions no title reached, for auditing. Silent by default. */
  log?: (message: string) => void
}

/** TMDB settings, with no region stated as null. */
export type TmdbContext = Omit<TmdbConfig, 'region'> & { region: string | null }

/** Wikidata settings, with the defaults filled in. */
export type WikidataContext = Required<WikidataConfig>

/** Model settings, with the defaults filled in and no place stated as null. */
export type ModelContext = Required<Omit<ModelConfig, 'place'>> & { place: string | null }

export type Context = {
  tmdb: TmdbContext
  posterLanguages: (string | null)[]
  wikidata: WikidataContext
  /** Null when no model is configured. */
  model: ModelContext | null
  userAgent: string
  log: (message: string) => void
}

/**
 * Turns the configuration into the settings every module reads, with every default filled in.
 */
export function resolveConfig(config: FilmIdentityConfig): Context {
  const primaryLanguage = config.tmdb.language.split('-')[0]
  const languages = config.wikidata?.languages ?? unique([primaryLanguage, 'en'])

  return {
    tmdb: {
      readAccessToken: config.tmdb.readAccessToken,
      language: config.tmdb.language,
      region: config.tmdb.region ?? null,
    },
    posterLanguages: config.posterLanguages ?? [...languages, null],
    wikidata: { languages, idProperties: config.wikidata?.idProperties ?? [] },
    model:
      config.model === undefined
        ? null
        : {
            ask: config.model.ask,
            listingLanguage: config.model.listingLanguage,
            relatedLanguages: config.model.relatedLanguages ?? [],
            place: config.model.place ?? null,
          },
    userAgent: config.userAgent,
    log: config.log ?? (() => undefined),
  }
}
