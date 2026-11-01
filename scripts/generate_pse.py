#!/usr/bin/env python3
"""Create and reopen source-matched PyMOL sessions for each displayed native model."""
import argparse,gzip,hashlib,json,math,re
from pathlib import Path


def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return (json.dumps(value,indent=2,allow_nan=False)+'\n').encode()
def sequence(cmd,roles):
 aa={'ALA':'A','ARG':'R','ASN':'N','ASP':'D','CYS':'C','GLN':'Q','GLU':'E','GLY':'G','HIS':'H','ILE':'I','LEU':'L','LYS':'K','MET':'M','PHE':'F','PRO':'P','SER':'S','THR':'T','TRP':'W','TYR':'Y','VAL':'V'}
 chains={}
 for atom in cmd.get_model('native and name CA').atom:
  assert atom.resn in aa and all(math.isfinite(c) for c in atom.coord)
  residues=chains.setdefault(atom.chain,{});assert atom.resi not in residues;residues[atom.resi]=aa[atom.resn]
 return {c:''.join(r.values()) for c,r in chains.items()}
def run(site,*,limit=None):
 from pymol import cmd
 site=Path(site).resolve();manifest=json.loads((site/'publication-manifest.json').read_bytes());path=site/'data/local-workspace.json';workspace=json.loads(path.read_bytes());sessions={};models=[]
 for c in workspace['campaigns']:
  for s in c['subjects']:
   for kind,rows in [('complex',s['modelCoverage']['models']),('monomer',s['monomerModels'])]:
    for model in rows:models.append((s,kind,model))
 if limit:models=models[:limit]
 output=site/'data/sessions';output.mkdir(exist_ok=True)
 for s,kind,m in models:
  asset=m['molecularModel'];relative=asset['url'].removeprefix('./');raw=(site/relative).read_bytes();assert sha(raw)==m['modelSha256']==asset['sha256']
  expected={asset['roles']['binder']:m['constructSequence']}
  if kind=='complex':expected[asset['roles']['receptor']]=m['targetSequence']
  filename=re.sub(r'[^A-Za-z0-9_.-]','_',s['id']+'__'+m['constructVariant']+'__'+m['foldingEngine']+'__'+(m.get('target') or 'monomer'))+'.pse'
  target=output/(asset['sha256']+'.pse')
  if not target.exists():
   cmd.reinitialize();cmd.set('max_threads',2);cmd.bg_color('white');cmd.set('orthoscopic',1);cmd.set('ray_shadows',0)
   cmd.read_pdbstr(raw.decode(),'native') if asset['format']=='pdb' else cmd.load_raw(raw.decode(),'cif','native')
   assert cmd.count_states('native')==1 and sequence(cmd,asset['roles'])==expected
   atom_count=cmd.count_atoms('native');cmd.hide('everything','all');cmd.show('cartoon','native')
   cmd.set_color('binder_orange',[240/255,122/255,33/255]);cmd.set_color('target_bluegray',[117/255,148/255,171/255])
   cmd.color('binder_orange','native and chain '+asset['roles']['binder'])
   if kind=='complex':cmd.color('target_bluegray','native and chain '+asset['roles']['receptor'])
   cmd.set_title('native',1,filename.removesuffix('.pse'));cmd.orient('native');cmd.zoom('native',buffer=5);cmd.save(str(target))
   # Reopen the actual standalone download and verify all chains and atom counts.
   cmd.reinitialize();cmd.load(str(target));assert cmd.get_names('objects')==['native'] and cmd.count_atoms('native')==atom_count and sequence(cmd,asset['roles'])==expected
   content=target.read_bytes()
   try:decoded=gzip.decompress(content)
   except OSError:decoded=content
   assert not any(marker in decoded for marker in [b'/home/tiburon/',b'/Users/tiburon/',b'/scratch/benavt/']), 'Session contains a private source path'
  content=target.read_bytes();reference=dict(url='./data/sessions/'+target.name,sha256=sha(content),modelSha256=asset['sha256'],format='pse',filename=filename,label='Open '+filename.removesuffix('.pse')+' in PyMOL')
  asset['pymolSession']=reference;sessions[m['id']]=reference
 # Mirror the same exact sessions into the separate explorer pool copy.
 for c in workspace['campaigns']:
  for s in c.get('candidatePool',[]):
   for m in s.get('modelCoverage',{}).get('models',[])+s.get('monomerModels',[]):
    if m['id'] in sessions:m['molecularModel']['pymolSession']=sessions[m['id']]
 oldhash=manifest['exportedWorkspaceSha256'];raw=encoded(workspace);path.write_bytes(raw);newhash=sha(raw)
 app=site/'app.js';text=app.read_text();assert text.count(oldhash)==1;text=text.replace(oldhash,newhash)
 if "from './pymol-download.mjs'" not in text:
  text="import {renderPymolDownload} from './pymol-download.mjs';\n"+text
  marker='${session?`<a class="button subtle" href="${esc(privateAssetURL(session.path))}" download>↓ PyMOL session</a>`:\'\'}'
  assert text.count(marker)==1;text=text.replace(marker,'${renderPymolDownload(subject.molecularModels)}')
 app.write_text(text)
 explorer=site/'candidate-explorer.mjs';text=explorer.read_text()
 if "from './pymol-download.mjs'" not in text:
  text="import {renderPymolDownload} from './pymol-download.mjs';\n"+text
  marker='${browser.assets.length?`<div class="viewer-options">';assert text.count(marker)==1;text=text.replace(marker,'${browser.assets.length?`<div class="artifact-links">${renderPymolDownload(browser.assets)}</div><div class="viewer-options">');explorer.write_text(text)
 (site/'pymol-download.mjs').write_bytes(Path(__file__).with_name('pymol-download.mjs').read_bytes())
 manifest.update(exportedWorkspaceSha256=newhash,pymolSessions=len(sessions),pymolVersion=cmd.get_version()[0])
 for name in ['data/local-workspace.json','app.js','candidate-explorer.mjs','pymol-download.mjs',*[str(p.relative_to(site)) for p in output.glob('*.pse')]]:
  raw=(site/name).read_bytes();manifest['files'][name]=dict(bytes=len(raw),sha256=sha(raw))
 (site/'publication-manifest.json').write_bytes(encoded(manifest));print(json.dumps(dict(status='verified',sessions=len(sessions),pymolVersion=cmd.get_version()[0],coordinatesChanged=0)))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--site',type=Path,default=Path(__file__).resolve().parents[1]/'docs');p.add_argument('--limit',type=int);a=p.parse_args();run(a.site,limit=a.limit)
