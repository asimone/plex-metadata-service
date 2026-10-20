# plex-metadata-service

Plex's built-in agents now serve AI-rewritten summaries. This service is a set of Plex **Custom Metadata Providers** (Plex Media Server 1.43+) that supply human-written summaries instead: **TMDB** for movies, and **TVDB** for TV (in progress).

Each provider is the **primary** provider of its own Plex agent, with Plex's own agent underneath. Plex calls the service whenever it matches or refreshes an item, so all automation stays with Plex: new items, refreshes, whole-library updates. Plex's agent fills in everything this service leaves out: artwork, cast, ratings, genres.

| Provider | URL | Status |
|---|---|---|
| Movies | `http://<host>:3000/movie` | Ready |
| TV | `http://<host>:3000/tv` | Planned (Phase 6) |

## How it works

```
Plex agent "Movies (Simone)"
  1. Simone Movies   (this service, PRIMARY)  matching, title, dates, IDs, summary
  2. Plex Movie                               artwork, cast, ratings, genres, ...
  3. Plex Local Media (optional)              local posters/assets
```

- **Matching:** Plex sends title, year, filename and sometimes an ID hint. The service uses, in order:
  1. an ID hint from Plex (`tmdb://`, `imdb://`);
  2. ID tags in the filename, like `{tmdb-105}` or `{imdb-tt0088763}`;
  3. otherwise a TMDB search, ranked by exact title, year (±1 year) and popularity.

  Fix Match in Plex gets up to 10 ranked results, with posters.
- **Metadata:** for a matched movie it returns `ratingKey`, `guid`, title, original title, release date, year, external IDs (`imdb://`, `tmdb://`) and the **summary**: TMDB's, cleaned of HTML and source tags, or OMDb's (IMDb plot) when TMDB has none. If no source has a summary, the field is left out so Plex Movie fills it.
- **Nothing is ever added to the text.** Source credit lives only in this README.
- **Permanent IDs:**
  - provider identifier `tv.plex.agents.custom.simone.movie`
  - item keys `tmdb-movie-{tmdbId}`

  Changing these forces Plex to rematch everything.

## Requirements

- Plex Media Server **1.43 or newer** (Custom Metadata Providers)
- Docker, on a machine Plex can reach over the network (here: Tufte, `12.27.27.211`)
- A **TMDB** API key (movies). Optional: **OMDb** (movie summary fallback). **TVDB** is needed for TV once it's built.

## Deploy with Docker

On the Docker host:

```bash
mkdir -p ~/docker/plex-metadata && cd ~/docker/plex-metadata
# get the code here (git clone, or copy a checkout), then:
cp .env.example .env      # fill in TMDB_API_KEY (and OMDB_API_KEY / TVDB_API_KEY)
chmod 600 .env
docker compose up -d --build
docker ps --filter name=plex-metadata   # should show (healthy)
```

- The container listens on port **3000**, and keeps its cache in `./data` (SQLite).
- It runs as the non-root `node` user (UID 1000), so `./data` must be writable by UID 1000.
- It's labelled so Watchtower ignores it: the image is built locally, so there's nothing to pull.
- **Update:** pull or copy the new code, then `docker compose up -d --build`.
- **Logs:** `docker logs -f plex-metadata`, or Dozzle. Use `LOG_LEVEL=debug` to see every request Plex sends.

