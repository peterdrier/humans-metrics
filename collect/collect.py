#!/usr/bin/env python3
"""Collect one row per day of codebase metrics for a .NET repo, keyed by (date, commit, reforge_version).

Usage:
  collect.py --repo <path> --out data [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--ref origin/main] [--force]

For every calendar day in the range that has a commit on --ref, the last commit of that day is measured:
written as one file per producer:
  <out>/stats/YYYY-MM-DD.json    { date, commit, collector_version, solution: {...}, assemblies: {name: {...}}, edges: [[from,to],...] }
  <out>/reforge/YYYY-MM-DD.json  { date, commit, reforge_version, snapshot: {...} }   only with --reforge and a building tree
  <out>/coverage/YYYY-MM-DD.json reserved for test coverage, same keys

One file per producer per day: rerunning a range overwrites those days in that producer's directory and
nothing else, so a series can be redone a week at a time (say, with a newer reforge) while the others stand.
Every file names the commit and tool version it was measured with. File-based metrics (lines, files, edges,
resx keys, cloc comment split) need no build; only the reforge producer does.
"""
import argparse, csv, datetime as dt, json, os, re, shutil, subprocess, sys, tempfile, collections

COLLECTOR_VERSION = 1

CODE_EXT = ('.cs', '.cshtml', '.resx', '.js')
NEUTRAL_RESX = re.compile(r'\.[a-z]{2}(-[A-Za-z]{2,4})?\.resx$')

def git(repo, *args, **kw):
    kw.setdefault('env', {**os.environ, 'TZ': 'UTC'})   # day keys are UTC days
    return subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True, check=True, **kw).stdout

def day_commits(repo, ref, d_from, d_to):
    """Last commit of each UTC day on ref, by committer date, within the range."""
    out = git(repo, 'log', ref, '--format=%H %cd', '--date=format-local:%Y-%m-%d', f'--since={d_from}T00:00:00Z', f'--until={d_to}T23:59:59Z')
    last = {}
    for line in out.splitlines():
        sha, d = line.split()
        last.setdefault(d, sha)        # log is newest-first, so first seen per day is the last commit
    return dict(sorted(last.items()))

def tree(repo, commit):
    out = git(repo, 'ls-tree', '-r', '-z', '--long', commit).split('\0')
    files = []
    for e in out:
        if not e: continue
        meta, path = e.split('\t', 1)
        _, _, blob, size = meta.split()
        files.append((path, blob, int(size)))
    return files

def line_counts(repo, items):
    """items: [(path, blob)] -> {path: newline count}, read via one cat-file batch."""
    if not items: return {}
    inp = '\n'.join(b for _, b in items) + '\n'
    p = subprocess.run(['git', '-C', repo, 'cat-file', '--batch'], input=inp.encode(), capture_output=True, check=True).stdout
    res, i = {}, 0
    for path, _ in items:
        nl = p.index(b'\n', i); size = int(p[i:nl].split()[2]); body = p[nl+1:nl+1+size]; i = nl + 1 + size + 1
        res[path] = (body.count(b'\n'), body)
    return res

def assembly_of(path):
    parts = path.split('/')
    if parts[0] == 'src':
        name = parts[2] if len(parts) > 2 and parts[1] == 'Sections' else parts[1]
    elif parts[0] == 'tests':
        name = parts[1]
    else:
        return None
    if '.' not in name: return None
    return name

