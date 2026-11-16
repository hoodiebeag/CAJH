import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {guardedJournalReport} from './evidence-guard.mjs';
import {recordDecision,recordOutcome,readJournal,scoreJournal,MODE} from './journal.mjs';
import {tier1} from './protocol.mjs';

const options={candidateId:'fixture',candidateVersion:'v1',mode:MODE.PAPER,now:Date.parse('2026-11-16T12:00:00Z')};
function file(){return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'guard-')),'j.jsonl');}
function decision(f,over={}){recordDecision({batchId:'B1',mode:MODE.PAPER,candidateId:'fixture',candidateVersion:'v1',at:'2026-11-01T12:00:00Z',asOfTime:1793520000,proposals:[],gate:{allowed:[{symbol:'AAA',action:'buy',targetPct:0.05}],rejected:[]},pool:['BBB'],...over},f);}
function outcome(f,over={}){recordOutcome({batchId:'B1',symbol:'AAA',holdDays:5,netReturn:0.01,controlReturn:0,...over},f);}
function blocked(f,code,opts=options){const before=fs.existsSync(f)?fs.readFileSync(f):null;const r=guardedJournalReport(f,opts);assert.equal(r.status,'blocked');assert.equal(r.score,null);assert.equal(r.protocol,null);assert.ok(r.issues.some(x=>x.code===code),JSON.stringify(r.issues));if(before)assert.deepEqual(fs.readFileSync(f),before);else assert.equal(fs.existsSync(f),false);return r;}

test('an absent journal produces no score or protocol verdict and creates nothing',()=>{blocked(file(),'NO_SCOPED_DECISIONS');});
test('an empty journal produces no score or protocol verdict',()=>{const f=file();fs.writeFileSync(f,'');blocked(f,'NO_SCOPED_DECISIONS');});
test('one malformed line blocks scoring instead of dropping damaged evidence',()=>{const f=file();decision(f);outcome(f);fs.appendFileSync(f,'{broken\n');blocked(f,'MALFORMED_JSON');});
test('a repeated outcome cannot count the same batch/symbol/hold twice',()=>{const f=file();decision(f);outcome(f);outcome(f);blocked(f,'DUPLICATE_OUTCOME');});
test('a conflicting duplicate outcome also blocks rather than chooses a winner',()=>{const f=file();decision(f);outcome(f);outcome(f,{netReturn:0.99});blocked(f,'DUPLICATE_OUTCOME');});
test('a repeated decision batch cannot ambiguously own outcomes',()=>{const f=file();decision(f);decision(f);outcome(f);blocked(f,'DUPLICATE_DECISION');});
test('same batch id in another mode is still ambiguous, not filtered away',()=>{const f=file();decision(f);decision(f,{mode:MODE.DRY_RUN});outcome(f);blocked(f,'DUPLICATE_DECISION');});
test('parseable non-record JSON blocks rather than crashes or vanishes',()=>{const f=file();decision(f);outcome(f);fs.appendFileSync(f,'null\n');blocked(f,'INVALID_RECORD');});
test('an orphan outcome blocks rather than silently disappearing',()=>{const f=file();decision(f);outcome(f,{batchId:'MISSING'});blocked(f,'ORPHAN_OUTCOME');});
test('a candidate scope with no decisions produces no verdict',()=>{const f=file();decision(f);outcome(f);blocked(f,'NO_SCOPED_DECISIONS',{...options,candidateId:'other'});});
test('clean nonempty input preserves original score, protocol criteria and thresholds',()=>{const f=file();decision(f);outcome(f);const before=fs.readFileSync(f);const r=guardedJournalReport(f,options);assert.equal(r.status,'ready_for_review');assert.deepEqual(r.issues,[]);assert.deepEqual(r.score,scoreJournal(f,options));assert.deepEqual(r.protocol,tier1(f,options));assert.deepEqual(fs.readFileSync(f),before);});
test('distinct symbols or holding windows are not mistaken for duplicate outcomes',()=>{const f=file();decision(f);outcome(f);outcome(f,{symbol:'BBB'});outcome(f,{holdDays:10});const r=guardedJournalReport(f,options);assert.equal(r.status,'ready_for_review');assert.equal(r.score.outcomes,3);});
test('duplicate symbol casing cannot evade the outcome identity check',()=>{const f=file();decision(f);outcome(f);outcome(f,{symbol:'aaa'});blocked(f,'DUPLICATE_OUTCOME');});
test('malformed identity fields block instead of inventing keys',()=>{const f=file();decision(f);outcome(f,{symbol:''});blocked(f,'INVALID_OUTCOME_IDENTITY');});
test('partial candidate scopes are rejected with an actionable issue',()=>{const f=file();decision(f);outcome(f);blocked(f,'CANDIDATE_SCOPE_REQUIRED',{mode:MODE.PAPER});});
