'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server');

let base;
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('product catalogue is served by the API', async () => {
  const response = await fetch(base + '/api/products');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.products.length, 5);
  assert.ok(data.products.some(p => p.id === 'capacity'));
});

test('demo endpoint executes the decision engine', async () => {
  const response = await fetch(base + '/api/demo');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.synthetic, true);
  assert.equal(data.result.decision, 'ALLOW');
  assert.match(data.result.recordFingerprint, /^[a-f0-9]{64}$/);
});

test('evaluation endpoint rejects a non-JSON request', async () => {
  const response = await fetch(base + '/api/evaluate', { method:'POST', headers:{'Content-Type':'text/plain'}, body:'{}' });
  assert.equal(response.status, 415);
});

test('evaluation endpoint rejects malformed financial payload', async () => {
  const response = await fetch(base + '/api/evaluate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:{id:'x',type:'test',amount:1,authorized:true} }) });
  assert.equal(response.status, 400);
});

test('evaluation endpoint returns a real decision record', async () => {
  const now = new Date().toISOString();
  const payload = {
    synthetic:true,
    state:{currency:'USD',assets:[{id:'A-1',grossValue:10000000,encumberedValue:2000000,evidence:[{id:'E-1',source:'test-fixture',observedAt:now,class:'simulated',encumbranceStatus:'known'}]}]},
    policy:{id:'P-1',version:'1',haircutRate:.1,maxEvidenceAgeMs:86400000},
    action:{id:'REQ-1',type:'financing_request',amount:7000000,authorized:true}
  };
  const response = await fetch(base + '/api/evaluate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.result.decision, 'ALLOW');
  assert.equal(data.result.capacity.totals.capacity, 7200000);
  assert.match(data.result.recordFingerprint, /^[a-f0-9]{64}$/);
});

test('browser-origin requests from another host are rejected', async () => {
  const response = await fetch(base + '/api/evaluate', { method:'POST', headers:{'Content-Type':'application/json',Origin:'https://attacker.example'}, body:'{}' });
  assert.equal(response.status, 403);
});

test('unknown routes return a structured 404', async () => {
  const response = await fetch(base + '/api/not-a-route');
  assert.equal(response.status, 404);
});

test('tenant-scoped assurance writes reject missing credentials', async () => {
  const response = await fetch(base + '/api/assurance/models', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,'valid_tenant_api_key_required');
});
test('tenant assurance records cannot be read without tenant credentials', async () => {
  const response = await fetch(base + '/api/assurance/records');
  assert.equal(response.status,401);
});
test('tenant bootstrap stays disabled until its separate secret is configured', async () => {
  const response = await fetch(base + '/api/tenants/bootstrap', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Example Institution',slug:'example-institution'})});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'tenant_bootstrap_not_configured');
});
test('tenant API key management rejects missing credentials', async () => {
  const response = await fetch(base + '/api/tenants/keys', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'analyst',label:'Analyst key'})});
  assert.equal(response.status,401);
});


test('named principal creation requires tenant authentication', async () => {
  const response=await fetch(base+'/api/assurance/principals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'Reviewer',email:'reviewer@example.org'})});
  assert.equal(response.status,401);
});
test('docket evidence export is tenant authenticated', async () => {
  const response=await fetch(base+'/api/assurance/dockets/demo-docket/export');
  assert.equal(response.status,401);
});
test('delegation creation requires tenant authentication', async () => {
  const response=await fetch(base+'/api/assurance/delegations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({granteePrincipalId:'principal-2',scopes:['docket:approve'],expiresAt:new Date(Date.now()+86400000).toISOString()})});
  assert.equal(response.status,401);
});
test('docket approval requires tenant authentication', async () => {
  const response=await fetch(base+'/api/assurance/dockets/demo-docket/approvals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'approve',rationale:'Reviewed'})});
  assert.equal(response.status,401);
});

test('Authority Chain verification is tenant-authenticated', async () => { const response=await fetch(base+'/api/assurance/chain/verify'); assert.equal(response.status,401); assert.equal((await response.json()).error,'valid_tenant_api_key_required'); });
