# Plex Custom Metadata Provider — Build Plan (rev. 3)

Hand-off plan for Claude Code. Build a self-hosted Plex **Custom Metadata Provider** where each field (summary, ratings and so on) has its own source priority, so no single upstream controls the summary text: not Plex's aggregator, not IMDb, not anyone else.

**v1 is movies only.** TV comes in v2, built on TVDB (see section 13). Until then, TV libraries stay on Plex Series.

Work through the phases in order. Each phase ends with passing tests and a commit. Don't start a phase until the previous one meets its acceptance criteria.

**Changes from rev. 1:**
- v1 is movies only; TV moves to v2 on TVDB.
- A CLI plus logging replaces the admin web page.
- Overrides live in one YAML file.
- There's a new "leverage Plex" principle.
- Ratings are additive (each source contributes its own badge), and Metacritic is dropped.
- The example code is copied in rather than forked.

---

## 1. Context

**Problem.** Plex's built-in agents (Plex Series / Plex Movie) now serve low-quality, AI-rewritten summaries. The legacy single-source agents (TheTVDB, TMDB) are hidden as of PMS 1.43 and are being retired. Plex's supported replacement is the Custom Metadata Provider API (PMS 1.43.0+): an external HTTP service that Plex calls for matching and metadata.

**Starting point.** Plex's reference implementation, [`plexinc/tmdb-example-provider`](https://github.com/plexinc/tmdb-example-provider) (TypeScript, Express 5, axios, winston, jest). It is a TV-only demo against TMDB. Its routes, paging, response models and TMDB client carry over. Its TMDB **TV** code is removed, because TV will be built on TVDB in v2.

**Environment.**
- Plex Media Server 1.43.4 runs in Docker on host **Tasha** (Ubuntu 24.04).
- This provider runs in Docker on host **Tufte** (Debian, the primary Docker host).
- Tasha must be able to reach Tufte over the LAN. The service is **not** exposed through cloudflared or Nginx Proxy Manager.

**Read first.** Before writing code, read `docs/MediaProvider.md`, `docs/Metadata.md` and `docs/API Endpoints.md` in the example repo. They are the spec. Where this plan and the spec disagree, the spec wins; flag the conflict.

---

## 2. Principle: leverage Plex

Don't rebuild what Plex already does. Before adding a feature, check whether a Plex feature covers it.

| Need | Use Plex | The provider's role |
|---|---|---|
| Fix one item's summary or title | Edit in Plex. Plex locks the field and refreshes won't overwrite it | None |
| Pick a different poster or background | Plex's artwork picker | Serve every available image through `/images` so Plex has choices |
| Fix a wrong match | Plex's **Fix Match** | Return good ranked results for `manual=1` |
| Local posters, local metadata | Plex's local assets | None |
| Collections | Plex collections and smart collections | None |
| Apply changes | Plex **Refresh Metadata** | None. Provider changes take effect on the next refresh |

Provider-side overrides exist only for what Plex locks can't do: **pinning a source** (the text stays current instead of frozen), **surviving a rematch or library rebuild** (Plex locks don't), and applying to every library that uses the provider. The README says so.

---

## 3. Scope

### In scope (v1)
- **Movie provider** (type 1).
- Sources:
  - **TMDB**: structure, images, cast, summaries.
  - **OMDb**: IMDb and Rotten Tomatoes ratings, and a fallback plot.
  - **Overrides**: a YAML file.
- Per-field merge policy in a config file.
- SQLite cache, retries, circuit breaker, graceful fallback.
- **CLI** to compare sources and manage overrides, plus clear logging. **No web UI.**
- Docker image and compose file for Tufte.

### v2 (planned; see section 13)
- **TV provider on TVDB** (show / season / episode), with alternate episode orders.

