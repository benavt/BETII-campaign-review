#!/usr/bin/env python3
"""Build an additive, self-contained Jokent review from selected saved evidence."""
import argparse
from copy import deepcopy
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import unquote, urlsplit

from build_review import sanitize, MODEL_KEYS, pointer
from jokent_selectivity import predicted_selectivity,calibration_identity
from verify_dimers import coordinate_sequences

ROOT=Path(__file__).resolve().parents[1]
ROOT_LINK='<nav style="padding:10px 20px;background:#17354d;color:white"><a style="color:#c5f3ed" href="./jokent/index.html?view=explorer">Jokent Sequences · collaborator cohort →</a></nav>'
IDENTITY='betii-jokent-sequences'
METHODS=['boltz2-exact','af3','opendde-exact','openfold']
TARGETS=['BRD3','BRD2','BRD4','BRDT']
TARGET_HASHES={'BRD3':'4600d2263fa89f68fd8e8516ba54135457e656cd479d67ea55a590ed9a9a1913','BRD2':'17c49be72fa438b63e0c3f393d4ea461a54fcac651b2cdfd270d8d889311e60c','BRD4':'d0e4892556f068282a8b6de02ff14a5da3d8015ab784f95805acd680ce28c309','BRDT':'da1531718c78b6a88af1fadc46f22459a4a6283f70080b557a00d80a682f4f3a'}
# Frozen intake order and identities, verified against both collaborator FASTAs.
ROSTER={'miniprotein_2183':'63a506e125fde1cca63e0e77460a0f491c999e55b070bbc2379c9362adc8c3c6','miniprotein_879':'fe190badd02b9bf9b61391d263c6b0a7702830598d1f494245f0cfa372674f2d','miniprotein_522':'273b845cee49562b46dcfc7f5f616739b1f52fd577b5f6614c6c5d97cc16ce2e','miniprotein_50':'fcf2130729047e9bc36c86f4d703d8588bdd623e3b7dea94074b4b0dd0e029e8','miniprotein_1147':'d054d18d068c2a4426491679103f8badd04718f5dcb4c60a518a5e12ebf6e5da','miniprotein_2871':'b699cbbe4aef235ad57f37fb0bb42b0ab5987e5813feceb8fdb0eaabe9cf02c2','miniprotein_5':'a19bb95fb9588027791c9a34e84eb09dd4bfce748a55aeef15815c815e62b589','miniprotein_1762':'ca8f9566298ba79c377a8e8d57d9993675ead5b645e8728a91ce2898f4b5949b','miniprotein_2767':'fe1242a71a979a98e51f3dc2d7130a4ae65b24472104dba6498a0d0e6a62acb8','miniprotein_887':'befd13aae34eb26b28f7698d21398c03b60aa22f2a3b5dee883276aedb6ce4e4','1run_m001_fixed_sc_et_0_model_2_b0_d1':'5e1c63949cf6341f136c57b13a5a546cf24441860af68519c7b37164b3795041','1run_m008_redesign_sc_et_168_model_3_b0_d1':'34fa8c676eadfc78f389960e8ac9624004d4a116da0b303095af5ddf3ae89e05','2run_m004_fixed_sc_et_449_model_0_b0_d0':'4a3343ef2d17ecd16b1433589ead1abc00df38bd6313369a58b6d9e19fcee5a1','2run_m017_redesign_sc_et_200_model_2_b0_d0':'a6e1b33d89714cd6dbcd40c59bb8afd608b0146da7ead3bb725ca0de9d2f7b5a','2run_m017_redesign_sc_et_222_model_3_b0_d0':'311d09645654b0b2f768627c887df15736587936b6ee54e8d21ff15c651ecc24','1run_m004_fixed_sc_et_230_model_3_b0_d1':'7832622ed2ca53e8555e2f5986104d7be5786d6c64951d39ef5848804cb2999c','2run_m004_fixed_sc_et_230_model_3_b0_d0':'e0073bd582fffd74f118aac05de45348a092aaf9aa2214b740127002bad7cab4','2run_m004_redesign_sc_et_120_model_3_b0_d0':'f55229528514cdbff4081a3055af4db17f6601e7fe0624ff5a1b6ddccfc85049'}
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value,indent=2,allow_nan=False)+'\n').encode()
def require(ok,message):
 if not ok: raise ValueError(message)
def asset_path(url):
 u=urlsplit(url); p=Path(unquote(u.path))
 require(not any([u.scheme,u.netloc,u.query,u.fragment]) and not p.is_absolute() and '..' not in p.parts and p.parts[:2]==('data','assets') and p.suffix in {'.pdb','.cif','.json','.pse'},'Unsafe scientific asset URL')
 return p
