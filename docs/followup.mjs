const REPOSITORY='https://github.com/benavt/BETII-campaign-review';
export function followupURL(subject,{note='',selection={}}={}){
 const m=selection?.kind==='dimer'?(subject.dimerModels||[]).find(m=>m.foldingEngine===selection.engine&&m.constructVariant===selection.variant&&m.nativeRank===Number(selection.rank)):subject.modelCoverage?.models?.find(m=>m.foldingEngine===selection?.engine&&m.constructVariant===selection?.variant&&m.target===selection?.target);
 const title=`[Follow-up] ${subject.displayName||subject.label||subject.id}`.slice(0,180);
 const context={candidateId:subject.id,sequenceSha256:subject.sequenceSha256,kind:'candidate_review',selection:selection||null,modelSha256:m?.modelSha256||null};
 const body='### Requested follow-up\n'+String(note).slice(0,4000)+'\n\n### Exact model context\n```json\n'+JSON.stringify(context,null,2)+'\n```\n\nThis request needs triage. It does not authorize scientific execution or paid scoring.';
 const u=new URL(REPOSITORY+'/issues/new');u.searchParams.set('title',title);u.searchParams.set('body',body);u.searchParams.set('labels','campaign-followup');return u.href;
}
