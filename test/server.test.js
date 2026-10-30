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