def checked(root,relative):
 p=root/relative
 require(p.is_file() and p.resolve().is_relative_to(root.resolve()) and not any(q.is_symlink() for q in [p,*p.parents]),'Missing or unsafe selected scientific asset')
 return p.read_bytes()
def model_rows(subject):
 return [('complex',m) for m in subject['modelCoverage']['models']]+[('monomer',m) for m in subject.get('monomerModels',[])]+[('homodimer',m) for m in subject.get('dimerModels',[])]
def verify_model(subject,kind,m,assets):
 require(m['status']=='verified' and m['foldingEngine'] in METHODS and m['constructVariant']=='untagged','Model is outside the approved Jokent scope')
 require(m.get('nativeCompletion')=='validated' and m.get('resourceVerification')=='verified','Native completion and resource validation are required')
 proof=m.get('nativeEvidence',{})
 required=['collection','nativeAcceptance','resourceAcceptance'] if kind=='homodimer' else ['request','collection','nativeReceipt','resourceReceipt']
 require(all(isinstance(proof.get(k),dict) and re.fullmatch('[0-9a-f]{64}',proof[k].get('sha256','')) for k in required),'Native proof hashes are incomplete')
 for ref in proof.get('resourceProofs',[]):require(isinstance(ref,dict) and re.fullmatch('[0-9a-f]{64}',ref.get('sha256','')),'Resource proof hash is missing')
 sequence=subject['sequence'];require(m['constructSequence']==sequence and m['constructSequenceSha256']==sha(sequence.encode()),'Binder sequence differs')
 a=m['molecularModel'];path=asset_path(a['url']);raw=checked(assets,path)
 require(sha(raw)==m['modelSha256']==a['sha256'],'Coordinate hash differs')
 roles=a['roles'];expected={roles['binder']:sequence}
 if kind=='complex':
  require(m['target'] in TARGETS and sha(m['targetSequence'].encode())==m['targetSequenceSha256']==TARGET_HASHES[m['target']],'Target sequence hash differs from the frozen ET isoform')
  expected[roles['receptor']]=m['targetSequence']
 elif kind=='homodimer':
  require(m['copies']==2 and len(a.get('binderCopies',[]))==1,'Homodimer must declare two binder chains')
  require(a['kind']=='binder_homodimer' and roles=={'binder':'A'} and a['binderCopies']==['B'] and not a.get('contextChains') and not a.get('hotspots'),'Homodimer roles must declare only the exact two binder chains')
  require(type(m['nativeRank']) is int and 1<=m['nativeRank']<=5,'Homodimer native rank must be1–5')
  for metric in ['ipTM','pTM']:
   observations=[o for o in m.get('observations',[]) if o['metric']==metric]
   require(type(m.get(metric)) in (int,float) and math.isfinite(m[metric]) and 0<=m[metric]<=1 and len(observations)==1 and observations[0]['value']==m[metric] and m['nativeConfidence'][metric]==m[metric] and m['nativeConfidence']['modelSha256']==m['modelSha256'],'Homodimer native confidence does not match its exact model and source observations')
  expected[a['binderCopies'][0]]=sequence
 require(coordinate_sequences(assets/path)==expected,'Native full-chain identity differs')
 for o in m.get('observations',[]):
  methods=[m['foldingEngine'],'PCANN','DeltaForge']+(['Arithmetic mean of verified native C-alpha pLDDT'] if o.get('metric')=='mean_pLDDT' else [])
  require(o.get('modelSha256')==m['modelSha256'] and o.get('modelId')==m['id'] and o.get('foldingEngine')==m['foldingEngine'] and o.get('constructVariant')==m['constructVariant'] and o.get('target')==m.get('target') and o.get('method') in methods and type(o.get('value')) in (int,float) and math.isfinite(o['value']) and re.fullmatch('[0-9a-f]{64}',o.get('source',{}).get('sha256','')),'Metric is not finite and bound to the selected coordinate and condition')
  if o['metric']=='mean_pLDDT':require(0<=o['value']<=100,'Mean pLDDT must use the 0–100 scale')
  if o['metric'] in ['pTM','ipTM','ipSAE_full']:require(0<=o['value']<=1,'Confidence metric must use the 0–1 scale')
 return raw,path
def grid(subjects):
 result=[]
 for s in subjects:
  present={(kind,m['foldingEngine'],m.get('target')) for kind,m in model_rows(s)}
  for engine in METHODS:
   for kind,target in [('monomer',None),*[( 'complex',t) for t in TARGETS],('homodimer',None)]:
    result.append(dict(candidateId=s['id'],kind=kind,engine=engine,target=target,variant='untagged',status='published' if (kind,engine,target) in present else 'pending'))
 return result
