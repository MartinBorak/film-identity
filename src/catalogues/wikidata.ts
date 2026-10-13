import { z } from 'zod'

import type { Context } from '../config.js'
import type { Film } from '../types.js'
import { union, unique } from '../utils.js'
import { FilmLookupError } from './errors.js'
import { fetchJson } from './http.js'

/**
 * The Action API, not SPARQL. Measured: SPARQL found answers in under 140ms but took 10-90s to
 * send them or failed with 429, 502 or 504; the Action API's search returned the same in 0.6s.
 */
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php'

const TITLE = 'P1476'
const PUBLICATION_DATE = 'P577'
export const IMDB_ID = 'P345'
export const TMDB_ID = 'P4947'
const DURATION = 'P2047'
export const DIRECTOR = 'P57'

// Durations in any other unit are ignored.
const MINUTE_UNIT = 'http://www.wikidata.org/entity/Q7727'

// 143 fitted one search when measured; the limit is query length, not count.
const ID_BATCH_SIZE = 100

// wbgetentities' limit per call.
const ENTITY_BATCH_SIZE = 50

const ITEM_ID_PATTERN = /^Q\d+$/u
const IMDB_ID_PATTERN = /^tt\d+$/u
const PROPERTY_PATTERN = /^P\d+$/u

// What a haswbstatement expression can hold: no `|` separator, no space.
const STATEMENT_VALUE_PATTERN = /^[\w.-]+$/u

/**
 * Splits a list into consecutive chunks of at most the given size.
 */
function toBatches<Item>(items: Item[], size: number): Item[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, batch) =>
    items.slice(batch * size, (batch + 1) * size),
  )
}

/**
 * Builds a Wikidata API address from query parameters, asking for JSON.
 */
function buildApiUrl(params: Record<string, string>): string {
  const url = new URL(WIKIDATA_API_URL)

  url.search = new URLSearchParams({ ...params, format: 'json' }).toString()

  return url.toString()
}

/**
 * Builds the address that fetches items' statements and labels, optionally in given languages only.
 */
export function buildWikidataEntitiesUrl(itemIds: string[], languages?: string[]): string {
  return buildApiUrl({
    action: 'wbgetentities',
    ids: itemIds.join('|'),
    props: 'claims|labels',
    ...(languages === undefined ? {} : { languages: languages.join('|') }),
  })
}

/**
 * Builds the address that searches Wikidata items by label in one language.
 */
export function buildWikidataSearchUrl(text: string, language: string, limit: number): string {
  return buildApiUrl({
    action: 'wbsearchentities',
    search: text,
    language,
    type: 'item',
    limit: String(limit),
  })
}

// Values stay unknown here: each property's shape is checked where it is read.
const claimSchema = z.object({
  rank: z.enum(['preferred', 'normal', 'deprecated']),
  mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }),
})

const entitySchema = z.object({
  claims: z.record(z.string(), z.array(claimSchema)).default({}),
  labels: z.record(z.string(), z.object({ value: z.string() })).default({}),
})

const entitiesResponseSchema = z.object({ entities: z.record(z.string(), entitySchema) })

const statementSearchResponseSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })) }),
})

export const searchResponseSchema = z.object({
  search: z.array(z.object({ id: z.string() })).default([]),
})

export type Entity = z.infer<typeof entitySchema>

/**
 * Fetches from the Wikidata API and checks that the response has the expected shape.
 */
export async function fetchWikidataApi<T>(
  context: Context,
  url: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return fetchJson(context, url, 'wikidata', schema)
}

/**
 * Fetches the statements and labels of many items, keyed by item id.
 */
export async function fetchWikidataEntities(
  context: Context,
  itemIds: string[],
): Promise<Record<string, Entity>> {
  const described = await Array.fromAsync(toBatches(itemIds, ENTITY_BATCH_SIZE), (batch) =>
    fetchWikidataApi(context, buildWikidataEntitiesUrl(batch), entitiesResponseSchema),
  )

  return Object.fromEntries(described.flatMap(({ entities }) => Object.entries(entities)))
}

/**
 * Picks an item's trusted statements for a property: the preferred ones if any, else the normal
 * ones. Deprecated statements mark a value as wrong and never count.
 */
function toBestClaims(entity: Entity, property: string): z.infer<typeof claimSchema>[] {
  const ranked = (entity.claims[property] ?? []).filter((claim) => claim.rank !== 'deprecated')
  const preferred = ranked.filter((claim) => claim.rank === 'preferred')

  return preferred.length > 0 ? preferred : ranked
}

/**
 * Lists the values of an item's trusted statements for a property.
 */
function toClaimValues(entity: Entity, property: string): unknown[] {
  return toBestClaims(entity, property)
    .map((claim) => claim.mainsnak.datavalue?.value)
    .filter((value) => value !== undefined)
}

/**
 * Reads a text field from a statement value, or null if the value lacks it.
 */
