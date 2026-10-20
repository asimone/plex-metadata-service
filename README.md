# plex-summary-sync

Plex's built-in agents now serve AI-rewritten summaries. This tool replaces them with human-written ones (TVDB for TV, TMDB for movies) and **locks** them so Plex's refreshes don't overwrite them.

Everything else stays with Plex: matching, artwork, cast, ratings and collections. The tool only touches the summary field, and only when you ask it to.

## How it works

1. It reads an item from Plex, including the external IDs Plex's agents already stored (`tvdb://`, `tmdb://`, `imdb://`).
2. It looks up the summary **by ID**, never by title:
   - **TV** (shows, seasons, episodes): TVDB using the item's own `tvdb://` ID, then TMDB.
   - **Movies:** TMDB (`tmdb://`, or `imdb://` via TMDB's find), then OMDb (`imdb://`).
3. If the summary differs from Plex's, it writes it and locks the field, just like editing it by hand in Plex. If it's the same, it only locks it.
4. If no source has a summary, Plex's stays as it is.

**Safety:**
- `sync` is a **dry run** unless you add `--write`.
- Plex's original text is saved locally before the first write. `restore` puts it back and unlocks the field.
- A summary you edited yourself in Plex (locked, and not what this tool wrote) is **never touched**.
- Nothing is ever added to the text. Source credit lives only in this README.

## Requirements

- Node 22 or newer
- Plex Media Server (tested on 1.43), with libraries using the **Plex Movie** / **Plex Series** agents
- The API keys below

## Plex integration

The tool talks to Plex Media Server's own HTTP API, the same one Plex Web uses, with your token. It runs on its own, outside Plex: nothing is installed into Plex, no custom agent or metadata provider is registered, and no server settings change.

**What it calls:**

| Call | Purpose |
|---|---|
| `GET /library/sections` | List libraries and their agents |
| `GET /library/sections/{id}/all?type=…&includeGuids=1` | Page through a library's items with their external IDs |
| `GET /library/metadata/{ratingKey}?includeGuids=1` | Read one item (`show`, `sync --item`) |
| `GET /library/metadata/{ratingKey}/children`, `/allLeaves` | A show's seasons and episodes |
| `PUT /library/sections/{id}/all?type=…&id={ratingKey}&summary.value=…&summary.locked=1` | **The only write:** set and lock the summary, the same edit as Plex's Edit dialog. `restore` sends the original with `summary.locked=0` |

The token travels in the `X-Plex-Token` header and is never logged.

### Plex setup

Check these:

1. **Agents:** each library should use Plex's current agents: **Plex Movie** for movies, **Plex Series** for TV. That's where the IDs come from.
   - Check with `npm run cli -- libraries`. Each library's agent is shown in brackets, e.g. `[tv.plex.agents.series]`.
   - Then `npm run cli -- list --summary-only` shows how many items carry `tvdb`/`tmdb`/`imdb` IDs.
2. **Older shows on the legacy TheTVDB agent:** some shows may still be matched by it (`com.plexapp.agents.thetvdb`), so they have no IDs to look up. In Plex, open the show and run **Refresh Metadata** (or **Fix Match**) under the library's Plex Series agent. Afterwards, `list` shows `tvdb://` IDs for it.
3. **Network:** the machine running this tool must reach Plex directly, e.g. `http://<plex-ip>:32400`. Remote Access isn't needed.
   - If **Settings → Network → Secure connections** is set to *Required*, plain `http://` is refused. Either set it to *Preferred*, or use the server's `https://…plex.direct:32400` address.
4. **Token:** use the **server owner's** token. A shared or managed user can't edit metadata.

**How this looks inside Plex:**
- A written summary shows a **lock icon** next to *Summary* in the item's **Edit** dialog. Plex leaves locked fields alone during **Refresh Metadata** and **Refresh All Metadata**. That was tested on the real server.
- To take over a summary yourself, just edit it in Plex. The tool sees that it was changed by a person and never touches it again.
- To hand a summary back to Plex's agent, run `restore <ratingKey>` for anything this tool wrote. For anything else, click the lock icon in **Edit** to unlock it.
- **Fix Match** changes the item's ID. The next sync of that item notices and looks up the new match's summary, keeping your original backup.

## API keys

| Key | Needed for | Required? |
|---|---|---|
| `PLEX_TOKEN` | Reading and writing Plex | **Yes** |
| `TVDB_API_KEY` | TV summaries | **Yes, for TV** |
| `TMDB_API_KEY` | Movie summaries, and TV fallback | **Yes, for movies** (recommended for TV) |
| `OMDB_API_KEY` | Movie fallback (IMDb plots) | Optional |

Keep every key in `.env` (git-ignored). Never commit them.

### Plex token
1. Open Plex Web as the **server owner** and go to any movie or episode.
2. Click **⋯ → Get Info → View XML**.
3. The URL of the new tab ends in `X-Plex-Token=…`. Copy that value.

Alternatively, on the Plex host: `PlexOnlineToken` in `Preferences.xml`, inside the Plex data folder.

The token grants full owner access (Plex has no read-only tokens), so treat it like a password. **Sign out of all devices** in your Plex account settings revokes it.

### TVDB
1. Register a project on TheTVDB's **API Information** page. Keys are per project, not from your user account page.
2. Copy the project's API key into `TVDB_API_KEY`.
3. `TVDB_PIN` is only needed if your key type requires a subscriber PIN. A project key works without one.

TVDB's terms require attribution. For command-line tools, the README is enough; see [Data sources](#data-sources-and-attribution).

### TMDB
1. Create an account at themoviedb.org and go to **Settings → API**. Request a key for personal use.
2. For "Application URL", this project's GitHub URL is fine. TMDB doesn't call it.
3. Copy the short **API Key (v3)**, not the long "API Read Access Token".

### OMDb (optional)
1. Request a free key at omdbapi.com. The free tier allows 1,000 requests a day; the tool stops at `OMDB_DAILY_CAP`.
2. **Click the activation link in the email.** Until you do, OMDb returns `401`.

## Setup

```bash
npm install
cp .env.example .env     # then fill in PLEX_URL, PLEX_TOKEN and your keys
npm run build
npm run cli -- libraries # checks Plex is reachable and the token works
```

## Usage

Fix one show or movie at a time, when you notice a bad summary:

```bash
# 1. Find the item's ratingKey: open it in Plex Web; the URL contains .../metadata/<ratingKey>
# 2. Compare Plex's summary with each source's
npm run cli -- show <ratingKey>

# 3. Preview, then write. For a show, this includes its seasons and episodes.
npm run cli -- sync --item <ratingKey>
npm run cli -- sync --item <ratingKey> --write

# Undo: put Plex's original back and unlock it
npm run cli -- restore <ratingKey>
```

There's no need to refresh in Plex afterwards. The change is visible right away and survives future refreshes.

### All commands

| Command | Does |
|---|---|
| `libraries` | Lists Plex libraries and their agents |
| `list [--library X] [--summary-only] [--json]` | Lists items and their external IDs (read-only) |
| `show <ratingKey>` | Plex's summary next to every source's, and what sync would do |
| `sync [--item <ratingKey>]... [--library X] [--all] [--full] [--write]` | Dry run by default. `--all` lists unchanged items too; `--full` prints full text |
| `restore <ratingKey>... \| --all` | Puts back Plex's original summaries and unlocks them |

**Whole-library runs** (`sync --library X --write`) are possible but not needed day to day. They also require `SYNC_WRITE=true` in `.env`, as a safety catch. Without `--write`, a library sync is a handy read-only report: about 46 seconds for ~900 movies on a cold cache.

### What the actions mean

| Action | Meaning |
|---|---|
| `write` | The source's summary differs from Plex's. It gets written and locked |
| `lock` | Plex already shows the source's text. It only gets locked |
| `unchanged` | Already written and locked by this tool |
| `user-owned` | Edited in Plex by a person. Left alone for good |
| `no-source` | No source has a summary (or no usable ID). Plex's stays |

## Configuration

All settings go in `.env`. See [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `PLEX_URL` | — | e.g. `http://192.168.1.10:32400` |
| `PLEX_TOKEN` | — | See [Plex token](#plex-token) |
| `PLEX_LIBRARIES` | all movie/TV libraries | Comma-separated names or section IDs, for library-wide runs |
| `TVDB_API_KEY`, `TVDB_PIN` | — | See [TVDB](#tvdb) |
| `TMDB_API_KEY` | — | See [TMDB](#tmdb) |
| `OMDB_API_KEY` | — | Optional. See [OMDb](#omdb-optional) |
| `OMDB_DAILY_CAP` | `900` | Stop calling OMDb after this many requests per UTC day |
| `SUMMARY_LANGUAGE` | `en-US` | Language of summaries. If a source has none in this language, it's treated as having none |
| `SYNC_WRITE` | `false` | Allows whole-library writes. Single `--item` writes don't need it |
| `SYNC_WRITES_PER_SECOND` | `5` | Spacing of writes to Plex |
| `SYNC_CONCURRENCY` | `4` | Source lookups in parallel |
| `DATA_DIR` | `./data` | Local SQLite database: cache, backups of Plex's originals, TVDB login |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |

## Rate limits and caching

- Source responses are cached for 30 days ("not found" for 7), so repeat runs barely touch the APIs.
- When a service says to slow down (HTTP 429), the tool waits as long as asked and retries, up to 3 times. Network errors and 5xx responses are retried the same way.
- After 5 failures in a row, a source is paused for 60 seconds.
- Any failed lookup just leaves Plex's summary in place. The next run tries again.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Plex rejected the token (401)` | Get a fresh `PLEX_TOKEN` from the server owner's account |
| `Could not reach Plex` | Check `PLEX_URL`, including the port (usually `32400`) |
| `omdb: HTTP 401` | Activate the OMDb key via the email link |
| `tvdb: HTTP 401` | Check `TVDB_API_KEY`, or set `TVDB_PIN` if your key type needs one |
| A show says `no usable ID` | It's still matched by the legacy TheTVDB agent, or it's unmatched. **Refresh Metadata** (or **Fix Match**) in Plex under Plex Series gives it IDs |
| A season shows `no-source` | Common: most seasons have no summary on TVDB or TMDB |
| I edited a summary in Plex and want the tool to manage it again | `restore <ratingKey>` won't help (the tool never wrote it). Unlock the summary in Plex's **Edit** dialog, then sync the item |

## Development

```bash
npm test                     # offline; all HTTP is mocked
npm run dev -- libraries     # run from source with ts-node
```

Findings from testing against a real server are in [docs/PLEX-FINDINGS.md](docs/PLEX-FINDINGS.md). The build plan is in [PLAN.md](PLAN.md).

## Data sources and attribution

- TV metadata provided by [TheTVDB.com](https://thetvdb.com).
- This product uses the [TMDB](https://www.themoviedb.org) API but is not endorsed or certified by TMDB.
- Plot data from the [OMDb API](https://www.omdbapi.com).

## Credits

Started from Plex's [tmdb-example-provider](https://github.com/plexinc/tmdb-example-provider) (imported at `3348a89`, ISC). Its TypeScript, test and logging setup carried over; the provider code was removed when the project became a summary sync.

## License

MIT. See [LICENSE](LICENSE).
