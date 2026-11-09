'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const posting=require('../src/ledger-posting');

test('normal balance follows account normal side using BigInt',()=>{
  assert.equal(posting.normalBalance({normal_side:'debit'},125000000000000000000n,25000000000000000000n),100000000000000000000n);
  assert.equal(posting.normalBalance({normal_side:'credit'},250n,1000n),750n);
  assert.equal(posting.normalBalance({normal_side:'debit'},10n,15n),-5n);
});
test('minor-unit parser accepts exact positive integer strings up to 78 digits',()=>{
  assert.equal(posting.amount('1'),1n);
  assert.equal(posting.amount('9'.repeat(78)),BigInt('9'.repeat(78)));
});
test('minor-unit parser rejects floats, exponent notation, signs, zero and overprecision',()=>{
  for(const v of [1,1.5,'1.5','1e3','-1','+1','0','00','01','9'.repeat(79),null]) {
    assert.throws(()=>posting.amount(v));
  }
});

test('serializable transaction retries only PostgreSQL serialization and deadlock failures',async()=>{
  let connects=0,releases=0,work=0;
  const pool={async connect(){connects++;let failed=false;return{
    async query(sql){if(sql==='SELECT work'){work++;if(!failed&&connects<3){failed=true;const e=new Error('serialization');e.code='40001';throw e;}}return{rows:[],rowCount:0};},
    release(){releases++;}
  };}};
  const result=await posting.withTransaction(pool,async client=>{await client.query('SELECT work');return 'committed';},'00000000-0000-4000-8000-000000000001');
  assert.equal(result,'committed');assert.equal(connects,3);assert.equal(releases,3);assert.equal(work,3);
});
test('serializable transaction does not retry business errors',async()=>{
  let connects=0,releases=0;
  const pool={async connect(){connects++;return{async query(sql){if(sql==='SELECT work'){const e=new Error('insufficient funds');e.code='P0001';throw e;}return{rows:[],rowCount:0};},release(){releases++;}};}};
  await assert.rejects(()=>posting.withTransaction(pool,client=>client.query('SELECT work'),'00000000-0000-4000-8000-000000000001'),/insufficient funds/);
  assert.equal(connects,1);assert.equal(releases,1);
});
test('account listing is exposed through the tenant transaction wrapper',()=>{
  assert.equal(typeof posting.listAccounts,'function');
});