function toField(value: unknown, field: string): string | null {
  const shaped = z.object({ [field]: z.string() }).safeParse(value)

  return shaped.success ? shaped.data[field] : null
}

/**
 * Lists the items that an item's property points to, such as a film's directors.
 */
export function toItemIds(entity: Entity, property: string): string[] {
  return toClaimValues(entity, property)
    .map((value) => toField(value, 'id'))
    .filter((id) => id !== null)
}

/**
 * Lists the text values of an item's property, such as its IMDb id.
 */
export function toStrings(entity: Entity, property: string): string[] {
  return toClaimValues(entity, property).filter(
    (value): value is string => typeof value === 'string',
  )
}

/**
 * Lists the years of an item's publication dates.
 * Wikidata writes a time as "+2026-02-05T00:00:00Z".
 */
export function toYears(entity: Entity): number[] {
  return toClaimValues(entity, PUBLICATION_DATE)
    .map((value) => toField(value, 'time'))
    .filter((time) => time !== null)
    .map((time) => Number(time.slice(1, 5)))
}

/**
 * Lists an item's distinct labels across all languages.
 */
export function toLabels(entity: Entity): string[] {
  return unique(Object.values(entity.labels).map((label) => label.value))
}

/**
 * Reads a film's running time in minutes, ignoring durations given in other units.
 */
function toRuntimeMinutes(entity: Entity): number | null {
  const minutes = toClaimValues(entity, DURATION)
    .filter((value) => toField(value, 'unit') === MINUTE_UNIT)
    .map((value) => toField(value, 'amount'))
    .filter((amount) => amount !== null)

  return minutes.length === 0 ? null : Number(minutes[0])
}

/**
 * Reads the further catalogue ids the configuration asks for, such as a film's ČSFD id.
 */
export function toCatalogueIds(context: Context, entity: Entity): Record<string, string> {
  return Object.fromEntries(
    context.wikidata.idProperties
      .map((property) => [property, toStrings(entity, property)[0]] as const)
      .filter((pair): pair is readonly [string, string] => pair[1] !== undefined),
  )
}

/**
 * Builds the address that fetches one film item, with its labels in the configured languages.
 * The id is validated, not escaped: a `|` in it would name a second item.
 */
export function buildWikidataFilmUrl(context: Context, wikidataId: string): string {
  if (!ITEM_ID_PATTERN.test(wikidataId)) {
    throw new FilmLookupError(`Not a Wikidata item id: ${wikidataId}`, 'wikidata', { wikidataId })
  }

  return buildWikidataEntitiesUrl([wikidataId], union([context.wikidata.languages, ['en']]))
}

/**
 * Converts a Wikidata item into a Film.
 * Here Wikidata is the catalogue of record, so an item with no label is a wrong id and throws.
 */
export function toWikidataFilm(
  context: Context,
  wikidataId: string,
  entity: Entity | undefined,
): Film {
  const labels = entity?.labels ?? {}
  const title = context.wikidata.languages
    .map((language) => labels[language]?.value)
    .find((label) => label !== undefined)

  if (entity === undefined || title === undefined) {
    throw new FilmLookupError(`Wikidata describes no film ${wikidataId}`, 'wikidata', {
      wikidataId,
    })
  }

  const originalTitle = toClaimValues(entity, TITLE)
    .map((value) => toField(value, 'text'))
    .find((text) => text !== null)
  const years = toYears(entity)
  const tmdbId = toStrings(entity, TMDB_ID)[0]

  return {
    tmdbId: tmdbId === undefined ? null : Number(tmdbId),
    imdbId: toStrings(entity, IMDB_ID)[0] ?? null,
    wikidataId,
    catalogueIds: toCatalogueIds(context, entity),
    title,
    englishTitle: labels.en?.value ?? originalTitle ?? title,
    originalTitle: originalTitle ?? '',
    // The earliest, since later dates are releases abroad.
    releaseYear: years.length === 0 ? null : Math.min(...years),
    runtimeMinutes: toRuntimeMinutes(entity),
    // Wikidata images carry their own licences; using them is a separate decision.
    posterPath: null,
    // Wikidata genres are not TMDB ids, and its directors would be more names to reconcile.
    directors: [],
    genreIds: [],
  }
}

/**
 * Fetches a film from Wikidata by its item id.
 */
export async function fetchWikidataFilm(context: Context, wikidataId: string): Promise<Film> {
  const { entities } = await fetchWikidataApi(
    context,
    buildWikidataFilmUrl(context, wikidataId),
    entitiesResponseSchema,
  )

  return toWikidataFilm(context, wikidataId, entities[wikidataId])
}

/**
 * Builds the address that finds the items stating any of the given values for a property.
 * It reads the statement index, so a whole batch of keys is one search.
 */
function buildStatementSearchUrl(property: string, keys: string[]): string {
  return buildApiUrl({
    action: 'query',
    list: 'search',
    srsearch: `haswbstatement:${keys.map((key) => `${property}=${key}`).join('|')}`,
    srnamespace: '0',
    srlimit: 'max',
    srprop: '',
  })
}

