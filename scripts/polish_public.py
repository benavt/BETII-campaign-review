#!/usr/bin/env python3
"""Apply the authorized single-campaign presentation without changing science."""
import argparse,hashlib,json,re
from pathlib import Path

def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return (json.dumps(v,indent=2,allow_nan=False)+'\n').encode()
def function(text,name,replacement):
 start=text.index('function '+name+'(');match=re.search(r'^function \w+\(',text[start+1:],re.M);end=start+1+match.start() if match else len(text)
 return text[:start]+replacement.rstrip()+'\n'+text[end:]
def run(site):
 site=Path(site);manifest=json.loads((site/'publication-manifest.json').read_bytes());w=json.loads((site/'data/local-workspace.json').read_bytes());c=w['campaigns'][0];oldhash=manifest['exportedWorkspaceSha256']
 assert (site/'app.js').read_text().count(oldhash)==1,'Workspace hash differs before presentation update'
 c['name']='BETII · Candidate Review';c['objective']='Compare structures and review the final ten-sequence panel.'
 c['publicReview']={'fixedRoster':True,'reviewerCount':10,'followupRepository':'benavt/BETII-campaign-review'}
 c['dimerPlan']={'copies':2,'methods':['boltz2-exact','af3','opendde-exact','openfold','colabfold'],'variants':['untagged','ctag64'],'conditions':100,'nativeOutputsPerCondition':5,'nativeOutputs':500,'status':'preparing'}
 triage=json.loads((site/'data/triage.json').read_bytes());triage['ranking']=triage['ranking'][:9];triage.pop('excludedId',None);(site/'data/triage.json').write_bytes(encoded(triage))
 # Hotspots are mapped from the original BRD3 ET target positions, not copied
 # blindly between isoforms or native residue numbering frames.
 from Bio.Align import PairwiseAligner
 from Bio.PDB.MMCIF2Dict import MMCIF2Dict
 ref=next(m['targetSequence'] for s in c['subjects'] for m in s['modelCoverage']['models'] if m['target']=='BRD3');positions=[29,30,33,34,35,36,47,48,50,52]
 aligner=PairwiseAligner();aligner.mode='global';aligner.match_score=2;aligner.mismatch_score=-1;aligner.open_gap_score=-8;aligner.extend_gap_score=-.5
 maps={}
 for s in c['subjects']:
  for m in s['modelCoverage']['models']:
   seq=m['targetSequence'];a=aligner.align(ref,seq)[0];mapping={}
   for rb,tb in zip(a.aligned[0],a.aligned[1]):
    for ri,ti in zip(range(*rb),range(*tb)):mapping[ri+1]=ti+1
   maps[m['target']]=dict(sequenceSha256=m['targetSequenceSha256'],positions=[mapping[p] for p in positions if p in mapping],reference='BRD3 ET canonical target residues '+','.join(map(str,positions)))
 for s in c['subjects']+c.get('candidatePool',[]):
  s['summary']='AP2-9 reference control.' if s['id']=='AP2-9' else ''
  for m in s['modelCoverage']['models']:
   asset=m['molecularModel'];path=site/asset['url'].removeprefix('./');raw=path.read_text();chain=asset['roles']['receptor']
   if asset['format']=='pdb':
    ordered=list(dict.fromkeys(int(l[22:26]) for l in raw.splitlines() if l.startswith('ATOM  ') and l[21].strip()==chain and l[12:16].strip()=='CA'))
   else:
    d=MMCIF2Dict(str(path));ordered=list(dict.fromkeys(int(r) for r,ch,at in zip(d['_atom_site.auth_seq_id'],d['_atom_site.auth_asym_id'],d['_atom_site.label_atom_id']) if ch==chain and at=='CA'))
   assert len(ordered)==len(m['targetSequence'])
   asset['hotspots']=[dict(chain=chain,resi=ordered[p-1]) for p in maps[m['target']]['positions']]
   asset['hotspotMapping']={'referenceSequenceSha256':sha(ref.encode()),'targetSequenceSha256':m['targetSequenceSha256'],'referenceResidues':positions,'mapping':'global canonical ET sequence alignment','target':m['target']}
 c['hotspotMaps']=maps
 c['viewRecipe']['hotspotsApoOnly']=False
 c['viewRecipe']['hotspotScope']='Canonical BRD3 hotspot positions mapped onto each ET target in bound structures.'
 workspace=encoded(w);(site/'data/local-workspace.json').write_bytes(workspace);newhash=sha(workspace)
 for name in ['public-review-ui.mjs','followup.mjs','dimer-models.mjs','public-readiness.mjs']:(site/name).write_bytes(Path(__file__).with_name(name).read_bytes())
 (site/'review-ui.mjs').write_bytes(Path(__file__).with_name('public-review-ui.mjs').read_bytes())
 app=(site/'app.js').read_text();assert app.count(oldhash)==1;app=app.replace(oldhash,newhash)
 if "from './dimer-models.mjs'" not in app:
  app="import {renderDimerModels,dimerModelData} from './dimer-models.mjs';\n"+app
  app=app.replace("let workspace, current,", "const dimerSelections=new Map();\nlet workspace, current,")
  app=app.replace("['evidence','Evidence']", "['dimers','Binder dimers'],['evidence','Evidence']")
  app=app.replace("tab==='evidence'?evidence(c)", "tab==='dimers'?renderDimerModels(c,dimerSelections.get(c.id)||{}):tab==='evidence'?evidence(c)")
  app=app.replace("'workspace','monomers','models'].includes", "'workspace','monomers','models','dimers'].includes")
  # Existing shared viewport machinery is reused for native two-binder assets.
  marker='  bind(c);';assert app.count(marker)==1
  app=app.replace(marker,marker+"\n  if(tab==='dimers'){const d=dimerModelData(c,dimerSelections.get(c.id)||{});document.querySelectorAll('[data-dimer-candidate],[data-dimer-variant],[data-dimer-engine]').forEach(n=>n.onchange=()=>{dimerSelections.set(c.id,{candidateId:document.querySelector('[data-dimer-candidate]').value,variant:document.querySelector('[data-dimer-variant]').value,engine:document.querySelector('[data-dimer-engine]').value});render();});if(d.assets.length)viewerController=mountMolecule(document.getElementById('dimer-molecule'),{...d.subject,molecularModels:d.assets},{campaignId:c.id,palette:{binder:'#F07A21'},onStatus:t=>{document.getElementById('dimer-status').textContent=t;}});}")
  # Reversible current review; historical package records remain in the backup.
  marker="try{const id=button.dataset.reviewGood,subject="
  app=app.replace(marker,"try{const id=button.dataset.reviewGood;if(button.getAttribute('aria-pressed')==='true'){delete workspace.candidateReviews?.[c.id]?.[id];await persist();await render();notify('Looks good cleared. You can review this design again.');return;}const subject=")
  marker="  document.querySelectorAll('[data-review-followup]')";idx=app.index(marker)
  app=app[:idx]+"  document.querySelectorAll('[data-review-clear]').forEach(b=>b.onclick=async()=>{delete workspace.candidateReviews?.[c.id]?.[b.dataset.reviewClear];await persist();await render();notify('Review cleared.');});\n  document.querySelectorAll('[data-approve-check]').forEach(b=>b.onclick=()=>{notify('Review every design and resolve required model gaps before confirming the package.');document.querySelector('.guided-shortlist [data-review-good][aria-pressed=\"false\"]')?.focus();});\n"+app[idx:]
  app=app.replace("Follow-up note saved for this draft; no job was requested.","Follow-up note saved. Use Send follow-up on GitHub to submit it to the team.")
 if "from './public-readiness.mjs'" not in app:
  app="import {publicReadiness,renderPublicOverview} from './public-readiness.mjs';\n"+app
  app=app.replace("tab==='overview'?renderAffinityQuote(c)+overview(c,s,selected)","tab==='overview'?renderPublicOverview(c)")
  app=app.replace("hardIssues:[...blockers(c,selected,{limitations:true})", "hardIssues:[...publicReadiness(c),...blockers(c,selected,{limitations:true})")
  app=app.replace("limitations:f.has('package')", "limitations:f.has('package')&&blockers(c,selection(c)).length>0")
 # Remove campaign-management chrome and unrelated future/empty sections.
 app=re.sub(r'\$\{renderSidebar\([^\n]+\)\}', '',app,count=1)
 app=re.sub(r'<footer class="page-foot">.*?</footer>','<footer class="page-foot"><span data-storage-status>Reviews saved in this browser</span></footer>',app,count=1)
 app=app.replace("['provenance','History'],",'').replace("'Missing models'","'Model coverage'")
 app=re.sub(r'<div class="two-columns"><section class="panel"><h2>Annotation priority</h2>.*?</section></div>','',app,count=1)
 app=app.replace('they do not recolor PNGs or run MAGPIE.','the selected native structures keep their recorded coordinates.')
 app=app.replace('Hotspots: pink (#FF69B4) on the apo reference only; they are not automatically painted on predicted complexes.','Hotspots: pink (#FF69B4), mapped onto the ET target in every bound structure.')
 app=app.replace('This review draft is separate from frozen submitted runs.','')
 app=re.sub(r"\$\{c.selectionDraft\?`<div class=\"notice private\"><span>◇</span>.*?`:''\}",'',app,count=1)
 app=app.replace("...(c.candidatePool?[['explorer','Choose candidates']]:[]),",'')

 # Preserve generic controls in source but offer only relevant public tabs.
 app=app.replace("['jobs','Jobs & design']","['models','Model library']")
 (site/'app.js').write_text('\n'.join(line.rstrip() for line in app.splitlines())+'\n')
 shell=(site/'workspace-shell.mjs').read_text();shell=function(shell,'renderSidebar','export function renderSidebar(){return \"\";}') if False else shell
 start=shell.index('export function renderSidebar(');end=shell.index('export function renderTopbar(',start);shell=shell[:start]+'export function renderSidebar(){return \"\";}\n'+shell[end:]
 shell=shell.replace('<button class="mobile-nav-toggle" data-mobile-nav="toggle" aria-controls="campaign-navigation" aria-expanded="false">☰ Campaigns</button>','')
 shell=re.sub(r'<details class="workspace-data-explanation">.*?</details>','',shell,count=1);(site/'workspace-shell.mjs').write_text(shell)
 index=(site/'index.html').read_text();index=re.sub(r'<aside style="padding:10px 20px;background:#17354d.*?</aside>','',index,count=1);(site/'index.html').write_text(index)
 styles=(site/'style.css').read_text();marker='/* Public single-campaign layout */'
 if marker not in styles:styles+='\n'+marker+'\n.workspace{margin-left:0!important;width:100%!important}.shell-sidebar,.mobile-nav-toggle,.mobile-nav-backdrop{display:none!important}.public-review-note{display:grid;gap:6px;margin-top:12px}.guided-progress-panel progress{width:min(440px,100%)}\n'
 (site/'style.css').write_text(styles)
 molecule=(site/'molecule.mjs').read_text().replace('showHotspots = false','showHotspots = true').replace('hotspots: \'#ff0080\'','hotspots: \'#FF69B4\'');(site/'molecule.mjs').write_text(molecule)
 colors=(site/'colors.mjs').read_text().replace('Hotspots · apo reference only','ET target hotspots');(site/'colors.mjs').write_text(colors)
 model=(site/'model.mjs').read_text();marker="  assert(str(reviewer)" # Supplement the existing approval gate for this fixed public roster.
 needle='export async function makeDecision(c, selectedIds, {reviewer, note, checks, outcome, viewContext = {}}) {'
 if 'Fixed public panel' not in model:
  assert needle in model;model=model.replace(needle,needle+"\n  if(outcome==='approved'&&c.publicReview?.fixedRoster)assert(selectedIds.length===c.subjects.length&&c.subjects.every(s=>selectedIds.includes(s.id)),'Fixed public panel: review all ten designs before confirmation.');")
 if "from './public-readiness.mjs'" not in model:
  model="import {publicReadiness} from './public-readiness.mjs';\n"+model
  model=model.replace("  assert(str(reviewer)","  if(outcome==='approved'&&c.publicReview?.fixedRoster)assert(publicReadiness(c).length===0,publicReadiness(c).join(' '));\n  assert(str(reviewer)")
 (site/'model.mjs').write_text(model)
 triagehtml=(site/'triage.html').read_text();triagehtml=re.sub(r'<p id="cutoff"></p>','',triagehtml);triagehtml=re.sub(r'const x=t\.ranking\.at\(-1\);document\.querySelector\(\x27#cutoff\x27\)\.textContent=`.*?`;','',triagehtml);triagehtml=triagehtml.replace('The source archive identifies it as a historical reference; this snapshot contains no experimental control-validation record.','It is shown separately from the nine ranked candidates.');(site/'triage.html').write_text(triagehtml)
 manifest.update(exportedWorkspaceSha256=newhash,publicInterface='single-campaign-v2',hotspotsMapped=True)
 for p in site.rglob('*'):
  if p.is_file() and p.name!='publication-manifest.json':manifest['files'][str(p.relative_to(site))]={'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}
 (site/'publication-manifest.json').write_bytes(encoded(manifest));print(json.dumps(dict(status='updated',campaigns=1,hotspotTargets=list(maps),dimerConditions=100,nativeDimerOutputs=500)))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--site',type=Path,default=Path(__file__).resolve().parents[1]/'docs');run(p.parse_args().site)
