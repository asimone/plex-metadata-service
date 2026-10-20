# Plex Summary Sync — Build Plan (rev. 5)

Hand-off plan for Claude Code. Build a small self-hosted service that replaces Plex's AI-rewritten summaries with **human-written ones** (TVDB for TV, TMDB/OMDb for movies), writes them into Plex through its API, and **locks** them so Plex's refreshes don't overwrite them.

**What changed from rev. 4:** the custom metadata provider is gone. Plex's own agents (Plex Movie / Plex Series) keep doing matching, artwork, cast, ratings and collections, which they do well. This service only fixes the one thing they do badly. It uses the same mechanism as a manual edit in Plex, and as tools like Kometa, which edits every field *except* summaries.

What that removes:
- matching risk, and rematching libraries
- the provider spec, new identifiers and ratingKeys
- agent setup, and the risk of mismatched metadata between providers

Kometa is deliberately left out for now. It can be added later for collections or overlays without conflicting, since it never touches summaries.

---

## 1. How it works

```
          ┌──────────── Plex (Tasha :32400) ────────────┐
          │  Plex Movie / Plex Series agents (unchanged) │
          │  match, art, cast, ratings, collections       │
          └───────▲─────────────────────────┬────────────┘
       write summary + lock     read items + external IDs
                  │                         │
          ┌───────┴─────── summary-sync (Tufte) ─────────┐
          │ for each item: external ID → source summary   │
          │ override YAML > sources in priority order     │
          │ SQLite: state, original backups, cache        │
          └───────┬───────────────┬───────────────┬──────┘
                TVDB            TMDB            OMDb
```

For each movie, show, season and episode:
1. Read the item from Plex with its `Guid` array (`imdb://`, `tmdb://`, `tvdb://`). Plex's agents already store these.
2. Resolve a summary: **override** → sources in configured order, **by ID only** → none.
3. If there's a summary and it differs from Plex's, back up Plex's current summary (first time only), write ours, and lock the field.
4. If there's no summary, leave Plex's untouched.

Looking up by ID removes the numbering problem for TV: episodes carry their own TVDB episode ID, so season and episode numbers never come into it.

---

## 2. Principle: leverage Plex

| Need | Who does it |
|---|---|
| Matching, Fix Match | Plex agents |
| Posters, backgrounds, cast, ratings, collections | Plex agents |
| One-off summary fix | You, in Plex. **Sync respects manual edits** (section 4) |
| Human-written summaries, kept fixed | **This service** |
| Applying our edits | Plex's own field lock, the same as a manual edit |

---

## 3. Scope

### v1
- **Movies and TV** (shows, seasons, episodes), since lookup by ID makes TV no harder than movies.
- Sources:
  - **TVDB** for TV.
  - **TMDB**, then **OMDb**, for movies.
  - **TMDB** as the TV fallback.
- Overrides in `config/overrides.yaml`.
- A CLI to sync (with dry run), inspect, override, and restore.
- A scheduled sync loop, SQLite state and cache, logging.
- Docker on Tufte.

### Later (not v1)
- Event-driven sync on "recently added", via a Tautulli notification or Plex webhook to a small HTTP endpoint.
- Taglines, if testing shows they're also rewritten.
- Kometa, for collections or overlays.

### Out of scope
- Every field other than `summary`.
- Any Plex agent or provider.
- *arr integration.
- A web UI.

---

## 4. Rules

**Source priority** (`config/sources.yaml`):

```yaml
movie:   [tmdb, omdb]   # OMDb = IMDb plot; swap the order to prefer IMDb
show:    [tvdb, tmdb]
season:  [tvdb, tmdb]
episode: [tvdb, tmdb]
```

**Ownership: never fight the user.**
- The service keeps a record for each item it writes: Plex ratingKey, the external ID used, the summary it wrote, the source, and when.
- If Plex's current summary is **locked and differs from what we last wrote**, a person edited it in Plex. Mark the item `user-owned` and never touch it again (unless `cli reclaim`).
- If an item's **GUID changes** (e.g. after Fix Match), discard the record and resolve again from the new ID.
- **Backups:** Plex's original summary is stored the first time we overwrite it. `cli restore` puts it back and unlocks the field, returning control to Plex.

