'use strict';
const crypto=require('node:crypto');
function fail(code){const e=new Error(code);e.code=code;throw e;}
function date(v){if(typeof v!=='string'||!/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.test(v)||Number.isNaN(Date.parse(v+'T00:00:00Z')))fail('date_invalid');return v;}
function validateCurrencyVersion(x){
 if(!x||!/^([A-Z]{3})$/.test(x.code||''))fail('currency_code_invalid');
 if(!Number.isInteger(x.minorUnit)||x.minorUnit<0||x.minorUnit>6)fail('currency_minor_unit_invalid');
 if(typeof x.name!=='string'||!x.name.trim()||typeof x.source!=='string'||!x.source.trim()||typeof x.sourceVersion!=='string'||!x.sourceVersion.trim())fail('currency_metadata_invalid');
 const validFrom=date(x.validFrom),validTo=x.validTo==null?null:date(x.validTo);
 if(validTo&&validTo<validFrom)fail('currency_date_range_invalid');
 return Object.freeze({code:x.code,name:x.name.trim(),minorUnit:x.minorUnit,validFrom,validTo,source:x.source,sourceVersion:x.sourceVersion,status:x.status||'research'});
}
function createCurrencyRegistry(rows){
 if(!Array.isArray(rows)||!rows.length)fail('currency_records_required');
 const map=new Map();
 for(const raw of rows){const x=validateCurrencyVersion(raw),a=map.get(x.code)||[];
  if(a.some(v=>!(x.validTo&&x.validTo<v.validFrom)&&!(v.validTo&&v.validTo<x.validFrom)))fail('currency_validity_overlap');
  a.push(x);a.sort((p,q)=>p.validFrom.localeCompare(q.validFrom));map.set(x.code,a);
 }
 return Object.freeze({get(code,asOf){const d=date(asOf),x=(map.get(code)||[]).find(v=>v.validFrom<=d&&(!v.validTo||d<=v.validTo));if(!x)fail('currency_version_not_found');return x;},
 list(){return [...map.values()].flat();},fingerprint(){return crypto.createHash('sha256').update(JSON.stringify(this.list())).digest('hex');}});
}
function toMinorUnits(value,exponent){
 if(!Number.isInteger(exponent)||exponent<0||exponent>6)fail('currency_minor_unit_invalid');
 if(typeof value!=='string'||!/^([0-9]+)(?:\.([0-9]+))?$/.test(value))fail('money_decimal_string_required');
 const [whole,fraction='']=value.split('.');if(fraction.length>exponent)fail('money_precision_exceeded');
 return (BigInt(whole)*(10n**BigInt(exponent))+BigInt((fraction+'0'.repeat(exponent)).slice(0,exponent)||'0')).toString();
}
module.exports={validateCurrencyVersion,createCurrencyRegistry,toMinorUnits};
