#!/usr/bin/env python3
"""Independently verify the added Jokent package and its complete asset closure."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit,unquote
from build_jokent import IDENTITY,ROSTER,METHODS,TARGETS,grid,model_rows,verify_model
from jokent_selectivity import predicted_selectivity

def sha(raw):return hashlib.sha256(raw).hexdigest()
def verify(site):
 root=site/'jokent';manifest=json.loads((root/'publication-manifest.json').read_bytes())
 assert manifest['campaignId']==IDENTITY and manifest['candidateIds']==list(ROSTER)
 assert manifest['scientificJobs']==manifest['providerCalls']==0 and manifest['DeltaForge'] in ['saved-scores-only','explicitly-approved-saved-results']
 assert sha((site/'data/local-workspace.json').read_bytes())==manifest['originalWorkspaceSha256'],'Original ten-candidate scientific workspace changed'
 actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()};expected=set(manifest['files'])|{'publication-manifest.json'}
 assert actual==expected and not any(p.is_symlink() for p in root.rglob('*')),'Jokent file allowlist differs'
 for name,record in manifest['files'].items():
  p=Path(name);assert not p.is_absolute() and '..' not in p.parts
  raw=(root/p).read_bytes();assert len(raw)==record['bytes'] and sha(raw)==record['sha256'],name
 raw=(root/'data/local-workspace.json').read_bytes();assert sha(raw)==manifest['exportedWorkspaceSha256']
 workspace=json.loads(raw);campaign,=workspace['campaigns'];subjects=campaign['subjects']
 assert campaign['id']==IDENTITY and campaign['candidatePool']==subjects
 assert campaign['selectionDraft']['selectedIds']==list(ROSTER)
 assert {s['id']:s['sequenceSha256'] for s in subjects}==ROSTER and [s['id'] for s in subjects]==list(ROSTER)
 assert campaign['dimerPlan']['methods']==METHODS and campaign['dimerPlan']['variants']==['untagged']
 coordinate_hashes=set();metric_count=pcann_count=0
 for s in subjects:
  assert sha(s['sequence'].encode())==s['sequenceSha256']
  assert len(s['constructVariants'])==1 and s['constructVariants'][0]['id']=='untagged' and s['constructVariants'][0]['sequence']==s['sequence']
  assert s['modelCoverage']['expectedTargets']==TARGETS and s['modelCoverage']['expectedEngines']==METHODS and s['modelCoverage']['expectedVariants']==['untagged']
  conditions=[];homodimers={}
  for kind,m in model_rows(s):
   verify_model(s,kind,m,root);coordinate_hashes.add(m['modelSha256'])
   conditions.append((kind,m['foldingEngine'],m.get('target'),m.get('nativeRank') if kind=='homodimer' else None))
   if kind=='homodimer':homodimers.setdefault(m['foldingEngine'],[]).append(m)
   for o in m.get('observations',[]):
    metric_count+=1;pcann_count+=o['method']=='PCANN'
    if o['metric']=='mean_pLDDT':assert o['unit']=='0-100'
  assert len(conditions)==len(set(conditions))
  for rows in homodimers.values():assert len(rows)==5 and {m['nativeRank'] for m in rows}=={1,2,3,4,5}
 with (root/'data/netsolp-d-scores.csv').open(newline='') as f:scores=list(csv.DictReader(f))
 assert sha((root/'data/netsolp-d-scores.csv').read_bytes())==manifest['netSolPSourceSha256']
 assert [r['candidate_id'] for r in scores]==list(ROSTER)
 for s,row in zip(subjects,scores,strict=True):
  assert s['sequenceSha256']==row['sequence_sha256'] and s['netSolP']['scores']=={k:float(row['predicted_'+k]) for k in ['solubility','usability']}
 with (root/'data/native-metrics.csv').open(newline='') as f:metrics=list(csv.DictReader(f))
 assert len(metrics)==metric_count
 with (root/'data/pcann-scores.csv').open(newline='') as f:pcann=list(csv.DictReader(f))
 assert len(pcann)==pcann_count
 lookup={m['id']:m for s in subjects for _,m in model_rows(s)}
 for row in pcann:
  model=lookup[row['model_id']];observations=[o for o in model['observations'] if o['method']=='PCANN' and o['metric']=='Kd_nM']
  assert len(observations)==1 and row['model_sha256']==model['modelSha256'] and float(row['pcann_Kd_nM'])==observations[0]['value'] and row['source_sha256']==observations[0]['source']['sha256']
  assert row['temperature_K']=='298' and row['construct']=='untagged' and row['engine']=='boltz2-exact'
 with (root/'data/deltaforge-scores.csv').open(newline='') as f:deltaforge=list(csv.DictReader(f))
 expected_deltaforge=[(m,o) for m in lookup.values() for o in m.get('observations',[]) if o['method']=='DeltaForge' and o['metric']=='Kd_nM']
 assert len(deltaforge)==len(expected_deltaforge)==manifest['deltaforgePredictions']
 for row in deltaforge:
  model=lookup[row['model_id']];scores=[o for o in model['observations'] if o['method']=='DeltaForge'];kd=[o for o in scores if o['metric']=='Kd_nM'];dg=[o for o in scores if o['metric']=='deltaG_kcal_mol']
  assert len(kd)==len(dg)==1 and row['model_sha256']==model['modelSha256'] and float(row['DeltaForge_Kd_nM'])==kd[0]['value'] and float(row['DeltaForge_deltaG_kcal_mol'])==dg[0]['value'] and row['response_sha256']==kd[0]['source']['sha256']
 selectivity=[predicted_selectivity(s) for s in subjects]
 assert json.loads((root/'data/predicted-selectivity.json').read_bytes())==selectivity
 assert all(s['predictedSelectivity']==r for s,r in zip(subjects,selectivity,strict=True))
 assert manifest['completePredictedSelectivityPanels']==sum(r['status']=='complete' for r in selectivity)
 pcann_selectivity=[predicted_selectivity(s,'PCANN') for s in subjects]
 assert json.loads((root/'data/pcann-predicted-selectivity.json').read_bytes())==pcann_selectivity
 assert all(s['pcannPredictedSelectivity']==r for s,r in zip(subjects,pcann_selectivity,strict=True))
 assert manifest.get('pcannPredictions',len(pcann))==len(pcann) and manifest.get('completePCANNSelectivityPanels',sum(r['status']=='complete' for r in pcann_selectivity))==sum(r['status']=='complete' for r in pcann_selectivity)
 for method,stem,series in [('DeltaForge','predicted-selectivity',selectivity),('PCANN','pcann-predicted-selectivity',pcann_selectivity)]:
  with (root/('data/'+stem+'.csv')).open(newline='') as f:selectivity_csv=list(csv.DictReader(f))
  assert len(selectivity_csv)==18
  for row,r in zip(selectivity_csv,series,strict=True):
   assert row['candidate_id']==r['candidateId'] and row['status']==r['status'] and row['affinity_method']==method and row['missing_isoforms']==';'.join(r['missingTargets'])
   if r['status']=='complete':
    assert float(row['BRD3_Kd_nM'])==r['Kd_nM']['BRD3'] and float(row['minimum_predicted_selectivity'])==r['minimumPredictedSelectivity'] and row['limiting_isoform']==r['limitingIsoform']
    for t in ['BRD2','BRD4','BRDT']:assert float(row[t+'_over_BRD3'])==r['ratiosOverBRD3'][t]
   else:assert not any(row[k] for k in ['BRD2_over_BRD3','BRD4_over_BRD3','BRDT_over_BRD3','minimum_predicted_selectivity','limiting_isoform'])
 for s in subjects:
  for kind,m in model_rows(s):
   for o in m.get('observations',[]):
    matches=[r for r in metrics if r['candidate_id']==s['id'] and r['kind']==kind and r['model_sha256']==m['modelSha256'] and r['metric']==o['metric'] and r['source_sha256']==o['source']['sha256']]
    assert len(matches)==1 and float(matches[0]['value'])==o['value']
 coverage=json.loads((root/'data/coverage.json').read_bytes());assert coverage['expectedConditions']==432 and coverage['cells']==grid(subjects)
 assert len({(r['candidateId'],r['kind'],r['engine'],r['target']) for r in coverage['cells']})==432
 counts={kind:sum(r['kind']==kind and r['status']=='published' for r in coverage['cells']) for kind in ['complex','monomer','homodimer']}
 assert manifest['counts']==coverage['counts']==counts
 def walk(value):
  if isinstance(value,dict):
   if 'url' in value:
    u=urlsplit(value['url']);p=Path(unquote(u.path));assert not any([u.scheme,u.netloc,u.query,u.fragment]) and not p.is_absolute() and '..' not in p.parts and str(p) in expected,'Unbundled scientific asset'
   for child in value.values():walk(child)
  elif isinstance(value,list):
   for child in value:walk(child)
  elif isinstance(value,str):assert not re.search(r'/(?:Users|home|scratch|mnt)/|tail[0-9a-z]+\.ts\.net|github\.rpi\.edu|(?i:Bearer\s|ghp_|github_pat_)',value),'Private source material'
 walk(workspace)
 for p in root.glob('*'):
  if p.suffix in {'.mjs','.js'}:
   for ref in re.findall(r"(?:from\s*|import\s*\()\s*['\"](\./[^'\"]+)['\"]",p.read_text()):assert (p.parent/ref).is_file(),ref
 for ref in re.findall(r'(?:src|href)="(\./[^"?#]+)',(root/'index.html').read_text()):assert (root/ref).is_file(),ref
 return dict(valid=True,candidates=18,expectedConditions=432,counts=counts,coordinateFiles=len(coordinate_hashes),metrics=metric_count,pcannObservations=pcann_count,deltaforgePredictions=len(deltaforge),completePredictedSelectivityPanels=manifest['completePredictedSelectivityPanels'],originalWorkspaceUnchanged=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--site',type=Path,default=Path(__file__).resolve().parents[1]/'docs');print(json.dumps(verify(p.parse_args().site)))
