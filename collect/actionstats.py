#!/usr/bin/env python3
"""Actions producer: one data/actions/<date>.json per day with workflow runs.

Runs are listed per day with the API's `created` filter (a single listing
stops at 1000 results; the busiest day so far had about 600). Duration is updated_at minus run_started_at; billable
minutes need one call per run and are not collected.

Record: {date, collector_version, runs, conclusions: {success, failure,
cancelled, ...}, reruns, events: {pull_request, push, schedule, ...},
workflows: {name: {runs, failure, success, duration_s}}}

`success` per workflow is recorded from 2026-08-01 on; earlier records have only `failure`, which cannot tell a
pass from a cancelled or skipped run.
"""
import argparse, collections, datetime as dt, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prstats import paged, iso

VERSION = 1

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True); ap.add_argument('--gh', default='peterdrier/Humans')
    ap.add_argument('--from', dest='d_from'); ap.add_argument('--to', dest='d_to')
    a = ap.parse_args()
    outdir = os.path.join(a.out, 'actions'); os.makedirs(outdir, exist_ok=True)
    d_to = dt.date.fromisoformat(a.d_to) if a.d_to else dt.date.today() - dt.timedelta(days=1)
    if not a.d_from:
        have = sorted(f[:-5] for f in os.listdir(outdir) if f.endswith('.json'))
        a.d_from = (dt.date.fromisoformat(have[-1]) + dt.timedelta(days=1)).isoformat() if have else '2026-02-04'
    start = dt.date.fromisoformat(a.d_from)
    days = collections.defaultdict(lambda: dict(runs=0, conclusions=collections.Counter(), reruns=0, events=collections.Counter(),
                                                workflows=collections.defaultdict(lambda: collections.Counter())))
    d = start
    while d <= d_to:
        e = d
        for w in paged(f'/repos/{a.gh}/actions/runs', created=f'{d}..{e}', status='completed', key='workflow_runs'):
            day = w['created_at'][:10]; rec = days[day]
            rec['runs'] += 1; rec['conclusions'][w['conclusion'] or 'none'] += 1; rec['reruns'] += w['run_attempt'] > 1
            rec['events'][w['event']] += 1
            wf = rec['workflows'][w['name']]; wf['runs'] += 1; wf['failure'] += w['conclusion'] == 'failure'; wf['success'] += w['conclusion'] == 'success'
            if w.get('run_started_at'): wf['duration_s'] += int((iso(w['updated_at']) - iso(w['run_started_at'])).total_seconds())
        print(f'  {d}..{e}: {sum(days[x]["runs"] for x in days if d.isoformat() <= x <= e.isoformat())} runs', file=sys.stderr)
        d = e + dt.timedelta(days=1)
    for day, rec in days.items():
        json.dump(dict(date=day, collector_version=VERSION, runs=rec['runs'], conclusions=dict(rec['conclusions']), reruns=rec['reruns'],
                       events=dict(rec['events']), workflows={k: dict(v) for k, v in sorted(rec['workflows'].items())}),
                  open(os.path.join(outdir, f'{day}.json'), 'w'), indent=1)
    print(f'actions: {len(days)} days {start}..{d_to}', file=sys.stderr)

if __name__ == '__main__':
    main()