**Overrides** (`config/overrides.yaml`) are keyed by external ID, so they survive Plex rematches and library rebuilds:

```yaml
"tmdb://105":
  summary: "Marty McFly, a 17-year-old..."
"tvdb://81189":
  pin: tmdb            # use this source for this item
"tmdb://603":
  skip: true           # leave Plex's summary alone
```
The file hot reloads. A bad file logs an error with the line number and keeps the last good version.

**Summary cleanup** (all sources): strip HTML and decode entities; strip trailing attributions like `(Source: …)` / `[Written by …]`; collapse whitespace. `N/A`, empty or whitespace-only means no value.

**Writes are cautious:**
- A first-time `sync` defaults to **dry run** until `SYNC_WRITE=true` is set.
- Writes are throttled: a configurable number per second.
- An item is skipped if its summary already matches.

---

## 5. Plex API (verify each in Phase 1)

| Purpose | Call |
|---|---|
| Libraries | `GET /library/sections` |
| Items with external IDs | `GET /library/sections/{id}/all?type={1\|2\|3\|4}&includeGuids=1` (paged with `X-Plex-Container-Start` / `-Size`) |
| Incremental sync | Same call filtered by `addedAt>>=` / `updatedAt>>=` the last run |
| Write and lock | `PUT /library/sections/{id}/all?type={n}&id={ratingKey}&summary.value=…&summary.locked=1` |
| Unlock (restore) | Same with `summary.locked=0` |

