'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ACTIONS}=require('../src/authority-persistence');
const fs=require('node:fs');
test('generic plugin invocation is a distinct allowlisted authority action, not a wildcard',()=>{
 assert.equal(ACTIONS.has('integration:tool:invoke'),true);
 assert.equal(ACTIONS.has('*'),false);
});
test('authority persistence requires exact integration and target resource scopes',()=>{
 const source=fs.readFileSync(require.resolve('../src/authority-persistence'),'utf8');
 assert.match(source,/additionalResourceIds/);
 assert.match(source,/ADDITIONAL_RESOURCE_OUTSIDE_ENVELOPE/);
});
