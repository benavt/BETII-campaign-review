#!/usr/bin/env python3
"""Verify the complete public file allowlist, scope, hashes and asset closure."""
import argparse,hashlib,json,re
from verify_dimers import verify_dimers
from pathlib import Path
from urllib.parse import unquote,urlsplit

def verify(root):
 manifest=json.loads((root/'publication-manifest.json').read_bytes());expected=set(manifest['files'])|{'publication-manifest.json'};actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
 assert actual==expected and not any(p.is_symlink() for p in root.rglob('*')),'Public file allowlist differs'
 for name,record in manifest['files'].items():
  p=Path(name);assert not p.is_absolute() and '..' not in p.parts
  raw=(root/p).read_bytes();assert len(raw)==record['bytes'] and hashlib.sha256(raw).hexdigest()==record['sha256'],name
 workspace=json.loads((root/'data/local-workspace.json').read_bytes());assert len(workspace['campaigns'])==1
 c=workspace['campaigns'][0];assert c['id']=='betii-nine-plus-ap2-9' and len(c['subjects'])==10 and {s['id'] for s in c['subjects']}==set(manifest['candidateIds'])
 assert c['selectionDraft']['selectedIds']==manifest['candidateIds'] and manifest['candidateIds'][-1]=='AP2-9' and 'LF-BRD3-r09' not in manifest['candidateIds']
 def walk(value):
  if isinstance(value,dict):
   if 'url' in value:
    u=urlsplit(value['url']);p=Path(unquote(u.path));assert not any([u.scheme,u.netloc,u.query,u.fragment]) and not p.is_absolute() and '..' not in p.parts and str(p) in expected,'Unbundled scientific asset'
   for child in value.values():walk(child)
  elif isinstance(value,list):
   for child in value:walk(child)
  elif isinstance(value,str):assert not re.search(r'/(?:Users|home|scratch|mnt)/|tail[0-9a-z]+\.ts\.net|github\.rpi\.edu|(?i:Bearer\s|ghp_|github_pat_|api[_-]?key\s*[:=])',value),'Private path or credential marker'
 walk(workspace);walk(json.loads((root/'data/triage.json').read_bytes()))
 for p in root.glob('*'):
  if p.suffix in {'.mjs','.js'}:
   for ref in re.findall(r"(?:from\s*|import\s*\()\s*['\"](\./[^'\"]+)['\"]",p.read_text()):assert (p.parent/ref).is_file(),ref
 for ref in re.findall(r'(?:src|href)="(\./[^"?#]+)',(root/'index.html').read_text()):assert (root/ref).is_file(),ref
 dimers=verify_dimers(root,workspace,manifest)
 return dict(**dimers,valid=True,candidates=10,structuralCells=manifest['verifiedCoordinateModels'],missing=len(manifest['missingCells']),files=len(actual),bytes=sum(r['bytes'] for r in manifest['files'].values()),public=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--site',type=Path,default=Path(__file__).resolve().parents[1]/'docs');print(json.dumps(verify(p.parse_args().site)))
