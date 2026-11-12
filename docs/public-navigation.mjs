import {campaignViews,renderCampaignTabs} from './workspace-shell.mjs';
export function renderPublicTabs(c,options={}){
 const views=campaignViews(c).filter(v=>v.id!=='jobs'&&(v.id!=='explorer'||c.publicReview?.netSolPScores))
  .map(v=>v.id==='explorer'?{...v,label:'Candidate Explorer'}:v);
 views.push({id:'dimers',label:'Binder dimers'});
 const primary=['overview','subjects','explorer','models','monomers','dimers','review'];
 const ordered=[...primary.flatMap(id=>views.filter(v=>v.id===id)),...views.filter(v=>!primary.includes(v.id))];
 return renderCampaignTabs(c,{...options,views:ordered.map(v=>({...v,primary:primary.includes(v.id)}))});
}
