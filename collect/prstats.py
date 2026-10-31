#!/usr/bin/env python3
"""PR producer: GitHub REST facts per PR, cached in data/prs/raw.jsonl, then one
data/prs/<date>.json per day keyed by the day the PR merged (or closed).

Credit goes to the author (lane from collect/lanes.yml, by branch name,
author and the squash commit's trailers). Peter's reviews, approvals, review
comments and merges on PRs he did not author are the separate "gate" series.

Incremental: PRs are refetched when updated after the cached cursor; comments
use the API's `since`. The merger is fetched only for PRs not authored by
Peter, bots included (one extra call each), since that is the only place it matters.

Record: {date, collector_version, opened, lanes: {lane: {merged, closed,
lines, files, ttm_hours: [..], reviews, changes_requested, bot_comments,
human_comments}}, gate: {reviews, approvals, changes_requested,
review_comments, merges}, bots: {login: comments}}
"""
import argparse, collections, datetime as dt, json, os, re, subprocess, sys, time, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gitstats import classify, load_rules, git

VERSION = 1
API = 'https://api.github.com'
TOKEN = os.environ.get('GITHUB_TOKEN') or os.environ.get('HUMANS_TOKEN')

def get(path, **params):
    url = API + path + ('?' + urllib.parse.urlencode(params) if params else '')
    h = {'Accept': 'application/vnd.github+json'}
    if TOKEN: h['Authorization'] = 'Bearer ' + TOKEN
    for attempt in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=h))
            return json.load(r), r.headers.get('Link', '')
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and attempt < 4: time.sleep(30 * (attempt + 1)); continue
            raise

def paged(path, stop=None, key=None, **params):
    params.setdefault('per_page', 100); page = 1
    while True:
        items, link = get(path, page=page, **params)
        if key: items = items[key]
        for it in items:
            if stop and stop(it): return
            yield it
        if 'rel="next"' not in link: return
        page += 1

def save(rawp, raw):
    with open(rawp + '.tmp', 'w') as f:
        for n in sorted(raw): f.write(json.dumps(raw[n], separators=(',', ':')) + '\n')
    os.replace(rawp + '.tmp', rawp)

