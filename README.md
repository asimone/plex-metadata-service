# plex-metadata-service

Custom metadata providers for Plex (Plex Media Server 1.43+) that replace Plex's AI-rewritten summaries with human-written ones. Each provider is named after its source:

| Provider name in Plex | URL | Library type | Source |
|---|---|---|---|
| **TMDB Movies** | `http://<host>:3000/movie` | Movies | TMDB (OMDb as a summary fallback) |
| **TVDB TV Shows** | `http://<host>:3000/tv` | TV Shows | TVDB, in aired order (TMDB as a summary fallback) |

Each provider is the **primary** source of its own Plex agent. It matches your files and supplies titles, dates, numbering, IDs and summaries. Plex's own agent sits underneath and fills in everything else: posters, cast, ratings, genres. Plex calls the service on its own whenever it matches or refreshes something, so there's nothing to schedule.

## Contents

1. [Required API keys](#1-required-api-keys)
2. [Deploy with Docker](#2-deploy-with-docker)
3. [Add it to Plex](#3-add-it-to-plex)
4. [Configuration](#4-configuration)
5. [Troubleshooting](#5-troubleshooting)
6. [Command-line tools (optional)](#6-command-line-tools-optional)

## 1. Required API keys

| Key | Used for | Required |
|---|---|---|
| `TMDB_API_KEY` | TMDB Movies provider; TV summary fallback | Yes, for movies |
| `TVDB_API_KEY` | TVDB TV Shows provider | Yes, for TV |
| `OMDB_API_KEY` | Movie summary fallback (IMDb plots) | Optional |

A provider without its key is simply switched off. For example, without `TVDB_API_KEY` there is no `/tv`.

- **TMDB:**
  1. Create an account at themoviedb.org and go to **Settings → API**.
  2. Request a personal-use key. Any URL works for "Application URL", e.g. this repo's.
  3. Copy the short **API Key (v3)**, not the long "Read Access Token".
- **TVDB:**
  1. Register a project on TheTVDB's **API Information** page. Keys are per project, not from your account page.
  2. Copy the project's API key.
  3. Set `TVDB_PIN` only if your key type requires one.
- **OMDb:**
  1. Request a free key at omdbapi.com (1,000 requests a day).
  2. **Click the activation link in the email**, otherwise the key is rejected.

## 2. Deploy with Docker

### Requirements
- A machine with Docker and Docker Compose that your Plex server can reach over the network. It can be the Plex machine itself.
- Port **3000** free on that machine, or change the mapping in `docker-compose.yml`.

### Install

1. **Get the code onto the Docker host**, e.g. into `~/docker/plex-metadata`:
   ```bash
   git clone https://github.com/asimone/plex-metadata-service.git ~/docker/plex-metadata
   ```
   The repo is private, so if the host has no GitHub access, copy it from a checkout on another machine:
   ```bash
   git archive HEAD | ssh <user>@<host> "mkdir -p docker/plex-metadata && tar -x -C docker/plex-metadata"
   ```
2. **Create the settings file** with your keys:
   ```bash
   cd ~/docker/plex-metadata
   cp .env.example .env
   nano .env          # set TMDB_API_KEY, TVDB_API_KEY, and OMDB_API_KEY if you have one
   chmod 600 .env
   ```
3. **Build and start:**
   ```bash
   docker compose up -d --build
   ```
4. **Check it's healthy:**
   ```bash
   docker ps --filter name=plex-metadata      # STATUS should say (healthy)
   curl http://localhost:3000/movie           # {"MediaProvider":{... "title":"TMDB Movies" ...}}
   curl http://localhost:3000/tv              # {"MediaProvider":{... "title":"TVDB TV Shows" ...}}
   ```
5. **Check Plex can reach it.** Run this on the Plex machine, or inside the Plex container (`docker exec plex …`):
   ```bash
   curl http://<docker-host-ip>:3000/tv
   ```
   If this fails, fix the network or firewall before going on. Plex has to reach this URL.

**Use a fixed IP for the Docker host** (a DHCP reservation), because Plex stores the provider URL by address.

### What the container does
- Runs as a non-root user (UID 1000) and listens on port 3000.
- Stores its cache (SQLite) in `./data`, which must be writable by UID 1000. The cache can be deleted at any time.
- Restarts automatically (`restart: unless-stopped`) and reports its health through `/health`.
- Is labelled so Watchtower skips it. The image is built locally, so there's nothing to pull.

### Update, logs, remove
```bash
cd ~/docker/plex-metadata
git pull                         # or copy the new code in again
docker compose up -d --build     # rebuild and restart
docker logs -f plex-metadata     # follow logs (or use Dozzle)
docker compose down              # stop and remove the container
```

## 3. Add it to Plex

Do this in Plex Web, signed in as the **server owner**. There are three parts:
- **Providers:** register this service's URLs with Plex.
- **Agents:** a named, ordered list of providers. Ours goes first (primary), and Plex's own goes underneath.
- **Libraries:** point each library at its agent.

### 3.1 Add the providers
1. Open **Settings** (wrench icon) → **Metadata Agents**.
2. **Add Provider** → enter `http://<docker-host-ip>:3000/movie` → save. It's listed as **TMDB Movies**.
3. **Add Provider** → enter `http://<docker-host-ip>:3000/tv` → save. It's listed as **TVDB TV Shows**.

### 3.2 Add the agents
Still under **Metadata Agents**, click **Add Agent** once for each. Name each agent after its source, the same as the provider:

| Setting | Movies | TV |
|---|---|---|
| Agent name | **TMDB Movies** | **TVDB TV Shows** |
| Primary provider | TMDB Movies | TVDB TV Shows |
| Add below it, in order | **Plex Movie**, then **Plex Local Media** (optional) | **Plex Series**, then **Plex Local Media** (optional) |

- **Plex Movie / Plex Series** fill in posters, artwork, cast, ratings and genres.
- **Plex Local Media** uses any posters or artwork stored next to your files.

Save each agent. If an agent doesn't appear in the library settings afterwards, refresh the page with **Ctrl+F5**.

### 3.3 Try it on a test library (recommended)
1. **Add Library** → choose the type (Movies or TV Shows) → name it e.g. *Movies (test)*.
2. Add the **same folders** as your real library. Nothing is copied or changed.
3. **Advanced → Agent** → **TMDB Movies** or **TVDB TV Shows** → **Add Library**.
4. Once a few items have scanned, open some and check:
   - the summaries come from TMDB/TVDB;
   - posters, cast and ratings are present;
   - TV seasons and episodes are numbered like your files.
5. Delete the test library when done (**Manage Library → Delete**). Your files are untouched.

### 3.4 Switch your real library
1. Hover over the library → **⋯ → Edit Library → Advanced**.
2. **Agent** → **TMDB Movies** (or **TVDB TV Shows**) → **Save Changes**.

From then on, **new items** are matched and described by the provider. Existing items keep their current details until refreshed:
- **One item:** **⋯ → Refresh Metadata**.
- **Everything:** **Manage Library → Refresh All Metadata**. Each item is matched again once.

### Matching tips
- **ID tags in folder names give exact matches.** Movies: `{imdb-tt0088763}` or `{tmdb-105}`; Radarr adds `{imdb-…}` by default. Shows: `{tvdb-81189}` or `[tvdb-81189]`; Sonarr can add these. Without a tag, the provider searches by title and year.
- **Wrong match?** Use **⋯ → Fix Match**. You get up to 10 ranked results with posters. Adding an ID tag to the folder makes it permanent.
- **TV numbering** follows TVDB's aired order, the same numbering Sonarr uses.

### Undo
Set the library's agent back to **Plex Movie** / **Plex Series** and refresh. Nothing in your media folders is ever modified.

### Renaming after an upgrade
Provider names come from the service. If you added the providers before they were renamed, Plex may keep showing the old names. Remove and re-add the provider, or simply rename your agents in **Metadata Agents**. The underlying IDs never change, so matches aren't affected.

## 4. Configuration

All settings go in `.env` next to `docker-compose.yml`. Apply changes with `docker compose up -d`.

| Variable | Default | Purpose |
|---|---|---|
| `TMDB_API_KEY` | — | Enables TMDB Movies; TMDB summary fallback for TV |
| `TVDB_API_KEY`, `TVDB_PIN` | — | Enables TVDB TV Shows |
| `OMDB_API_KEY` | — | Optional movie summary fallback |
| `OMDB_DAILY_CAP` | `900` | Daily limit on OMDb calls |
| `SUMMARY_LANGUAGE` | `en-US` | Language used when Plex doesn't send one (Plex normally sends its own) |
| `LOG_LEVEL` | `info` | `debug` logs every request Plex sends. Useful for troubleshooting, but noisy |
| `PORT` | `3000` | Port inside the container |

**Caching:** source lookups are cached in `./data`: TV episode lists for 1 day, show and movie details for 7 days, summaries for 30 days. The service retries rate limits and network errors, and briefly pauses a source after repeated failures. If a summary can't be found, Plex's own agent fills it in.

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| Plex can't add the provider | `curl http://<docker-host-ip>:3000/movie` (or `/tv`) must work **from the Plex machine or container**. Check the IP, port 3000 and firewalls |
| `/tv` or `/movie` returns 404 | Its API key isn't set in `.env`. Check `docker logs plex-metadata` for a "disabled" warning |
| Container isn't `(healthy)` | `docker logs plex-metadata` |
| Agent missing from library settings | Refresh Plex Web with Ctrl+F5 |
| Wrong movie or show | **Fix Match**, or add an ID tag to the folder name (see [Matching tips](#matching-tips)) |
| Plex's own summary still shows | None of the sources has an English summary for that item, or the item hasn't been refreshed since switching agents |
| `omdb: HTTP 401` in logs | Activate the OMDb key from the email |
| `tvdb: HTTP 401` in logs | Check `TVDB_API_KEY`, or set `TVDB_PIN` if your key type needs one |

## 6. Command-line tools (optional)

The repo also has a command-line tool that talks to Plex directly (Node 22+). It's useful for inspecting IDs and summaries, or fixing a single item in a library that doesn't use these providers. It needs `PLEX_URL` and `PLEX_TOKEN` in `.env`. To get the token, open any item in Plex Web → **⋯ → Get Info → View XML**, and copy `X-Plex-Token` from the URL.

```bash
npm install && npm run build
npm run cli -- libraries                       # libraries and their agents
npm run cli -- show <ratingKey>                # Plex's summary vs each source
npm run cli -- sync --item <ratingKey> --write # write and lock one item's summary
npm run cli -- restore <ratingKey>             # undo
```

## Data sources

- TV metadata provided by [TheTVDB.com](https://thetvdb.com).
- This product uses the [TMDB](https://www.themoviedb.org) API but is not endorsed or certified by TMDB.
- Plot data from the [OMDb API](https://www.omdbapi.com).

## License

MIT. See [LICENSE](LICENSE). Built on Plex's [tmdb-example-provider](https://github.com/plexinc/tmdb-example-provider).