def collect_day(repo, commit, cloc):
    files = tree(repo, commit)
    code = [(p, b) for p, b, _ in files if p.endswith(CODE_EXT) and (p.startswith('src/') or p.startswith('tests/'))]
    md = [(p, b) for p, b, _ in files if p.endswith('.md') and not p.startswith(('node_modules/', 'bin/', 'obj/'))]
    counts = line_counts(repo, code + md)
    A = collections.defaultdict(lambda: collections.Counter())
    sol = collections.Counter()
    csproj = [(p, b) for p, b, _ in files if p.endswith('.csproj')]
    for p, _ in code:
        n, body = counts[p]
        asm = assembly_of(p)
        if not asm: continue
        is_test = p.startswith('tests/')
        is_mig = '/Migrations/' in p
        ext = p.rsplit('.', 1)[1]
        a = A[asm]
        a['is_test'] = int(is_test)
        if is_mig:
            a['migration_lines'] += n; sol['migration_lines'] += n; continue
        a['files'] += 1
        a[f'{ext}_lines'] += n
        a['lines'] += n
        if ext == 'cs':
            text = body.decode('utf8', 'replace')
            a['classes'] += len(re.findall(r'\b(?:public|internal|private|protected)\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|record)\s+\w', text))
            a['interfaces'] += len(re.findall(r'\binterface\s+I\w', text))
            if p.endswith('Controller.cs'): a['controllers'] += 1
            if '/Entities/' in p: a['entities'] += 1
            a['dbsets'] += text.count('DbSet<')
        if ext == 'cshtml': a['views'] += 1
        if ext == 'resx' and not NEUTRAL_RESX.search(p):
            a['resx_keys'] += body.count(b'<data ')
    for p, _ in md:
        sol['md_lines'] += counts[p][0]
    # project reference edges
    edges = []
    cs = line_counts(repo, csproj)
    name_of = {p: assembly_of(p) for p, _ in csproj}
    for p, _ in csproj:
        src = name_of[p]
        if not src: continue
        for ref in re.findall(r'<ProjectReference\s+Include="([^"]+)"', cs[p][1].decode('utf8', 'replace')):
            tgt = os.path.basename(ref.replace('\\', '/')).removesuffix('.csproj')
            edges.append((src, tgt))
        A[src]['is_test'] = int(p.startswith('tests/'))
    fan_out = collections.Counter(s for s, t in edges if not t.endswith(('.Base', '.Analyzers')) and 'Humans.Base' != t and 'Analyzers' not in t)
    fan_in = collections.Counter(t for s, t in edges if 'Base' not in t and 'Analyzers' not in t)
    for asm in A:
        A[asm]['fan_out'] = fan_out.get(asm, 0); A[asm]['fan_in'] = fan_in.get(asm, 0)
    # cloc comment split on C# app code, via a throwaway checkout
    if cloc:
        with tempfile.TemporaryDirectory() as wt:
            subprocess.run(['git', '-C', repo, 'worktree', 'add', '--detach', '-q', wt, commit], check=True, capture_output=True)
            try:
                for asm in list(A):
                    if A[asm]['is_test']: continue
                    d = os.path.join(wt, 'src', 'Sections', asm) if os.path.isdir(os.path.join(wt, 'src', 'Sections', asm)) else os.path.join(wt, 'src', asm)
                    if not os.path.isdir(d): continue
                    r = subprocess.run([cloc, '--json', '--quiet', '--include-ext=cs', '--exclude-dir=Migrations,bin,obj', d], capture_output=True, text=True)
                    try:
                        j = json.loads(r.stdout).get('C#', {})
                        A[asm]['cs_code'] = j.get('code', 0); A[asm]['cs_comment'] = j.get('comment', 0)
                    except json.JSONDecodeError:
                        pass
            finally:
                subprocess.run(['git', '-C', repo, 'worktree', 'remove', '--force', wt], capture_output=True)
    # solution totals
    for asm, a in A.items():
        pref = 'test_' if a['is_test'] else 'app_'
        for k in ('lines', 'files', 'cs_lines', 'cshtml_lines', 'resx_lines', 'js_lines', 'classes', 'interfaces', 'controllers', 'views', 'entities', 'dbsets', 'resx_keys', 'cs_code', 'cs_comment'):
            sol[pref + k] += a.get(k, 0)
    sol['assemblies'] = sum(1 for a in A.values() if not a['is_test'])
    sol['test_projects'] = sum(1 for a in A.values() if a['is_test'])
    sol['edges'] = sum(1 for s, t in edges if 'Base' not in t and 'Analyzers' not in t)
    sol['commits'] = int(git(repo, 'rev-list', '--count', commit))
    return sol, A, edges