def iso(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00')) if s else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True, help='local Humans clone (trailers, numstat)')
    ap.add_argument('--out', required=True); ap.add_argument('--gh', default='peterdrier/Humans')
    ap.add_argument('--full', action='store_true', help='ignore the cache cursor')
    a = ap.parse_args()
    outdir = os.path.join(a.out, 'prs'); os.makedirs(outdir, exist_ok=True)
    rawp = os.path.join(outdir, 'raw.jsonl'); curp = os.path.join(outdir, 'cursor.json')
    raw = {}
    if os.path.exists(rawp):
        for line in open(rawp): r = json.loads(line); raw[r['number']] = r
    cur = json.load(open(curp)) if os.path.exists(curp) and not a.full else {}
    rules = load_rules(); peter = rules['peter']
    pr_updated, c_since = cur.get('pr_updated'), cur.get('comments')

    # --- PRs updated since cursor
    new_max = pr_updated
    for p in paged(f'/repos/{a.gh}/pulls', state='all', sort='updated', direction='desc',
                   stop=lambda p: pr_updated and p['updated_at'] <= pr_updated):
        n = p['number']; old = raw.get(n, {})
        if old.get('updated') == p['updated_at']: continue
        r = dict(number=n, title=p['title'], author=p['user']['login'], author_type=p['user']['type'], branch=p['head']['ref'],
                 created=p['created_at'], merged=p['merged_at'], closed=p['closed_at'], updated=p['updated_at'],
                 draft=p['draft'], merge_sha=p['merge_commit_sha'], merged_by=old.get('merged_by'),
                 comments=old.get('comments', {}), reviews=[])
        for rv in paged(f'/repos/{a.gh}/pulls/{n}/reviews'):
            if rv['user']: r['reviews'].append(dict(by=rv['user']['login'], type=rv['user']['type'], state=rv['state'], at=rv.get('submitted_at')))
        raw[n] = r; new_max = max(new_max or '', p['updated_at'])
        if len(raw) % 100 == 0:
            print(f'  {len(raw)} PRs', file=sys.stderr, flush=True); save(rawp, raw)

    # --- merger, only where it matters for the gate series
    for r in raw.values():
        if r['merged'] and r['author'] not in peter and not r.get('merged_by'):
            one, _ = get(f"/repos/{a.gh}/pulls/{r['number']}"); r['merged_by'] = (one.get('merged_by') or {}).get('login') or '?'
    save(rawp, raw)

    # --- comments (review comments + issue comments), by PR, since cursor
    c_max = c_since
    for kind, path, key in (('review', f'/repos/{a.gh}/pulls/comments', 'pull_request_url'), ('issue', f'/repos/{a.gh}/issues/comments', 'issue_url')):
        params = dict(sort='created', direction='asc'); 
        if c_since: params['since'] = c_since
        for c in paged(path, **params):
            if c_since and c['created_at'] <= c_since: continue
            n = int(c[key].rsplit('/', 1)[1]); r = raw.get(n)
            if not r: continue
            who = c['user']['login'] if c['user'] else '?'
            r['comments'][who] = r['comments'].get(who, 0) + 1
            c_max = max(c_max or '', c['created_at'])

    # --- lane, trailers and lines from the local clone
    for r in raw.values():
        if r['merged'] and r['merge_sha'] and 'lines' not in r:
            try:
                show = git(a.repo, 'show', '--numstat', '--format=%x1f%(trailers:only,unfold)%x1f', r['merge_sha'])
                trailers = [t for t in show.split('\x1f')[1].splitlines() if t.strip()]
                nums = [l.split('\t') for l in show.split('\x1f')[2].splitlines() if l.count('\t') == 2]
                r['files'] = len(nums); r['lines'] = sum(int(x[0]) + int(x[1]) for x in nums if x[0] != '-')
            except subprocess.CalledProcessError:
                trailers = []; r['files'] = r['lines'] = None
            r['trailers'] = trailers
        lane, rt = classify(rules, r.get('title', ''), r['author'], r.get('trailers', []), branch=r['branch'])
        r['lane'], r['routine'] = lane, rt

    save(rawp, raw)
    json.dump({'pr_updated': new_max, 'comments': c_max}, open(curp, 'w'))

    # --- day records
    days = collections.defaultdict(lambda: dict(opened=0, lanes=collections.defaultdict(lambda: collections.Counter()), ttm={},
                                                gate=collections.Counter(), bots=collections.Counter()))
    for r in raw.values():
        days[r['created'][:10]]['opened'] += 1
        if not r['closed']: continue
        d = days[(r['merged'] or r['closed'])[:10]]; L = d['lanes'][r['lane']]
        if r['merged']:
            L['merged'] += 1; L['lines'] += r.get('lines') or 0; L['files'] += r.get('files') or 0
            d['ttm'].setdefault(r['lane'], []).append(round((iso(r['merged']) - iso(r['created'])).total_seconds() / 3600, 1))
        else: L['closed'] += 1
        for rv in r['reviews']:
            if rv['type'] == 'Bot': continue
            L['reviews'] += 1; L['changes_requested'] += rv['state'] == 'CHANGES_REQUESTED'
        for who, n in r['comments'].items():
            if who.endswith('[bot]') or who in ('github-actions',): L['bot_comments'] += n; d['bots'][who] += n
            else: L['human_comments'] += n
        if r['author'] not in peter:
            g = d['gate']
            for rv in r['reviews']:
                if rv['by'] in peter:
                    g['reviews'] += 1; g['approvals'] += rv['state'] == 'APPROVED'; g['changes_requested'] += rv['state'] == 'CHANGES_REQUESTED'
            g['review_comments'] += sum(n for who, n in r['comments'].items() if who in peter)
            g['merges'] += 1 if r['merged_by'] in peter else 0
    for day, d in days.items():
        rec = dict(date=day, collector_version=VERSION, opened=d['opened'],
                   lanes={k: dict(v) | ({'ttm_hours': d['ttm'][k]} if k in d['ttm'] else {}) for k, v in sorted(d['lanes'].items())},
                   gate=dict(d['gate']), bots=dict(d['bots']))
        json.dump(rec, open(os.path.join(outdir, f'{day}.json'), 'w'), indent=1)
    print(f'prs: {len(raw)} PRs cached, {len(days)} days', file=sys.stderr)

if __name__ == '__main__':
    main()
