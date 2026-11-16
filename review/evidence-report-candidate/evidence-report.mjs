import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {guardedJournalReport} from './analyst/evidence-guard.mjs';

/** Read-only diagnostic command. Explicit paths/scope only; never defaults to live state. */
export function evidenceReportCommand(args, io={out:s=>console.log(s),err:s=>console.error(s)}) {
  const allowed=new Set(['journal','candidate','candidate-version','mode']);
  const values={};
  for(let i=0;i<args.length;i+=2){
    const name=args[i]?.startsWith('--')?args[i].slice(2):'';
    const value=args[i+1];
    if(!allowed.has(name)||name in values||typeof value!=='string'||!value.trim()||value.startsWith('--')){
      io.err('Invalid arguments. Require --journal FILE --candidate ID --candidate-version VERSION --mode paper|dry-run|anonymised. No defaults or repairs.');return 2;
    }
    values[name]=value;
  }
  if([...allowed].some(k=>!(k in values))||!['paper','dry-run','anonymised'].includes(values.mode)){
    io.err('Require --journal FILE --candidate ID --candidate-version VERSION --mode paper|dry-run|anonymised. No defaults or repairs.');return 2;
  }
  const result=guardedJournalReport(values.journal,{
    candidateId:values.candidate,candidateVersion:values['candidate-version'],mode:values.mode,
  });
  io.out(JSON.stringify({diagnosticOnly:true,approval:false,...result},null,2));
  return result.status==='blocked'?5:0;
}

// Importing the command for tests has no side effects. Direct execution is explicit.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.exitCode=evidenceReportCommand(process.argv.slice(2));
}
