import { z } from 'zod'

import { FilmLookupError } from '../catalogues/errors.js'
import {
  toCast,
  toDirectors,
  toKnownTitles,
  toReleaseYear,
  type TmdbMovie,
} from '../catalogues/tmdb.js'
import type { Context } from '../config.js'
import type { Evidence } from '../resolve/evidence.js'
import { askModel, describePlace, findJson, toListingMessage } from './helpers.js'

/**
 * Writes the instructions that tell the model how to pick a listing's film among search results.
 * The model picks only among candidates a search found, and identify.ts still requires the
 * listing's facts to corroborate the pick.
 */
function toSystemPrompt(context: Context): string {
  const language = context.model?.listingLanguage ?? 'the local language'

  return `You identify films in The Movie Database (TMDB) from listings that describe them.${describePlace(context)}
You are given one listing as its source printed it, in ${language}, and the catalogue entries a search found for it. Distributors translate titles freely, so the printed title may be a semantic translation of a title in any language.
Answer with the tmdbId of the entry the listing names, or null if none of them is it or two of them could be. A wrong id names the wrong film; null only costs a person a minute. Prefer null over a guess.
Answer with a JSON object of the form {"tmdbId": 123} or {"tmdbId": null} only, no prose.`
}

// Enough to tell namesakes apart, short enough that ten candidates fit beside the listing.
const TITLES_PER_CANDIDATE = 15
const CAST_PER_CANDIDATE = 5
const OVERVIEW_LENGTH = 300

export type SelectableCandidate = {
  tmdbId: number
  titles: string[]
  releaseYear: number | null
  originalLanguage: string
  directors: string[]
  cast: string[]
  runtimeMinutes: number | null
  overview: string
}

/**
 * Trims a catalogue film down to the facts the model needs to tell it apart from namesakes.
 */
export function toSelectableCandidate(movie: TmdbMovie): SelectableCandidate {
  return {
    tmdbId: movie.id,
    titles: toKnownTitles(movie).slice(0, TITLES_PER_CANDIDATE),
    releaseYear: toReleaseYear(movie.release_date),
    originalLanguage: movie.original_language,
    directors: toDirectors(movie),
    cast: toCast(movie).slice(0, CAST_PER_CANDIDATE),
    runtimeMinutes: movie.runtime,
    overview: movie.overview.slice(0, OVERVIEW_LENGTH),
  }
}

const answerSchema = z.object({ tmdbId: z.number().nullable() })

/**
 * Reads the chosen film id from the model's reply, ignoring any id that was not on offer.
 */
function toSelectedId(answer: string, candidates: SelectableCandidate[]): number | null {
  const parsed = answerSchema.safeParse(findJson(answer, /\{.*\}/su))

  if (!parsed.success) {
    throw new FilmLookupError('The model answered with no tmdbId', 'model', { answer })
  }

  // An id not on offer was named from memory, which this route forbids.
  return candidates.some((candidate) => candidate.tmdbId === parsed.data.tmdbId)
    ? parsed.data.tmdbId
    : null
}

/**
 * Asks the model which of the found films the listing names, or null if none clearly is.
 */
export async function selectFilmAmongCandidates(
  context: Context,
  rawTitles: string[],
  evidence: Evidence,
  candidates: SelectableCandidate[],
): Promise<number | null> {
  if (candidates.length === 0) {
    return null
  }

  const message = JSON.stringify({
    listing: {
      ...toListingMessage(rawTitles, evidence),
      synopses: evidence.synopses.map((synopsis) => synopsis.slice(0, OVERVIEW_LENGTH)),
    },
    candidates,
  })

  return toSelectedId(await askModel(context, toSystemPrompt(context), message), candidates)
}
