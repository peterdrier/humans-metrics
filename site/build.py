#!/usr/bin/env python3
"""Render the site into docs/: copy site/{index.html,style.css,app.js} and write one docs/data/<key>.json per dataset.

Usage: build.py [--target targets/humans.yml] [--data data] [--docs docs]. A private target passes its own data and docs dirs.
The page fetches its data, so open it over HTTP (python3 -m http.server -d docs), not file://.

The data contract (what app.js reads into `D`; its KEYS list must match):
  statsCols/stats   solution-wide daily rows (data/stats/*.json .solution)
  refCols/ref       reforge snapshot rows (data/reforge/*.json .snapshot, else data/seed/reforge-history.csv)
  reachTop          per day, the file of highest reach once composition roots (Section.cs, Program.cs) are dropped
  topFiles          that file per section on the latest day that has top_files
  top               largest classes, most complex methods and riskiest classes of the latest reforge day that has them
  modules           per-day module sizes, test LOC, edges and a dependency summary
  git               per-day lane/routine/model counts (data/git/*.json)
  prs, actions      per-day PR flow / gate series, and workflow runs
  semDeps           service-interface edges of the latest reforge day, per section: sections and call sites in each direction
  files             runtime: stored uploads per day, total and by category (data/runtime/files/*.json)
  meta              the target's timeline marks (split date, events, series start dates)
"""
import argparse, csv, glob, json, os, re, shutil, sys, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'collect'))
import target as tgt
ap = argparse.ArgumentParser(); tgt.add_arg(ap)
ap.add_argument('--data', default=os.path.join(ROOT, 'data')); ap.add_argument('--docs', default=os.path.join(ROOT, 'docs'))
A = ap.parse_args(); T = tgt.load(A.target); DATA = A.data
days = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(DATA, 'stats', '*.json')))]
if not days: raise SystemExit('no data/stats/*.json')
reforge_days = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(DATA, 'reforge', '*.json')))]

# --- solution-wide stats, in the column names the page expects
stats_cols = ['Date','App Lines','Test Lines','CS Lines','CS Code','CS Comment','CSHTML Lines','RESX Lines','JS Lines','MD Lines','Migration Lines','Files','Classes','Interfaces','Controllers','Views','Resx Keys','Day +Lines','Day -Lines']
stats = []
prev = None
for d in days:
    s = d['solution']
    total = s.get('app_lines', 0) + s.get('test_lines', 0)
    delta = total - prev if prev is not None else 0
    prev = total
    stats.append([d['date'], s.get('app_lines',0), s.get('test_lines',0), s.get('app_cs_lines',0), s.get('app_cs_code',0), s.get('app_cs_comment',0),
                  s.get('app_cshtml_lines',0) + s.get('app_razor_lines',0), s.get('app_resx_lines',0), s.get('app_js_lines',0), s.get('md_lines',0), s.get('migration_lines',0),
                  s.get('app_files',0)+s.get('test_files',0), s.get('app_classes',0), s.get('app_interfaces',0), s.get('app_controllers',0), s.get('app_views',0),
                  s.get('app_resx_keys',0), max(delta,0), max(-delta,0)])

# --- reforge snapshot rows: per-day snapshot when collected, otherwise the seeded history CSV
ref_cols = ['commit_date','loc_prod','loc_test','files_prod','classes','interfaces','avg_reach','p95_reach','max_reach','max_reach_file','core_size_pct','core_file_count','cycle_count','avg_fanout','max_fanout','max_fanout_file','avg_cyclomatic','p95_cyclomatic','max_cyclomatic','max_cyclomatic_method','avg_class_loc','p95_class_loc','max_class_loc','max_class_loc_name']
ref_by_date = {}
seed = os.path.join(DATA, 'seed', 'reforge-history.csv')
if os.path.exists(seed):
    for r in csv.DictReader(open(seed)):
        ref_by_date[r['commit_date'][:10]] = r
SNAP_KEYS = {'avg_fanout': 'avgFanOut', 'max_fanout': 'maxFanOut', 'max_fanout_file': 'maxFanOutFile'}   # the rest are plain snake_case to camelCase
def camel(c): return SNAP_KEYS.get(c) or re.sub(r'_(.)', lambda m: m.group(1).upper(), c)
for d in reforge_days:
    if d.get('snapshot'): ref_by_date[d['date']] = {'commit_date': d['date'], **{c: d['snapshot'].get(camel(c), '') for c in ref_cols[1:]}}
num = re.compile(r'^-?\d+(\.\d+)?$')
def val(v):
    if isinstance(v, (int, float)): return v
    v = str(v); return float(v) if num.match(v) else v
ref = [[val(r.get(c, '')) if c != 'commit_date' else r['commit_date'][:10] for c in ref_cols] for _, r in sorted(ref_by_date.items())]

