#!/usr/bin/env python3
"""Refresh presentation assets without rebuilding or changing scientific evidence."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
SHARED=['affinity.mjs','themes.css','responsive.css','navigation.mjs','campaign-overview.mjs','campaign-presentation.mjs','candidate-explorer.mjs','campaign-inputs.mjs','folding-dashboard.mjs','model-library.mjs','review-ui.css']
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return (json.dumps(value,indent=2,allow_nan=False)+'\n').encode()
def run(site,app_root=None):
 site=Path(site);manifest_path=site/'publication-manifest.json';before=manifest_path.read_bytes();manifest=json.loads(before)
 workspace=site/'data/local-workspace.json';workspace_hash=sha(workspace.read_bytes())
 assert workspace_hash==manifest['exportedWorkspaceSha256']
 # Existing publication is the presentation seed for subsequent scientific builds.
 source=Path(app_root)/'site' if app_root else ROOT/'docs'
 pin=subprocess.check_output(['git','-C',str(app_root),'rev-parse','HEAD'],text=True).strip() if app_root else json.loads((source/'publication-manifest.json').read_bytes())['uiAppCommit']
 for name in SHARED:(site/name).write_bytes((source/name).read_bytes())
 style=(source/'style.css').read_text();marker='/* Public single-campaign layout */'
 if app_root:
  previous=(site/'style.css').read_text();assert marker in previous
  style+='\n'+previous[previous.index(marker):]
 (site/'style.css').write_text(style)
 shell=(source/'workspace-shell.mjs').read_bytes()
 if app_root:
  from static_app import adapt_shell
  shell=adapt_shell(shell).decode().replace("'Private workspace'","'BETII review snapshot'")
  start=shell.index('export function renderSidebar(');end=shell.index('export function renderTopbar(',start)
  shell=shell[:start]+'export function renderSidebar(){return "";}\n'+shell[end:]
  shell=shell.replace('<button class="mobile-nav-toggle" data-mobile-nav="toggle" aria-controls="campaign-navigation" aria-expanded="false">☰ Campaigns</button>','')
  shell=re.sub(r'<details class="workspace-data-explanation">.*?</details>','',shell,count=1).encode()
 (site/'workspace-shell.mjs').write_bytes(shell)
 navigation="""import {campaignViews,renderCampaignTabs} from './workspace-shell.mjs';
export function renderPublicTabs(c,options={}){
 const views=campaignViews(c).filter(v=>!['explorer','jobs'].includes(v.id));
 views.push({id:'dimers',label:'Binder dimers'});
 const primary=['overview','subjects','models','monomers','dimers','review'];
 const ordered=[...primary.flatMap(id=>views.filter(v=>v.id===id)),...views.filter(v=>!primary.includes(v.id))];
 return renderCampaignTabs(c,{...options,views:ordered.map(v=>({...v,primary:primary.includes(v.id)}))});
}
"""
 (site/'public-navigation.mjs').write_text(navigation)
 app=(site/'app.js').read_text()
 if "from './affinity.mjs'" not in app:
  app="import {renderAffinity,affinitySelection,affinityRequest} from './affinity.mjs';\nconst affinityStates=new Map();\n"+app
 if "tab==='affinity'?renderAffinity" not in app:
  marker="tab==='overview'?renderPublicOverview(c):"
  assert app.count(marker)==1
  app=app.replace(marker,"tab==='affinity'?renderAffinity(c,affinityStates.get(c.id)||{}):"+marker)
 if 'data-affinity-request' not in app:
  source_app=(source/'app.js').read_text()
  start=source_app.index('  const affinityUpdate=')
  end=source_app.index('\n',source_app.index("document.querySelectorAll('[data-affinity-request]')",start))
  bindings=source_app[start:end]
  assert app.count('function bind(c) {\n')==1
  app=app.replace('function bind(c) {\n','function bind(c) {\n'+bindings+'\n')
 app=app.replace("['overview','inputs','review-plan','evidence','review','colors','workspace','monomers','models','dimers']", "['affinity','overview','inputs','review-plan','evidence','review','colors','workspace','monomers','models','dimers']")
 if "from './public-navigation.mjs'" not in app:app="import {renderPublicTabs} from './public-navigation.mjs';\n"+app
 if '<nav class="tabs" aria-label="Campaign views">' in app:
  start=app.index('<nav class="tabs" aria-label="Campaign views">');end=app.index('</nav>',start)+6
  app=app[:start]+'${renderPublicTabs(c,{active:tab,issueCount:issues.length})}'+app[end:]
 app=app.replace('<h1>${esc(campaignName(c))}</h1><p>${esc(campaignPurpose(c))}</p>','<h1>${esc(campaignName(c))}</h1>')
 app='\n'.join(line for line in app.split('\n') if not line.startswith('const campaignPurpose='))
 if 'function overview(' in app:
  start=app.index('function overview(');end=app.index('\nfunction plot(',start);app=app[:start]+app[end:]
 app=app.replace('<h2>Review candidates</h2><p>Choose a candidate, inspect its evidence, then mark it ready or request follow-up.</p>','<h2>Candidates</h2>')
 app=app.replace('<h2>What has been checked?</h2><p>Start with the outstanding decisions. Open audit details only when you need the technical record.</p>','<h2>Evidence</h2>')
 app=app.replace('<h2 class="subject-id">${esc(readableSubject(subject))}</h2>','')
 (site/'app.js').write_text(app)
 overview=(site/'public-readiness.mjs').read_text().replace('<h2>Review the ten-sequence panel</h2><p>Compare tagged and untagged structures across folding methods and ET isoforms, then record your assessment in Final Review.</p>','<h2>Review</h2>')
 (site/'public-readiness.mjs').write_text(overview)
 review=(site/'review-ui.mjs').read_text().replace('<h2>Final Review</h2><p>Review each design, then confirm the complete panel. You can revise any assessment.</p>','<h2>Final review</h2>')
 (site/'review-ui.mjs').write_text(review);(site/'public-review-ui.mjs').write_text(review)
 index=(site/'index.html').read_text().replace('<p>Large model collections can take a moment to load.</p>','');(site/'index.html').write_text(index)
 assert sha(workspace.read_bytes())==workspace_hash
 manifest.update(uiAppCommit=pin,uiRefreshedAt=datetime.now().astimezone().isoformat(),previousPublicationManifestSha256=sha(before))
 for path in site.rglob('*'):
  if path.is_file() and path!=manifest_path:manifest['files'][path.relative_to(site).as_posix()]={'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())}
 manifest_path.write_bytes(encoded(manifest))
 print(json.dumps({'uiAppCommit':pin,'workspaceUnchanged':True,'files':len(manifest['files'])}))
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--site',type=Path,default=ROOT/'docs');parser.add_argument('--app-root',type=Path)
 args=parser.parse_args();run(args.site,args.app_root)
