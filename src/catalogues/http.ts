import ky, { isHTTPError, isTimeoutError, SchemaValidationError, type ResponsePromise } from 'ky'
import { z } from 'zod'

import type { Context } from '../config.js'
import { FilmLookupError, type FilmLookupSource } from './errors.js'

const REQUEST_TIMEOUT_MS = 15_000

/**
 * Sends requests with a per-attempt timeout, so one silent host cannot stall the run.
 * Retries only GET after a server error or rate limit, since repeating another method may act
 * twice. A server's own retry delay is honoured but capped at the timeout.
 */
const client = ky.create({
  timeout: REQUEST_TIMEOUT_MS,
  retry: {
    limit: 2,
    methods: ['get'],
    statusCodes: [429, 500, 502, 503, 504],
    maxRetryAfter: REQUEST_TIMEOUT_MS,
  },
})

/**
 * Turns an error status, a timeout or an unexpected response shape into a FilmLookupError naming
 * the service; passes others on.
 */
function toLookupError(error: unknown, url: string, source: FilmLookupSource): unknown {
  if (error instanceof SchemaValidationError) {
    return new FilmLookupError('Response did not match the expected shape', source, {
      url,
      issues: z.prettifyError(error),
    })
  }

  if (isHTTPError(error)) {
    const status = error.response.status

    return new FilmLookupError(`Request failed with status ${status}`, source, { url, status })
  }

  if (isTimeoutError(error)) {
    return new FilmLookupError(`No response within ${REQUEST_TIMEOUT_MS}ms`, source, {
      url,
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
  }

  return error
}

/**
 * Sends a GET request with the configured user agent and reads its body.
 * Callers send requests one at a time, never in parallel, because every catalogue rate-limits.
 */
async function fetchBody<T>(
  context: Context,
  url: string,
  source: FilmLookupSource,
  headers: Record<string, string>,
  read: (response: ResponsePromise) => Promise<T>,
): Promise<T> {
  try {
    return await read(client.get(url, { headers: { ...headers, 'user-agent': context.userAgent } }))
  } catch (error: unknown) {
    throw toLookupError(error, url, source)
  }
}

/**
 * Fetches a URL and returns its JSON body, checked against the schema.
 */
export async function fetchJson<T>(
  context: Context,
  url: string,
  source: FilmLookupSource,
  schema: z.ZodType<T>,
  headers: Record<string, string> = {},
): Promise<T> {
  return fetchBody(context, url, source, headers, (response) => response.json(schema))
}

/**
 * Fetches a URL and returns the raw response body, such as a poster image.
 */
export async function fetchBytes(
  context: Context,
  url: string,
  source: FilmLookupSource,
): Promise<Uint8Array> {
  return fetchBody(
    context,
    url,
    source,
    {},
    async (response) => new Uint8Array(await response.arrayBuffer()),
  )
}
