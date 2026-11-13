#!/usr/bin/env python3
"""Reforge producer: one data/reforge/<date>.json per UTC day, from a throwaway
worktree at the last commit of that day on origin/main.

Per day, in order; a step that fails marks the record and stops the day:
  1. build      dotnet build -c Release (a tree that does not build is not usable)
  2. tests      dotnet test under dotnet-coverage (one Cobertura file, no package
                reference needed, so early trees are covered too), integration
                suite excluded; failing tests are recorded, not fatal. The report
                is reduced to data/coverage/<date>.json (collect/coverage.py,
                generated code dropped) and that reduced report is what reforge
                scores, on this run and on every later rescore (reused unless
                --retest is passed: coverage depends on the Humans commit, not
                on reforge)
  3. snapshot   reforge snapshot --by-assembly --format json --coverage <merged>
                with --count-tokens when ANTHROPIC_API_KEY is set, sharing the
                token cache at data/reforge/token-cache.txt
  4. surface    reforge surface-score --format json, kept slim: solution totals,
                byRule and the section edges, the only figures the by-assembly
                rows lack (this pass goes away once snapshot emits them)
     The rows carry each section's five files of highest reach (topFiles,
                reforge 0.34+), lifted into top_files: {section: [...]}
  5. structure  reforge snapshot (the solution-wide row: reach, core, cycles,
                fan-out, class sizes) and reforge health reduced to the ten
                largest classes, ten most complex methods and ten riskiest
                classes, migrations left out. Neither needs a build, so
                --fill adds them to records that predate this step

The whole history scores under reforge's default config: any
reforge.surface-score.json in the tree is removed before the run, so
config_hash is constant across the series. global.json is removed too so
the installed SDK builds every tree (recorded as sdk_override).

Record: {date, commit, collector_version, reforge_version, config_hash, build,
tests: {exit, seconds, passed, failed, skipped, covered, lines}, rows: [by-assembly rows], surface: {total,
surface, internal, byRule, groups}, edges: [{from, to, count}], snapshot: {solution-wide row},
top: {classes, methods, risk}, structure_version, top_files: {section: [{file, reach,
fanOut}]}, top_files_version, seconds: {...}}

--fill-top-files adds top_files to records that lack it, from a no-score
by-assembly pass (no build, no rescore of the rows already stored).
"""
import argparse, collections, datetime as dt, glob, json, os, re, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collect import day_commits, git
import coverage as covmod
import target as tgt

T = tgt.load()   # replaced from --target in main()

VERSION = 1

def run(cmd, cwd, env=None, timeout=7200):
    t = time.time()
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env, timeout=timeout)
    return p, round(time.time() - t)

def solution_in(tree):
    s = glob.glob(os.path.join(tree, '*.slnx')) or glob.glob(os.path.join(tree, '*.sln'))
    return s[0] if s else None

def section_of(path):
    m = re.match(T['section_re'], path)
    return m.group(1).replace('.Contracts', '') if m else ''

def structure(rec, reforge, sln, tree, env):
    """Step 5. Fills rec['snapshot'] and rec['top']; a failure is recorded and leaves the rest of the record alone."""
    p, s = run([reforge, 'snapshot', '--solution', sln, '--format', 'json'], tree, env); rec['seconds']['structure'] = s
    if p.returncode: rec['structure_error'] = p.stderr[-2000:]; return
    rec['snapshot'] = json.loads(p.stdout)
    p, s = run([reforge, 'health', '--solution', sln, '--top', '100000', '--format', 'json'], tree, env); rec['seconds']['structure'] += s
    if p.returncode: rec['structure_error'] = p.stderr[-2000:]; return
    types = [t for t in json.loads(p.stdout).get('results', []) if '/Migrations/' not in t['file']]
    cls = lambda t: dict(name=t['name'], section=section_of(t['file']), lines=t['lines'], methods=t['methodCount'], risk=t['score'])
    rec['top'] = dict(
        classes=[cls(t) for t in sorted(types, key=lambda t: -t['lines'])[:10]],
        risk=[cls(t) for t in sorted(types, key=lambda t: -t['score'])[:10]],
        methods=[dict(name=f"{t['name']}.{t['maxComplexityMethod']}", section=section_of(t['file']), cyclomatic=t['maxCyclomaticComplexity'], classLines=t['lines'])
                 for t in sorted(types, key=lambda t: -t['maxCyclomaticComplexity'])[:10]])
    v = subprocess.run([reforge, '--version'], capture_output=True, text=True).stdout.strip()
    rec['structure_version'] = v.split('+')[0]
    rec.pop('structure_error', None)

def keep_top_files(rec, rows, reforge):
    tf = {r['section']: r['topFiles'] for r in rows if r.get('topFiles')}
    if not tf: return
    rec['top_files'] = tf
    rec['top_files_version'] = subprocess.run([reforge, '--version'], capture_output=True, text=True).stdout.strip().split('+')[0]

