#!/usr/bin/env python3
"""Stored-file stats from the Humans app's public /api/stats/files endpoint (runtime data, not code).

Writes data/runtime/files/YYYY-MM-DD.json: one per UTC day, the uploads present at the end of that day
by category folder (count, bytes). Asks only for the days it lacks: from the day after the last file
(or --from) through yesterday; with no files and no --from, yesterday alone.

The endpoint reconstructs each day from file write times, so files deleted or overwritten between that day
and "collected_on" are missing from it. It serves at most 366 days, so --from is clamped to that.
"""
import argparse, datetime as dt, glob, json, os, urllib.request

VERSION = 1
MAX_DAYS = 366

ap = argparse.ArgumentParser()
ap.add_argument('--out', default='data')
ap.add_argument('--base-url', default='https://humans.nobodies.team')
ap.add_argument('--from', dest='start', help='first day to (re)collect, YYYY-MM-DD')
a = ap.parse_args()

out = os.path.join(a.out, 'runtime', 'files')
os.makedirs(out, exist_ok=True)
today = dt.datetime.now(dt.timezone.utc).date()
yesterday = today - dt.timedelta(days=1)
have = sorted(os.path.basename(p)[:10] for p in glob.glob(os.path.join(out, '*.json')))
if a.start: start = dt.date.fromisoformat(a.start)
elif have: start = dt.date.fromisoformat(have[-1]) + dt.timedelta(days=1)
else: start = yesterday
start = max(start, today - dt.timedelta(days=MAX_DAYS))
if start > yesterday: raise SystemExit(f'file stats: up to date through {have[-1]}')

url = f'{a.base_url}/api/stats/files?asOfDate={start.isoformat()}'
with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'humans-metrics'}), timeout=60) as r:
    rows = json.load(r)
for row in rows:
    rec = {'date': row['date'], 'collector_version': VERSION, 'collected_on': today.isoformat(),
           'count': row['count'], 'bytes': row['bytes'], 'categories': row['categories']}
    with open(os.path.join(out, row['date'] + '.json'), 'w') as f:
        json.dump(rec, f, indent=1, sort_keys=True); f.write('\n')
print(f'file stats: wrote {len(rows)} day(s), {start} to {yesterday}')
