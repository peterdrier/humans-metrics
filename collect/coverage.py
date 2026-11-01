"""Compact per-day coverage, computed once per Humans commit and reused by every rescore.

A Cobertura report is reduced to what reforge reads (package -> class -> line
number and hits), with line numbers run-length encoded as [start, end] ranges:

  {date, commit, tool, tests: {exit, seconds, summary},
   assemblies: {name: {"File.cs:Class": {"c": [[1,12],[15,15]], "u": [[13,14]]}}}}

materialize() writes it back out as a minimal Cobertura file for `reforge --coverage`.
"""
import json, xml.etree.ElementTree as ET

def ranges(nums):
    out = []
    for n in sorted(nums):
        if out and n == out[-1][1] + 1: out[-1][1] = n
        else: out.append([n, n])
    return out

def reduce(cobertura_path, keep=lambda name: True):
    root = ET.parse(cobertura_path).getroot()
    assemblies = {}
    for pkg in root.iter('package'):
        name = pkg.get('name') or ''
        if not keep(name): continue
        classes = assemblies.setdefault(name, {})
        for cls in pkg.iter('class'):
            key = f"{cls.get('filename') or ''}:{cls.get('name') or ''}"
            seen = {}
            for line in cls.iter('line'):
                try: n = int(line.get('number')); h = int(line.get('hits') or 0)
                except (TypeError, ValueError): continue
                seen[n] = seen.get(n, False) or h > 0
            if not seen: continue
            cur = classes.setdefault(key, {'c': [], 'u': []})
            cov = {n for n, hit in seen.items() if hit} | {n for r in cur['c'] for n in range(r[0], r[1] + 1)}
            unc = {n for n, hit in seen.items() if not hit} | {n for r in cur['u'] for n in range(r[0], r[1] + 1)}
            cur['c'], cur['u'] = ranges(cov), ranges(unc - cov)
    return assemblies

def materialize(doc, path):
    cov = ET.Element('coverage', {'version': 'humans-metrics'})
    pkgs = ET.SubElement(cov, 'packages')
    for name, classes in doc['assemblies'].items():
        p = ET.SubElement(pkgs, 'package', {'name': name}); cs = ET.SubElement(p, 'classes')
        for key, lines in classes.items():
            fn, _, cn = key.partition(':')
            c = ET.SubElement(cs, 'class', {'name': cn, 'filename': fn}); ls = ET.SubElement(c, 'lines')
            for a, b in lines['c']:
                for n in range(a, b + 1): ET.SubElement(ls, 'line', {'number': str(n), 'hits': '1'})
            for a, b in lines['u']:
                for n in range(a, b + 1): ET.SubElement(ls, 'line', {'number': str(n), 'hits': '0'})
    ET.ElementTree(cov).write(path, encoding='utf-8', xml_declaration=True)

def totals(doc):
    c = u = 0
    for classes in doc['assemblies'].values():
        for lines in classes.values():
            c += sum(b - a + 1 for a, b in lines['c']); u += sum(b - a + 1 for a, b in lines['u'])
    return c, c + u
