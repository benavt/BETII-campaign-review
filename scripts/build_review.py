#!/usr/bin/env python3
"""Publish only a hash-verified, explicitly selected nine-plus-control snapshot.

Run on the source host with its installed Campaign Manager scientific validators.
Copies only referenced selected coordinate/confidence assets and allowlisted UI
files; never copies a workspace directory, raw provider replies or host bindings.
"""
import argparse
from copy import deepcopy
from datetime import datetime
import hashlib
import importlib.util
import itertools
import json
import math
from pathlib import Path
import re
import sys
from urllib.parse import unquote,urlsplit
from zoneinfo import ZoneInfo
from static_app import adapt_app,adapt_shell

APP_PIN='77fdef1743941469f0eb24ac829d5e333d4299e1'
ORIGINAL_IDS=['C2K_L60_0608','Brd3ET_Brd3ET_3761_model_2','Brd3ET_Brd3ET_5020_model_5','Brd3ET_Brd3ET_1010_model_0','R3-05','BRD3ET_rank17','LF-BRD2-r01','LF-BRD3-r09','Brd3ET_Brd3ET_1933_model_6','C-34']
ENGINES=['boltz2-exact','af3','opendde-exact','openfold'];TARGETS=['BRD3','BRD2','BRD4','BRDT'];VARIANTS=['untagged','ctag64']
SUBJECT_KEYS=['id','label','displayName','kind','group','sequence','sequenceSha256','constructVariants','modelCoverage','monomerModels','metrics','metricsScope','viewBindings','explorerMetrics']
MODEL_KEYS=['id','target','foldingEngine','constructVariant','status','modelSha256','constructSequence','constructSequenceSha256','targetSequence','targetSequenceSha256','source','molecularModel','nativeRank','sampleCount','nativeSelection','scope','viewBindings','observations','engineVersion','confidenceProof','nativeSummaryProof','nativeCompletion','resourceVerification','humanScientificAcceptance']

def require(ok,message):
    if not ok:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return (json.dumps(v,indent=2,allow_nan=False)+'\n').encode()
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def asset_path(url):
    parsed=urlsplit(url);p=Path(unquote(parsed.path))
    require(not any([parsed.scheme,parsed.netloc,parsed.query,parsed.fragment]) and not p.is_absolute() and '..' not in p.parts and p.parts[:2]==('data','assets') and p.suffix in {'.pdb','.cif','.json'},'Unapproved scientific asset')
    return p

def checked(root,relative):
    path=root/relative
    require(path.resolve().is_relative_to(root.resolve()) and path.is_file() and not any(p.is_symlink() for p in [path,*path.parents]),'Unsafe or absent scientific source')
    return path.read_bytes()

def sanitize(value):
    if isinstance(value,dict):return {k:sanitize(v) for k,v in value.items() if k not in {'session_id','sessionId','command','argv','raw_design_spec','run_manifest','hostname'}}
    if isinstance(value,list):return [sanitize(v) for v in value]
    if isinstance(value,str):
        # Preserve private-source identities and hashes, without exposing host paths
        # even when a path occurs inside a label rather than in a path field.
        return re.sub(r'/(?:Users|home|scratch|mnt|opt|private|tmp)/[^\s|"<>]*',lambda m:'retained-source:'+sha(m[0].encode())[:16]+'/'+Path(m[0]).name,value)
    return value

def pointer(data,path):
    for k in path.lstrip('/').split('/'):
        k=k.replace('~1','/').replace('~0','~');data=data[int(k)] if isinstance(data,list) else data[k]
    return data

def rank(subject):
    models=subject['modelCoverage']['models'];values={};calibrations=[];refs=[]
    for target in TARGETS:
        matched=[m for m in models if (m['constructVariant'],m['foldingEngine'],m['target'])==('untagged','boltz2-exact',target)]
        require(len(matched)==1 and matched[0]['status']=='verified','Exact four-isoform panel required')
        m=matched[0];observations=[o for o in m['observations'] if o['metric']=='Kd_nM'];require(len(observations)==1,'Unique saved Kd required');o=observations[0]
        require(o['modelSha256']==m['modelSha256'] and o['foldingEngine']=='boltz2-exact' and o['constructVariant']=='untagged' and o['target']==target and isinstance(o['value'],(int,float)) and math.isfinite(o['value']) and o['value']>0,'Saved Kd model/construct scope differs')
        source=o['source'];raw=Path(source['path']).read_bytes();require(sha(raw)==source['sha256'],'Saved Kd response changed')
        require(pointer(json.loads(raw),source['locator']['pointer'])==o['value'],'Saved Kd value differs from source')
        values[target]=o['value'];calibrations.append(json.dumps(o['calibration'],sort_keys=True));refs.append(source)
    require(len(set(calibrations))==1,'Incompatible scorer calibrations')
    limiting=min(TARGETS[1:],key=lambda t:values[t]);return dict(id=subject['id'],label=subject.get('displayName',subject['label']),origin=subject['group'],Kd_nM=values,minimumSelectivity=values[limiting]/values['BRD3'],limitingTarget=limiting,sources=refs)