### Out of scope. Design so these can be added later without a rewrite.
- TVmaze as an extra summary source.
- IMDb bulk datasets for ratings.
- Anime-specific handling (AniList, MAL, AniDB, Anime-Lists mapping).
- NFO files as a source.
- Collections (type 18). Plex handles these natively.
- Sonarr/Radarr integration. The service never talks to the *arr stack.
- Any admin web page.

---

## 4. Spec facts to honor

From the example repo's docs (movie-relevant subset; section 13 covers TV):

| Item | Rule |
|---|---|
| Provider identifier | Must start with `tv.plex.agents.custom.`. Suffix characters are limited to `[a-zA-Z0-9.]` |
| Separate providers | One provider per parent type. Movies get their own provider at `/movie` |
| Metadata type numbers | movie = 1 (show = 2, season = 3, episode = 4 for v2) |
| GUID format | `{scheme}://{type}/{ratingKey}`. The scheme equals the provider identifier |
| ratingKey chars | `[a-zA-Z0-9_-]` only |
| Required features | `metadata` (GET) and `match` (POST) |
| Recommended | `/library/metadata/:ratingKey/images` |
| `manual=1` on match | Return multiple results ordered by confidence. Otherwise return the best match only |
| `includeAdult` | Filter out adult results unless `1` |
| Localization | `X-Plex-Language` and `X-Plex-Country`, as header or query param |
| Status codes | 200 OK, 400 malformed, 404 unknown ratingKey (metadata only), 500 internal |
| External IDs | Include a `Guid` array (`imdb://`, `tmdb://`) on items |
| Rating badges | Only `imdb://image.rating`, `themoviedb://image.rating`, `rottentomatoes://image.rating.ripe` (critic), `rottentomatoes://image.rating.upright` (audience). Values are floats from 0 to 10. New badge types are not supported |

---

## 5. Fixed decisions

These are hard to change later. Do not deviate without asking.

**Identifiers (permanent).** Changing these forces Plex to rematch every item.
- Movie: `tv.plex.agents.custom.simone.movie`
- TV (reserved for v2): `tv.plex.agents.custom.simone.tv`

**ratingKeys (permanent).**
- Movie: `tmdb-movie-{id}`, e.g. `tmdb-movie-105`.
- The TV formats are fixed now, in section 13, even though TV ships in v2.

**Paths.** `/movie/...` exposes `GET /` (the provider definition), `/library/metadata/...` and `/library/metadata/matches`. `/tv` is reserved for v2 and not mounted in v1.

**Runtime.** Node 22, TypeScript strict. Production runs compiled JS (`node dist/server.js`), not ts-node.

**Housekeeping.**
- This repo is not a GitHub fork. Copy the example's code in as the first code commit and credit the source (commit hash and URL) in the commit message and README. The example has no LICENSE file; its `package.json` declares ISC, which is compatible with this repo's MIT license.
- Remove the unused `@anthropic-ai/claude-agent-sdk` dependency.
- Remove the example's TMDB TV code once the movie provider is in (Phase 2). Keep anything generic (paging, `Children` helpers, models) for v2.
- Keep Swagger at `/api-docs`, behind `ENABLE_API_DOCS` (default `true`).
- Never commit `.env` or the SQLite database.

---

## 6. Target architecture

```
Plex (Tasha) ──HTTP──▶ Provider service (Tufte)
                         ├─ /movie  Movie provider (type 1)   backbone: TMDB
                         ├─ Match layer    ID first (guid hint), title+year fallback
                         ├─ Merge layer    per-field source priority, overrides win
                         ├─ Source adapters
                         │    ├─ tmdb      (structure, images, cast, summary)
                         │    ├─ omdb      (IMDb/RT ratings + fallback plot, budgeted)
                         │    └─ override  (config/overrides.yaml, always wins)
                         ├─ Cache          SQLite, per-source TTL
                         └─ CLI            compare sources, manage overrides
```

The source adapters, merge engine, cache and CLI must not assume movies. v2 adds a TV provider and a `tvdb` adapter without changes to these layers.

### Proposed layout

