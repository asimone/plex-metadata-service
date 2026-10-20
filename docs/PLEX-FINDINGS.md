# Plex findings

Results from running the read-only Phase 1 dry run against the real server. These answer the questions in PLAN.md section 5 and shape Phases 2 and 3.

## Run 1 — 2026-10-20

**Server:** PMS 1.43.x on Tasha. Libraries: Movies (`tv.plex.agents.movie`), TV Shows (`tv.plex.agents.series`), Music (not supported, skipped).

**Performance:** 26,992 items listed in about 21 seconds (200 items per page, `includeGuids=1`). No errors.

### Coverage

| Type | Total | tvdb | tmdb | imdb | No usable ID | Summary locked | Summary empty |
|---|---:|---:|---:|---:|---:|---:|---:|
| movie | 912 | 895 | 910 | 909 | 1 | 0 | 1 |
| show | 587 | 557 | 556 | 554 | 29 | 0 | 1 |
| season | 1,768 | 1,533 | 12 | 0 | 228 | 0 | 1,162 |
| episode | 23,725 | 20,463 | 18,714 | 17,756 | 3,262 | 0 | 759 |

### Answers to PLAN.md section 5

1. **Do seasons and episodes carry `tvdb://` IDs?** Yes. Items matched by Plex Series carry their **own** TVDB IDs: TVDB season IDs on seasons (e.g. `tvdb://1964999`) and TVDB episode IDs on episodes. No numbering lookup is needed for them.
2. **Does a locked bulk `PUT` survive Refresh Metadata?** Yes. See run 2.
3. **Does `includeGuids=1` work on the bulk listing for every type?** Yes, for movies, shows, seasons and episodes.

### What the gaps are

- **Movies:** 910 of 912 have a TMDB ID.
  - One is unmatched (`local://`).
  - One has only an IMDb ID. TMDB's `/find` can resolve it.
- **Legacy-agent TV shows: 28 shows, 223 seasons, 3,231 episodes.** These were matched long ago by the legacy **TheTVDB agent** (`com.plexapp.agents.thetvdb`) and were never rematched. They have **no `Guid` array**, but their Plex GUID embeds the TVDB IDs:
  - show `com.plexapp.agents.thetvdb://152831?lang=en`
  - episode `com.plexapp.agents.thetvdb://152831/1/2?lang=en` (series / season / episode, in TVDB aired order)

  Their summaries came from that legacy TVDB agent, so they are probably **already human-written**. Plex is removing legacy agents in 2026; a refresh under Plex Series would rematch them and give them `Guid` arrays.
- **Unmatched TV:** one show (`local://`), with 4 seasons and 31 episodes.
- **New-agent gaps:** 10 seasons and 24 episodes under shows that do have a TVDB ID lack their own ID. They can be resolved through the show's TVDB ID plus season/episode number, or skipped.
- **No locked summaries anywhere.** Nothing has been hand-edited, so the "user-owned" rule starts with an empty set.
- **Empty summaries:** 1,162 seasons (66%) and 759 episodes have none in Plex. Any we can fill from TVDB is a bonus beyond fixing AI text.

### Decisions this suggests (to confirm)

- **Phase 2 (movies):** look up by `tmdb://` first, then `imdb://` via `/find`. That covers 911 of 912.
- **Phase 3 (TV):**
  - Use the item's own `tvdb://` ID for shows, seasons and episodes.
  - **Skip legacy-agent items** by default and report them. Their text is already from TVDB. Parsing the legacy GUID can come later if needed.
  - Skip the 34 orphan seasons/episodes in v1, and report them.
- Filling empty season and episode summaries is in scope: same lookup, nothing to overwrite.

To list the legacy-agent or unmatched items yourself:

```bash
npm run cli -- list --library "TV Shows" | grep "no external IDs"
```

## Run 2 — 2026-10-20 (Phase 2, movies)

### Dry run over Movies (912 items, ~46 s on a cold cache)

| Outcome | Count |
|---|---:|
| Would write (Plex's text differs from TMDB's) | 627 |
| Would lock only (Plex already shows TMDB's text) | 283 |
| No source summary | 2 |
| Errors | 0 |

- **About 31% of movies already show TMDB's text verbatim.** The rest differ. Many of Plex's versions read like IMDb-style plot lines, e.g. with actor names in parentheses. Review the report at `data/dry-run-movies.txt` (git-ignored) before enabling whole-library writes.
- The 2 with no source summary:
  - one unmatched local item;
  - one movie where TMDB has no overview, and OMDb rejected the key (`401`, which usually means the key isn't activated yet).

### Write, refresh, restore (3 test movies)

| Movie | ratingKey | Action |
|---|---|---|
| 2 Fast 2 Furious | 2540 | write + lock |
| Crouching Tiger, Hidden Dragon | 5523 | write + lock |
| 28 Days Later | 131 | lock only (text already matched) |

1. `sync --item … --write`: Plex showed our text with the summary **locked**, and the next sync reported `unchanged`.
2. **Refresh Metadata in Plex** on all three: the text and the lock both survived. A `PUT /library/sections/{id}/all … summary.locked=1` behaves like a manual edit.
3. `restore`: Plex's original text came back, **unlocked**. The local records were removed, and the next dry run sees the items as new again (`write` / `lock`).

## Run 3 — 2026-10-20 (Phase 3, TV)

- **One show end to end** (`sync --item 28489`, dry run): the show, its season and all 12 episodes resolved from TVDB by their own IDs.
  - 3 would be written: the show-level summary plus 2 episodes.
  - 10 episodes already match TVDB, so they would only be locked.
  - The season has no summary on TVDB or TMDB.
- **Partial library dry run**, stopped on purpose once the approach was proven: about 16,400 items processed.
  - 6,172 would be written, 7,211 lock only, 2,984 no source summary (mostly seasons, plus legacy-agent shows without IDs).
  - **0 errors, 0 rate-limit (429) responses, no circuit trips** at 4 concurrent lookups.
- Takeaway: TV works the same way as movies. Fix individual shows on demand with `sync --item <show ratingKey> --write`; there's no need to sweep the whole library.

## Run 4 — 2026-10-20 (Phase 5, movie provider as primary)

Setup: provider at `http://12.27.27.211:3000/movie` (Docker on Tufte), agent "Movies (Simone)" (primary) with Plex Movie below it, test library on the real Movies folders.

**What Plex sends when matching** (`POST /movie/library/metadata/matches`):

```json
{"excludeElements":"Media","type":1,"title":"A Few Good Men","year":1992,
 "filename":"A Few Good Men (1992)/A Few Good Men (1992) {imdb-tt0104257} [Bluray-1080p]...mkv",
 "hash":"416c…"}
```

- `title`, `year` and `filename` (folder + file, relative to the library root). **No `guid` hint** was sent for any item.
- Radarr's `{imdb-tt…}` filename tags reach us through `filename`, so about half the library matches **by ID**. In the first 81 matches, 39 used an ID hint.
- The rest are matched by title search. Spot-checks were all correct, including tricky titles: *Terminator 2 Judgement Day*, *WALL·E*, *The Square (2017)*, *Total Recall (1990)*, *Ocean's Eleven (2001)*.
- 0 failed matches, 0 errors, and every metadata response had a TMDB summary.

**Calls per movie:** `POST …/matches`, then `GET …/metadata/{key}`, then `GET …/metadata/{key}/extras?X-Plex-Container-Size=50…`. Plex also sends `X-Plex-Text-Format=markdown`.
- `/extras` isn't in the spec docs. It used to fall through to Express's HTML 404; it now returns an empty container.