def fill_top_files(repo, rec, reforge):
    """--fill-top-files: rank files with the installed reforge, leaving the scored rows alone."""
    tree = f"/tmp/rf-{rec['date']}"
    if os.path.exists(tree): git(repo, 'worktree', 'remove', '--force', tree)
    git(repo, 'worktree', 'add', '--detach', tree, rec['commit'])
    try:
        sln = solution_in(tree)
        if not sln: return
        gj = os.path.join(tree, 'global.json')
        if os.path.exists(gj): os.remove(gj)   # as in collect_day: early trees pin an SDK patch the container lacks
        env = {**os.environ, 'DOTNET_CLI_TELEMETRY_OPTOUT': '1', 'DOTNET_NOLOGO': '1'}
        p, s = run([reforge, 'snapshot', '--solution', sln, '--by-assembly', '--no-score', '--format', 'json'], tree, env)
        rec['seconds']['top_files'] = s
        if p.returncode: rec['top_files_error'] = p.stderr[-2000:]; return
        keep_top_files(rec, json.loads(p.stdout), reforge)
        rec.pop('top_files_error', None)
    finally:
        git(repo, 'worktree', 'remove', '--force', tree)

def fill_day(repo, rec, reforge):
    """--fill: add step 5 to an existing record without rebuilding or rescoring it."""
    tree = f"/tmp/rf-{rec['date']}"
    if os.path.exists(tree): git(repo, 'worktree', 'remove', '--force', tree)
    git(repo, 'worktree', 'add', '--detach', tree, rec['commit'])
    try:
        sln = solution_in(tree)
        if sln: structure(rec, reforge, sln, tree, {**os.environ, 'DOTNET_CLI_TELEMETRY_OPTOUT': '1', 'DOTNET_NOLOGO': '1'})
    finally:
        git(repo, 'worktree', 'remove', '--force', tree)