def build(app,source,destination,node):
    import subprocess
    require(not destination.exists(),'Publication output must be new')
    require(subprocess.check_output(['git','-C',str(app),'rev-parse','HEAD'],text=True).strip()==APP_PIN,'Unexpected source UI revision')
    require(not subprocess.check_output(['git','-C',str(app),'status','--porcelain','--untracked-files=no'],text=True).strip(),'Tracked source UI differs')
    sys.path.insert(0,str(app/'scripts'));native=load(app/'scripts/import_registry_refolds.py','_public_native_validator');public=load(app/'scripts/build_public.py','_public_file_allowlist')
    raw=source.read_bytes();private=json.loads(raw);parent=next(c for c in private['campaigns'] if c['id']=='betii-final10-exact-r7');pool={s['id']:s for s in parent['candidatePool']}
    ranking=sorted([rank(pool[i]) for i in ORIGINAL_IDS],key=lambda r:(-r['minimumSelectivity'],r['id']))
    require(ranking[-1]['id']=='LF-BRD3-r09','Reviewed cutoff changed; do not silently publish a different panel')
    selected=[r['id'] for r in ranking[:9]]+['AP2-9'];control=rank(pool['AP2-9']);files={};assets={};cells=[];subjects=[]
    def bundle(value):
        if isinstance(value,dict):
            if 'url' in value:
                relative=asset_path(value['url']);content=checked(app/'site',relative);require(sha(content)==value.get('sha256'),'Scientific asset hash differs')
                target=Path('data/assets')/(sha(content)+relative.suffix);require(len(content)<64*1024*1024,'Scientific asset exceeds bound')
                assets[target]=content;value['url']='./'+str(target)
            for v in value.values():bundle(v)
        elif isinstance(value,list):
            for v in value:bundle(v)
    for index,cid in enumerate(selected):
        original=pool[cid];s={k:deepcopy(original[k]) for k in SUBJECT_KEYS if k in original};s['rank']=index+1;s['recommended']=True
        origin=original.get('designOrigin',{});s['designOrigin']={k:deepcopy(origin[k]) for k in ['method','original_design_id','run','unknowns'] if k in origin}
        s['summary']=('Requested AP2-9 positive control; saved predictions do not establish experimental control performance.' if cid=='AP2-9' else f"Candidate {index+1} of nine from the edited shortlist · minimum untagged predicted BRD3 preference {ranking[index]['minimumSelectivity']:.3g}×.")
        s['modelCoverage'].update(expectedTargets=TARGETS,expectedEngines=ENGINES,expectedVariants=VARIANTS)
        s['monomerPlan']=dict(schemaVersion=1,expectedVariants=VARIANTS,expectedEngines=ENGINES,requests=[])
        for kind,rows in [('complex',s['modelCoverage']['models']),('monomer',s['monomerModels'])]:
            trimmed=[]
            for old in rows:
                m={k:deepcopy(old[k]) for k in MODEL_KEYS if k in old};require(m['status']=='verified','Unverified model cannot enter public snapshot')
                relative=asset_path(m['molecularModel']['url']);content=checked(app/'site',relative);require(sha(content)==m['modelSha256']==m['molecularModel']['sha256'],'Native/browser coordinate identity differs')
                expected=dict(kind=kind,constructSequence=m['constructSequence'],**({'targetSequence':m['targetSequence']} if kind=='complex' else {}))
                native.structure(content,m['molecularModel']['format'],m['molecularModel']['roles'],expected)
                require(sha(m['constructSequence'].encode())==m['constructSequenceSha256'],'Construct sequence changed')
                if kind=='complex':require(sha(m['targetSequence'].encode())==m['targetSequenceSha256'],'Target sequence changed')
                cells.append(dict(candidateId=cid,kind=kind,variant=m['constructVariant'],engine=m['foldingEngine'],target=m.get('target'),modelSha256=m['modelSha256']))
                bundle(m);trimmed.append(sanitize(m))
            if kind=='complex':s['modelCoverage']['models']=trimmed
            else:s['monomerModels']=trimmed
        subjects.append(sanitize(s))
    expected=[dict(candidateId=cid,kind='monomer' if target is None else 'complex',variant=variant,engine=engine,target=target) for cid,variant,engine,target in itertools.product(selected,VARIANTS,ENGINES,[None,*TARGETS])]
    key=lambda c:tuple(c.get(k) for k in ['candidateId','kind','variant','engine','target'])
    require(len({key(c) for c in cells})==len(cells),'Duplicate structural comparison')
    missing=[c for c in expected if key(c) not in {key(c) for c in cells}]
    require(all(c['candidateId']=='AP2-9' and c['kind']=='complex' and c['engine']=='openfold' for c in missing),'Unexpected publication coverage gap')
    stamp=datetime.now(ZoneInfo('America/New_York')).isoformat();identity='betii-nine-plus-ap2-9'
    triage=sanitize(dict(schemaVersion=1,scope='Untagged, full canonical receptor constructs, Boltz2 Exact coordinates and matched saved DeltaForge calibration',formula='min(Kd_BRD2,Kd_BRD4,Kd_BRDT)/Kd_BRD3',ranking=ranking,excludedId=ranking[-1]['id'],selectedIds=selected,control=control,untaggedOnly=True,newDeltaForgeCalls=0))
    files[Path('data/triage.json')]=encoded(triage)
    files[Path('triage.html')]=Path(__file__).with_name('triage.html').read_bytes()
    files[Path('shortlist-untagged.fasta')]=''.join('>'+s['id']+(' | positive control' if s['id']=='AP2-9' else '')+'\n'+s['sequence']+'\n' for s in subjects).encode()
    files[Path('shortlist-tagged.fasta')]=''.join('>'+s['id']+' | full 64-residue tag\n'+next(v['sequence'] for v in s['constructVariants'] if v['id']=='ctag64')+'\n' for s in subjects).encode()
    c={k:deepcopy(parent[k]) for k in ['target','axes','viewRecipe','molecularViewPresets','workflowPin'] if k in parent}
    c.update(id=identity,name='BETII · Nine candidates + AP2-9 control',objective='Review the nine highest untagged isoform-selectivity candidates from the edited shortlist, with AP2-9 as the requested positive control.',recipe='Saved native Boltz2 Exact, AlphaFold 3, OpenDDE Exact and OpenFold structures · tagged/untagged · monomers and BRD-family ET complexes. DeltaForge saved-scores-only.',observedAt=stamp,demo=False,reviewOnly=True,predecessorCampaignId=parent['id'],run=dict(id='2026-11-01_nine-plus-control_001',parentIds=[parent['run']['id']],execution='completed',telemetry='verified',acceptance='needs_review'),subjects=subjects,candidatePool=deepcopy(subjects),selectionDraft=dict(schemaVersion=1,id='2026-11-01_nine-plus-control_001',selectedIds=selected,history=[],suggestedTarget=10,executionAuthorized=False),evidence=[dict(id='scoped-native-models',label='Verified selected native structures',kind='cache_integrity',status='verified',summary=f'{len(cells)} of 400 structural comparisons are bundled; every imported coordinate retains its exact source hash and full chain sequences.',source=dict(label='Explicitly authorized ten-sequence public snapshot'))],requiredEvidence=['scoped-native-models'])
    workspace=dict(schemaVersion=1,campaigns=[sanitize(c)],decisions=[]);exported=encoded(workspace)
    require(len(exported)<64*1024*1024,'Public workspace exceeds import limit')
    files[Path('data/local-workspace.json')]=exported
    for name in public.PUBLIC_FILES:
        content=checked(app/'site',Path(name))
        if name=='app.js':content=adapt_app(content,sha(exported))
        elif name=='workspace-shell.mjs':content=adapt_shell(content)
        elif name=='index.html':content=content.replace(b'Campaign Studio \xc2\xb7 Research review',b'BETII \xc2\xb7 Nine candidates and control')
        files[Path(name)]=content
    files.update(assets);files[Path('.nojekyll')]=b''
    # Static banner is part of the interface and links the exact selection evidence.
    index=files[Path('index.html')].decode();banner=f'<aside style="padding:10px 20px;background:#17354d;color:white;font:14px system-ui">Public BETII snapshot · 9 candidates + AP2-9 control · {len(cells)}/400 structural comparisons · <a style="color:#c5f3ed" href="./triage.html">Selection &amp; sequences</a></aside>'
    require(index.count('<body>')==1,'Pinned index body changed');files[Path('index.html')]=index.replace('<body>','<body>'+banner).encode()
    validator="import{validateWorkspace}from './model.mjs';let s='';for await(const c of process.stdin)s+=c;validateWorkspace(JSON.parse(s));console.log('valid');"
    result=subprocess.run([node,'--input-type=module','-e',validator],cwd=app/'site',input=exported,capture_output=True);require(result.returncode==0,'Workspace validation failed: '+result.stderr.decode())
    require(sum(len(v) for v in files.values())<850*1024*1024,'Public site exceeds bounded publication size')
    manifest=dict(schemaVersion=1,audience='public',publicationAllowed=True,snapshotId='2026-11-01_nine-plus-control_001',createdAt=stamp,appCommit=APP_PIN,sourceWorkspaceSha256=sha(raw),exportedWorkspaceSha256=sha(exported),candidateIds=selected,campaignIds=[identity],verifiedCoordinateModels=len(cells),missingCells=missing,assetCount=len(assets),selectedModelsOnly=True,DeltaForge='saved-scores-only',scientificJobs=0,providerCalls=0,files={str(k):dict(sha256=sha(v),bytes=len(v)) for k,v in sorted(files.items())})
    destination.mkdir(parents=True)
    for name,content in files.items():
        p=destination/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
    (destination/'publication-manifest.json').write_bytes(encoded(manifest))
    print(json.dumps(dict(output=str(destination),models=len(cells),missing=missing,assets=len(assets),bytes=sum(len(v) for v in files.values()),selectedIds=selected)))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--app-root',type=Path,required=True);p.add_argument('--workspace',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--node',required=True);a=p.parse_args();build(a.app_root,a.workspace,a.output,a.node)
