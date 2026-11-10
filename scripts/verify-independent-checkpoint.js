'use strict';
const fs=require('node:fs');
const {verifyCheckpoint}=require('../src/independent-proof-checkpoint');
function required(name){const v=process.env[name];if(!v||!v.trim())throw new Error(name+'_required');return v;}
try{
 const file=process.argv[2];if(!file)throw new Error('checkpoint_file_argument_required');
 const checkpoint=JSON.parse(fs.readFileSync(file,'utf8'));
 const result=verifyCheckpoint(checkpoint,required('KEEL_CHECKPOINT_VERIFY_PUBLIC_KEY'));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(!result.valid)process.exitCode=2;
}catch(e){process.stderr.write('independent_checkpoint_verification_failed '+String(e.stack||e)+'\n');process.exitCode=1;}
