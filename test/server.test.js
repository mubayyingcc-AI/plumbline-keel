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
  assert.equal(data.products.length, 9);
  assert.ok(data.products.some(p => p.id === 'ledger'));
  assert.ok(data.products.some(p => p.id === 'capacity'));
  assert.ok(data.products.some(p => p.id === 'payment-authority'));
  assert.ok(data.products.some(p => p.id === 'card-control'));
  assert.ok(data.products.some(p => p.id === 'remittance-integrity'));
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
test('Human Card recovery group creation requires a tenant principal',async()=>{
 const r=await fetch(base+'/api/human-card/recovery/groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trusteePrincipalIds:[],threshold:2,delayHours:24})});
 assert.equal(r.status,401);assert.equal((await r.json()).error,'valid_tenant_api_key_required');
});
test('Human Card lost-card recovery request requires a tenant principal',async()=>{
 const r=await fetch(base+'/api/human-card/recovery/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardId:'card-001',reasonCode:'card_lost'})});
 assert.equal(r.status,401);assert.equal((await r.json()).error,'valid_tenant_api_key_required');
});
test('Human Card recovery approval requires a tenant principal',async()=>{
 const r=await fetch(base+'/api/human-card/recovery/requests/00000000-0000-4000-8000-000000000001/approvals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'approve',rationaleCode:'verified'})});
 assert.equal(r.status,401);assert.equal((await r.json()).error,'valid_tenant_api_key_required');
});
test('Human Card recovery finalisation requires a tenant principal',async()=>{
 const r=await fetch(base+'/api/human-card/recovery/requests/00000000-0000-4000-8000-000000000001/finalise',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(r.status,401);assert.equal((await r.json()).error,'valid_tenant_api_key_required');
});
test('physical Human Card pairing challenge requires a tenant principal', async () => {
  const response=await fetch(base+'/api/human-card/pairing/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardId:'card-001'})});
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,'valid_tenant_api_key_required');
});
test('physical Human Card pairing verification requires a tenant principal', async () => {
  const response=await fetch(base+'/api/human-card/pairing/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId:'00000000-0000-4000-8000-000000000001',nonce:'invalid',signature:'invalid'})});
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,'valid_tenant_api_key_required');
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

test('fracture assessment write requires tenant authentication', async () => {
  const response=await fetch(base+'/api/fracture/assessments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assessmentId:'FRA-TEST',currency:'USD',institutions:[]})});
  assert.equal(response.status,401);
});
test('fracture assessment history requires tenant authentication', async () => {
  const response=await fetch(base+'/api/fracture/assessments');
  assert.equal(response.status,401);
});

test('currency instrument catalogue requires tenant authentication',async()=>{const r=await fetch(base+'/api/currency/instruments');assert.equal(r.status,401)});
test('currency account creation requires tenant authentication',async()=>{const r=await fetch(base+'/api/currency/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:'agent-001',ownerRef:'agent',instrumentCode:'COMPUTE_CREDIT'})});assert.equal(r.status,401)});
test('currency account history requires tenant authentication',async()=>{const r=await fetch(base+'/api/currency/accounts');assert.equal(r.status,401)});
test('currency transfer preparation requires tenant authentication',async()=>{const r=await fetch(base+'/api/currency/transfers/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(r.status,401)});
test('currency transfer history requires tenant authentication',async()=>{const r=await fetch(base+'/api/currency/transfers');assert.equal(r.status,401)});

test('Authority Chain verification is tenant-authenticated', async () => { const response=await fetch(base+'/api/assurance/chain/verify'); assert.equal(response.status,401); assert.equal((await response.json()).error,'valid_tenant_api_key_required'); });

test('financial state object write requires tenant authentication',async()=>{const r=await fetch(base+'/api/financial-state/objects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(r.status,401)});
test('financial state snapshot read requires tenant authentication',async()=>{const r=await fetch(base+'/api/financial-state/objects');assert.equal(r.status,401)});

test('regulatory obligation registration requires tenant authentication',async()=>{const r=await fetch(base+'/api/regulatory/obligations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(r.status,401)});
test('regulatory evidence registration requires tenant authentication',async()=>{const r=await fetch(base+'/api/regulatory/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(r.status,401)});
test('regulatory gap evaluation requires tenant authentication',async()=>{const r=await fetch(base+'/api/regulatory/gaps/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(r.status,401)});
test('regulatory docket export requires tenant authentication',async()=>{const r=await fetch(base+'/api/regulatory/dockets/demo/export');assert.equal(r.status,401)});

test('regulatory corrective action creation requires tenant authentication',async()=>{const r=await fetch(base+'/api/regulatory/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(r.status,401)});
test('regulatory corrective action transition requires tenant authentication',async()=>{const r=await fetch(base+'/api/regulatory/actions/transition',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(r.status,401)});

test('public sandbox scenario catalogue exposes only explicitly executable fixtures', async () => {
  const response = await fetch(base + '/api/sandbox/scenarios');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.scenarios.map(s => s.id), ['KFS-001','KFS-002']);
  assert.ok(data.scenarios.every(s => s.availability === 'EXECUTABLE' && s.dataClass === 'synthetic'));
});

test('assurance status exposes the contract consumed by the website', async () => {
  const response = await fetch(base + '/api/assurance/status');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.availability, 'available');
  assert.equal(data.tenantIsolation, 'credential-scoped');
  assert.equal(typeof data.boundary, 'string');
});

test('ledger status fails closed when no database is configured', async () => {
  if (process.env.DATABASE_URL) return;
  const response = await fetch(base + '/api/ledger/status');
  const data = await response.json();
  assert.equal(response.status, 503);
  assert.equal(data.status, 'BLOCKED');
  assert.equal(data.reason, 'database_not_configured');
});

test('Payment Authority sandbox runs the real evaluator and never executes a payment', async () => {
  const scenarios = ['PA-001','PA-002','PA-003','PA-004'];
  const expected = ['ALLOW_WITHIN_MANDATE','HUMAN_APPROVAL_REQUIRED','HOLD','DENY'];
  for (let i=0;i<scenarios.length;i++) {
    const response = await fetch(base + '/api/sandbox/payment-authority/runs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenarioId:scenarios[i]}) });
    const data = await response.json();
    assert.equal(response.status,200);
    assert.equal(data.result.decision,expected[i]);
    assert.equal(data.passed,true);
    assert.equal(data.execution,'DISABLED');
    assert.equal(data.synthetic,true);
  }
});

test('Human Card sandbox profile contains no payment credentials and unverified funding is held', async () => {
  const response = await fetch(base + '/api/sandbox/human-card/runs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenarioId:'HC-001'}) });
  const data = await response.json();
  assert.equal(response.status,200);
  assert.equal(data.card.status,'sandbox');
  assert.match(data.card.display.label,/NOT A PAYMENT CARD/);
  assert.equal(data.card.providerTokenRef,undefined);
  assert.equal(data.fundingAvailability.status,'HOLD');
  assert.equal(data.execution,'DISABLED');
});

test('Payment Authority and Human Card scenario catalogues are backend supplied', async () => {
  const pa = await fetch(base + '/api/sandbox/payment-authority/scenarios');
  const paData = await pa.json();
  assert.equal(pa.status,200);
  assert.deepEqual(paData.scenarios.map(x=>x.id),['PA-001','PA-002','PA-003','PA-004']);
  const hc = await fetch(base + '/api/sandbox/human-card/scenarios');
  const hcData = await hc.json();
  assert.equal(hc.status,200);
  assert.deepEqual(hcData.scenarios.map(x=>x.id),['HC-001']);
});

test('currency precision catalogue exposes references without live settlement', async () => {
  const response = await fetch(base + '/api/sandbox/currency/instruments');
  const data = await response.json();
  assert.equal(response.status,200);
  assert.ok(data.instruments.some(x=>x.code==='NGN'&&x.scale===2));
  assert.ok(data.instruments.every(x=>x.liveSettlement===false));
  assert.equal(data.execution,'DISABLED');
});

test('currency precision API converts exact decimal strings to integer atomic units', async () => {
  for (const [instrumentCode,amount,units] of [['USD','12.34','1234'],['NGN','123.45','12345'],['COMPUTE_CREDIT','0.000001','1']]) {
    const response = await fetch(base + '/api/sandbox/currency/precision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instrumentCode,amount})});
    const data = await response.json();
    assert.equal(response.status,200);
    assert.equal(data.atomicUnits,units);
    assert.equal(data.execution,'DISABLED');
  }
});

test('currency precision API rejects JSON numbers and excess decimal precision', async () => {
  const numeric = await fetch(base + '/api/sandbox/currency/precision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instrumentCode:'USD',amount:0.1})});
  assert.equal(numeric.status,400);
  const precision = await fetch(base + '/api/sandbox/currency/precision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instrumentCode:'USD',amount:'1.001'})});
  assert.equal(precision.status,400);
});

test('reconciliation sandbox catalog is backend supplied', async () => {
  const response=await fetch(base+'/api/sandbox/reconciliation/scenarios');
  const data=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(data.scenarios.map(x=>x.id),['REC-001','REC-002','REC-003','REC-004','REC-005','REC-006']);
});

test('reconciliation sandbox preserves match, duplicate, mismatch, missing, partial and late outcomes', async () => {
  const cases=[['REC-001','MATCHED'],['REC-002','EXCEPTIONS'],['REC-003','EXCEPTIONS'],['REC-004','INCOMPLETE'],['REC-005','INCOMPLETE'],['REC-006','EXCEPTIONS']];
  for(const [scenarioId,status] of cases){
    const response=await fetch(base+'/api/sandbox/reconciliation/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId})});
    const data=await response.json();
    assert.equal(response.status,200);
    assert.equal(data.result.status,status);
    assert.equal(data.passed,true);
    assert.equal(data.synthetic,true);
    assert.equal(data.providerConnected,false);
    assert.equal(data.execution,'DISABLED');
  }
});

test('favicon routes serve the real SVG asset', async () => {
  for (const path of ['/favicon.svg','/favicon.ico']) {
    const response=await fetch(base+path);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/image\/svg\+xml/);
    assert.match(await response.text(),/<svg/);
  }
});

test('tenant accounting APIs require an authenticated tenant key', async () => {
  const paths=['/api/ledger/books','/api/ledger/periods','/api/ledger/trial-balance?bookId=book-1&periodId=period-1'];
  for(const path of paths){
    const response=await fetch(base+path);
    assert.equal(response.status,401);
  }
  const create=await fetch(base+'/api/ledger/books',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
  assert.equal(create.status,401);
});

test('dual-control period close endpoints are tenant-authenticated', async () => {
  const paths=[
    '/api/ledger/periods/p-1/close-requests',
    '/api/ledger/periods/p-1/closure'
  ];
  for(const path of paths){
    const response=await fetch(base+path);
    assert.equal(response.status,401);
  }
  for(const path of [
    '/api/ledger/periods/p-1/soft-close',
    '/api/ledger/periods/p-1/close-requests',
    '/api/ledger/periods/p-1/close-requests/r-1/approve',
    '/api/ledger/periods/p-1/close-requests/r-1/reject'
  ]){
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
    assert.equal(response.status,401);
  }
});


test('application database pool refuses admin DATABASE_URL without runtime URL', async () => {
  const priorAdmin=process.env.DATABASE_URL;
  const priorRuntime=process.env.KEEL_RUNTIME_DATABASE_URL;
  try {
    process.env.DATABASE_URL='postgresql://administrator:must-not-be-used@127.0.0.1:1/keel';
    delete process.env.KEEL_RUNTIME_DATABASE_URL;
    const { dbPool }=require('../server');
    assert.equal(await dbPool(),null);
  } finally {
    if(priorAdmin===undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=priorAdmin;
    if(priorRuntime===undefined) delete process.env.KEEL_RUNTIME_DATABASE_URL; else process.env.KEEL_RUNTIME_DATABASE_URL=priorRuntime;
  }
});

test('core schema bootstrap is isolated from the web runtime pool', () => {
  const { dbPool, bootstrapCoreSchema }=require('../server');
  assert.equal(typeof dbPool,'function');
  assert.equal(typeof bootstrapCoreSchema,'function');
  assert.match(bootstrapCoreSchema.toString(),/CREATE TABLE IF NOT EXISTS keel_leads/);
  assert.doesNotMatch(dbPool.toString(),/CREATE TABLE|ALTER TABLE|CREATE INDEX/);
  assert.match(dbPool.toString(),/KEEL_RUNTIME_DATABASE_URL/);
  assert.match(dbPool.toString(),/runtime_database_role_boundary_failed/);
});
