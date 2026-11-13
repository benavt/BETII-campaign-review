import {betiiDemoCampaign} from './betii-demo.mjs';
const source = {label:'Illustrative fixture · not scientific evidence'};
const ev = (id,label,status='verified',kind='receipt',note='Synthetic example for trying the review workflow.') => ({id,label,status,kind,note,source});
const base = (id,name,target,recipe,objective) => ({id,name,target,recipe,objective,demo:true,observedAt:'2026-10-26T16:00:00-04:00',workflowPin:'demo-contract-v1',run:{id:`2026-10-26_${id}_001`,parentIds:[],execution:'completed',telemetry:'verified',acceptance:'verified'},requiredEvidence:['identity','inputs','acceptance','delivery'],evidence:[ev('identity','Sequence & construct identity'),ev('inputs','Frozen inputs & numbering map'),ev('acceptance','Native scientific acceptance'),ev('delivery','Final deliverables inspected')],notes:'All subjects, scores and evidence in this workspace are illustrative. Import a validated export to review real work.'});
export function demoWorkspace() {
  const egfr=base('egfr-switch','EGFR · pH-selective binders','EGFR','Cross-species design','Find binders with a consistent pH preference across human and mouse.');
  egfr.accent='purple'; egfr.axes={x:{key:'human',label:'Human ipSAE'},y:{key:'mouse',label:'Mouse ipSAE'}};
  egfr.viewRecipe={alignment:'Receptor aligned; shared camera across species',colors:'Human target teal · mouse target slate · binder orange',numbering:'Author numbering mapped to canonical receptor positions'};
  egfr.subjects=[['DEMO-E01',.88,.85],['DEMO-E02',.84,.9],['DEMO-E03',.76,.72],['DEMO-E04',.91,.66],['DEMO-E05',.73,.81],['DEMO-E06',.82,.79]].map(([id,human,mouse],i)=>({id,label:id,kind:'candidate',group:i<2?'Recommended':'Alternative',recommended:i<2,metrics:{human,mouse},summary:i<2?'Paired cross-species model for human inspection.':'Retained alternative; inspect both species before selecting.',parentId:i===1?'DEMO-E00':null}));
  const tnf=base('tnf-fusion','TNFα · two-domain fusions','TNFα','Ensemble comparison','Compare how each binder domain approaches its assigned trimer pocket.');
  tnf.accent='orange';tnf.evidence[3].status='needs_review';tnf.evidence[3].note='The example final animation still needs a human check of its alignment and colors.';
  tnf.axes={x:{key:'nDistance',label:'N-domain pocket distance (Å)'},y:{key:'cDistance',label:'C-domain pocket distance (Å)'}};
  tnf.viewRecipe={alignment:'TNF trimer fixed; domains displayed in the shared frame',colors:'Target gray · N-domain cyan · C-domain hotpink · linker green',numbering:'Native assembly labels preserved'};
  tnf.subjects=[['DEMO-T01',3.1,3.8],['DEMO-T02',4.4,6.2],['DEMO-T03',9.8,3.2],['DEMO-T04',15.2,11.5],['DEMO-T05',6.7,16.4]].map(([id,nDistance,cDistance],i)=>({id,label:id,kind:'ensemble representative',group:i<2?'Pocket proximal':'Alternative',recommended:i<2,metrics:{nDistance,cDistance},summary:'One representative structure, with both domain-distance measurements.'}));
  const glp=base('glp1r-redesign','GLP-1R · scaffold redesign','GLP-1R','Parent → variant','Review redesigned peptides against their exact parent scaffolds.');
  glp.accent='blue';glp.evidence[1].status='missing';glp.evidence[1].note='Example blocker: submitted pocket and featurized pocket have different numbering frames.';
  glp.axes={x:{key:'parentScore',label:'Parent ipSAE'},y:{key:'variantScore',label:'Variant ipSAE'}};
  glp.viewRecipe={alignment:'Receptor fixed; parent and child share a camera',colors:'Receptor gray · peptide orange · conditioning pocket hotpink',numbering:'Submitted and featurized pocket frames require reconciliation'};
  glp.subjects=[['DEMO-G01',.81,.87],['DEMO-G02',.85,.9],['DEMO-G03',.83,.8],['DEMO-G04',.78,.86]].map(([id,parentScore,variantScore],i)=>({id,label:id,kind:'variant',group:'Redesigned',parentId:`DEMO-P0${i+1}`,recommended:i===1,metrics:{parentScore,variantScore},summary:'Sequence-changing redesign creates a new subject linked to its parent.'}));
  const tfr=base('tfr1-epitope','TfR1 · conserved epitope','TfR1','Target & hotspot review','Choose an exposed conserved region for a cross-reactive design campaign.');
  tfr.accent='teal';tfr.run.execution='not_started';tfr.run.telemetry='not_applicable';tfr.run.acceptance='needs_review';
  tfr.evidence[2].status='needs_review';tfr.evidence[2].note='A proposed epitope is a hypothesis; geometry and glycan clearance need validation.';
  tfr.subjects=[{id:'DEMO-PATCH-A',label:'Conserved patch A',kind:'epitope hypothesis',group:'Proposed',recommended:true,metrics:{},summary:'Review conservation, exposure, geometry and glycan clearance before freezing design inputs.'}];
  tfr.viewRecipe={alignment:'Human–mouse structural alignment',colors:'Conserved residues green · species differences magenta',numbering:'Explicit human ↔ mouse residue correspondence'};
  return {schemaVersion:1,name:'Research workspace',campaigns:[egfr,tnf,glp,tfr,betiiDemoCampaign()],decisions:[],selections:{},exportedAt:null};
}
