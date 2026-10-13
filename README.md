# film-identity

Turn a cinema's printed listing into the film it names. Give it the title as printed, whatever else the cinema said (year, director, runtime, a blurb, a poster), and get back the film's TMDB, IMDb and Wikidata ids, or a refusal. It was extracted from [Kinomat](https://kinomat.sk), a Bratislava cinema programme, where it resolves thirteen cinemas' spellings of a title into one schedule.

The rule throughout: a wrong identity merges two films' schedules silently, an unmatched listing is a line in a report. So nothing is settled on a catalogue's ranking or a string's similarity. A tie stays a tie, a lone namesake the cinema's own facts contradict is refused, and a model may propose what to search for but never name a film from memory.

## Install

```sh
pnpm add film-identity
pnpm add sharp   # optional, only to compare posters
```

You need a TMDB API read access token from <https://www.themoviedb.org/settings/api>. A language model is optional and widens the search for listings no title reaches. Any provider works; the prompts were tuned on Claude Sonnet 5.

## Use

Create a resolver for the cinemas' market:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { createFilmResolver } from 'film-identity'

const anthropic = new Anthropic()

export const filmResolver = createFilmResolver({
  tmdb: { readAccessToken: process.env.TMDB_READ_ACCESS_TOKEN, language: 'sk-SK', region: 'SK' },
  wikidata: { languages: ['sk', 'cs', 'en'], idProperties: ['P2529'] },
  model: {
    ask: async (system, message) => {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: message }],
      })

      return response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')
    },
    listingLanguage: 'Slovak',
    relatedLanguages: ['Czech'],
    place: 'Bratislava',
  },
  userAgent: 'MyAggregator/1.0 (+https://example.org)',
  log: console.log,
})
```

Then resolve listings with it:

```ts
const match = await filmResolver.identify({
  titles: ['Spasenie'],
  screeningYear: 2026,
  productionYears: [2026],
  directors: ['Emin Alper'],
  runtimesInMinutes: [120],
})
// { evidence: 'title' | 'director' | 'poster' | 'model', film: { tmdbId, imdbId, ... } }
// or { evidence: 'unmatched', film: null }
```

A whole programme at once, where listings naming one film are resolved together:

```ts
const matches = await filmResolver.identifyAll(listings) // Map<printed title, FilmMatch>
```

Add the ids only Wikidata holds (its item, IMDb where TMDB lacked it, and the properties you configured):

```ts
const linked = await filmResolver.linkFilms(films)
linked[0].catalogueIds.P2529 // the ČSFD id, where Wikidata states one
```

Films no id reaches, typically new releases Wikidata describes before anyone states an id on them, can be paired by hand: pass a map from TMDB id to Wikidata item as the second argument, and that item is read instead of searching by title.

```ts
const linked = await filmResolver.linkFilms(films, new Map([[1671297, 'Q139495672']]))
```

`fetchFilmLinks` takes the same arguments and returns those ids alone, keyed by TMDB id; `fetchTmdbFilm` and `fetchWikidataFilm` fetch one film by an id a person settled on.

The configuration is per market (language, region, where the cinemas are), so a program covering several markets creates a resolver for each.

## How a listing is resolved

1. **Title.** Every form the printed title might name a film under, strongest first: the original title the cinema itself gave, the whole title, then the text after a strand prefix's colon or either side of a spaced dash, with bracketed labels dropped. Each is searched on TMDB. A film is taken when it is the only one answering to the title, spelling aside. Among namesakes, the year the cinema printed, the director it named and the people its blurb names narrow the set, and a lone namesake is still refused when the cinema's director or year contradicts it. A typo is accepted only one edit away (two on a long title), never across a numbering, and only with the release year corroborating it.
2. **Director.** Where no title reaches the film, the people do: every film the stated directors made, narrowed by the stated year and then the stated runtime, taken only when exactly one stands.
3. **Model and poster.** With a model configured, it proposes up to four search queries (the original title, the English one, a related language's). What they find goes through the same matcher. What no title settles is put to the poster: a 128-bit difference hash of the cinema's artwork against each candidate's TMDB posters, admitted only well within the measured gap between right and wrong. Last, the model picks among the candidates found, and the pick is admitted only where the cinema's own year, director or runtime stands behind it.

Every route refuses rather than guesses, and the `evidence` field says which one admitted the film so a person can audit the ones that need it.

## Configuration

| Option                  | Meaning                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmdb.language`         | The locale TMDB answers in. Picks the title returned, never what is searched.                                                                                                                                                                                                                                              |
| `tmdb.region`           | Whose release dates TMDB reports.                                                                                                                                                                                                                                                                                          |
| `posterLanguages`       | Poster languages likeliest to share artwork with the cinemas', tried first. Defaults to the Wikidata languages, then posters in no language.                                                                                                                                                                               |
| `wikidata.languages`    | Label languages a film is read under, likeliest first.                                                                                                                                                                                                                                                                     |
| `wikidata.idProperties` | Identifier properties to carry out, such as `P2529` for ČSFD or `P1265` for AlloCiné.                                                                                                                                                                                                                                      |
| `model`                 | Omit it and no model is asked. `ask` sends a system prompt and a message to your model and resolves to its text reply; leave room for thinking in its token limit. `listingLanguage` tells the model what it reads; `relatedLanguages` are ones whose titles TMDB often holds where it holds none in the listing language. |
| `userAgent`             | Required. How requests identify themselves; Wikidata asks that it name your project and how to reach you.                                                                                                                                                                                                                  |
| `log`                   | Where admissions no title reached are reported. Silent by default.                                                                                                                                                                                                                                                         |

Catalogue outages throw a `FilmLookupError` naming the source. A model or poster host failing costs that listing, not the run.

## Developing

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build
```

No test reaches the network: the catalogues are faked from saved real responses.
