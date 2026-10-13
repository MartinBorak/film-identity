import { FilmLookupError } from '../catalogues/errors.js'
import type { Context } from '../config.js'
import type { Evidence } from '../resolve/evidence.js'

/**
 * Builds what the model is told about a listing: its printed titles and the facts it stated.
 */
export function toListingMessage(rawTitles: string[], evidence: Evidence): object {
  return {
    printedTitles: rawTitles,
    statedOriginalTitles: evidence.originalTitles,
    statedProductionYears: evidence.productionYears,
    statedDirectors: evidence.directors,
    statedRuntimeMinutes: evidence.runtimesInMinutes,
    firstScreeningDate: evidence.firstScreeningDate,
  }
}

/**
 * Gives a prompt sentence saying where the listings come from, or nothing if no place is set.
 */
export function describePlace(context: Context): string {
  const place = context.model?.place

  return place == null ? '' : ` The listings come from ${place}.`
}

/**
 * Pulls the JSON answer out of a model's reply, which the model may wrap in prose.
 * Gives undefined where the pattern finds nothing or what it finds is not JSON, such as prose with
 * brackets of its own.
 */
export function findJson(answer: string, pattern: RegExp): unknown {
  const text = pattern.exec(answer)?.[0]

  if (text === undefined) {
    return undefined
  }

  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Sends one question to the caller's model and returns its reply.
 * Any failure is reported as the model's, so it costs one listing, not the run.
 */
export async function askModel(
  context: Context,
  systemPrompt: string,
  message: string,
): Promise<string> {
  if (context.model === null) {
    throw new FilmLookupError('No model configured', 'model')
  }

  try {
    return await context.model.ask(systemPrompt, message)
  } catch (error: unknown) {
    throw new FilmLookupError('The model did not answer', 'model', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}
