# plex-metadata-service

Custom metadata providers for Plex (Plex Media Server 1.43+) that replace Plex's AI-rewritten summaries with human-written ones. Plex's own agents still supply posters, cast, ratings and everything else.

| Provider | URL | Source |
|---|---|---|
| Movies | `http://<host>:3000/movie` | TMDB (OMDb as fallback) |
| TV | `http://<host>:3000/tv` | TVDB (TMDB as fallback) |

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
curl http://<host>:3000/tv
```

Each returns a small JSON description of the provider. If `/tv` gives a 404, `TVDB_API_KEY` isn't set.

To update, copy in the new code and run `docker compose up -d --build` again.

## Set up in Plex

Plex needs two things for each library type:
- a **provider**: this service's URL;
- an **agent**: a named list of providers. This service goes first, as the *primary*, with Plex's own agent below it to fill in posters, cast and ratings.

Do this in Plex Web as the server owner.

### 1. Add the providers

1. **Settings** (wrench icon) → **Metadata Agents**.
2. **Add Provider** → `http://<host>:3000/movie` → save. It appears as **Simone Movies**.
3. **Add Provider** again → `http://<host>:3000/tv` → save. It appears as **Simone TV**.

### 2. Add the agents

On the same page:

| | Movies agent | TV agent |
|---|---|---|
| **Add Agent**, name | *Movies (Simone)* | *TV (Simone)* |
| Primary provider | **Simone Movies** | **Simone TV** |
| Then add, in order | **Plex Movie**, optionally **Plex Local Media** | **Plex Series**, optionally **Plex Local Media** |

Save each one. If a new agent doesn't show up in the library menus, refresh the page with Ctrl+F5.

### 3. Point a library at the agent

1. Hover over the library → **⋯ → Edit Library → Advanced**.
2. **Agent** → *Movies (Simone)* or *TV (Simone)* → **Save Changes**.

New items are matched by this service from then on. To update items already in the library, use **⋯ → Refresh Metadata** on one item, or **Manage Library → Refresh All Metadata** for everything.

**Tip:** to try it out first, add a second library that points at the same folders and uses the new agent. Delete it afterwards; your files aren't touched.

**Fixing a wrong match:** use **Fix Match** in Plex. For a match that sticks, put an ID tag in the folder name: `{tmdb-<id>}` or `{imdb-tt…}` for movies (Radarr adds `{imdb-…}` by default), and `{tvdb-<id>}` for shows (Sonarr can add it).

**Undo:** set the library's agent back to **Plex Movie** or **Plex Series** and refresh. Your files are never changed.

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
| Plex can't add the provider | Make sure `curl http://<host>:3000/movie` (or `/tv`) works from the Plex machine |
| Wrong movie or show | Use **Fix Match**, or add `{tmdb-<id>}` (movies) or `{tvdb-<id>}` (shows) to the folder name |
| Plex's summary still shows | None of the sources had an English summary for that item |
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
