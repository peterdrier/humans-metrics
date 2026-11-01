"""Compact per-day coverage, computed once per Humans commit and reused by every rescore.

A Cobertura report is reduced to what reforge reads (assembly -> file -> which
lines were measured and which were hit), as two bitmaps per file, base64 of one
bit per line number starting at line 1:

  {date, commit, tool, format: 2, tests: {exit, seconds, summary},
   assemblies: {name: {"path/File.cs": {"n": lastLine, "m": <measured>, "c": <covered>}}}}

Generated code (EF migrations, *.g.cs, *.Designer.cs) is left out, matching the
corpus reforge scores, so coverage percentages describe handwritten code.
materialize() writes it back out as a minimal Cobertura file for `reforge --coverage`.
"""
import base64, re, xml.etree.ElementTree as ET

GENERATED = re.compile(r'(^|/)Migrations/|\.g\.cs$|\.Designer\.cs$|(^|/)obj/')

def _pack(bits, n):
    buf = bytearray((n + 7) // 8)
    for i in bits: buf[(i - 1) >> 3] |= 1 << ((i - 1) & 7)
    return base64.b64encode(bytes(buf)).decode()

def _unpack(s, n):
    buf = base64.b64decode(s)
    return {i for i in range(1, n + 1) if buf[(i - 1) >> 3] >> ((i - 1) & 7) & 1}

def reduce(cobertura_path, keep=lambda name: True):
    root = ET.parse(cobertura_path).getroot()
    assemblies = {}
    for pkg in root.iter('package'):
        name = pkg.get('name') or ''
        if not keep(name): continue
        files = assemblies.setdefault(name, {})
        for cls in pkg.iter('class'):
            fn = (cls.get('filename') or '').replace('\\', '/')
            if not fn or GENERATED.search(fn): continue
            f = files.setdefault(fn, [set(), set()])   # measured, covered
            for line in cls.iter('line'):
                try: n = int(line.get('number')); h = int(line.get('hits') or 0)
                except (TypeError, ValueError): continue
                f[0].add(n)
                if h > 0: f[1].add(n)
        for fn in list(files):
            if isinstance(files[fn], list):
                m, c = files[fn]
                if not m: del files[fn]; continue
                last = max(m); files[fn] = {'n': last, 'm': _pack(m, last), 'c': _pack(c, last)}
        if not files: del assemblies[name]
    return assemblies

def lines(entry):
    m = _unpack(entry['m'], entry['n']); c = _unpack(entry['c'], entry['n']) & m
    return m, c

def materialize(doc, path):
    cov = ET.Element('coverage', {'version': 'humans-metrics'})
    pkgs = ET.SubElement(cov, 'packages')
    for name, files in doc['assemblies'].items():
        p = ET.SubElement(pkgs, 'package', {'name': name}); cs = ET.SubElement(p, 'classes')
        for fn, entry in files.items():
            c = ET.SubElement(cs, 'class', {'name': fn, 'filename': fn}); ls = ET.SubElement(c, 'lines')
            m, hit = lines(entry)
            for n in sorted(m): ET.SubElement(ls, 'line', {'number': str(n), 'hits': '1' if n in hit else '0'})
    ET.ElementTree(cov).write(path, encoding='utf-8', xml_declaration=True)

def totals(doc):
    c = t = 0
    for files in doc['assemblies'].values():
        for entry in files.values():
            m, hit = lines(entry); t += len(m); c += len(hit)
    return c, t