```
src/
  app.ts, server.ts, cli.ts
  config/            env.ts, sources.ts (merge policy YAML)
  providers/         MovieProvider.ts
  routes/            movieRoutes.ts, shared/ (paging, headers, errors)
  sources/
    SourceAdapter.ts        interface
    tmdb/                   TMDBClient.ts (from example), TMDBMapper.ts
    omdb/                   OMDbClient.ts, OMDbMapper.ts
    override/               OverrideStore.ts (YAML, hot reload)
  merge/             MergeEngine.ts, policy.ts
  services/          MovieMatchService.ts, MovieMetadataService.ts
  cache/             Cache.ts (SQLite), budget.ts (OMDb daily counter), servedItems.ts
  resilience/        retry.ts, circuitBreaker.ts
  text/              cleanSummary.ts
  models/            Metadata.ts, MediaProvider.ts (from example)
  utils/             guid.ts, logger.ts
config/
  sources.example.yaml, overrides.example.yaml
test/
  unit/, contract/, fixtures/
```

---

## 7. Merge policy

Each field resolves through an ordered list of sources. The first source that returns a non-empty, valid value wins. `override` is always checked first, even if a list omits it.

`config/sources.yaml` (ship `sources.example.yaml`):

```yaml
movie:
  summary:        [override, tmdb, omdb]
  title:          [override, tmdb]
  tagline:        [tmdb]
  images:         [tmdb]
  cast:           [tmdb]
  genres:         [tmdb]
  contentRating:  [tmdb]
  ratings:        [omdb, tmdb]      # additive, see below
```

The file is keyed by provider type, so v2 adds a `tv:` block.

**Why OMDb is last for summaries.** OMDb's plot comes from IMDb, one of the suspected sources of the AI-rewritten text. It is a fallback, or something to pin per title.

**Ratings are additive, not first-wins.** The `Rating` array collects one entry per badge from every available source, in list order, without duplicates:
- IMDb: OMDb `imdbRating` → `imdb://image.rating`, `audience`.
- Rotten Tomatoes: OMDb `Ratings[Source="Rotten Tomatoes"]`, e.g. `87%` → `8.7`, `rottentomatoes://image.rating.ripe`, `critic`. Show it regardless of score. Plex has no "rotten" badge; note this in the README.
- TMDB: `vote_average` → `themoviedb://image.rating`, `audience`.
- Metacritic: dropped, since Plex has no badge for it.

**Rules.**
- Structure is never merged: ratingKeys, dates, duration and external IDs always come from TMDB.
- Cross-source lookups go by ID only (TMDB `external_ids` → IMDb ID). Never title-search a secondary source.
- A source failure (timeout, open circuit, exhausted budget, 4xx/5xx) means "no value"; move to the next source. Never return 500 when TMDB data is available.

---

## 8. Sources

### TMDB (backbone)
- Reuse the example's client. Add movie endpoints (`/movie/{id}` with `append_to_response=credits,images,release_dates,external_ids`).
- Matching: `tmdb://` hint by direct lookup, `imdb://` via `/find`, otherwise `/search/movie` with title and year.
- Handle HTTP 429 using `Retry-After`. Keep request logging under the existing env toggle.

### OMDb (ratings and fallback plot)
- Endpoint: `https://www.omdbapi.com/?apikey=...&i={imdbId}&plot=full`.
- Look up by IMDb ID only. Never title-search.
- **Budget:** keep a daily counter in SQLite with a configurable cap (`OMDB_DAILY_CAP`, default 900 for the free tier; raise it for paid tiers). At the cap, fall through to the next source. Reset at UTC midnight.
- Cache responses for 30 days and "not found" (`Response: "False"`) for 7 days.
- Optional. If `OMDB_API_KEY` is unset, the adapter is disabled and the service still works.

### Overrides (`config/overrides.yaml`)
- **The only override store.** It is edited by hand or through the CLI.
- Keyed by provider type and ratingKey, then field. Each value is either literal text or a pin:

  ```yaml
  movie:
    tmdb-movie-105:
      summary: { pin: omdb }
    tmdb-movie-603:
      summary: "A hacker learns..."
  ```
