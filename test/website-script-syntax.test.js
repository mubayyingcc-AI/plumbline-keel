'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('website inline JavaScript parses without syntax errors', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0, 'expected at least one inline script');
  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` }));
  }
});
