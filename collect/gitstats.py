#!/usr/bin/env python3
"""Git producer: one data/git/<date>.json per day with commits on origin/main.

Units are the non-merge commits on main: with squash merges each one is a
PR (merge commits are production promotions and carry no work of their own). Each merged commit is classified into a lane by collect/lanes.yml
(automation | peter | other); credit goes to the author, never the merger.

Record: {date, commit, collector_version, lanes: {lane: {prs, files, added,
deleted}}, routines: {name: prs}, models: {model: prs}, authors (distinct
author count on merged commits), all_commits (every commit of the day, not
just first-parent), hours: [24 counts by author hour, UTC]}.
"""
import argparse, collections, datetime as dt, json, os, re, subprocess, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = 1

def git(repo, *args):
    return subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True, check=True).stdout

def load_rules():
    r = yaml.safe_load(open(os.path.join(HERE, 'lanes.yml')))
    for rt in r['routines']:
        for k in ('branch', 'subject', 'author'):
            if k in rt: rt[k] = re.compile(rt[k], re.I)
    r['peter'] = set(r['peter_logins'])
    return r

MODEL_RE = re.compile(r'^Co-Authored-By:\s*(.*?)\s*<', re.I)

def classify(rules, subject, author, trailers, branch=None):
    for rt in rules['routines']:
        if ('branch' in rt and branch and rt['branch'].search(branch)) or \
           ('subject' in rt and rt['subject'].search(subject)) or \
           ('author' in rt and rt['author'].search(author)):
            return 'automation', rt['name']
    return ('peter' if author in rules['peter'] else 'other'), None

def merged_commits(repo, ref, d_from, d_to):
    """Non-merge commits by author date, with numstat."""
    out = git(repo, 'log', ref, '--no-merges', '--reverse', '--numstat',
              f'--since={d_from}T00:00:00', f'--until={d_to}T23:59:59',
              '--format=%x1e%H%x1f%ad%x1f%an%x1f%s%x1f%(trailers:only,unfold)', '--date=format:%Y-%m-%d %H')
    for chunk in out.split('\x1e')[1:]:
        head, _, stat = chunk.partition('\n')
        h, ad, an, subj, trailers = head.split('\x1f')
        files = added = deleted = 0
        for line in stat.splitlines():
            p = line.split('\t')
            if len(p) == 3:
                files += 1
                if p[0] != '-': added += int(p[0]); deleted += int(p[1])
        yield dict(sha=h, date=ad[:10], hour=int(ad[11:]), author=an, subject=subj,
                   trailers=[t for t in trailers.splitlines() if t.strip()],
                   files=files, added=added, deleted=deleted)

def all_commit_days(repo, ref, d_from, d_to):
    out = git(repo, 'log', ref, f'--since={d_from}T00:00:00', f'--until={d_to}T23:59:59',
              '--format=%ad', '--date=short')
    return collections.Counter(out.split())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--ref', default='origin/main')
    ap.add_argument('--from', dest='d_from'); ap.add_argument('--to', dest='d_to')
    a = ap.parse_args()
    outdir = os.path.join(a.out, 'git'); os.makedirs(outdir, exist_ok=True)
    d_to = a.d_to or git(a.repo, 'log', '-1', '--format=%ad', '--date=short', a.ref).strip()
    if not a.d_from:
        have = sorted(f[:-5] for f in os.listdir(outdir) if f.endswith('.json'))
        a.d_from = (dt.date.fromisoformat(have[-1]) + dt.timedelta(days=1)).isoformat() if have else '2026-02-04'
    rules = load_rules()
    days = collections.defaultdict(list)
    for c in merged_commits(a.repo, a.ref, a.d_from, d_to):
        days[c['date']].append(c)
    totals = all_commit_days(a.repo, a.ref, a.d_from, d_to)
    for day in sorted(set(days) | set(totals)):
        lanes = collections.defaultdict(lambda: collections.Counter())
        routines, models, authors, hours = collections.Counter(), collections.Counter(), set(), [0]*24
        for c in days.get(day, []):
            lane, rt = classify(rules, c['subject'], c['author'], c['trailers'])
            lanes[lane].update(prs=1, files=c['files'], added=c['added'], deleted=c['deleted'])
            if rt: routines[rt] += 1
            for t in c['trailers']:
                m = MODEL_RE.match(t)
                if m: models[m.group(1)] += 1
            authors.add(c['author']); hours[c['hour']] += 1
        last = days[day][-1]['sha'][:9] if day in days else None
        rec = dict(date=day, commit=last, collector_version=VERSION,
                   lanes={k: dict(v) for k, v in sorted(lanes.items())}, routines=dict(routines),
                   models=dict(models), authors=len(authors), all_commits=totals.get(day, 0), hours=hours)
        json.dump(rec, open(os.path.join(outdir, f'{day}.json'), 'w'), indent=1)
    print(f'git: {len(set(days)|set(totals))} days {a.d_from}..{d_to}', file=sys.stderr)

if __name__ == '__main__':
    main()
