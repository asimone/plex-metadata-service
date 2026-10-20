# plex-summary-sync

Replaces Plex's AI-rewritten summaries with human-written ones (TVDB for TV, TMDB/OMDb for movies), writes them into Plex through its API, and locks them so refreshes don't overwrite them. Plex's own agents keep doing matching, artwork, cast, ratings and collections.

**Status:** in development. Phase 1 (read-only Plex client and dry-run listing) is in place; nothing writes to Plex yet. See [PLAN.md](PLAN.md) for the full plan.

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
npm run cli -- libraries                       # list the server's libraries
npm run cli -- sync --dry-run --summary-only   # per-library counts of external IDs
npm run cli -- sync --dry-run --library Movies # every item with its IDs
npm run cli -- sync --dry-run --json > items.jsonl
```

The dry run is read-only. It lists every movie, show, season and episode with the external IDs (`tvdb://`, `tmdb://`, `imdb://`) that Plex's agents stored, which are what summaries will be looked up by. It also flags summaries that are already locked or empty.

## Development

```bash
npm test
npm run dev -- libraries   # ts-node, no build step
```

## Credits

Started from Plex's [tmdb-example-provider](https://github.com/plexinc/tmdb-example-provider) (imported at `3348a89`, ISC). Its TMDB client is kept under `src/sources/tmdb/`; the provider code was removed when the project became a summary sync.

## License

MIT. See [LICENSE](LICENSE).