def csv_bytes(fields,rows):
 f=io.StringIO(newline='');w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows);return f.getvalue().encode()
def refresh_manifest(site):
 manifest_path=site/'publication-manifest.json';manifest=json.loads(manifest_path.read_bytes())
 observed={p.relative_to(site).as_posix():dict(bytes=p.stat().st_size,sha256=sha(p.read_bytes())) for p in sorted(site.rglob('*')) if p.is_file() and p!=manifest_path}
 previous=manifest['files'];manifest['files']={name:previous[name] if previous[name]==observed[name] else observed[name] for name in previous if name in observed}
 manifest['files'].update({name:record for name,record in observed.items() if name not in manifest['files']})
 manifest_path.write_bytes(encoded(manifest))
def build(evidence,assets,netsolp,site,node='node',metric_files=()):
 raw=evidence.read_bytes();source=json.loads(raw);candidates=source['candidates'];original_workspace=(site/'data/local-workspace.json').read_bytes()
 models={m['id']:m for s in candidates for _,m in model_rows(s)};pcann_rows=[];deltaforge_rows=[]
 for metric_file in metric_files:
  metric_release=json.loads(metric_file.read_bytes())
  for entry in metric_release['observations']:
   observation=entry.get('observation',entry)
   require(observation['modelId'] in models,'Additional score refers to an unpublished model')
   model=models[observation['modelId']]
   require(observation['modelSha256']==model['modelSha256'] and model['foldingEngine']=='boltz2-exact','Additional score coordinate scope differs')
   require(not any(o['id']==observation['id'] for o in model.get('observations',[])),'Duplicate metric observation')
   if observation['method']=='DeltaForge':
    score_source=observation['source'];response_raw=Path(score_source['path']).read_bytes();require(sha(response_raw)==score_source['sha256'],'Saved DeltaForge response changed');envelope=json.loads(response_raw)
    require(pointer(envelope,score_source['locator']['pointer'])==observation['value'] and envelope['source_model_sha256']==model['modelSha256'] and envelope['scoring_PDB_sha256']==observation['provenance']['scoringPdbSha256'] and envelope['response']['source_pdb_sha256']==envelope['scoring_PDB_sha256'],'DeltaForge value or native/scoring input binding differs')
    require(calibration_identity(observation['calibration'])==calibration_identity(envelope['response']) and envelope['response'].get('success') is True and envelope['response'].get('affinity_quotable') is True and envelope['response'].get('model_equivalence_verified') is True,'Saved DeltaForge calibration or scientific validation differs')
   model.setdefault('observations',[]).append(observation)
  for row in metric_release.get('rows',[]):
   if metric_release.get('method')=='DeltaForge':
    model=models[row['modelId']];kd=[o for o in model['observations'] if o['method']=='DeltaForge' and o['metric']=='Kd_nM'];dg=[o for o in model['observations'] if o['method']=='DeltaForge' and o['metric']=='deltaG_kcal_mol']
    require(len(kd)==len(dg)==1 and row['deltaforgeKd_nM']==kd[0]['value'] and row['deltaforgeDeltaG_kcal_mol']==dg[0]['value'],'DeltaForge export row differs from source-bound observations')
    deltaforge_rows.append(dict(candidate_id=row['candidateId'],model_id=row['modelId'],model_sha256=row['modelSha256'],scoring_PDB_sha256=row['pdbSha256'],target=row['target'],construct='untagged',engine='boltz2-exact',DeltaForge_Kd_nM=row['deltaforgeKd_nM'],DeltaForge_deltaG_kcal_mol=row['deltaforgeDeltaG_kcal_mol'],response_sha256=row['responseSha256']));continue
   model=models[row['modelId']];observations=[o for o in model['observations'] if o['method']=='PCANN' and o['metric']=='Kd_nM']
   require(len(observations)==1 and row['modelSha256']==model['modelSha256'] and row['pcannKd_nM']==observations[0]['value'] and math.isfinite(row['pcannDeltaG_kcal_mol']) and row['temperatureK']==298,'PCANN export row differs from the verified native model/score')
   pcann_rows.append(dict(candidate_id=row['candidateId'],model_id=row['modelId'],model_sha256=row['modelSha256'],target=row['target'],construct='untagged',engine='boltz2-exact',pcann_Kd_nM=row['pcannKd_nM'],pcann_deltaG_kcal_mol=row['pcannDeltaG_kcal_mol'],temperature_K=row['temperatureK'],source_sha256=observations[0]['source']['sha256']))
 require(len(candidates)==18 and len({s['id'] for s in candidates})==18 and len({s['sequenceSha256'] for s in candidates})==18,'Expected the 18 unique Jokent sequences')
 require({s['id']:s['sequenceSha256'] for s in candidates}==ROSTER and [s['id'] for s in candidates]==list(ROSTER),'Candidate identities differ from the frozen collaborator intake')
 score_raw=netsolp.read_bytes();scores=list(csv.DictReader(io.StringIO(score_raw.decode())))
 require([r['candidate_id'] for r in scores]==[s['id'] for s in candidates],'NetSolP roster/order differs')
 destination=site/'jokent';require(not destination.exists(),'Jokent publication must be new')
 parent=json.loads(original_workspace)['campaigns'][0];subjects=[];bundle={};metrics=[]
 for s,row in zip(candidates,scores,strict=True):
  require(s['group']=='Jokent Sequences' and sha(s['sequence'].encode())==s['sequenceSha256']==row['sequence_sha256'],'Jokent intake identity differs')
  require(len(s['constructVariants'])==1 and s['constructVariants'][0]['id']=='untagged' and s['constructVariants'][0]['sequence']==s['sequence'],'Jokent sequences must remain as supplied')
  subject={k:deepcopy(s[k]) for k in ['id','label','displayName','kind','group','sequence','sequenceSha256','summary','source','constructVariants','modelCoverage','monomerPlan','netSolP'] if k in s}
  subject['kind']='sequence_candidate';subject['recommended']=False;subject['monomerModels']=[];subject['modelCoverage']['models']=[]
  conditions=[(kind,m['foldingEngine'],m.get('target'),m.get('nativeRank') if kind=='homodimer' else None) for kind,m in model_rows(s)]
  require(len(conditions)==len(set(conditions)),'Duplicate published structural condition')
  for engine in METHODS:
   dimers=[m for m in s.get('dimerModels',[]) if m['foldingEngine']==engine]
   require(not dimers or len(dimers)==5 and {m['nativeRank'] for m in dimers}=={1,2,3,4,5},'Homodimer publication requires the complete native five-model ensemble')
  score_values={k:float(row['predicted_'+k]) for k in ['solubility','usability']}
  require(all(math.isfinite(v) and 0<=v<=1 for v in score_values.values()) and s['netSolP']['scores']==score_values and s['netSolP']['source']['sha256']==sha(score_raw),'Saved NetSolP identity or score differs')
  subject['netSolP']=dict(model='NetSolP-D 1.0',sequenceSha256=s['sequenceSha256'],role='sequence_candidate',source=dict(path='site/data/netsolp-d-scores.csv',sha256=sha(score_raw)),scores=score_values)
  for kind,m in model_rows(s):
   data,path=verify_model(s,kind,m,assets);target=Path('data/assets')/(sha(data)+path.suffix);bundle[target]=data
   keep=set(MODEL_KEYS)|{'nativeEvidence','copies','ipTM','pTM','meanPLDDT','nativeConfidence','provenance','nativeId','candidateId','resourceVerificationScope'}
   model={k:deepcopy(v) for k,v in m.items() if k in keep};model['molecularModel']['url']='./'+str(target)
   for o in model.get('observations',[]):
    if o['metric']=='mean_pLDDT':o['unit']='0-100'
    if o.get('method')=='PCANN' and o['metric']=='Kd_nM':subject.setdefault('explorerMetrics',[]).append(dict(key='pcann_kd_nM',label='PCANN predicted Kd (nM)',value=o['value'],scale='log10',source=deepcopy(o['source']),scope=o['scope'],modelId=m['id'],modelSha256=m['modelSha256'],target=m['target'],constructVariant='untagged',foldingEngine=m['foldingEngine']))
   # The publication contains one selected native model per monomer/ET condition.
   # Full ensembles remain in the original scientific archive.
   for o in model.get('observations',[]):
    metrics.append(dict(candidate_id=s['id'],kind=kind,engine=m['foldingEngine'],target=m.get('target',''),construct='untagged',model_sha256=m['modelSha256'],metric=o['metric'],method=o['method'],value=o['value'],unit=o.get('unit') or '',source_sha256=o['source']['sha256']))
   key='modelCoverage' if kind=='complex' else 'monomerModels' if kind=='monomer' else 'dimerModels'
   if key=='modelCoverage':subject[key]['models'].append(sanitize(model))
   else:subject.setdefault(key,[]).append(sanitize(model))
  subject['predictedSelectivity']=predicted_selectivity(subject);subject['pcannPredictedSelectivity']=predicted_selectivity(subject,'PCANN');subjects.append(sanitize(subject))
 cells=grid(subjects);counts={kind:sum(r['kind']==kind and r['status']=='published' for r in cells) for kind in ['complex','monomer','homodimer']}
 stamp=datetime.now(timezone.utc).isoformat();ids=[s['id'] for s in subjects]
 campaign={k:deepcopy(parent[k]) for k in ['target','axes','viewRecipe','molecularViewPresets'] if k in parent}
 campaign.update(id=IDENTITY,name='BETII · Jokent Sequences',objective='Review all 18 unique collaborator sequences as supplied across four native folding methods and all BET ET isoforms.',recipe='Saved structures and scores only. Untagged monomers, BRD2/BRD3/BRD4/BRDT complexes and binder homodimers. Missing evidence remains pending.',workflowPin=source['workflowPin'],observedAt=source['observedAt'],demo=False,reviewOnly=True,run=dict(id='2026-11-12_jokent-sequences_001',execution='running',telemetry='verified',acceptance='needs_review'),subjects=subjects,candidatePool=deepcopy(subjects),selectionDraft=dict(schemaVersion=1,id='2026-11-13_jokent-public_001',selectedIds=ids,history=[],suggestedTarget=18,executionAuthorized=False),publicReview=dict(fixedRoster=True,reviewerCount=18,followupRepository='benavt/BETII-campaign-review',netSolPScores=dict(model='NetSolP-D 1.0',source=dict(path='site/data/netsolp-d-scores.csv',sha256=sha(score_raw)))),dimerPlan=dict(variants=['untagged'],methods=METHODS,conditions=72,nativeOutputs=360),evidence=[dict(id='saved-jokent-evidence',label='Saved collaborator predictions',kind='cache_integrity',status='needs_review',summary=f"{counts['complex']} of 288 ET complexes, {counts['monomer']} of 72 monomers and {counts['homodimer']} of 72 homodimer conditions published; NetSolP-D complete for all 18.",source=dict(label='Hash-verified Jokent intake and saved native coordinate evidence'))],requiredEvidence=['saved-jokent-evidence'])
 workspace=encoded(dict(schemaVersion=1,campaigns=[campaign],decisions=[]))
 validator="import{validateWorkspace}from './model.mjs';let s='';for await(const c of process.stdin)s+=c;validateWorkspace(JSON.parse(s));"
 result=subprocess.run([node,'--input-type=module','-e',validator],cwd=site,input=workspace,capture_output=True)
 require(result.returncode==0,'Public workspace failed validation: '+result.stderr.decode())
 destination.mkdir()
 for p in site.iterdir():
  if p.is_file() and p.suffix in {'.mjs','.js','.css','.html','.svg'} and p.name not in ['triage.html'] :shutil.copy2(p,destination/p.name)
 shutil.copytree(site/'vendor',destination/'vendor')
 for relative,data in bundle.items():p=destination/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 (destination/'data/local-workspace.json').write_bytes(workspace)
 (destination/'data/netsolp-d-scores.csv').write_bytes(score_raw)
 (destination/'data/coverage.json').write_bytes(encoded(dict(expectedConditions=432,counts=counts,cells=cells)))
 (destination/'data/native-metrics.csv').write_bytes(csv_bytes(['candidate_id','kind','engine','target','construct','model_sha256','metric','method','value','unit','source_sha256'],metrics))
 (destination/'data/pcann-scores.csv').write_bytes(csv_bytes(['candidate_id','model_id','model_sha256','target','construct','engine','pcann_Kd_nM','pcann_deltaG_kcal_mol','temperature_K','source_sha256'],pcann_rows))
 (destination/'data/deltaforge-scores.csv').write_bytes(csv_bytes(['candidate_id','model_id','model_sha256','scoring_PDB_sha256','target','construct','engine','DeltaForge_Kd_nM','DeltaForge_deltaG_kcal_mol','response_sha256'],deltaforge_rows))
 selectivity=[s['predictedSelectivity'] for s in subjects];(destination/'data/predicted-selectivity.json').write_bytes(encoded(selectivity))
 selectivity_rows=[dict(candidate_id=r['candidateId'],affinity_method='DeltaForge',status=r['status'],BRD3_Kd_nM=r.get('Kd_nM',{}).get('BRD3'),BRD2_over_BRD3=r.get('ratiosOverBRD3',{}).get('BRD2'),BRD4_over_BRD3=r.get('ratiosOverBRD3',{}).get('BRD4'),BRDT_over_BRD3=r.get('ratiosOverBRD3',{}).get('BRDT'),minimum_predicted_selectivity=r.get('minimumPredictedSelectivity'),limiting_isoform=r.get('limitingIsoform'),missing_isoforms=';'.join(r['missingTargets'])) for r in selectivity]
 (destination/'data/predicted-selectivity.csv').write_bytes(csv_bytes(['candidate_id','affinity_method','status','BRD3_Kd_nM','BRD2_over_BRD3','BRD4_over_BRD3','BRDT_over_BRD3','minimum_predicted_selectivity','limiting_isoform','missing_isoforms'],selectivity_rows))
 pcann_selectivity=[s['pcannPredictedSelectivity'] for s in subjects];(destination/'data/pcann-predicted-selectivity.json').write_bytes(encoded(pcann_selectivity))
 pcann_selectivity_rows=[dict(candidate_id=r['candidateId'],affinity_method='PCANN',status=r['status'],BRD3_Kd_nM=r.get('Kd_nM',{}).get('BRD3'),BRD2_over_BRD3=r.get('ratiosOverBRD3',{}).get('BRD2'),BRD4_over_BRD3=r.get('ratiosOverBRD3',{}).get('BRD4'),BRDT_over_BRD3=r.get('ratiosOverBRD3',{}).get('BRDT'),minimum_predicted_selectivity=r.get('minimumPredictedSelectivity'),limiting_isoform=r.get('limitingIsoform'),missing_isoforms=';'.join(r['missingTargets'])) for r in pcann_selectivity]
 (destination/'data/pcann-predicted-selectivity.csv').write_bytes(csv_bytes(['candidate_id','affinity_method','status','BRD3_Kd_nM','BRD2_over_BRD3','BRD4_over_BRD3','BRDT_over_BRD3','minimum_predicted_selectivity','limiting_isoform','missing_isoforms'],pcann_selectivity_rows))
 (destination/'jokent-sequences.fasta').write_text(''.join('>'+s['id']+'\n'+s['sequence']+'\n' for s in subjects))
 adapt_ui(destination,counts)
 from jokent_selectivity_ui import adapt_selectivity_ui
 adapt_selectivity_ui(destination)
 pcann_count=sum(o.get('method')=='PCANN' and o['metric']=='Kd_nM' for s in subjects for _,m in model_rows(s) for o in m.get('observations',[]))
 for name in ['status.html','public-readiness.mjs']:
  p=destination/name;text=p.read_text().replace('PCANN is pending where no verified saved score is present.',f'PCANN Kd is complete for {pcann_count} of 72 Boltz2 Exact isoform conditions.'+(' Remaining conditions are pending.' if pcann_count<72 else '')).replace('PCANN: only saved, coordinate-matched scores are included when available.',f'PCANN Kd: {pcann_count} of 72 Boltz2 Exact isoform conditions complete.'+(' Remaining conditions are pending.' if pcann_count<72 else '')+' All published scores match the exact native coordinate hash.').replace('Native metrics CSV</a>','Native metrics CSV</a> · <a href="./data/pcann-scores.csv" download>PCANN Kd and ΔG CSV</a>');p.write_text(text)
 deltaforge_count=len(deltaforge_rows)
 for name in ['status.html','public-readiness.mjs']:
  p=destination/name;text=p.read_text().replace('DeltaForge remains saved-scores-only; no new predictions were requested.',f'DeltaForge Kd is complete for {deltaforge_count} of 72 Exact isoform conditions under the explicitly approved batch.'+(f' The remaining {72-deltaforge_count} DeltaForge scores are pending after provider account reads timed out.' if deltaforge_count<72 else '')).replace('DeltaForge: no saved Jokent scores in this snapshot; saved-scores-only policy prohibits new predictions.',f'DeltaForge Kd: {deltaforge_count} of 72 Exact isoform conditions complete under the explicitly approved batch.'+(f' The remaining {72-deltaforge_count} DeltaForge scores are pending after provider account reads timed out.' if deltaforge_count<72 else ''));p.write_text(text)
 p=destination/'data/local-workspace.json';workspace_data=json.loads(p.read_bytes());workspace_data['campaigns'][0]['run']['execution']='unknown';workspace=encoded(workspace_data);p.write_bytes(workspace)
 p=destination/'app.js';p.write_text(re.sub(r"const publicationStorageKey='[^']+';","const publicationStorageKey='betii-jokent-"+sha(workspace)+"';",p.read_text()))
 manifest=dict(schemaVersion=1,audience='public',publicationAllowed=True,campaignId=IDENTITY,candidateIds=ids,sourceEvidenceSha256=sha(raw),sourceWorkspaceSha256=source['workspaceSha256'],originalWorkspaceSha256=sha(original_workspace),exportedWorkspaceSha256=sha(workspace),netSolPSourceSha256=sha(score_raw),createdAt=stamp,expectedConditions=432,counts=counts,scientificJobs=0,providerCalls=0,DeltaForge='explicitly-approved-saved-results' if deltaforge_count else 'saved-scores-only',deltaforgePredictions=deltaforge_count,pcannPredictions=pcann_count,completePCANNSelectivityPanels=sum(r['status']=='complete' for r in pcann_selectivity),completePredictedSelectivityPanels=sum(r['status']=='complete' for r in selectivity),selection='All 18 unique sequences, untagged only; no experimental ranking',files={})
 (destination/'publication-manifest.json').write_bytes(encoded(manifest));refresh_manifest(destination)
 index=site/'index.html';html=index.read_text()
 if ROOT_LINK not in html:index.write_text(html.replace('<body>','<body>'+ROOT_LINK,1))
 require((site/'data/local-workspace.json').read_bytes()==original_workspace,'Original ten campaign changed')
 refresh_manifest(site)
 print(json.dumps(dict(output=str(destination),counts=counts,coordinateFiles=len(bundle),metrics=len(metrics),originalWorkspaceUnchanged=True)))
