# plex-summary-sync

Replaces Plex's AI-rewritten summaries with human-written ones (TVDB for TV, TMDB/OMDb for movies), writes them into Plex through its API, and locks them so refreshes don't overwrite them. Plex's own agents keep doing matching, artwork, cast, ratings and collections.

**Status:** in development. Movie sync (Phase 2) works: dry run by default, writes on request. TV comes in Phase 3. See [PLAN.md](PLAN.md).

## Setup

Requires Node 22+.

```bash
npm install
cp .env.example .env   # fill in PLEX_URL and PLEX_TOKEN
npm run build
```

### Getting your Plex token

In Plex Web, open any item → **⋯ → Get Info → View XML**. The URL of the page that opens ends in `X-Plex-Token=…`; copy that value into `PLEX_TOKEN`. Use the server owner's account. Treat the token like a password.

## Usage

```bash
npm run cli -- libraries                      # list the server's libraries
npm run cli -- list --summary-only            # external-ID coverage per library (read-only)
npm run cli -- sync                           # DRY RUN: which summaries would change
npm run cli -- sync --all --full              # every item, full text
npm run cli -- show <ratingKey>               # Plex's summary vs each source, and the decision
npm run cli -- sync --item <ratingKey> --write   # write one item
npm run cli -- restore <ratingKey>            # put Plex's original back and unlock
```

**How a sync decides, per item:**
- Look up a summary by ID: TMDB (`tmdb://`, or `imdb://` via /find), then OMDb (`imdb://`). Never by title.
- If it differs from Plex's, write it and **lock** the field (the same as editing it in Plex). If it's the same, just lock it.
- If no source has one, leave Plex's alone.
- If a summary is locked and isn't what this tool last wrote, someone edited it in Plex: it's left alone for good.
- Plex's original text is saved locally (`DATA_DIR`) before the first write, so `restore` (or `restore --all`) undoes everything.

**Writes are opt-in:** `sync` is a dry run unless you add `--write`. Whole-library writes also need `SYNC_WRITE=true` in `.env`; single items (`--item`) don't.

## Development

```bash
npm test
npm run dev -- libraries   # ts-node, no build step
```

## Data sources and attribution

- TV metadata provided by [TheTVDB.com](https://thetvdb.com).
- This product uses the [TMDB](https://www.themoviedb.org) API but is not endorsed or certified by TMDB.
- Plot data from the [OMDb API](https://www.omdbapi.com).

## Credits

Started from Plex's [tmdb-example-provider](https://github.com/plexinc/tmdb-example-provider) (imported at `3348a89`, ISC). Its TypeScript, test and logging setup carried over; the provider code was removed when the project became a summary sync.

## License

MIT. See [LICENSE](LICENSE).