def snapshot(repo, commit, solution):
    """reforge snapshot in a throwaway worktree; returns (version, row dict) or (version, None)."""
    ver = subprocess.run(['reforge', '--version'], capture_output=True, text=True).stdout.strip().split('+')[0]
    with tempfile.TemporaryDirectory() as wt:
        subprocess.run(['git', '-C', repo, 'worktree', 'add', '--detach', '-q', wt, commit], check=True, capture_output=True)
        try:
            out = os.path.join(wt, 'snap.csv')
            r = subprocess.run(['reforge', 'snapshot', '--solution', os.path.join(wt, solution), '--append', out], cwd=wt, capture_output=True, text=True)
            if r.returncode != 0 or not os.path.exists(out): return ver, None
            rows = list(csv.DictReader(open(out)))
            return ver, (rows[-1] if rows else None)
        finally:
            subprocess.run(['git', '-C', repo, 'worktree', 'remove', '--force', wt], capture_output=True)

def write(path, rec):
    with open(path, 'w') as f:
        json.dump(rec, f, indent=0, separators=(',', ':'), sort_keys=True); f.write('\n')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--ref', default='origin/main'); ap.add_argument('--solution', default='Humans.slnx')
    ap.add_argument('--from', dest='d_from'); ap.add_argument('--to', dest='d_to')
    ap.add_argument('--reforge', action='store_true', help='also run reforge snapshot (needs a building tree)')
    ap.add_argument('--no-cloc', action='store_true')
    ap.add_argument('--reforge-only', action='store_true', help='only the reforge producer (implies --reforge)')
    a = ap.parse_args()
    if a.reforge_only: a.reforge = True
    stats_dir = os.path.join(a.out, 'stats'); os.makedirs(stats_dir, exist_ok=True)
    reforge_dir = os.path.join(a.out, 'reforge'); os.makedirs(reforge_dir, exist_ok=True)
    d_to = a.d_to or dt.date.today().isoformat()
    probe = reforge_dir if a.reforge_only else stats_dir
    have = sorted(f[:-5] for f in os.listdir(probe) if f.endswith('.json'))
    if a.d_from: d_from = a.d_from
    elif have: d_from = (dt.date.fromisoformat(have[-1]) + dt.timedelta(days=1)).isoformat()
    else: d_from = '2026-02-04'
    if dt.date.fromisoformat(d_from) > dt.date.fromisoformat(d_to):
        print(f'nothing to do: last day {have[-1] if have else None}'); return
    cloc = None if a.no_cloc else shutil.which('cloc')
    days = day_commits(a.repo, a.ref, d_from, d_to)
    if not days: print(f'no commits on {a.ref} between {d_from} and {d_to}'); return
    num = re.compile(r'-?\d+(\.\d+)?')
    for i, (d, sha) in enumerate(days.items(), 1):
        note = ''
        if not a.reforge_only:
            sol, A, E = collect_day(a.repo, sha, cloc)
            rec = {'date': d, 'commit': sha[:9], 'collector_version': COLLECTOR_VERSION,
                   'solution': dict(sol), 'assemblies': {k: dict(v) for k, v in sorted(A.items())}, 'edges': sorted(E)}
            write(os.path.join(stats_dir, f'{d}.json'), rec)
            note += f' assemblies={len(A)} edges={len(E)}'
        if a.reforge:
            rv, snap = snapshot(a.repo, sha, a.solution)
            if snap:
                snap = {k: (float(v) if num.fullmatch(v) else v) for k, v in snap.items() if k not in ('commit_date', 'commit', 'solution')}
                write(os.path.join(reforge_dir, f'{d}.json'), {'date': d, 'commit': sha[:9], 'reforge_version': rv, 'snapshot': snap})
                note += f' reforge={rv}'
            else: note += ' reforge=FAILED'
        print(f'[{i}/{len(days)}] {d} {sha[:9]}{note}', file=sys.stderr)

if __name__ == '__main__':
    main()
