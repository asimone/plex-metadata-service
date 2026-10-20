# Plex Summary Provider — Build Plan (rev. 4)

Hand-off plan for Claude Code. Build a small, self-hosted Plex **Custom Metadata Provider** whose only job is to supply **human-written summaries**. Plex's own agents supply everything else.

**What changed from rev. 3:** Plex's new agent system already stacks providers and fills each missing field from the next provider down. So this project no longer rebuilds a full metadata agent. Plex Movie / Plex Series keep doing posters, cast, ratings, collections and Discovery. This provider only replaces the field that's broken: the AI-rewritten descriptions.
- Dropped as a result: OMDb (Plex Movie already shows IMDb and Rotten Tomatoes ratings), the images endpoint, cast and ratings mapping, the per-field merge engine, and the multi-source fallback chains.

---

## 1. Problem and approach

**Problem.** Plex Movie and Plex Series serve AI-rewritten, low-quality summaries. Their other metadata (matching, artwork, cast, ratings, collections) is fine.

**How Plex agents work now** (PMS 1.43+, per Plex's announcement and staff replies; see section 9 for sources):
- A **provider** is an HTTP service. An **agent** is an ordered list of providers that the user builds in Plex Settings → Metadata Agents.
- One provider in the agent is **primary** and does the matching. Plex then sends a `match` request to each other provider and stores the GUID each one returns. Later refreshes are plain `metadata` GETs.
- **Order sets priority.** Plex takes each field from the highest provider that supplies it, and lower providers fill whatever is left.
- The legacy agent system is being removed from new PMS releases in 2026.

**Approach.** Build a provider that returns only the required core fields plus `summary` and a `Guid` array of external IDs. Make it the **primary** provider of an agent, with Plex Movie / Plex Series below it. Our provider matches, our summary wins, and Plex fills the rest.

```
Agent "Movies (clean summaries)"
  1. Simone Summaries (this service)   PRIMARY: matching + summary
  2. Plex Movie                        everything else
  3. Plex Local Media (optional)       local artwork/assets
```

**Sources for summary text.** These have human-written, community-edited synopses:
- **Movies:** TMDB.
- **TV (v2):** TVDB first, then TMDB.
- **Overrides** in a local YAML file always win.

If no source has a summary, the provider **omits** the field and Plex fills it from its own agent. An imperfect summary beats a blank one; to blank a specific title instead, use an override.

---

## 2. Principle: leverage Plex

Don't rebuild what Plex already does.

| Need | Who does it |
|---|---|
| Matching, Fix Match results | **This provider** (it is primary; section 4) |
| Posters, backgrounds, artwork picker | Plex Movie / Series, Plex Local Media |
| Cast, crew, Discovery pages | Plex Movie / Series |
| IMDb / Rotten Tomatoes / TMDB ratings | Plex Movie / Series |
| Collections | Plex |
| One-off summary fix | Edit in Plex. Plex locks the field |
| **Summaries that persist and stay fixed** | **This provider** |

Provider overrides (section 6) exist only for what Plex field locks can't do: survive a rematch or library rebuild, and apply to every library that uses the provider.

---

## 3. Scope

### v1: movies
- Movie summary provider at `/movie` (type 1), with TMDB as the source.
- Overrides in `config/overrides.yaml`, plus a small CLI.
- SQLite cache, retry and timeouts.
- Logging that shows which source supplied each summary.
- Docker image and compose file for Tufte.

### v2: TV
- TV summary provider at `/tv` (types 2, 3, 4), with TVDB first and TMDB as fallback. Section 8 has the details.

### Out of scope
- Images, cast, ratings, genres, collections and every field other than `summary` (and `tagline`, if testing shows Plex's taglines are also rewritten).
- OMDb and IMDb plots (IMDb is a suspected source of the rewritten text).
- An admin web UI.
- Anime, NFO, and *arr integration.

---

## 4. Decided: this provider is primary

This provider is the agent's **primary**, and Plex Movie / Plex Series sit below it to fill the gaps.

**What that means:**
- **Matching is ours.** Plex sends the initial match and Fix Match (`manual=1`) to this provider. Match quality matters for everything, not just summaries, so Phase 1 puts real care into it: ID hints first, filename tags (`{tmdb-…}`, `{imdb-…}`), then title + year with good ranking.
- **Item GUIDs become ours** (`tv.plex.agents.custom.simone.movie://movie/tmdb-movie-{id}`). Switching a library to this agent rematches every item; Phase 2 confirms watch state survives.
- **Plex Movie matches separately.** Plex sends it its own match request (title, year, filename today; staff plan to add known external GUIDs). If it lands on a different movie than we did, the item gets mixed metadata, e.g. our summary with someone else's poster. Our `Guid` array (imdb/tmdb) is our best defense, and Phase 2 measures how often this happens.

**Known Plex issues to check in Phase 2:**
- A forum report (1.43.0) says some fields, `audienceRating` among them, don't fall back from a secondary Plex provider. Staff called it a known issue with no ETA. If the IMDb/RT badges go missing, the fix is to supply `Rating` ourselves (OMDb comes back in scope only for that).
- Another report (1.43.2) says Plex Series as a secondary provider didn't fetch season and episode titles or descriptions. That matters for v2 TV (section 8).
- An omitted field should fall through to lower providers. It's unconfirmed whether an empty string does too, so the provider must **omit**, never send `""`.

---

## 5. Spec facts to honor

From `docs/` (Plex's provider spec):

| Item | Rule |
|---|---|
| Identifier | `tv.plex.agents.custom.` prefix, suffix limited to `[a-zA-Z0-9.]` |
| Required Metadata fields | `ratingKey`, `key`, `guid`, `type`, `title`, `originallyAvailableAt` |
| GUID | `{identifier}://{type}/{ratingKey}`; ratingKey limited to `[a-zA-Z0-9_-]` |
| Required features | `metadata` (GET) and `match` (POST) |
| `manual=1` | Ranked list; otherwise the best match only |
| Status codes | 200, 400 malformed, 404 unknown ratingKey (metadata only), 500 internal |
| Localization | `X-Plex-Language` / `X-Plex-Country`, as header or query |
| External IDs | `Guid` array (`imdb://`, `tmdb://`, `tvdb://`) |
| Plex request timeout | About 90 s per staff (we target well under 8 s) |
| Match hints from Plex | title, year, filename and relative path today. Staff plan to also pass known external GUIDs; use them when present |

`/images`, `/children` and `/grandchildren` are recommended or required only for providers that serve those fields. v1 movies doesn't need them. v2 TV needs `/children` and `/grandchildren` (section 8).

---

## 6. Fixed decisions

Ask before changing any of these.

- **Identifiers (permanent):** movie `tv.plex.agents.custom.simone.movie`; TV (v2) `tv.plex.agents.custom.simone.tv`.
- **ratingKeys (permanent):** movie `tmdb-movie-{id}`. TV keys are in section 8.
- **Response contents:** required core fields, `year`, `Guid` array, `summary` (when available). Nothing else unless Phase 2 shows a reason.
- **Summary resolution:** `override` → configured sources in order → omit. Config file `config/sources.yaml`:

  ```yaml
  movie:
    summary: [tmdb]
  tv:                   # v2
    summary: [tvdb, tmdb]
  ```
- **Cleanup** on all summary text: strip HTML and decode entities, strip trailing attributions like `(Source: …)` / `[Written by …]`, collapse whitespace; `N/A`, empty or whitespace-only means no value.
- **Overrides (`config/overrides.yaml`)** are the only override store, edited by hand or through the CLI. They hot reload, and a bad file keeps the last good version and logs the error with its line number. A value is either literal text or a pin to a source:

  ```yaml
  movie:
    tmdb-movie-105:
      summary: "Marty McFly, a 17-year-old..."
    tmdb-movie-603:
      summary: { pin: tmdb }
  ```
  Overrides are keyed by **our** ratingKey, which is the item's GUID in Plex because this provider is primary.
- **Runtime:** Node 22, TypeScript strict, production runs `node dist/server.js`.
- **Housekeeping:** remove the example's TMDB TV code in Phase 1 (v2 rebuilds TV on TVDB). Keep Swagger behind `ENABLE_API_DOCS`. Never commit `.env` or the database.

---

## 7. v1 phases

### Phase 0: Baseline ✅
Example imported with attribution, unused dependency removed, `start:prod` added. Tests and build pass. (Branch `phase-0-baseline`.)

### Phase 1: Minimal movie summary provider
- `GET /movie`: provider definition (type 1 only).
- `POST /movie/library/metadata/matches`:
  - Use a `tmdb://` or `imdb://` hint when Plex sends one (`/movie/{id}`, `/find`).
  - Otherwise use title + year (`/search/movie`). Use `filename` to pull out the year or `{tmdb-…}` / `{imdb-…}` tags when no year is given.
  - `manual=1` returns up to 10 ranked results. Respect `includeAdult`.
- `GET /movie/library/metadata/:ratingKey`: required fields, `year`, `Guid` array, `summary`. Pick the summary language from `X-Plex-Language`, falling back to English.
- `cleanSummary`, plus overrides read from YAML (CLI comes in Phase 4).
- Log at `info`: one line per request with ratingKey, title and summary source (`override` / `tmdb` / `none`). Log full match bodies at `debug`.
- Remove the example's TV routes and mapping; unmount `/tv`.
- **Done when:** contract tests pass for match and metadata (required fields, GUID format, 400/404), a summary is omitted rather than empty when there's none, and "Back to the Future" (1985) plus `imdb://tt0088763` both match TMDB 105.

### Phase 2: Docker, deploy, and the Plex test
- Multi-stage Dockerfile (`node:22-slim`, non-root), `HEALTHCHECK` on `/health`, compose for Tufte (`container_name: plex-provider`, `restart: unless-stopped`, `/data` and `/config` volumes, env file).
- Register the provider in Plex on Tasha and create a **test Movie library** on the same folders. Then answer, and record in `docs/PLEX-FINDINGS.md`:
  1. With this provider as primary supplying only `summary`, do posters, cast, ratings (IMDb/RT badges), genres and collections all fill from Plex Movie?
  2. How often does Plex Movie match a different movie than we did? Compare on a sample, including remakes and same-title movies.
  3. Which match hints does Plex send to this provider (GUIDs? filename? year?).
  4. Does watch state survive switching the library onto this agent?
  5. Does a refresh pick up a changed override?
  6. Are Plex's taglines also rewritten? If so, add `tagline` to scope.
  7. The exact provider URL to register (`/movie` vs root).
- **Done when:** the container runs on Tufte, `/health` is green from Tasha's Plex container, and the findings doc answers all seven questions. **If gap-filling from Plex Movie doesn't work, stop and revisit this plan.**

### Phase 3: Cache and resilience
- SQLite (`better-sqlite3`, WAL) at `/data/provider.db`. Cache key: source + endpoint + params + language. TTLs: TMDB metadata 7 days, search 1 day.
- `served_items` table (ratingKey, title, year, last served) for CLI search.
- Retry up to 3 times with backoff and jitter on network errors, 429 (honor `Retry-After`) and 5xx. 8 s outbound timeout. One circuit breaker per source (5 failures to open, half-open after 60 s).
- On any source failure, omit `summary` and let Plex fill it. Return 500 only when the request can't be answered at all.
- `/health`: status, uptime, cache size, circuit states. Never calls upstreams.
- **Done when:** unit tests cover cache hit/miss/expiry, retry rules and breaker states, and a repeat metadata request makes zero upstream calls.

### Phase 4: CLI
Run with `docker exec plex-provider node dist/cli.js <cmd>`. Uses Node's `util.parseArgs`, with no CLI framework.

| Command | Does |
|---|---|
| `search <title>` | Find served items |
| `show <ratingKey>` | Each source's summary, the winner, and the final text |
| `set <ratingKey> "<text>"` | Literal summary override |
| `pin <ratingKey> <source>` | Pin a source |
| `clear <ratingKey>` | Remove the override |
| `overrides validate` | Check the YAML |

Edits go through the `yaml` library's Document API so comments survive. The CLI reminds you to refresh the item in Plex.
- **Done when:** `set` / `pin` / `clear` change and revert the metadata endpoint's summary, and a hand edit to the YAML applies without a restart.

### Phase 5: Tests, docs and rollout
- Offline test suite (`nock`). `npm run smoke` hits the live API for a few movies. Coverage of at least 80% on `sources/`, `cache/`, `resilience/` and `overrides/`.
- README: what it is and isn't, agent setup (a step-by-step walkthrough: this provider as primary, Plex Movie below), env vars, CLI, troubleshooting, the Phase 2 findings, and credits.
- **Rollout:** reserve Tufte's IP in pfSense → deploy → test library → compare a sample of titles → switch the real Movie library's agent → refresh → delete the test library. **Rollback:** switch the library back to Plex Movie and refresh.

---

## 8. v2: TV (outline)

Built after v1 is live and the Phase 2 findings are known.

- **This provider is primary for TV too**, so it must serve the full hierarchy on **TVDB**: show, seasons and episodes, `/children` and `/grandchildren` with paging, `includeChildren`, and episode match by `parentIndex`/`index` or `date`. Responses stay minimal (required fields, titles, indexes, dates, `Guid`, `summary`); Plex Series fills art, cast and ratings.
- TVDB numbering matches Sonarr's file naming, so episode matching lines up with your files.
- **Check first:** the 1.43.2 report that Plex Series as a secondary doesn't fetch season and episode details. Since we supply episode titles and summaries ourselves, the impact may be limited to episode thumbnails. Test before building.
- Alternate episode orders (DVD, absolute) are a later add-on, not part of v2's first cut.
- **ratingKeys (permanent):** `tvdb-show-{seriesId}`, `tvdb-season-{seriesId}-{seasonType}-{n}`, `tvdb-episode-{episodeId}`.
- **Needs:** a TVDB v4 API key (confirm whether a subscriber PIN or fee is required).
- TMDB and other secondary sources are reached only by ID from TVDB, never by season and episode number.

---

## 9. Sources for the Plex behavior above

- [Plex announcement: Custom Metadata Providers](https://forums.plex.tv/t/announcement-custom-metadata-providers/934384) and [page 2](https://forums.plex.tv/t/announcement-custom-metadata-providers/934384?page=2): staff explain the primary provider, priority order, gap-filling, and the 90 s timeout.
- [Secondary provider fallback not working](https://forums.plex.tv/t/metadata-agent-secondary-provider-fallback-not-working/936181): `audienceRating` doesn't fall back (a known issue).
- [Plex Series as secondary not fetching season/episode details](https://forums.plex.tv/t/plex-series-metadata-provider-not-fetching-season-episode-details-when-used-as-secondary-agent/939685).
- [Plex support: Agents](https://support.plex.tv/articles/200241558-agents/): ordering and per-field fallback.
- Some details come from community forum posts, not official docs. Phase 2 verifies them against the real server.

---

## 10. Configuration

`.env`:

```
TMDB_API_KEY=            # v3 "API Key"
PORT=3000
BASE_URL=http://<tufte-ip>:3000
DATA_DIR=/data
SOURCES_CONFIG=/config/sources.yaml
OVERRIDES_FILE=/config/overrides.yaml
ENABLE_API_DOCS=true
LOG_LEVEL=info
LOG_UPSTREAM_REQUESTS=true
# v2: TVDB_API_KEY=, TVDB_PIN=
```

Startup validation: `TMDB_API_KEY` is required. `sources.yaml` must reference only known sources. A bad overrides file warns but doesn't stop startup.

---

## 11. Working rules for Claude Code

- One branch per phase. Run `npm test` and `npm run build` before each commit; keep commits small.
- New dependencies need a reason in the commit message. Expected: `better-sqlite3`, `yaml`, `nock` (dev).
- Before building anything, ask whether Plex already does it (section 2). If the answer is "maybe", test it in Phase 2's test library first.
- Don't invent spec behavior. Where the docs are silent, choose the simplest compliant option and note it.
- Ask before changing identifiers, ratingKey formats, or summary resolution rules.