def collect_day(repo, commit, date, outdir, reforge, tests, key, retest=False):
    tree = f'/tmp/rf-{date}'
    if os.path.exists(tree): git(repo, 'worktree', 'remove', '--force', tree)
    git(repo, 'worktree', 'add', '--detach', tree, commit)
    rec = dict(date=date, commit=commit, collector_version=VERSION, seconds={})
    env = {**os.environ, 'DOTNET_CLI_TELEMETRY_OPTOUT': '1', 'DOTNET_NOLOGO': '1',
           'REFORGE_TOKEN_CACHE': os.path.abspath(os.path.join(outdir, 'token-cache.txt'))}
    try:
        for f in glob.glob(os.path.join(tree, '**', 'reforge.surface-score.json'), recursive=True): os.remove(f)
        sln = solution_in(tree)
        if not sln: rec['build'] = 'no solution'; return rec
        gj = os.path.join(tree, 'global.json')
        if os.path.exists(gj):   # early trees pin an exact SDK patch with no rollForward; measure with the installed SDK
            os.remove(gj); rec['sdk_override'] = True
        p, s = run(['dotnet', 'build', sln, '-c', 'Release', '-v', 'quiet', '-nologo', '-p:NuGetAudit=false', '-p:RunAnalyzers=false'], tree, env)   # audit and analyzers are CI gates on today's clock, not part of the measurement
        rec['seconds']['build'] = s
        if p.returncode: rec['build'] = 'failed'; rec['build_error'] = (p.stdout + p.stderr)[-2000:]; return rec
        rec['build'] = 'ok'
        cov = None
        covdir = os.path.join(os.path.dirname(outdir), 'coverage'); os.makedirs(covdir, exist_ok=True)
        covj = os.path.join(covdir, f'{date}.json')
        if tests and os.path.exists(covj) and not retest:
            doc = json.load(open(covj)); rec['tests'] = {**doc['tests'], 'reused': True}
            cov = os.path.join(tree, 'coverage.cobertura.xml'); covmod.materialize(doc, cov)
        elif tests:
            covf = os.path.join(tree, 'coverage.cobertura.xml')
            inner = f'dotnet test {sln} --no-build -c Release -v quiet --blame-hang-timeout 5m' + (f" --filter {T['test_filter']}" if T.get('test_filter') else '')
            p, s = run(['dotnet-coverage', 'collect', '-f', 'cobertura', '-o', covf, inner], tree, env)
            tot = collections.Counter()
            for l in p.stdout.splitlines():   # one Passed!/Failed! line per test assembly
                for k, v in re.findall(r'(Failed|Passed|Skipped):\s+(\d+)', l): tot[k.lower()] += int(v)
            rec['tests'] = dict(exit=p.returncode, seconds=s, **tot)
            if os.path.exists(covf):
                doc = dict(date=date, commit=commit, tool='dotnet-coverage', format=2, tests=rec['tests'],
                           assemblies=covmod.reduce(covf, keep=lambda n: n.startswith(tuple(T['coverage_prefixes'])) and '.Tests' not in n))
                rec['tests']['covered'], rec['tests']['lines'] = covmod.totals(doc)
                json.dump(doc, open(covj, 'w'), separators=(',', ':'))
                cov = os.path.join(tree, 'coverage.reduced.xml'); covmod.materialize(doc, cov)   # score the same reduced report a rescore will reuse
            else: rec['tests']['error'] = (p.stdout + p.stderr)[-1000:]
        cmd = [reforge, 'snapshot', '--solution', sln, '--by-assembly', '--format', 'json']
        if cov: cmd += ['--coverage', cov]
        if key: cmd += ['--count-tokens']
        p, s = run(cmd, tree, env); rec['seconds']['snapshot'] = s
        if p.returncode: rec['snapshot_error'] = p.stderr[-2000:]; return rec
        rec['rows'] = json.loads(p.stdout)
        keep_top_files(rec, rec['rows'], reforge)
        sol = next((r for r in rec['rows'] if r.get('section') == '(solution)'), rec['rows'][0] if rec['rows'] else {})
        rec['reforge_version'] = sol.get('reforgeVersion'); rec['config_hash'] = sol.get('configHash')
        p, s = run([reforge, 'surface-score', '--solution', sln, '--format', 'json', *T.get('surface_args', [])], tree, env); rec['seconds']['surface'] = s
        if p.returncode: rec['surface_error'] = p.stderr[-2000:]; return rec
        j = json.loads(p.stdout)
        rec['surface'] = dict(total=j.get('total'), surface=j.get('surfaceTotal'), internal=j.get('implementationShapeTotal'), testTotal=j.get('testTotal'),
                              byRule=j.get('byRule'))   # per-section figures live in the by-assembly rows; this pass only adds totals, byRule and edges
        rec['edges'] = j.get('edges')
        structure(rec, reforge, sln, tree, env)
        return rec
    finally:
        git(repo, 'worktree', 'remove', '--force', tree)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--ref', default='origin/main'); ap.add_argument('--from', dest='d_from'); ap.add_argument('--to', dest='d_to')
    ap.add_argument('--days', nargs='*', help='explicit days instead of a range')
    ap.add_argument('--forward', action='store_true', help='oldest first (default newest first)')
    ap.add_argument('--redo', action='store_true', help='recollect days that already have a record')
    ap.add_argument('--no-tests', action='store_true'); ap.add_argument('--retest', action='store_true', help='rerun tests even when data/coverage has the day'); ap.add_argument('--reforge', default='reforge')
    ap.add_argument('--fill', action='store_true', help='add the structure step (snapshot row, top lists) to existing records in the range that lack it; no build')
    ap.add_argument('--fill-top-files', action='store_true', help='add top_files to existing records in the range that lack it; no build, rows untouched')
    tgt.add_arg(ap)
    a = ap.parse_args()
    global T
    T = tgt.load(a.target); a.d_from = a.d_from or T['start']
    outdir = os.path.join(a.out, 'reforge'); os.makedirs(outdir, exist_ok=True)
    d_to = a.d_to or (dt.date.today() - dt.timedelta(days=1)).isoformat()
    days = day_commits(a.repo, a.ref, a.d_from, d_to)
    if a.days: days = {d: days[d] for d in a.days}
    order = sorted(days) if a.forward else sorted(days, reverse=True)
    key = bool(os.environ.get('ANTHROPIC_API_KEY'))
    for d in order:
        path = os.path.join(outdir, f'{d}.json')
        if a.fill_top_files:
            if not os.path.exists(path): continue
            rec = json.load(open(path))
            if rec.get('build') != 'ok' or (rec.get('top_files') and not a.redo): continue
            fill_top_files(a.repo, rec, a.reforge)
            json.dump(rec, open(path, 'w'), separators=(',', ':'))
            print(f"{d} {rec['commit'][:9]} top_files={len(rec.get('top_files', {}))} {rec['seconds'].get('top_files')}s {rec.get('top_files_error', '')[-200:]}", file=sys.stderr, flush=True)
            continue
        if a.fill:
            if not os.path.exists(path): continue
            rec = json.load(open(path))
            if rec.get('build') != 'ok' or (rec.get('top') and not a.redo): continue
            fill_day(a.repo, rec, a.reforge)
            json.dump(rec, open(path, 'w'), separators=(',', ':'))
            print(f"{d} {rec['commit'][:9]} fill snapshot={'snapshot' in rec} top={'top' in rec} {rec['seconds'].get('structure')}s {rec.get('structure_error', '')[-200:]}", file=sys.stderr, flush=True)
            continue
        if os.path.exists(path) and not a.redo: continue
        t = time.time()
        rec = collect_day(a.repo, days[d], d, outdir, a.reforge, not a.no_tests, key, a.retest)
        rec['seconds']['total'] = round(time.time() - t)
        json.dump(rec, open(path, 'w'), separators=(',', ':'))
        print(f"{d} {days[d][:9]} build={rec.get('build')} rows={len(rec.get('rows', []))} tests={rec.get('tests', {}).get('exit')} {rec['seconds']}", file=sys.stderr, flush=True)

if __name__ == '__main__':
    main()
