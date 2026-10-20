# Plex Metadata Providers — Build Plan (rev. 6)

Two Plex **Custom Metadata Providers** that Plex calls itself: one for TV, one for movies. Each is the **primary** provider of its own Plex agent, with Plex's own agents below it to fill in everything we leave out. Plex handles all automation: matching new items, refreshes, and whole-library updates.

**What changed from rev. 5:** the standalone CLI sync (Phases 1–3) proved the sources, IDs, cleanup and Plex behavior. But it needs a person to run it. Plex should drive this instead, so the work returns to the provider model with a firm decision that **ours is primary**. The sources, cache, resilience and cleanup code carry over unchanged. The sync/CLI stays as a diagnostic tool.

---

## 1. How it fits into Plex

```
Agent "Movies (Simone)"                     Agent "TV (Simone)"
  1. Simone Movies  /movie  PRIMARY           1. Simone TV  /tv  PRIMARY
  2. Plex Movie             fills the rest    2. Plex Series      fills the rest
  3. Plex Local Media (optional)              3. Plex Local Media (optional)
```

- **Primary** means Plex sends us the **match** request for every new item and for Fix Match, and stores our GUID as the item's identity.
- On every refresh, Plex asks each provider for metadata. Per field, the highest provider that supplies a value wins.
- We return **what we're authoritative for**: identity, titles, dates, the hierarchy (TV), external IDs and **summaries**. We leave out artwork, cast, ratings and genres, so Plex Movie/Series fill them.
- Plex calls us over the LAN, so the service runs all the time, in Docker on Tufte.

## 2. Fixed decisions (ask before changing)

| | Movies | TV |
|---|---|---|
| Path | `/movie` | `/tv` |
| Identifier (permanent) | `tv.plex.agents.custom.simone.movie` | `tv.plex.agents.custom.simone.tv` |
| Types | 1 | 2, 3, 4 |
| Backbone (matching and structure) | TMDB | TVDB (aired order) |
| ratingKeys (permanent) | `tmdb-movie-{id}` | `tvdb-show-{id}`, `tvdb-season-{showId}-{n}`, `tvdb-episode-{episodeId}` |
| Summary sources | TMDB → OMDb | TVDB → TMDB |

- TV seasons use the aired-order season number. Alternate orders (DVD, absolute) are a later add-on, and would get their own season keys.
- Never put source attribution in text served to Plex. Credit goes only in the README.
- If no source has a summary, omit the field so Plex's agent fills it. Never send `""`.
- Look up by ID wherever Plex gives one. Title search is used only for matching when no ID hint exists.

## 3. Fields returned

**Every item:** `ratingKey`, `key`, `guid`, `type`, `title`, `originallyAvailableAt` (when known), `year`, `summary` (when available), and a `Guid` array (`imdb://`, `tmdb://`, `tvdb://`).

**TV adds:**
- `index`, plus parent/grandparent `ratingKey`, `guid`, `key` and `title`
- `Children` when `includeChildren=1`
- `/children` and `/grandchildren` endpoints with paging (default size 20, start 1)

**Match results also carry `thumb`,** so Fix Match shows posters. Metadata responses leave artwork to Plex.

Everything else (art, cast, ratings, genres, content rating, studio, duration) is omitted for Plex to fill. Fields can be added later if Plex's values turn out to be bad.

## 4. Phases

### Phase 4: Movie provider ✅
- An Express server with `GET /movie`, `POST /movie/library/metadata/matches` and `GET /movie/library/metadata/:ratingKey`.
- Matching:
  - `guid` hint (`tmdb://` direct, `imdb://` via `/find`), then filename tags `{tmdb-…}` / `{imdb-…}`;
  - otherwise `/search/movie` by title + year, ranked by exact title, year (±1) and popularity;
  - `manual=1` returns up to 10 results; respect `includeAdult`.
- Metadata from TMDB `/movie/{id}?append_to_response=external_ids`; the summary through the existing TMDB → OMDb resolution and cleanup.
- Log one line per request: path, ratingKey or title, and result.
- **Done when:** contract tests pass (required fields, GUID format, 400/404), and "Back to the Future" (1985) plus `imdb://tt0088763` both match `tmdb-movie-105`.

### Phase 5: Docker on Tufte and a Plex test library ✅ (movies; real library switching 2026-10-20)
- A multi-stage Dockerfile (`node:22-slim`, non-root) with `HEALTHCHECK /health`, and compose for Tufte (port 3000, `/data` volume, env file, `restart: unless-stopped`).
- Register `http://<tufte-ip>:3000/movie` in Plex and create a "Movies (Simone)" agent as described in section 1. Point a **test Movie library** at the same folders.
- Record in `docs/PLEX-FINDINGS.md`:
  - which match hints Plex sends;
  - match accuracy on a sample;
  - whether art, cast and ratings fill from Plex Movie;
  - whether watch state survives;
  - the exact URL format Plex wants.
- **Done when:** the test library looks right and the findings are recorded.

### Phase 6: TV provider ✅
- `GET /tv` declaring types 2, 3 and 4. Matching for shows (`tvdb://` hint, then TVDB search by title + year), seasons (show + index) and episodes (show + `parentIndex`/`index`, or air `date`).
- Metadata for show, season and episode from TVDB extended records plus translations. `includeChildren`, `/children` and `/grandchildren` with paging.
- **Done when:** contract tests pass, and a test TV library matches and displays correctly, with art, cast and ratings filled by Plex Series.

### Phase 7: Rollout and docs
- Switch the real libraries to the new agents one at a time and refresh. **Rollback:** switch back to Plex Movie / Plex Series.
- README: agent setup walkthrough, Docker, troubleshooting.

## 5. What carries over from Phases 1–3
- `sources/` (TVDB, TMDB, OMDb), `resilience/` (retries, circuit breaker), `store/` (SQLite cache), `text/cleanSummary`.
- The CLI (`list`, `show`, `sync`, `restore`) stays as a diagnostic and manual tool. It isn't needed once the providers are live.

## 6. Working rules
- One branch per phase. Run `npm test` and `npm run build` before each commit.
- No live API calls in `npm test`; all HTTP is mocked with `nock`.
- The spec lives in `docs/` (`MediaProvider.md`, `Metadata.md`, `API Endpoints.md`). Where the spec and this plan disagree, the spec wins; flag it.
