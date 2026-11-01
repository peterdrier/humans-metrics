#!/usr/bin/env python3
"""Reforge producer: one data/reforge/<date>.json per UTC day, from a throwaway
worktree at the last commit of that day on origin/main.

Per day, in order; a step that fails marks the record and stops the day:
  1. build      dotnet build -c Release (a tree that does not build is not usable)
  2. tests      dotnet test under dotnet-coverage (one Cobertura file, no package
                reference needed, so early trees are covered too), integration
                suite excluded; failing tests are recorded, not fatal. The report
                is reduced to data/coverage/<date>.json (collect/coverage.py) and
                reused by every later rescore unless --retest is passed, since
                coverage depends on the Humans commit, not on reforge
  3. snapshot   reforge snapshot --by-assembly --format json --coverage <merged>
                with --count-tokens when ANTHROPIC_API_KEY is set, sharing the
                token cache at data/reforge/token-cache.txt
  4. surface    reforge surface-score --format json, kept slim: solution totals,
                byRule and the section edges, the only figures the by-assembly
                rows lack (this pass goes away once snapshot emits them)

The whole history scores under reforge's default config: any
reforge.surface-score.json in the tree is removed before the run, so
config_hash is constant across the series. global.json is removed too so
the installed SDK builds every tree (recorded as sdk_override).

Record: {date, commit, collector_version, reforge_version, config_hash, build,
tests: {exit, failed, seconds}, rows: [by-assembly rows], surface: {total,
surface, internal, byRule, groups}, edges: [{from, to, count}], seconds: {...}}
"""
import argparse, datetime as dt, glob, json, os, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collect import day_commits, git
import coverage as covmod

VERSION = 1

def run(cmd, cwd, env=None, timeout=7200):
    t = time.time()
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env, timeout=timeout)
    return p, round(time.time() - t)

def solution_in(tree):
    s = glob.glob(os.path.join(tree, '*.slnx')) or glob.glob(os.path.join(tree, '*.sln'))
    return s[0] if s else None

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
            inner = f'dotnet test {sln} --no-build -c Release -v quiet --blame-hang-timeout 5m --filter FullyQualifiedName!~Humans.Integration.Tests'
            p, s = run(['dotnet-coverage', 'collect', '-f', 'cobertura', '-o', covf, inner], tree, env)
            rec['tests'] = dict(exit=p.returncode, seconds=s, summary=next((l.strip() for l in p.stdout.splitlines() if l.startswith('Passed!') or l.startswith('Failed!')), None))
            if os.path.exists(covf):
                cov = covf
                doc = dict(date=date, commit=commit, tool='dotnet-coverage', format=2, tests=rec['tests'],
                           assemblies=covmod.reduce(covf, keep=lambda n: n.startswith(('Humans', 'Profiles')) and '.Tests' not in n))
                json.dump(doc, open(covj, 'w'), separators=(',', ':'))
                rec['tests']['covered'], rec['tests']['lines'] = covmod.totals(doc)
            else: rec['tests']['error'] = (p.stdout + p.stderr)[-1000:]
        cmd = [reforge, 'snapshot', '--solution', sln, '--by-assembly', '--format', 'json']
        if cov: cmd += ['--coverage', cov]
        if key: cmd += ['--count-tokens']
        p, s = run(cmd, tree, env); rec['seconds']['snapshot'] = s
        if p.returncode: rec['snapshot_error'] = p.stderr[-2000:]; return rec
        rec['rows'] = json.loads(p.stdout)
        sol = next((r for r in rec['rows'] if r.get('section') == '(solution)'), rec['rows'][0] if rec['rows'] else {})
        rec['reforge_version'] = sol.get('reforgeVersion'); rec['config_hash'] = sol.get('configHash')
        p, s = run([reforge, 'surface-score', '--solution', sln, '--format', 'json'], tree, env); rec['seconds']['surface'] = s
        if p.returncode: rec['surface_error'] = p.stderr[-2000:]; return rec
        j = json.loads(p.stdout)
        rec['surface'] = dict(total=j.get('total'), surface=j.get('surfaceTotal'), internal=j.get('implementationShapeTotal'), testTotal=j.get('testTotal'),
                              byRule=j.get('byRule'))   # per-section figures live in the by-assembly rows; this pass only adds totals, byRule and edges
        rec['edges'] = j.get('edges')
        return rec
    finally:
        git(repo, 'worktree', 'remove', '--force', tree)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--ref', default='origin/main'); ap.add_argument('--from', dest='d_from', default='2026-02-04'); ap.add_argument('--to', dest='d_to')
    ap.add_argument('--days', nargs='*', help='explicit days instead of a range')
    ap.add_argument('--forward', action='store_true', help='oldest first (default newest first)')
    ap.add_argument('--redo', action='store_true', help='recollect days that already have a record')
    ap.add_argument('--no-tests', action='store_true'); ap.add_argument('--retest', action='store_true', help='rerun tests even when data/coverage has the day'); ap.add_argument('--reforge', default='reforge')
    a = ap.parse_args()
    outdir = os.path.join(a.out, 'reforge'); os.makedirs(outdir, exist_ok=True)
    d_to = a.d_to or (dt.date.today() - dt.timedelta(days=1)).isoformat()
    days = day_commits(a.repo, a.ref, a.d_from, d_to)
    if a.days: days = {d: days[d] for d in a.days}
    order = sorted(days) if a.forward else sorted(days, reverse=True)
    key = bool(os.environ.get('ANTHROPIC_API_KEY'))
    for d in order:
        path = os.path.join(outdir, f'{d}.json')
        if os.path.exists(path) and not a.redo: continue
        t = time.time()
        rec = collect_day(a.repo, days[d], d, outdir, a.reforge, not a.no_tests, key, a.retest)
        rec['seconds']['total'] = round(time.time() - t)
        json.dump(rec, open(path, 'w'), separators=(',', ':'))
        print(f"{d} {days[d][:9]} build={rec.get('build')} rows={len(rec.get('rows', []))} tests={rec.get('tests', {}).get('exit')} {rec['seconds']}", file=sys.stderr, flush=True)

if __name__ == '__main__':
    main()
