# Backfilling the reforge history

One session per date range, newest first, any number in parallel. Each session:

```bash
git clone https://github.com/peterdrier/Humans ../Humans          # full history (not shallow)
dotnet tool install --global Reforge --version 0.32.0              # pin; the rows record it
dotnet tool install --global dotnet-coverage
export PATH="$HOME/.dotnet/tools:$PATH"                            # ANTHROPIC_API_KEY comes from the environment
python3 collect/reforgehist.py --repo ../Humans --out data --from 2026-09-01 --to 2026-09-30 --reforge "$HOME/.dotnet/tools/reforge"
```

Pass `--reforge` with the full path: cloud containers ship an older `reforge`
in `/usr/local/bin` that wins on PATH.

The driver walks the range newest first, skips days that already have a record,
and per day: builds (installed SDK, NuGet audit and analyzers off, recorded),
runs the unit tests under dotnet-coverage, stores coverage as
`data/coverage/<date>.json`, then `reforge snapshot --by-assembly` with exact
token counts and `reforge surface-score` for edges and byRule. Each day writes
`data/reforge/<date>.json` and appends to `data/reforge/token-cache.txt`.

Commit and push after every few days, not at the end:

```bash
git pull --rebase && git add data && git commit -m "reforge: 2026-09-21..2026-09-30" && git push
```

The token cache merges by union (`.gitattributes`), day files never collide, so
parallel sessions do not conflict. Expect about 90 s per day in February and
about 15 min per day in October, mostly build and tests.

## First session on a new reforge version

Before any bulk fill, rescore the days that already have records with `--redo`
(coverage and tokens reused), check that `surface`, `edges` and `byRule` are
still populated in the new records, run `python3 site/build.py`, and push. The
four seed days are 2026-02-12, 2026-08-07, 2026-08-10 and 2026-10-31; they were
last scored on 0.31.1.

## Rescoring a range after a reforge release

Same command with `--redo`. Coverage and exact tokens are reused from
`data/coverage/` and the cache, so a rescore costs the build plus two reforge
passes. `--retest` forces the tests to run again (only when the test runner or
the coverage tool changes).

## A day that does not build

The record is a stub with `build: failed` and the tail of the build output; the
page lists these days. Fix the driver if it is a tooling issue of today's clock
(SDK pin, audit, expiring analyzer), otherwise the day stays unmeasured.

## After the backfill

`python3 site/build.py` regenerates `docs/index.html`; the weekly job does this
on Mondays and scores new days forward. The `data/seed/reforge-history.csv`
series and the three `data/surface/` runs retire once every day has a record.