**Check that Plex can reach it** from inside the Plex container (on Tasha it's named `plex`):

```bash
docker exec plex curl -s http://12.27.27.211:3000/movie
```

You should get a `MediaProvider` JSON document.

## Set it up in Plex

Plex Web, signed in as the server owner. Menu names below are from PMS 1.43 and may differ slightly between versions.

1. **Add the provider:** *Settings → Metadata Agents → Add Provider*. Enter `http://12.27.27.211:3000/movie` and save. It shows up as **Simone Movies (TMDB, clean summaries)**.
2. **Create an agent:** *Add Agent*. Name it e.g. **Movies (Simone)**.
   - Set **Simone Movies** as the **primary** provider.
   - Add **Plex Movie** below it, to fill artwork, cast, ratings and so on.
   - Optionally add **Plex Local Media** for local posters.

   If the new agent doesn't appear in later menus, hard-refresh the page (Ctrl+F5). That's a known Plex Web quirk.
3. **Try it on a test library first:** *Add Library → Movies*, point it at the **same folders** as your real Movies library, and under *Advanced* choose the **Movies (Simone)** agent. Your real library is untouched.
4. **Check a few titles:** summaries should be TMDB's, while posters, cast and ratings come from Plex Movie. Try **Fix Match** on one to see the ranked results.
5. **Switch the real library** when you're happy: *Edit library → Advanced → Agent → Movies (Simone)*, then *Refresh All Metadata*. Every movie rematches once onto the new provider. Then delete the test library.

**Rollback:** set the library's agent back to **Plex Movie** and refresh. Nothing in your media folders is ever modified.

## API keys

| Key | Needed for | Required? |
|---|---|---|
| `TMDB_API_KEY` | Movie provider (matching, metadata, summaries) | **Yes** |
| `OMDB_API_KEY` | Movie summary fallback (IMDb plots) | Optional |
| `TVDB_API_KEY` | TV provider | **Yes, for TV** |
| `PLEX_TOKEN` | Only the optional CLI tools (below), not the providers | CLI only |

Keep keys in `.env` (git-ignored, `chmod 600` on the server). Never commit them.

### TMDB
1. Create an account at themoviedb.org and go to **Settings → API**. Request a key for personal use.
2. For "Application URL", this project's GitHub URL is fine. TMDB doesn't call it.
3. Copy the short **API Key (v3)**, not the long "API Read Access Token".

### OMDb (optional)
1. Request a free key at omdbapi.com. The free tier allows 1,000 requests a day; the service stops at `OMDB_DAILY_CAP`.
2. **Click the activation link in the email.** Until you do, OMDb returns `401`.

### TVDB
1. Register a project on TheTVDB's **API Information** page. Keys are per project, not from your user account page.
2. Copy the project's API key into `TVDB_API_KEY`. `TVDB_PIN` is only needed if your key type requires a subscriber PIN; a project key works without one.

### Plex token (CLI only)
In Plex Web, open any item → **⋯ → Get Info → View XML**. The URL of the new tab ends in `X-Plex-Token=…`. It grants full owner access, so treat it like a password.

## Configuration

All settings go in `.env`. See [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `TMDB_API_KEY` | — | Required for the movie provider |
| `OMDB_API_KEY` | — | Optional summary fallback |
| `OMDB_DAILY_CAP` | `900` | Stop calling OMDb after this many requests per UTC day |
| `TVDB_API_KEY`, `TVDB_PIN` | — | TV |
| `SUMMARY_LANGUAGE` | `en-US` | Default language when Plex doesn't send `X-Plex-Language` |
| `PORT` | `3000` | Port inside the container |
| `DATA_DIR` | `./data` (`/data` in Docker) | SQLite cache |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |
| `PLEX_URL`, `PLEX_TOKEN`, `PLEX_LIBRARIES`, `SYNC_*` | — | CLI tools only |

## Rate limits and caching

- TMDB details are cached for 7 days, searches for 1 day, and summary lookups for 30 days. Plex refreshing a whole library mostly hits the cache.
- On HTTP 429 the service waits as long as asked (`Retry-After`) and retries, up to 3 times. Network errors and 5xx responses are retried the same way.
- After 5 failures in a row, a source is paused for 60 seconds.
- If TMDB is down, matches and metadata return an error, and Plex retries on its next refresh. If only the summary sources fail, the summary is left out and Plex Movie's is used.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Plex can't add the provider | From the Plex container, run `curl http://<host>:3000/movie`. Check the host IP, port 3000 and firewalls |
| Wrong movie matched | Use **Fix Match** in Plex, or add `{tmdb-<id>}` to the folder name for a guaranteed match |
| A movie has Plex's summary, not TMDB's | TMDB has no overview for it, and OMDb had none either (or isn't configured) |
| `omdb: HTTP 401` in logs | Activate the OMDb key via the email link |
| Container not `healthy` | Run `docker logs plex-metadata`. A missing `TMDB_API_KEY` disables `/movie` |

## CLI tools (optional)

The repo also has a command-line tool that talks to Plex directly with `PLEX_TOKEN`. It's useful for checking what IDs and summaries Plex has, and for one-off fixes on libraries that don't use these providers.

```bash
npm install && npm run build
npm run cli -- libraries                 # libraries and their agents
npm run cli -- list --summary-only       # how many items carry tvdb/tmdb/imdb IDs
npm run cli -- show <ratingKey>          # Plex's summary vs each source's
npm run cli -- sync --item <ratingKey>   # dry run; add --write to write and lock it
npm run cli -- restore <ratingKey>       # undo: Plex's original back, unlocked
```

`sync` is a dry run unless you add `--write`. Plex's original text is backed up locally before any write. Whole-library writes also need `SYNC_WRITE=true`.

## Development

```bash
npm test                 # offline; all HTTP is mocked
npm run dev:server       # run the providers from source
npm run dev -- libraries # run the CLI from source
```

- Plex's provider spec: [docs/MediaProvider.md](docs/MediaProvider.md), [docs/Metadata.md](docs/Metadata.md), [docs/API Endpoints.md](docs/API%20Endpoints.md).
- Findings from the real server: [docs/PLEX-FINDINGS.md](docs/PLEX-FINDINGS.md).
- Plan: [PLAN.md](PLAN.md).

## Data sources and attribution

- TV metadata provided by [TheTVDB.com](https://thetvdb.com).
- This product uses the [TMDB](https://www.themoviedb.org) API but is not endorsed or certified by TMDB.
- Plot data from the [OMDb API](https://www.omdbapi.com).

## Credits

Built on Plex's [tmdb-example-provider](https://github.com/plexinc/tmdb-example-provider) (imported at `3348a89`, ISC): its provider spec, TypeScript, test and logging setup.

## License

MIT. See [LICENSE](LICENSE).
