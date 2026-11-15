'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('website inline JavaScript parses without syntax errors', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0, 'expected at least one inline script');
  assert.match(html, /id="control-plane"/);
  assert.match(html, /api\/control\/sandbox\/runs/);
  assert.match(html, /Agent & Plugin Control/);
  assert.ok(html.includes('id="infrastructure-finance"'));
  assert.ok(html.includes('/api/infrastructure/sandbox/runs'));
  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(source, { filename: 'index.html:inline-script-' + (index + 1) }));
  }
});
