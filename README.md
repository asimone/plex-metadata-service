# plex-metadata-service

A self-hosted Plex [Custom Metadata Provider](docs/MediaProvider.md) (PMS 1.43+) with per-field source priority, so no single upstream controls your summaries.

**Status:** in development. v1 is a movie provider (TMDB + OMDb, with local overrides). TV on TVDB is planned for v2. See [PLAN.md](PLAN.md) for the full build plan.

## Development

Requires Node 22+.

```bash
npm install
cp .env.example .env   # add your TMDB_API_KEY
npm run dev            # ts-node, for development
npm test
npm run build && npm run start:prod
```

The Plex provider spec this service implements is in [docs/](docs/).

## Credits

Built on Plex's reference implementation, [plexinc/tmdb-example-provider](https://github.com/plexinc/tmdb-example-provider) (imported at commit `3348a89`, declared ISC in its `package.json`). The spec documents in `docs/` come from that repository.

## License

MIT. See [LICENSE](LICENSE).