- **Hot reload:** watch the file and apply changes without a restart. On a parse or validation error, log it with the line number and keep the last good version.
- **Validation:** known provider types, a well-formed ratingKey for that type, known fields, known sources in pins.
- CLI edits use the `yaml` library's Document API so comments and ordering survive.
- Changes take effect on Plex's next refresh of that item.

### Summary cleanup (applied to every source's text)
- Strip HTML tags and decode entities.
- Strip trailing attributions like `(Source: Crunchyroll)` and `[Written by MAL Rewrite]`.
- Collapse whitespace. Treat `"N/A"`, empty and whitespace-only strings as no value.

---

## 9. Cache and resilience

- SQLite via `better-sqlite3`, file at `/data/provider.db`, WAL mode.
- Cache key: source + endpoint + params + language.
- TTLs (configurable): TMDB metadata 7 days, TMDB search 1 day, OMDb 30 days, OMDb not-found 7 days.
- `served_items` table: provider type, ratingKey, title, year, last served. It powers `cli search` and survives cache expiry.
- Retries: up to 3, with exponential backoff and jitter, only for network errors, 429 and 5xx.
- One circuit breaker per source: opens after 5 consecutive failures, goes half-open after 60 seconds.
- Outbound timeout: 8 seconds per request.
- `GET /health` returns status, uptime, cache size, per-source circuit state and the OMDb budget used today. It must stay fast and never call upstreams.

---

## 10. CLI and logging

There is no web UI. Run the CLI inside the container: `docker exec plex-provider node dist/cli.js <command>`.

| Command | Does |
|---|---|
| `search <title>` | Find items Plex has requested (from `served_items`) |
| `compare <ratingKey>` | Print every source's value for each overridable field, the winner, and the final text Plex receives |
| `pin <ratingKey> <field> <source>` | Pin a source for the field |
| `set <ratingKey> <field> "<text>"` | Write a literal override |
| `clear <ratingKey> [field]` | Remove the overrides for the item, or for one field |
| `overrides validate` | Validate `overrides.yaml` without the server running |
| `health` | Print `/health` |

`compare` fetches live, through the cache, so it shows what Plex would get right now. After changing an override, the CLI reminds you to refresh the item in Plex.

**Logging** (winston, JSON in production, readable in dev):
- `info`, one line per metadata or match request: provider, ratingKey, title, the winning source per field (e.g. `summary=tmdb ratings=omdb,tmdb`), cache hits vs upstream calls, duration.
- `warn`: a source failed and fell through, a circuit opened, the OMDb budget is exhausted, an overrides file was rejected.
- `debug`: full match request bodies (to answer the open questions in section 14) and upstream URLs (secrets redacted).
- Readable with `docker logs -f plex-provider` or Dozzle.

---

## 11. Configuration

`.env.example`:

```
TMDB_API_KEY=
OMDB_API_KEY=            # optional
OMDB_DAILY_CAP=900
PORT=3000
BASE_URL=http://<tufte-ip>:3000
DATA_DIR=/data
SOURCES_CONFIG=/config/sources.yaml
OVERRIDES_FILE=/config/overrides.yaml
ENABLE_API_DOCS=true
LOG_LEVEL=info
LOG_UPSTREAM_REQUESTS=true
```

Validate at startup: `TMDB_API_KEY` is required. The sources YAML must parse and reference only known sources and fields. The overrides YAML is validated, but a bad file only warns. Fail fast on anything required, with a clear message.

---

## 12. Phases (v1)

### Phase 0: Baseline
- Copy the example code in, with attribution. Install, build, and run the existing tests.
- Remove the unused dependency. Add `npm run start:prod` → `node dist/server.js`.
- **Done when:** `npm test` and `npm run build` pass on the imported code.