# --- modules: fold .Contracts into its section, strip the target's name prefix (Humans./Profiles.); biweekly plus the last day keeps the page light
def short(n): return re.sub(T['short_re'], '', n)
modules = []
pick = days[::7] + ([days[-1]] if days[-1] not in days[::7] else [])
for d in pick:
    loc, tl = collections.Counter(), collections.Counter()
    for name, a in d['assemblies'].items():
        if a.get('is_test'): tl[short(name).removesuffix('.Tests')] += a.get('cs_lines', 0)
        else: loc[short(name).replace('.Contracts', '')] += a.get('cs_lines', 0) + a.get('cshtml_lines', 0)
    nodes = sorted({short(n) for n, a in d['assemblies'].items() if not a.get('is_test')})
    edges = [[short(s), short(t)] for s, t in d['edges'] if not s.startswith('tests') and short(s) in nodes and short(t) in nodes and not short(s).endswith('.Tests')]
    skip = {'Base', 'Analyzers'}
    core = [e for e in edges if e[1] not in skip]
    n = len([x for x in nodes if x not in skip])
    fo, fi = collections.Counter(e[0] for e in core), collections.Counter(e[1] for e in core)
    summ = {'nodeCount': len(nodes), 'edgeCount': len(core), 'baseEdges': len(edges) - len(core),
            'density': (len(core) / (n * (n - 1))) if n > 1 else 0, 'avgFanOut': (len(core) / n) if n else 0,
            'maxFanOut': max(fo.values(), default=0), 'maxFanOutNode': max(fo, key=fo.get, default=''),
            'maxFanIn': max(fi.values(), default=0), 'maxFanInNode': max(fi, key=fi.get, default='')}
    modules.append({'date': d['date'], 'commit': d['commit'], 'loc': dict(loc), 'testLoc': dict(tl), 'deps': {'nodes': nodes, 'edges': edges}, 'depSummary': summ})

# --- git producer (data/git/*.json): lanes per day
gitd = []
for p_ in sorted(glob.glob(os.path.join(DATA, 'git', '*.json'))):
    j = json.load(open(p_))
    gitd.append({k: j[k] for k in ('date', 'lanes', 'routines', 'models', 'authors', 'all_commits')})

# --- PR producer (data/prs/<date>.json) and Actions producer (data/actions/<date>.json)
prs = [json.load(open(p_)) for p_ in sorted(glob.glob(os.path.join(DATA, 'prs', '20*.json')))]
acts = [json.load(open(p_)) for p_ in sorted(glob.glob(os.path.join(DATA, 'actions', '*.json')))]

# --- reforge 0.31 day records (collect/reforgehist.py): per-section rows, totals, edges
SEC_KEYS = {'loc': 'locProd', 'files': 'files', 'classes': 'classes', 'ifaces': 'interfaces', 'methods': 'methods',
            'cog': 'cognitiveAvg', 'cogMax': 'cognitiveMax', 'maxClass': 'maxClassLoc',
            'expTypes': 'exportedTypes', 'expRead': 'exportedReadMethods', 'expWrite': 'exportedWriteMethods',
            'expUnused': 'exportedMethodsUnusedExternally', 'intTypes': 'internalTypes',
            'tokens': 'tokensProd', 'tokSrc': 'tokensProdSource', 'score': 'scoreTotal', 'surf': 'scoreSurface', 'impl': 'scoreImplementation',
            'sizeCharge': 'sectionSizeCharge', 'classCharge': 'classSizeCharge',
            'testScore': 'testScore', 'testLoc': 'testLoc', 'testMethods': 'testMethods', 'testTokens': 'tokensTests', 'testRatio': 'testTokenRatio',
            'covLines': 'coverageTotal', 'cov': 'coveragePercent'}
sec_days = []
for d in reforge_days:
    if not d.get('rows'): continue
    secs = {}
    for r in d['rows']:
        secs[r['section']] = {k: r.get(v) for k, v in SEC_KEYS.items()}
    sol_row = next((r for r in d['rows'] if r.get('section') == '(solution)'), {})
    sec_days.append({'date': d['date'], 'testSeconds': (d.get('tests') or {}).get('seconds'), 'tokSrc': sol_row.get('tokensProdSource'), 'sdk': d.get('sdk_override', False), 'commit': d['commit'][:9], 'version': d.get('reforge_version'), 'config': d.get('config_hash'),
                     'build': d.get('build'), 'tests': (d.get('tests') or {}).get('exit'), 'seconds': d.get('seconds'),
                     'total': (d.get('surface') or {}).get('total'), 'edges': len(d.get('edges') or []),
                     'byRule': (d.get('surface') or {}).get('byRule'), 'sections': secs})
sec_failed = [{'date': d['date'], 'commit': d['commit'][:9], 'version': d.get('reforge_version'), 'build': d.get('build'), 'err': (d.get('build_error') or d.get('snapshot_error') or d.get('surface_error') or '')[-300:]}
              for d in reforge_days if not d.get('rows')]