/**
 * Builds the address that finds the Wikidata items for a batch of TMDB ids.
 * The ids are checked, not escaped: they go into a search expression, not a URL parameter.
 */
export function buildWikidataFilmIdsUrl(tmdbIds: number[]): string {
  const notIds = tmdbIds.filter((tmdbId) => !Number.isInteger(tmdbId))

  if (notIds.length > 0) {
    throw new FilmLookupError(`Not TMDB ids: ${notIds.join(', ')}`, 'wikidata', { notIds })
  }

  return buildStatementSearchUrl(TMDB_ID, tmdbIds.map(String))
}

/**
 * Builds the address that finds the Wikidata items for a batch of IMDb ids.
 */
export function buildWikidataFilmIdsByImdbIdUrl(imdbIds: string[]): string {
  const notIds = imdbIds.filter((imdbId) => !IMDB_ID_PATTERN.test(imdbId))

  if (notIds.length > 0) {
    throw new FilmLookupError(`Not IMDb ids: ${notIds.join(', ')}`, 'wikidata', { notIds })
  }

  return buildStatementSearchUrl(IMDB_ID, imdbIds)
}

export type WikidataLinks = {
  wikidataId: string
  imdbId: string | null
  catalogueIds: Record<string, string>
}

/**
 * Collects a film item's ids: its Wikidata id, its IMDb id and any further catalogue ids.
 */
export function toWikidataLinks(
  context: Context,
  wikidataId: string,
  entity: Entity,
): WikidataLinks {
  return {
    wikidataId,
    imdbId: toStrings(entity, IMDB_ID)[0] ?? null,
    catalogueIds: toCatalogueIds(context, entity),
  }
}

/**
 * Matches each asked key, such as a TMDB id, to the links of the item that states it.
 * A key stated on two items identifies neither, so it is left out.
 */
export function toWikidataLinksByKey(
  context: Context,
  property: string,
  keys: string[],
  entities: Record<string, Entity>,
): Map<string, WikidataLinks> {
  const asked = new Set(keys)
  const statements = Object.entries(entities).flatMap(([wikidataId, entity]) =>
    toStrings(entity, property)
      .filter((key) => asked.has(key))
      .map((key) => ({ key, wikidataId, entity })),
  )
  const statementsByKey = Map.groupBy(statements, (statement) => statement.key)

  return new Map(
    [...statementsByKey]
      .filter(([, found]) => new Set(found.map(({ wikidataId }) => wikidataId)).size === 1)
      .map(([key, [{ wikidataId, entity }]]) => [
        key,
        toWikidataLinks(context, wikidataId, entity),
      ]),
  )
}

/**
 * Finds the items stating each key for a property and reads their links.
 */
async function fetchLinks(
  context: Context,
  property: string,
  keys: string[],
  buildUrl: (batch: string[]) => string,
): Promise<Map<string, WikidataLinks>> {
  const searches = await Array.fromAsync(toBatches(keys, ID_BATCH_SIZE), (batch) =>
    fetchWikidataApi(context, buildUrl(batch), statementSearchResponseSchema),
  )
  const itemIds = union(searches.map(({ query }) => query.search.map(({ title }) => title)))

  return toWikidataLinksByKey(
    context,
    property,
    keys,
    await fetchWikidataEntities(context, itemIds),
  )
}

/**
 * Looks up films' Wikidata links by their TMDB ids.
 * A film Wikidata has no item for is absent from the result, not an error.
 */
export async function fetchWikidataLinksByTmdbId(
  context: Context,
  tmdbIds: number[],
): Promise<Map<number, WikidataLinks>> {
  const found = await fetchLinks(context, TMDB_ID, tmdbIds.map(String), (batch) =>
    buildWikidataFilmIdsUrl(batch.map(Number)),
  )

  return new Map([...found].map(([key, links]) => [Number(key), links]))
}

/**
 * Looks up films' Wikidata links by their IMDb ids, leaving out any Wikidata has no item for.
 */
export async function fetchWikidataLinksByImdbId(
  context: Context,
  imdbIds: string[],
): Promise<Map<string, WikidataLinks>> {
  return fetchLinks(context, IMDB_ID, imdbIds, buildWikidataFilmIdsByImdbIdUrl)
}

/**
 * Lists the items that state a given value for a property, such as every film by one director.
 */
export async function fetchItemIdsStating(
  context: Context,
  property: string,
  value: string,
): Promise<string[]> {
  if (!PROPERTY_PATTERN.test(property) || !STATEMENT_VALUE_PATTERN.test(value)) {
    throw new FilmLookupError(`Not a statement: ${property}=${value}`, 'wikidata', {
      property,
      value,
    })
  }

  const { query } = await fetchWikidataApi(
    context,
    buildStatementSearchUrl(property, [value]),
    statementSearchResponseSchema,
  )

  return query.search.map(({ title }) => title)
}
