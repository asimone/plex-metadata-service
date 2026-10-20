# Plex findings

What we learned running this against a real Plex Media Server (1.43.x) with Movies and TV libraries. It covers behavior the provider spec in this folder doesn't describe.

## Custom metadata providers (as primary)

**Match requests.** Plex sends the title, year and filename (folder + file, relative to the library root). In testing it **never sent a `guid` hint**:

```json
{"excludeElements":"Media","type":1,"title":"Back to the Future","year":1985,
 "filename":"Back to the Future (1985)/Back to the Future (1985) {imdb-tt0088763} [Bluray-1080p].mkv",
 "hash":"…"}
```

- ID tags in paths reach the provider through `filename`: Radarr's `{imdb-tt…}` and Sonarr's `{tvdb-…}` / `[tvdb-…]`. With Radarr/Sonarr naming, most items match **by ID**.
- Matching by title + year handled tricky cases correctly in testing: remakes, punctuation and accents.

**Movie flow, per item:**
1. `POST …/matches`
2. `GET …/metadata/{key}`
3. `GET …/metadata/{key}/extras?X-Plex-Container-Size=50…`

**TV flow, per show:**
1. Optionally `GET` the show by an existing Plex ID (a 24-character hex ID). The provider answers 404, and Plex then matches.
2. `POST …/matches` (type 2, `includeChildren=1`, `episodeOrder=tvdbAiring`).
3. `GET` the show, then its extras.
4. `GET` each season with `includeChildren=1`.

No separate season or episode match requests were seen.

**Other details:**
- `/extras` isn't in the spec. The provider answers with an empty container.
- Plex also sends `X-Plex-Text-Format=markdown`, plus `X-Plex-Language` / `X-Plex-Country` as query parameters.
- Paging starts at **0** (`X-Plex-Container-Start=0`), even though the spec text says 1.
- `episodeOrder=tvdbAiring` corresponds to TVDB's aired ("official") order.
- With the provider as primary and Plex Movie / Plex Series below it, artwork, cast and ratings were filled in correctly by Plex's agent.

## Plex API (CLI tools)

- `GET /library/sections/{id}/all?type={1|2|3|4}&includeGuids=1` returns each item's external IDs (`imdb://`, `tmdb://`, `tvdb://`) for movies, shows, seasons and episodes. Items matched by Plex Series carry their **own** TVDB IDs, including on seasons and episodes.
- Items still matched by the legacy **TheTVDB agent** have no `Guid` array. Their IDs are embedded in the Plex GUID instead: `com.plexapp.agents.thetvdb://<series>/<season>/<episode>?lang=en`.
- `PUT /library/sections/{id}/all?type=…&id={ratingKey}&summary.value=…&summary.locked=1` behaves like a manual edit. The text and the lock survive **Refresh Metadata**. Sending the original text with `summary.locked=0` restores it.

## Sources

- **TVDB:**
  - A show's base `name` / `overview` are in its **original language**. English comes from `translations` (`/series/{id}/extended?meta=translations`).
  - `/series/{id}/episodes/default/{lang}` lists every episode (500 per page) with translated names and overviews. Where a translation is missing, it may return original-language text.
  - Impossible IDs (e.g. `0`) return **400**, not 404.
  - Most seasons have no overview in any language.
- **TMDB:** `/find/{id}?external_source=tvdb_id` resolves TVDB season and episode IDs, which is useful as a summary fallback.
- **Rate limits:** a lookup pass over tens of thousands of items at 4 concurrent requests hit no 429s.
