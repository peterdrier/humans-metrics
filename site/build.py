#!/usr/bin/env python3
"""Render docs/index.html from data/: the page template plus one embedded JSON blob.

The template's data contract (what the page's script reads from `D`):
  statsCols/stats   solution-wide daily rows (data/stats/*.json .solution)
  refCols/ref       reforge snapshot rows (data/reforge/*.json .snapshot, else data/seed/reforge-history.csv)
  modules           per-day module sizes, test LOC, edges and a dependency summary
  git               per-day lane/routine/model counts (data/git/*.json)
  prs, actions      per-day PR flow / gate series, and workflow runs
  runs              surface-score headline per archived run (data/surface/*.json)
  surface, byRule,  per-section and per-rule points of the latest surface-score run
  semDeps           service-interface edges of the latest surface-score run
"""
import csv, glob, json, os, re, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
days = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(ROOT, 'data', 'stats', '*.json')))]
if not days: raise SystemExit('no data/stats/*.json')
reforge_days = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(ROOT, 'data', 'reforge', '*.json')))]

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
                  s.get('app_cshtml_lines',0), s.get('app_resx_lines',0), s.get('app_js_lines',0), s.get('md_lines',0), s.get('migration_lines',0),
                  s.get('app_files',0)+s.get('test_files',0), s.get('app_classes',0), s.get('app_interfaces',0), s.get('app_controllers',0), s.get('app_views',0),
                  s.get('app_resx_keys',0), max(delta,0), max(-delta,0)])

# --- reforge snapshot rows: per-day snapshot when collected, otherwise the seeded history CSV
ref_cols = ['commit_date','loc_prod','loc_test','files_prod','classes','interfaces','avg_reach','p95_reach','max_reach','max_reach_file','core_size_pct','core_file_count','cycle_count','avg_fanout','max_fanout','max_fanout_file','avg_cyclomatic','p95_cyclomatic','max_cyclomatic','max_cyclomatic_method','avg_class_loc','p95_class_loc','max_class_loc','max_class_loc_name']
ref_by_date = {}
seed = os.path.join(ROOT, 'data', 'seed', 'reforge-history.csv')
if os.path.exists(seed):
    for r in csv.DictReader(open(seed)):
        ref_by_date[r['commit_date'][:10]] = r
for d in reforge_days:
    if d.get('snapshot'): ref_by_date[d['date']] = {'commit_date': d['date'], **d['snapshot']}
num = re.compile(r'^-?\d+(\.\d+)?$')
def val(v):
    if isinstance(v, (int, float)): return v
    v = str(v); return float(v) if num.match(v) else v
ref = [[val(r.get(c, '')) if c != 'commit_date' else r['commit_date'][:10] for c in ref_cols] for _, r in sorted(ref_by_date.items())]

# --- modules: fold .Contracts into its section, strip the Humans./Profiles. prefix; biweekly plus the last day keeps the page light
def short(n): return re.sub(r'^(Humans|Profiles)\.', '', n)
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
for p_ in sorted(glob.glob(os.path.join(ROOT, 'data', 'git', '*.json'))):
    j = json.load(open(p_))
    gitd.append({k: j[k] for k in ('date', 'lanes', 'routines', 'models', 'authors', 'all_commits')})

# --- PR producer (data/prs/<date>.json) and Actions producer (data/actions/<date>.json)
prs = [json.load(open(p_)) for p_ in sorted(glob.glob(os.path.join(ROOT, 'data', 'prs', '20*.json')))]
acts = [json.load(open(p_)) for p_ in sorted(glob.glob(os.path.join(ROOT, 'data', 'actions', '*.json')))]

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
sec_failed = [{'date': d['date'], 'commit': d['commit'][:9], 'build': d.get('build'), 'err': (d.get('build_error') or d.get('snapshot_error') or d.get('surface_error') or '')[-300:]}
              for d in reforge_days if not d.get('rows')]

# --- surface-score runs (slim per-run files under data/surface/)
runs, surface, by_rule, sem = [], [], [], None
for p in sorted(glob.glob(os.path.join(ROOT, 'data', 'surface', '*.json'))):
    j = json.load(open(p))
    runs.append({k: j[k] for k in ('date', 'commit', 'reforge_version', 'surface', 'internal', 'total')} | {'sha': j['commit'], 'version': j['reforge_version']})
    surface, by_rule, sem = j.get('groups', []), j.get('byRule', []), j.get('semDeps')

D = {'statsCols': stats_cols, 'stats': stats, 'refCols': ref_cols, 'ref': ref, 'modules': modules,
     'git': gitd, 'prs': prs, 'actions': acts, 'secDays': sec_days, 'statsSeconds': [[x['date'], x.get('seconds')] for x in days], 'secFailed': sec_failed, 'runs': runs, 'latestRun': runs[-1] if runs else None, 'surface': surface, 'byRule': by_rule, 'semDeps': sem,
     'generated': days[-1]['date']}
def dump(v, ind=''):
    # Diff-friendly JSON: a container stays on one line when short, else one child per line, so a new day is a new line.
    flat = json.dumps(v, separators=(',', ':'))
    if len(flat) <= 160 or not isinstance(v, (list, dict)) or not v: return flat
    sub = ind + ' '
    if isinstance(v, list): items = [dump(x, sub) for x in v]
    else: items = [json.dumps(k) + ':' + dump(x, sub) for k, x in v.items()]
    return ('[' if isinstance(v, list) else '{') + '\n' + ',\n'.join(sub + i for i in items) + '\n' + ind + (']' if isinstance(v, list) else '}')
tmpl = open(os.path.join(ROOT, 'site', 'template.html')).read()
out = tmpl.replace('__DATA__', dump(D))
os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
open(os.path.join(ROOT, 'docs', 'index.html'), 'w').write(out)
print(f'docs/index.html: {len(out)//1024} KB, {len(stats)} days, {len(ref)} snapshot rows, {len(modules)} module checkpoints, {len(runs)} surface runs, {len(sec_days)} per-assembly days')