### Phase 1: Movie provider (TMDB)
- `MovieProvider.ts`: type 1 only, identifier `tv.plex.agents.custom.simone.movie`.
- Routes: `GET /movie`, `GET /movie/library/metadata/:ratingKey`, `GET /movie/library/metadata/:ratingKey/images`, `POST /movie/library/metadata/matches`.
- Matching per section 8. `manual=1` returns up to 10 ranked results; respect `includeAdult`.
- Full movie mapping: summary, tagline, studio, genres, country, cast and crew, content rating by `X-Plex-Country`, TMDB rating, every image, `Guid` array, duration.
- Move shared code (paging, header parsing, response wrapping, errors) into `routes/shared/`. Remove the example's TV routes and TMDB TV mapping, and unmount `/tv`.
- **Done when:** movie contract tests pass, and a manual match for "Back to the Future" (1985) and for `imdb://tt0088763` both return TMDB 105.

### Phase 2: Docker and deploy loop
- Multi-stage Dockerfile on `node:22-slim`. The build stage compiles TS; the runtime stage has production deps only and runs as a non-root user.
- `HEALTHCHECK` against `/health`. Volumes: `/data` (database) and `/config` (YAML).
- `docker-compose.yml` for Tufte with `restart: unless-stopped`, port 3000, an env file, both volumes, and `container_name: plex-provider`.
- **Done when:** the container builds and runs on Tufte, `/health` is green, and `/movie` returns the provider definition from inside another container on the same host.

### Phase 3: Cache and resilience
- Implement `Cache`, retry, circuit breaker, timeouts and `served_items`. Route all upstream calls through them.
- Extend `/health`.
- **Done when:** unit tests cover cache hit/miss/expiry, retry on 5xx and 429, no retry on 4xx, and breaker open/half-open/close; a second identical metadata request makes zero upstream calls.

### Phase 4: Merge engine and OMDb
- `SourceAdapter` interface: `getFields(item, fields, ctx) → Partial<FieldValues>`.
- `MergeEngine` applies the YAML policy per field, with additive ratings.
- OMDb client, mapper, budget, caching, and disable-when-no-key.
- `cleanSummary` on all summary text.
- **Done when:** unit tests prove priority order, fallthrough on failure and on empty values, the budget cutoff, rating conversion, and that output with OMDb disabled matches TMDB-only output.

### Phase 5: Overrides, CLI and logging
- `OverrideStore` (YAML, hot reload, validation), wired into the merge engine as the first source.
- The CLI and logging per section 10.
- **Done when:** `cli pin` / `cli set` changes the `summary` the metadata endpoint returns, `cli clear` reverts it, a hand edit to the YAML takes effect without a restart, and a broken YAML keeps the last good overrides.

### Phase 6: Test hardening
- Contract tests per endpoint against `docs/*.md`: required fields, GUID and ratingKey formats, the `Image` and `Rating` shapes, and the 400 and 404 cases.
- Mock all HTTP in tests (`nock`); no live calls in `npm test`.
- `npm run smoke` uses real keys against a few known movies and prints the merged results.
- **Done when:** `npm test` passes offline, and coverage on `merge/`, `sources/`, `cache/` and `resilience/` is at least 80%.

### Phase 7: Docs and rollout
- README: what it is, setup, env vars, merge config, the "leverage Plex" guidance (when to use Plex field locks vs overrides), CLI, Plex registration, troubleshooting, credits to the example repo, the v2 roadmap.
- `docs/ROLLOUT.md` with the procedure below.
- **Done when:** a new reader can deploy it from the README alone.

