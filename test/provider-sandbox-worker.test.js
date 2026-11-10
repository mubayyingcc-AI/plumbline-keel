'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runOnce}=require('../scripts/provider-sandbox-worker');

test('sandbox worker refuses incomplete authority and connection configuration',async()=>{
  await assert.rejects(()=>runOnce({}),/sandbox_worker_configuration_incomplete/);
});
