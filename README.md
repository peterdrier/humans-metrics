# humans-metrics

Codebase timeline for [peterdrier/Humans](https://github.com/peterdrier/Humans): one record per day of
solution-wide and per-assembly stats, reforge structure metrics, and surface-score readings, rendered as a
static page. Built to watch growth, slop and cleanup over an agent-driven project's life.

Page: `docs/index.html`, with `style.css`, `app.js` and `data/*.json` beside it (GitHub Pages serves `docs/` from `main`; open it over HTTP, since `file://` blocks the data fetch).

## Layout

| Path | What |
|---|---|
| `data/stats/YYYY-MM-DD.json` | One file per day with a commit on Humans `main`: `commit`, `collector_version`, the solution row, a row per assembly (src and tests), ProjectReference edges. Git and cloc only. |
| `data/git/<date>.json` | `collect/gitstats.py` | Per-lane PRs, files, lines; routines; models; author count; commit hour histogram. Lanes from `collect/lanes.yml`. |
| `data/prs/<date>.json` | `collect/prstats.py` | PRs opened; per lane merged, closed, lines, time-to-merge; bot vs human comments; gate series (Peter on others' PRs). Raw per-PR facts cached in `data/prs/raw.jsonl`, cursor in `cursor.json`. |
| `data/actions/<date>.json` | `collect/actionstats.py` | Workflow runs by conclusion, event, workflow; wall-clock duration; re-runs. |
| `data/coverage/YYYY-MM-DD.json` | `collect/coverage.py` via the reforge driver: unit-test line coverage per assembly and class as covered/uncovered line ranges, computed once per Humans commit and reused by every rescore (`--retest` recomputes). |
| `data/reforge/YYYY-MM-DD.json` | `collect/reforgehist.py`: build, unit tests with coverage, `reforge snapshot --by-assembly` rows (default config, exact tokens when a key is present) and a slim `surface-score` (totals, by rule, by section, edges). `token-cache.txt` beside them is the shared exact-token cache. |
| `data/surface/<date>-<sha>-reforge<ver>.json` | Slim surface-score reading: totals, points by rule, points by section, service-interface edges. Full JSON stays in a local archive. |
| `data/runtime/files/<date>.json` | `collect/filestats.py`: runtime data, not code. Uploads on the production server per UTC day, total and by folder (count, bytes), from Humans' public `/api/stats/files?asOfDate=`. Asks only for missing days through yesterday; a day counts files present at its end by write time, so later deletions are missing. |
| `data/seed/reforge-history.csv` | The daily `reforge snapshot` rows carried over from the Humans repo, used until every day has its own snapshot. No reforge version was recorded for these. |
| `collect/collect.py` | The collector. File-based metrics need only git and cloc; `--reforge` adds the snapshot and needs a building tree. |
| `site/{index.html,style.css,app.js}` + `site/build.py` | The page source, and the builder that copies it to `docs/` and writes `docs/data/<key>.json`. |
| `.github/workflows/weekly.yml` | Monday job: collect missing days, rebuild, commit, deploy. |

## Every record carries its provenance

One file per producer per day, each naming the commit it measured and the tool version that measured it.
Redo any range with `--from/--to` (`--reforge-only` for just that producer) and only those files change, so
the reforge series can be reworked a week at a time when reforge gains columns (per-assembly stats and
coverage are coming) while the file-based series stands.

## Running it

```bash
# full history, file-based metrics only (minutes)
python3 collect/collect.py --repo ../Humans --out data --from 2026-02-04

# one week of reforge snapshots only (each day builds the tree)
python3 collect/collect.py --repo ../Humans --out data --from 2026-10-20 --to 2026-10-26 --reforge-only

# render
python3 site/build.py
```

Day boundaries use the author date of the last commit on `origin/main` that day. `cloc` gives the C# code
versus comment split per assembly; without it those columns are absent.

## Known gaps

- `entities` reads 0 after the August section split (the `Entities/` directories moved); `dbsets` counts
  `DbSet<` declarations instead and is the better table count.
- Pre-split "assemblies" are the four or five layer projects. That is the point: the page shows the
  layered era as it was.
- The surface-score readings are three manual runs with two reforge versions. A per-day surface series
  waits on reforge grouping by assembly.