### Rollout procedure (for the README)
1. Give Tufte a DHCP reservation or static IP in pfSense first. Plex registers the provider by address, and an IP change silently breaks metadata.
2. Deploy with compose on Tufte. Confirm `curl http://<tufte-ip>:3000/movie` works **from Tasha**, including from inside the Plex container.
3. In Plex: Settings → Metadata Agents → Add Provider → `http://<tufte-ip>:3000/movie`.
4. Add an Agent, name it, and set the new provider as primary.
5. Create a **test Movie library** pointing at the same media folders, using the new agent. Leave the real library untouched.
6. Compare a sample of titles. Watch `docker logs -f plex-provider` during matching.
7. Pin or override summaries with the CLI where needed. Overrides survive the switch to the real library; Plex field locks made in the test library do not.
8. Once satisfied, switch the real Movie library's agent, refresh metadata, and delete the test library.

**Rollback:** switch the library agent back to Plex Movie and refresh. Nothing in the media folders is modified.

---

## 13. v2 roadmap: TV on TVDB

Not built in v1. These decisions are recorded now so v1 doesn't paint v2 into a corner.

**Why TVDB.** Sonarr names TV files using TVDB numbering, so a TVDB backbone matches episodes correctly where TMDB numbering differs (specials, split seasons, anime). TVDB also provides aired, DVD and absolute orders natively.

**Fixed now (permanent once shipped):**
- Identifier: `tv.plex.agents.custom.simone.tv`, at `/tv`.
- ratingKeys:

  | Type | Format | Example |
  |---|---|---|
  | Show | `tvdb-show-{seriesId}` | `tvdb-show-81189` |
  | Season | `tvdb-season-{seriesId}-{seasonType}-{number}` | `tvdb-season-81189-official-2` |
  | Episode | `tvdb-episode-{episodeId}` (TVDB's own episode ID) | `tvdb-episode-349232` |

  - `seasonType` is TVDB's season-type slug (`official`, `dvd`, `absolute`, …), lowercased and limited to `[a-z0-9]`.
  - Episodes are keyed by episode ID so watch history and overrides survive renumbering and order changes.
  - With no `episodeOrder`, an episode's parent season is in `official` (aired) order.

**Planned shape:**
- Merge policy: `summary: [override, tvdb, tmdb, omdb]`, `ratings: [omdb, tmdb]`.
- TMDB and OMDb are reached only through IDs from TVDB `remoteIds`. Per episode, they are used only when TVDB provides that episode's IMDb or TMDB ID; never fetch by season and episode number.
- Spec requirements: types 2, 3 and 4; `/children` and `/grandchildren` paging (default size 20, start 1); `includeChildren`; `episodeOrder` with the `SeasonType` array; episode match by `date`.
- Needs a TVDB v4 key, and possibly a subscriber PIN. Confirm the cost first.
- Rollout: a test TV library first, and confirm watch state survives the rematch from Plex Series.

---

## 14. Open questions to verify during the build

Check these against real Plex behavior and note the findings in the README:

- **Which hints Plex sends.** Log full match request bodies at `debug`. Confirm whether Plex includes `guid` hints such as `imdb://` for movies, and whether folder tags like `{tmdb-105}` / `{imdb-tt0088763}` arrive as `guid`.
- **Ratings display.** Confirm that the section 4 badge identifiers render in Plex for movies.
- **Exact provider URL Plex wants.** Confirm whether Plex is registered with the base (`/movie`) or the root URL, and adjust the README.
- **Combining providers.** Plex lets an agent list multiple providers. Check whether this provider could sit as a secondary behind Plex's own for selective fields, in keeping with "leverage Plex". Record findings only; don't build it.

---

## 15. Working rules for Claude Code

- Keep each phase in its own branch or commit series. Run `npm test` and `npm run build` before each commit.
- Prefer small, reviewable commits with clear messages.
- Don't add dependencies without a reason noted in the commit message. Expected additions: `better-sqlite3`, `yaml`, `nock` (dev). The CLI uses Node's built-in `util.parseArgs`; no CLI framework.
- Don't invent spec behavior. If the docs are silent, choose the simplest compliant option and note it.
- Before building a feature, check whether Plex already does it (section 2).
- Keep v1 simple: anything not needed for movies goes to section 13 or out of scope.
- Ask before changing the identifiers, ratingKey formats, or merge semantics.