Auth uses `X-Plex-Token` (the server owner's token). Types: 1 movie, 2 show, 3 season, 4 episode.

**Questions Phase 1 answers on the real server:**
1. Do episodes and seasons from Plex Series carry `tvdb://` GUIDs? (Seasons may have only a show-level ID, in which case resolve the season through its show's TVDB ID and season number.)
2. Does the bulk `PUT` with `summary.locked=1` behave like a manual edit and survive Refresh Metadata?
3. Does `includeGuids=1` work on the bulk listing for every type?

---

## 6. Sources

- **TVDB v4:** log in with `TVDB_API_KEY` (plus `TVDB_PIN` if the key type needs it; **confirm the cost**). Cache the token and refresh it on 401. Use `/series/{id}`, `/seasons/{id}` and `/episodes/{id}` with English translations, falling back to the original-language overview.
- **TMDB:** use `/movie/{id}` and `/tv/{id}` (and season and episode endpoints when Plex provides a TMDB ID). Look up `imdb://` items via `/find`. Use the v3 API key.
- **OMDb (optional):** `?i={imdbId}&plot=full`. Daily cap `OMDB_DAILY_CAP` (default 900), reset at UTC midnight. If there's no key, it's disabled.
- **Always:** by ID only, never title search.
- **Resilience:** 8 s timeout. Retry up to 3 times with backoff and jitter on network errors, 429 (honor `Retry-After`) and 5xx. One circuit breaker per source. A source failure means "no value", and Plex's summary stays.
- **Cache** (SQLite): source responses for 30 days, "not found" for 7 days. Summaries are re-resolved when the cache expires, which picks up upstream edits.

---

## 7. CLI and service

The service is one container that runs a sync loop (`SYNC_INTERVAL`, default 1 hour; incremental, plus a full pass weekly). The CLI runs inside it: `docker exec plex-summary-sync node dist/cli.js <cmd>`.

| Command | Does |
|---|---|
| `sync [--dry-run] [--library X] [--item <ratingKey>] [--full]` | Run a sync now |
| `show <title\|ratingKey>` | Plex's current summary, each source's summary, the winner, and the item's state |
| `set <guid> "<text>"` / `pin <guid> <source>` / `skip <guid>` / `clear <guid>` | Edit `overrides.yaml` (comments preserved) |
| `restore <ratingKey\|--all>` | Put back Plex's original summary and unlock |
| `reclaim <ratingKey>` | Take back an item marked user-owned |
| `status` | Last run, counts (written / unchanged / no source / user-owned / errors), circuit states, OMDb budget |

**Logging** (winston): one `info` line per write (title, guid, source); a run summary at the end; `warn` on source failures and when an item is marked user-owned; `debug` with full details. View with `docker logs -f` or Dozzle.

---

## 8. Configuration

```
PLEX_URL=http://<tasha-ip>:32400
PLEX_TOKEN=
PLEX_LIBRARIES=Movies,TV Shows      # names or section IDs
TVDB_API_KEY=
TVDB_PIN=                           # if required
TMDB_API_KEY=                       # v3 "API Key"
OMDB_API_KEY=                       # optional
OMDB_DAILY_CAP=900
SYNC_WRITE=false                    # dry run until you flip this
SYNC_INTERVAL=1h
SYNC_WRITES_PER_SECOND=5
DATA_DIR=/data
SOURCES_CONFIG=/config/sources.yaml
OVERRIDES_FILE=/config/overrides.yaml
LOG_LEVEL=info
```

At startup, check that `PLEX_URL`, `PLEX_TOKEN` and at least one source key are set, and that the configured libraries exist. Fail fast with a clear message.

---

## 9. Phases

Each phase gets its own branch, `npm test` and `npm run build` before each commit, and small commits.

### Phase 0: Baseline ✅
Example provider imported with attribution, unused dependency removed. (Branch `phase-0-baseline`.)

### Phase 1: Skeleton and read-only Plex client
- Remove the example's provider code (routes, providers, Swagger, TV mapping). Keep the TS, jest and winston setup, and keep `TMDBClient` for Phase 2. Rename the package to `plex-summary-sync`.
- Config loading and validation, a Plex client (list libraries, page items with GUIDs), and a `sync --dry-run` that lists items and their external IDs without contacting any source.
- **Done when:** a dry run against Tasha lists every movie, show, season and episode with its GUIDs, and the section 5 questions 1 and 3 are answered in `docs/PLEX-FINDINGS.md`.

### Phase 2: Movie sync
- TMDB and OMDb adapters, cleanup, SQLite (state, backups, cache, budget), ownership rules, write and lock, throttling.
- **Done when:** unit tests cover resolution order, cleanup, ownership (user-owned detection, GUID change) and restore; `sync --item` on 3 real movies writes and locks; Refresh Metadata in Plex keeps our summary (section 5 question 2); and `restore` puts Plex's original back.

### Phase 3: TV sync
- TVDB adapter (auth, translations); shows, seasons and episodes; TMDB fallback by ID.
- **Done when:** `sync --item` on one show updates the show, its seasons and its episodes with TVDB text, and a dry run over the whole TV library shows sensible coverage counts.

### Phase 4: Overrides, CLI, sync loop
- Overrides YAML (hot reload, validation), all CLI commands, the scheduled loop (incremental plus weekly full pass), and `status`.
- **Done when:** `set`/`pin`/`skip`/`clear` take effect on the next sync, a manual edit in Plex is detected and left alone, and the loop runs unattended for a day.

### Phase 5: Docker, tests, docs, rollout
- Multi-stage Dockerfile (`node:22-slim`, non-root), compose for Tufte (`container_name: plex-summary-sync`, `restart: unless-stopped`, `/data` and `/config` volumes, env file). `nock` for all HTTP in tests; coverage of at least 80% on sources, resolution and state.
- README: what it does and doesn't do, getting the Plex token, setup, config, CLI, how to undo everything (`restore --all`), and credits.
- **Rollout:**
  1. Deploy with `SYNC_WRITE=false` and review the dry run.
  2. Enable writes for the Movies library.
  3. Spot-check in Plex.
  4. Enable TV.

  **Rollback:** `cli restore --all`, then stop the container.

---

## 10. Open items

- TVDB key cost and the PIN requirement.
- Movie source order: TMDB first (default) or OMDb/IMDb first. One line in `sources.yaml`; decide after comparing a sample in a dry run.
- Whether taglines also need fixing.

## 11. Working rules for Claude Code

- Before building anything, check whether Plex (or later, Kometa) already does it.
- Never write to Plex in tests. Real writes only via explicit `sync --item` during phase checks, or with `SYNC_WRITE=true`.
- New dependencies need a reason in the commit message. Expected: `better-sqlite3`, `yaml`, `nock` (dev).
- Ask before changing the ownership rules or the override key format.
