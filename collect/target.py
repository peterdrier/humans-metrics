"""Loads a target file (targets/humans.yml by default); see that file for the keys."""
import os, yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(ROOT, 'targets', 'humans.yml')

def load(path=None):
    path = os.path.abspath(path or DEFAULT)
    t = yaml.safe_load(open(path))
    t['lanes'] = os.path.join(os.path.dirname(path), t['lanes'])
    t['start'] = str(t['start'])
    return t

def add_arg(ap):
    ap.add_argument('--target', help='target file (default targets/humans.yml)')