def adapt_ui(destination,counts):
 index=destination/'index.html';html=index.read_text().replace(ROOT_LINK,'').replace('data-publication-id="betii-nine-plus-ap2-9"',f'data-publication-id="{IDENTITY}"')
 html=re.sub(r'<aside style="padding:10px 20px;background:#17354d.*?</aside>','',html,count=1,flags=re.S)
 html=html.replace('<body>','<body><nav style="padding:10px 20px;background:#17354d;color:white"><a style="color:#c5f3ed" href="../?view=candidates">← Nine candidates + AP2-9</a> · Jokent Sequences · 18 untagged collaborators · <a style="color:#c5f3ed" href="./status.html">Folding status &amp; downloads</a></nav>',1)
 html=html.replace('BETII · Nine candidates and control','BETII · Jokent Sequences');index.write_text(html)
 explorer=destination/'candidate-explorer.mjs';text=explorer.read_text().replace('November 1 Adaptyv selection','Jokent Sequences').replace('November 1 Adaptyv scores','Jokent NetSolP-D scores').replace('adaptyv-november-1','jokent-netsolp');explorer.write_text(text)
 for name in ['review-ui.mjs','public-review-ui.mjs']:
  p=destination/name;text=p.read_text().replace('./triage.html','./status.html').replace('./shortlist-untagged.fasta','./jokent-sequences.fasta');text=re.sub(r'<a class="button subtle" href="\./shortlist-tagged.fasta" download>Tagged FASTA</a>','',text);p.write_text(text)
 p=destination/'model.mjs';p.write_text(p.read_text().replace('review all ten designs','review all designs'))
 p=destination/'campaign-presentation.mjs';p.write_text(p.read_text().replace("if(c.selectionDraft&&c.id.startsWith('betii-'))return 'BETII · shortlist';","if(c.id==='betii-jokent-sequences')return 'BETII · Jokent Sequences';\n if(c.selectionDraft&&c.id.startsWith('betii-'))return 'BETII · shortlist';"))
 p=destination/'public-readiness.mjs';p.write_text("""export function publicReadiness(c){let missing=0;for(const s of c.subjects)for(const e of c.dimerPlan.methods){if(!s.monomerModels?.some(m=>m.foldingEngine===e&&m.status==='verified'))missing++;for(const t of ['BRD3','BRD2','BRD4','BRDT'])if(!s.modelCoverage.models.some(m=>m.target===t&&m.foldingEngine===e&&m.status==='verified'))missing++;if(!(s.dimerModels||[]).some(m=>m.foldingEngine===e&&m.status==='verified'))missing++;}return missing?[missing+' of 432 requested conditions await validated publication.']:[];}
export function renderPublicOverview(c){return '<section class="panel"><h2>Jokent Sequences</h2><p>18 unique collaborator sequences, used exactly as supplied. Four methods × four ET isoforms, monomers and binder homodimers: 432 conditions.</p><p><a href="./status.html">Full status, metrics and downloads</a></p><p>NetSolP-D is complete for all 18. PCANN is pending where no verified saved score is present. DeltaForge remains saved-scores-only; no new predictions were requested.</p><p>'+publicReadiness(c).join(' ')+'</p><p>Confidence metrics are computational predictions; human scientific acceptance remains pending.</p></section>';}
""")
 p=destination/'dimer-models.mjs';text=p.read_text().replace(",colabfold:'ColabFold'",'').replace("[['untagged','Untagged'],['ctag64','Tagged']]","[['untagged','As supplied (untagged)']]").replace('Two identical binder chains. The tagged condition has the complete 64-residue tag on both chains.','Two identical copies of the supplied untagged binder.');p.write_text(text)
 p.write_text(p.read_text().replace('<th>ipTM</th><th>pTM</th>','<th>ipTM</th><th>pTM</th><th>Mean pLDDT (0–100)</th>').replace("${Number.isFinite(m.pTM)?m.pTM.toFixed(3):'—'}</td>","${Number.isFinite(m.pTM)?m.pTM.toFixed(3):'—'}</td><td>${Number.isFinite(m.meanPLDDT)?m.meanPLDDT.toFixed(2):'—'}</td>"))
 rows=''.join('<tr><td>'+kind+'</td><td>'+str(counts[kind])+'</td><td>'+str(expected)+'</td></tr>' for kind,expected in [('complex',288),('monomer',72),('homodimer',72)])
 (destination/'status.html').write_text('''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jokent Sequences · saved evidence</title><style>body{font:16px system-ui;max-width:1050px;margin:40px auto;padding:0 20px;background:#101923;color:#edf5fb}a{color:#8ddbd2}table{border-collapse:collapse;width:100%}td,th{padding:8px;text-align:left;border-bottom:1px solid #415365}select{padding:8px}small{color:#bad0df}</style><a href="./?view=explorer">← Jokent Campaign Manager</a> · <a href="../?view=candidates">Original nine + AP2-9 panel</a><h1>Jokent Sequences</h1><p>18 unique sequences deduplicated across the original and modified collaborator FASTAs. The 10 modified-file sequences exactly repeat original-file sequences. All constructs here are untagged and unchanged.</p><p>Four methods: Boltz2 Exact, AlphaFold 3, OpenDDE Exact and OpenFold. ET targets: BRD2, BRD3, BRD4 and BRDT. Coordinates and available native confidence metrics retain their exact source hashes. Each available monomer/ET condition includes its selected native model; additional native ensemble members remain in the research archive.</p><table><thead><tr><th>Condition</th><th>Published</th><th>Requested</th></tr></thead><tbody>'''+rows+'''</tbody></table><p>NetSolP-D solubility and purification usability: complete for all 18. PCANN: only saved, coordinate-matched scores are included when available. DeltaForge: no saved Jokent scores in this snapshot; saved-scores-only policy prohibits new predictions. Completed folds do not establish affinities or experimental binding.</p><p><a href="./jokent-sequences.fasta" download>18 sequences FASTA</a> · <a href="./data/netsolp-d-scores.csv" download>NetSolP-D CSV</a> · <a href="./data/native-metrics.csv" download>Native metrics CSV</a> · <a href="./data/coverage.json" download>All 432 conditions JSON</a></p><h2>Requested conditions</h2><label>Candidate <select id="candidate"><option value="">All 18</option></select></label><table><thead><tr><th>Candidate</th><th>Condition</th><th>Method</th><th>Isoform</th><th>Status</th></tr></thead><tbody id="cells"></tbody></table><script type="module">const data=await(await fetch('./data/coverage.json')).json(),select=document.querySelector('#candidate');for(const id of [...new Set(data.cells.map(c=>c.candidateId))]){const o=document.createElement('option');o.value=id;o.textContent=id;select.append(o);}function draw(){const body=document.querySelector('#cells');body.replaceChildren();for(const c of data.cells.filter(c=>!select.value||select.value===c.candidateId)){const row=document.createElement('tr');for(const value of [c.candidateId,c.kind,c.engine,c.target||'—',c.status]){const td=document.createElement('td');td.textContent=value;row.append(td);}body.append(row);}}select.onchange=draw;draw();</script>''')
 for name in ['status.html','public-readiness.mjs']:
  p=destination/name;p.write_text(p.read_text().replace('Full status, metrics and downloads</a>','Full status, metrics and downloads</a> · <a href="./?view=affinity">kD predictions</a>').replace('← Jokent Campaign Manager</a>','← Jokent Campaign Manager</a> · <a href="./?view=affinity">kD predictions</a>'))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--evidence',type=Path,required=True);p.add_argument('--source-assets',type=Path,required=True);p.add_argument('--netsolp',type=Path,required=True);p.add_argument('--metrics',type=Path,action='append',default=[]);p.add_argument('--site',type=Path,default=ROOT/'docs');p.add_argument('--node',default='node');a=p.parse_args();build(a.evidence,a.source_assets,a.netsolp,a.site,a.node,a.metrics)
