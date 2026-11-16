import {readJournal, scoreJournalRecords, KIND, MODE} from './journal.mjs';
import {tier1Records} from './protocol.mjs';

/**
 * Read-only integrity gate for a candidate-scoped diagnostic report.
 * This does not validate ledger signatures, data provenance, completeness, economics,
 * deployment safety or performance. It never changes, deduplicates or repairs evidence.
 * A ready_for_review result is not promotion approval or a claim the protocol passed.
 * The old public APIs remain available and are not protected until callers use this gate.
 */
export function guardedJournalReport(file, options={}) {
  const issues=[];
  const add=(code,index=null)=>issues.push({code,index});
  const text=v=>typeof v==='string'&&v.trim().length>0;
  const mode=options.mode??MODE.PAPER;
  if(!text(options.candidateId))add('CANDIDATE_SCOPE_REQUIRED');
  let snapshot;
  try {snapshot=readJournal(file);} catch {return {status:'blocked',issues:[...issues,{code:'JOURNAL_READ_FAILED',index:null}],score:null,protocol:null};}
  if(snapshot.malformed)add('MALFORMED_JSON');
  const decisions=new Map();
  const outcomes=[];
  const outcomeKeys=new Set();
  let scoped=0;
  const kinds=new Set(Object.values(KIND));
  snapshot.records.forEach((r,index)=>{
    if(!r||typeof r!=='object'||Array.isArray(r)||!kinds.has(r.kind)){add('INVALID_RECORD',index);return;}
    if(r.kind===KIND.DECISION){
      if(!text(r.batchId)){add('INVALID_DECISION_IDENTITY',index);return;}
      if(decisions.has(r.batchId))add('DUPLICATE_DECISION',index);
      else decisions.set(r.batchId,r);
      if((r.mode??MODE.PAPER)===mode&&r.candidateId===options.candidateId
        &&(options.candidateVersion==null||r.candidateVersion===options.candidateVersion))scoped++;
    }
    if(r.kind===KIND.OUTCOME){
      if(!text(r.batchId)||!text(r.symbol)
        ||(r.holdDays!==null&&r.holdDays!==undefined&&(!Number.isFinite(r.holdDays)||r.holdDays<=0))){add('INVALID_OUTCOME_IDENTITY',index);return;}
      const key=JSON.stringify([r.batchId,r.symbol.trim().toUpperCase(),r.holdDays??null]);
      if(outcomeKeys.has(key))add('DUPLICATE_OUTCOME',index);
      outcomeKeys.add(key);outcomes.push({record:r,index});
    }
  });
  for(const {record:r,index} of outcomes)if(!decisions.has(r.batchId))add('ORPHAN_OUTCOME',index);
  if(scoped===0)add('NO_SCOPED_DECISIONS');
  if(issues.length)return {status:'blocked',issues,score:null,protocol:null};
  // Both calculations consume this exact parsed snapshot. No second read can mix versions.
  try {
    const score=scoreJournalRecords(snapshot,options);
    const protocol=tier1Records(snapshot,options);
    return {status:'ready_for_review',issues:[],score,protocol};
  } catch {
    return {status:'blocked',issues:[{code:'REPORT_COMPUTATION_FAILED',index:null}],score:null,protocol:null};
  }
}
