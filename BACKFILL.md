# Backfilling the reforge history

One session per date range, newest first, any number in parallel. Each session:

```bash
ls ../Humans || git clone https://github.com/peterdrier/Humans ../Humans   # the Humans Stats project checks it out; full history, not shallow
dotnet tool install --global dotnet-coverage
export PATH="$PATH:$HOME/.dotnet/tools"                            # for dotnet-coverage; appended so PATH reforge wins
ANTHROPIC_API_KEY="$REFORGE_ANTHROPIC_API_KEY" \
  python3 collect/reforgehist.py --repo ../Humans --out data --from 2026-09-01 --to 2026-09-30
```

Use the `reforge` on PATH: the cloud environment installs the latest release
at `/usr/local/bin/reforge`, so there is no install step. A release exists
because something should be measured differently, and every record names the
version it was scored with (`reforge --version` shows it up front), so the
page shows which days still need a rescore.

The cloud runner strips `ANTHROPIC_API_KEY` from sessions; the environment
carries it as `REFORGE_ANTHROPIC_API_KEY`, mapped only for the reforge command
as above. Never print it.

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

Before any bulk fill on a version no record has seen, rescore a few days that
already have records with `--redo` (coverage and tokens reused), check that
`surface`, `edges` and `byRule` are still populated, run `python3 site/build.py`,
and push. Rescoring the rest of the history is Peter's call, never a session's:
the page's provenance chart shows which days lag, and a session rescores only
the range it was told to.

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

`python3 site/build.py` regenerates `docs/` (page files plus `docs/data/*.json`); the weekly job does this
on Mondays and scores new days forward. The `data/seed/reforge-history.csv`
series and the three `data/surface/` runs retire once every day has a record.
