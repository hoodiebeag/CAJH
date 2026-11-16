import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {evidenceReportCommand} from './evidence-report.mjs';
import {recordDecision,recordOutcome,MODE} from './analyst/journal.mjs';
const f=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'report-cli-')),'j.jsonl');
const args=file=>['--journal',file,'--candidate','fixture','--candidate-version','v1','--mode','paper'];
function invoke(a){const out=[],err=[];const code=evidenceReportCommand(a,{out:s=>out.push(s),err:s=>err.push(s)});return {code,out,err};}
function fixture(file){recordDecision({batchId:'B1',mode:MODE.PAPER,candidateId:'fixture',candidateVersion:'v1',proposals:[],gate:{allowed:[],rejected:[]},pool:[]},file);recordOutcome({batchId:'B1',symbol:'AAA',holdDays:5,netReturn:0.1,controlReturn:0},file);}
test('no arguments do not resolve or read default live state',()=>{const r=invoke([]);assert.equal(r.code,2);assert.deepEqual(r.out,[]);assert.match(r.err[0],/No defaults/);});
test('missing required values, duplicates, unknown flags and invalid modes refuse before reporting',()=>{for(const a of [['--journal'],[...args(f()),'--root','somewhere'],[...args(f()),'--candidate','second'],args(f()).slice(0,-2),args(f()).map(x=>x==='paper'?'live':x)]){const r=invoke(a);assert.equal(r.code,2);assert.deepEqual(r.out,[]);}});
test('an explicit absent journal returns blocked exit5 and creates no file',()=>{const file=f();const r=invoke(args(file));assert.equal(r.code,5);const body=JSON.parse(r.out[0]);assert.equal(body.score,null);assert.equal(body.protocol,null);assert.equal(body.approval,false);assert.equal(body.diagnosticOnly,true);assert.equal(fs.existsSync(file),false);});
test('duplicate evidence emits diagnostics without a numeric score or verdict',()=>{const file=f();fixture(file);recordOutcome({batchId:'B1',symbol:'AAA',holdDays:5,netReturn:0.1,controlReturn:0},file);const before=fs.readFileSync(file);const r=invoke(args(file));assert.equal(r.code,5);const body=JSON.parse(r.out[0]);assert.ok(body.issues.some(x=>x.code==='DUPLICATE_OUTCOME'));assert.equal(body.score,null);assert.equal(body.protocol,null);assert.deepEqual(fs.readFileSync(file),before);});
test('clean diagnostic exit0 is explicitly not approval and preserves evidence',()=>{const file=f();fixture(file);const before=fs.readFileSync(file);const r=invoke(args(file));assert.equal(r.code,0);const body=JSON.parse(r.out[0]);assert.equal(body.status,'ready_for_review');assert.equal(body.approval,false);assert.equal(body.score.outcomes,1);assert.deepEqual(fs.readFileSync(file),before);});
