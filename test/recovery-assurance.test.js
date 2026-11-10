'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareLedgerProjection,assessRecoveryState}=require('../src/recovery-assurance');
test('recomputed exact minor-unit balances match restored projections',()=>{
 const result=compareLedgerProjection({accounts:[{account_id:'cash',normal_side:'debit',debit_total:'1000',credit_total:'200',normal_balance_minor:'800'},{account_id:'revenue',normal_side:'credit',debit_total:'200',credit_total:'1000',normal_balance_minor:'800'}],lines:[{account_id:'cash',side:'debit',amount_minor:'1000'},{account_id:'cash',side:'credit',amount_minor:'200'},{account_id:'revenue',side:'debit',amount_minor:'200'},{account_id:'revenue',side:'credit',amount_minor:'1000'}]});
 assert.equal(result.valid,true);
});
test('projection mismatch fails recovery verification',()=>{
 const result=compareLedgerProjection({accounts:[{account_id:'cash',normal_side:'debit',debit_total:'1000',credit_total:'200',normal_balance_minor:'801'},{account_id:'revenue',normal_side:'credit',debit_total:'200',credit_total:'1000',normal_balance_minor:'800'}],lines:[{account_id:'cash',side:'debit',amount_minor:'1000'},{account_id:'cash',side:'credit',amount_minor:'200'},{account_id:'revenue',side:'debit',amount_minor:'200'},{account_id:'revenue',side:'credit',amount_minor:'1000'}]});
 assert.equal(result.valid,false);assert.equal(result.findings[0].code,'LEDGER_PROJECTION_MISMATCH');
});
test('UNKNOWN and leased provider instructions remain visible recovery warnings',()=>{
 const result=assessRecoveryState({ledger:{valid:true},providerOutbox:[{status:'unknown'},{status:'leased'}],providerCases:[{status:'exception'}]});
 assert.equal(result.valid,true);assert.equal(result.provider.unknownCount,1);assert.equal(result.provider.leasedCount,1);assert.equal(result.warnings.length,3);
});
