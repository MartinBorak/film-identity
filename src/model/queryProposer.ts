import { z } from 'zod'

import { FilmLookupError } from '../catalogues/errors.js'
import type { Context } from '../config.js'
import type { Evidence } from '../resolve/evidence.js'
import { isNonEmpty, unique } from '../utils.js'
import { askModel, describePlace, findJson, toListingMessage } from './helpers.js'

const MAX_QUERIES = 4

/**
 * Writes the instructions that tell the model how to propose search queries for a listing.
 */
function toSystemPrompt(context: Context): string {
  const language = context.model?.listingLanguage ?? 'the local language'
  const related = context.model?.relatedLanguages ?? []
  const relatedTitles =
    related.length === 0
      ? ''
      : `, then its ${related.join(' and ')} distributor title (TMDB usually holds one where it holds no ${language} title)`

  return `You find films in The Movie Database (TMDB) from listings that describe them.${describePlace(context)}
You are given one listing as its source printed it, in ${language}. Distributors translate titles freely, so the printed title may be a semantic translation of a title in any language.
Propose up to ${MAX_QUERIES} search queries that TMDB's title search would find the film under: the film's original-language title first, then its English title${relatedTitles}, then one alternative if useful. Prefer the exact title as released; do not add years or names to a query.
Digits are part of a title's identity and catalogues keep them as digits: if the printed title contains "3", every query you propose contains "3" as well, never "three" or its equivalent in any language (a printed "Kino 4" becomes "Cinema 4", not "Cinema Four").
Event relays (opera, ballet, concerts) are catalogued in TMDB under the venue's series name and season, in the form "<Series> <season>: <Work in English>", for example "Royal Ballet & Opera 2024/25: Swan Lake". A season runs from September to the following summer, so derive it from the screening date.
Never output any identifier, id, URL or number that is not part of a title. Answer with a JSON array of strings only, no prose.`
}

const queriesSchema = z.array(z.string())

/**
 * Reads the model's reply as a short list of distinct search queries, failing if it holds none.
 */
function toQueries(answer: string): string[] {
  const parsed = queriesSchema.safeParse(findJson(answer, /\[.*\]/su))

  if (!parsed.success) {
    throw new FilmLookupError('The model answered with no list of queries', 'model', { answer })
  }

  return unique(parsed.data.map((query) => query.trim()).filter(isNonEmpty)).slice(0, MAX_QUERIES)
}

/**
 * Asks the model what to search TMDB for to find a listing's film, never which film it is.
 */
export async function proposeSearchQueries(
  context: Context,
  rawTitles: string[],
  evidence: Evidence,
): Promise<string[]> {
  return toQueries(
    await askModel(
      context,
      toSystemPrompt(context),
      JSON.stringify(toListingMessage(rawTitles, evidence)),
    ),
  )
}
