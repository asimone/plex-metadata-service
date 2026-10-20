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
2. **Does a locked bulk `PUT` survive Refresh Metadata?** Not tested yet (Phase 2, needs writes).
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
npm run cli -- sync --dry-run --library "TV Shows" | grep "no external IDs"
```