# --- latest reforge day: semantic edges per section, and the top lists
sem, top = None, None
edged = next((d for d in reversed(reforge_days) if d.get('edges')), None)
if edged:
    agg = collections.defaultdict(lambda: dict(uses=0, usedBy=0, callsOut=0, callsIn=0))
    sem_edges = [e for e in edged['edges'] if 'Base' not in (e['from'], e['to'])]   # every section calls Base (Users core, audit append); it would flatten the chart
    for e in sem_edges:
        agg[e['from']]['uses'] += 1; agg[e['from']]['callsOut'] += e.get('count', 0)
        agg[e['to']]['usedBy'] += 1; agg[e['to']]['callsIn'] += e.get('count', 0)
    sem = {'date': edged['date'], 'edges': len(sem_edges), 'sections': [{'section': k, **v} for k, v in sorted(agg.items())]}
# --- reach without composition roots: a section's Section.cs (and the Shell's Program.cs) names every type it
#     registers, so its reach is the whole section and says nothing about coupling; drop them, keep the rest.
#     A file naming a single other file only repeats that file's reach (Users' AddHumansIdentity shim calls Section.cs).
def wiring(f): return os.path.basename(f['file']) in ('Section.cs', 'Program.cs') or f['fanOut'] <= 1
def real_tops(d):
    out = {}
    for sec, fs in (d.get('top_files') or {}).items():
        if sec == '(solution)': continue
        f = next((f for f in fs if not wiring(f)), None)
        if f: out[sec] = f
    return out
reach_top, top_files = [], None
for d in reforge_days:
    rt = real_tops(d)
    if not rt: continue
    sec, f = max(rt.items(), key=lambda kv: (kv[1]['reach'], kv[1]['fanOut']))
    reach_top.append([d['date'], f['reach'], f['file'], f['fanOut']])
    top_files = {'date': d['date'], 'version': d.get('top_files_version'),
                 'sections': sorted(({'section': k, **v} for k, v in rt.items()), key=lambda x: (-x['reach'], -x['fanOut']))}
topd = next((d for d in reversed(reforge_days) if d.get('top')), None)
if topd: top = {'date': topd['date'], 'version': topd.get('structure_version'), **topd['top']}

# --- runtime: stored files (app data, not code), its own series
files = [{k: j[k] for k in ('date', 'count', 'bytes', 'categories')}
         for j in (json.load(open(p)) for p in sorted(glob.glob(os.path.join(DATA, 'runtime', 'files', '*.json'))))]

D = {'statsCols': stats_cols, 'stats': stats, 'refCols': ref_cols, 'ref': ref, 'modules': modules,
     'git': gitd, 'prs': prs, 'actions': acts, 'secDays': sec_days, 'statsSeconds': [[x['date'], x.get('seconds')] for x in days], 'secFailed': sec_failed, 'semDeps': sem, 'top': top, 'files': files, 'reachTop': reach_top, 'topFiles': top_files,
     'generated': days[-1]['date'],
     'meta': {'split': T['page'].get('split'), 'splitLabel': T['page'].get('split_label'), 'events': T['page'].get('events', []),
              'gitFrom': T['page'].get('git_from'), 'prsFrom': T['page'].get('prs_from')}}
def dump(v, ind=''):
    # Diff-friendly JSON: a container stays on one line when short, else one child per line, so a new day is a new line.
    flat = json.dumps(v, separators=(', ', ': '))
    if len(flat) <= 160 or not isinstance(v, (list, dict)) or not v: return flat
    sub = ind + '  '
    if isinstance(v, list): items = [dump(x, sub) for x in v]
    else: items = [json.dumps(k) + ': ' + dump(x, sub) for k, x in v.items()]
    return ('[' if isinstance(v, list) else '{') + '\n' + ',\n'.join(sub + i for i in items) + '\n' + ind + (']' if isinstance(v, list) else '}')
DOCS = A.docs
os.makedirs(os.path.join(DOCS, 'data'), exist_ok=True)
for f in ('style.css', 'app.js'):
    shutil.copyfile(os.path.join(ROOT, 'site', f), os.path.join(DOCS, f))
html = open(os.path.join(ROOT, 'site', 'index.html')).read()
last = max(D['generated'], reforge_days[-1]['date']) if reforge_days else D['generated']
html = re.sub(r'<div class="eyebrow">[^<]* · [\d-]+ to [\d-]+', lambda m: f'<div class="eyebrow">{T["eyebrow"]} · {days[0]["date"]} to {last}', html)
html = re.sub(r'<title>[^<]*</title>', f'<title>{T["title"]}</title>', html, count=1)
html = re.sub(r'<h1>[^<]*</h1>', f'<h1>{T["title"]}</h1>', html, count=1)
open(os.path.join(DOCS, 'index.html'), 'w').write(html)
for stale in set(os.path.splitext(f)[0] for f in os.listdir(os.path.join(DOCS, 'data'))) - set(D):
    os.remove(os.path.join(DOCS, 'data', stale + '.json'))   # a dataset the page no longer reads
for k, v in D.items():
    open(os.path.join(DOCS, 'data', f'{k}.json'), 'w').write(dump(v) + '\n')
size = sum(os.path.getsize(os.path.join(DOCS, 'data', f'{k}.json')) for k in D)
print(f'docs/data: {len(D)} files, {size//1024} KB, {len(stats)} days, {len(ref)} snapshot rows, {len(modules)} module checkpoints, {len(sec_days)} per-assembly days')
