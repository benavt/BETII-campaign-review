// Cache availability is separate from scientific acceptance and imported coverage.
import {coverageSummary} from './coverage.mjs';

export const CACHE_STATES=Object.freeze({
  loaded:{label:'In this interface',tone:'approved'},
  record_only:{label:'Model record only; coordinates unverified',tone:'neutral'},
  cached_available:{label:'Found in another cache',tone:'approved'},
  referenced_missing:{label:'Recorded file is absent',tone:'blocked'},
  not_found:{label:'No match in searched caches',tone:'neutral'},
  identity_mismatch:{label:'Different construct, target or method',tone:'blocked'},
  unresolved:{label:'Identity or method unresolved',tone:'blocked'},
  not_searched:{label:'Not checked',tone:'neutral'},
  pending:{label:'Request recorded; no saved output',tone:'neutral'},
});
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const text=v=>typeof v==='string'&&v.trim().length>0;
const key=r=>JSON.stringify([r.candidateId,r.target,r.engine,r.variant]);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);

export function cacheAuditSummary(campaign){
  const expected=new Map(),identities=new Map();
  for(const subject of campaign.subjects.filter(s=>s.modelCoverage))for(const r of coverageSummary(subject).rows){
    const row={candidateId:subject.id,candidateLabel:subject.displayName||subject.label,target:r.target,engine:r.engine,variant:r.variant,modelId:r.modelId};
    const model=subject.modelCoverage.models.find(m=>m.id===r.modelId),asset=model?.molecularModel;
    const loaded=Boolean(asset&&hash(model.modelSha256)&&asset.sha256===model.modelSha256&&typeof asset.url==='string'&&asset.url.startsWith('./data/assets/')&&!asset.url.includes('..'));
    const variant=subject.constructVariants?.find(v=>v.id===r.variant),targetModel=subject.modelCoverage.models.find(m=>m.target===r.target&&m.targetSequenceSha256);
    identities.set(key(row),{constructSequence:variant?.sequence||(variant?.tagSequence&&subject.sequence?subject.sequence+variant.tagSequence:r.variant==='untagged'?subject.sequence:null),constructSequenceSha256:variant?.sequenceSha256,targetSequence:targetModel?.targetSequence,targetSequenceSha256:targetModel?.targetSequenceSha256});
    expected.set(key(row),{...row,classification:loaded?'loaded':r.modelId?'record_only':'not_searched',reason:loaded?'Hash-bound native coordinates are included in this review snapshot.':r.modelId?'A model record is imported, but this audit cannot establish an included native coordinate asset.':'No broader cache-audit result is attached for this combination.',evidence:[]});
  }
  const audit=campaign.cacheAudit;
  if(audit!==undefined){
    assert(expected.size>0,'A cache audit requires at least one declared model panel.');
    assert(audit&&audit.schemaVersion===1&&text(audit.id),'Cache audit requires schema version and snapshot identity.');
    assert(text(audit.observedAt)&&Number.isFinite(Date.parse(audit.observedAt))&&/(Z|[+-]\d\d:\d\d)$/.test(audit.observedAt),'Cache audit requires a timestamp with timezone.');
    assert(audit.scope&&Array.isArray(audit.scope.roots)&&audit.scope.roots.length>0&&audit.scope.roots.every(text)&&Array.isArray(audit.scope.limitations)&&audit.scope.limitations.every(text),'Cache audit requires explicit searched roots and limitations.');
    assert(Array.isArray(audit.entries)&&audit.entries.length<=expected.size,'Cache audit entries exceed the declared panel.');
    assert(audit.externalChecks===undefined||(Array.isArray(audit.externalChecks)&&audit.externalChecks.length<=100&&audit.externalChecks.every(c=>c&&text(c.host)&&text(c.status)&&text(c.reason))), 'External cache checks require a host, status and explicit explanation.');
    assert(audit.nearMatches===undefined||(Array.isArray(audit.nearMatches)&&audit.nearMatches.length<=10000&&audit.nearMatches.every(r=>r&&campaign.subjects.some(s=>s.id===r.candidateId)&&text(r.target)&&text(r.engine)&&text(r.variant)&&text(r.reason))), 'Near-matches require known candidates and explicit target, method, construct and reason.');
    const seen=new Set();
    for(const r of audit.entries){
      const k=key(r),base=expected.get(k);
      assert(base&&!seen.has(k),'Cache audit has a duplicate or out-of-panel combination.');seen.add(k);
      assert(Object.hasOwn(CACHE_STATES,r.classification)&&text(r.reason),'Cache audit entry requires a known state and an explanation.');
      assert(r.classification!=='loaded'||base.classification==='loaded','A cache audit cannot claim an unloaded model is in the interface.');
      assert(base.classification!=='loaded'||['loaded','cached_available'].includes(r.classification),'Cache audit contradicts an imported native model.');
      assert(r.evidence===undefined||(Array.isArray(r.evidence)&&r.evidence.every(e=>e&&text(e.path)&&hash(e.sha256))),'Cache audit evidence requires source paths and SHA-256 fingerprints.');
      assert(['loaded','record_only','not_searched'].includes(r.classification)||r.evidence?.length,'A concluded cache result requires inspectable source evidence.');
      if(r.classification==='cached_available'){
        const identity=identities.get(k),proof=e=>e&&text(e.path)&&hash(e.sha256);
        assert(Array.isArray(r.matches)&&r.matches.some(m=>text(m.path)&&hash(m.sha256)&&m.identityVerified===true&&key(m)===k&&hash(m.constructSequenceSha256)&&hash(m.targetSequenceSha256)&&(identity.constructSequenceSha256?m.constructSequenceSha256===identity.constructSequenceSha256:text(identity.constructSequence)&&m.constructSequence===identity.constructSequence)&&(identity.targetSequenceSha256?m.targetSequenceSha256===identity.targetSequenceSha256:text(identity.targetSequence)&&m.targetSequence===identity.targetSequence)&&proof(m.engineEvidence)&&proof(m.availabilityEvidence)),'Available cached models require verified exact identity, construct/target fingerprints and engine/availability source evidence.');
      }
      expected.set(k,{...base,...r,candidateLabel:base.candidateLabel,modelId:base.modelId,classification:base.classification==='loaded'?'loaded':r.classification});
    }
  }
  const rows=[...expected.values()],counts=Object.fromEntries(Object.keys(CACHE_STATES).map(s=>[s,rows.filter(r=>r.classification===s).length]));
  return {rows,counts,expected:rows.length,audit: audit||null};
}
