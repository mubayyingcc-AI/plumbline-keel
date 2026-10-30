'use strict';
const crypto=require('node:crypto');
const KEY_PREFIX='kk_live_';
function normalizeTenant(input){
  if(!input||typeof input!=='object') throw new Error('tenant details required');
  const name=String(input.name||'').trim();
  const slug=String(input.slug||'').trim().toLowerCase();
  if(name.length<2||name.length>160) throw new Error('tenant name must be 2-160 characters');
  if(!/^[a-z0-9](?:[a-z0-9-]{1,60}[a-z0-9])?$/.test(slug)) throw new Error('tenant slug must be lowercase letters, numbers and internal hyphens');
  return {name,slug};
}
function issueTenantKey(){
  const secret=crypto.randomBytes(32).toString('base64url');
  const token=KEY_PREFIX+secret;
  return {token,tokenHash:crypto.createHash('sha256').update(token).digest('hex'),keyId:'kkey_'+crypto.randomUUID()};
}
function hashPresentedKey(token){
  if(typeof token!=='string'||!token.startsWith(KEY_PREFIX)||token.length>128) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}
function safeHashEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64) return false;
  return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
function keyFromAuthorization(header){
  const m=String(header||'').match(/^Bearer (kk_live_[A-Za-z0-9_-]{30,100})$/);
  return m?m[1]:null;
}
function tenantScopeSql(tableAlias=''){
  if(!/^[a-z][a-z0-9_]*$/i.test(tableAlias)) throw new Error('invalid SQL alias');
  return tableAlias?tableAlias+'.tenant_id = $1':'tenant_id = $1';
}
module.exports={normalizeTenant,issueTenantKey,hashPresentedKey,safeHashEqual,keyFromAuthorization,tenantScopeSql,KEY_PREFIX};
