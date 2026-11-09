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
