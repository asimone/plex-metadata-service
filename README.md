# plex-metadata-service

Custom metadata providers for Plex (Plex Media Server 1.43+) that replace Plex's AI-rewritten summaries with human-written ones. Plex's own agents still supply posters, cast, ratings and everything else.

| Provider | URL | Source |
|---|---|---|
| Movies | `http://<host>:3000/movie` | TMDB (OMDb as fallback) |
| TV | `http://<host>:3000/tv` | TVDB (coming soon) |

## Required API keys

| Key | Used for | Required |
|---|---|---|
| `TMDB_API_KEY` | Movies | Yes |
| `TVDB_API_KEY` | TV | Yes, for TV |
| `OMDB_API_KEY` | Movie summary fallback | Optional |

- **TMDB:** themoviedb.org → **Settings → API**. Request a personal-use key, then copy the short **API Key (v3)**.
- **TVDB:** register a project on TheTVDB's **API Information** page and copy its API key. Only set `TVDB_PIN` if your key type requires one.
- **OMDb:** request a free key at omdbapi.com, then **click the activation link in the email**.

## Install

On a Docker host that Plex can reach:

```bash
cd ~/docker/plex-metadata        # a checkout of this repo
cp .env.example .env             # add your API keys
chmod 600 .env
docker compose up -d --build
```

Check that it's running:

```bash
curl http://<host>:3000/movie
```

To update, copy in the new code and run `docker compose up -d --build` again.

## Set up in Plex

1. **Settings → Metadata Agents → Add Provider**, and enter `http://<host>:3000/movie`.
2. **Add Agent**, named e.g. *Movies (Simone)*:
   - primary provider: **Simone Movies**
   - below it: **Plex Movie**, then optionally **Plex Local Media**.

   If the new agent doesn't show up in menus, refresh the page with Ctrl+F5.
3. Open your Movies library and go to **Edit Library → Advanced → Agent → Movies (Simone)**, then save.
4. **Manage Library → Refresh All Metadata**.

**Fixing a wrong match:** use **Fix Match** in Plex. For a match that sticks, add `{tmdb-<id>}` or `{imdb-tt…}` to the movie's folder name. Radarr adds `{imdb-…}` by default.

**Undo:** set the library's agent back to **Plex Movie** and refresh. Your files are never changed.

## Configuration

Settings go in `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `TMDB_API_KEY`, `TVDB_API_KEY`, `OMDB_API_KEY` | — | See [Required API keys](#required-api-keys) |
| `SUMMARY_LANGUAGE` | `en-US` | Used when Plex doesn't send a language |
| `OMDB_DAILY_CAP` | `900` | Daily limit on OMDb calls |
| `LOG_LEVEL` | `info` | Set to `debug` to log every request from Plex |

Logs: `docker logs -f plex-metadata`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Plex can't add the provider | Make sure `curl http://<host>:3000/movie` works from the Plex machine |
| Wrong movie | Use **Fix Match**, or add `{tmdb-<id>}` to the folder name |
| Plex's summary still shows | TMDB (and OMDb) had no summary for that movie |
| `omdb: HTTP 401` in logs | Activate the OMDb key from the email |

## Command-line tools (optional)

The repo also has a CLI that talks to Plex directly. It needs `PLEX_URL` and `PLEX_TOKEN` in `.env`. Get the token in Plex Web: open any item → **⋯ → Get Info → View XML**, and copy `X-Plex-Token` from the URL.

```bash
npm install && npm run build
npm run cli -- libraries                       # list libraries and their agents
npm run cli -- show <ratingKey>                # compare Plex's summary with the sources
npm run cli -- sync --item <ratingKey> --write # write and lock one item's summary
npm run cli -- restore <ratingKey>             # undo
```

## Data sources

- TV metadata provided by [TheTVDB.com](https://thetvdb.com).
- This product uses the [TMDB](https://www.themoviedb.org) API but is not endorsed or certified by TMDB.
- Plot data from the [OMDb API](https://www.omdbapi.com).

## License

MIT. See [LICENSE](LICENSE). Built on Plex's [tmdb-example-provider](https://github.com/plexinc/tmdb-example-provider).
