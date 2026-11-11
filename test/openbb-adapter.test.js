'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkStatus } = require('../src/openbb-adapter');

test('OpenBB adapter stays disabled when no endpoint is configured', async () => {
  const previous = process.env.OPENBB_API_BASE_URL;
  delete process.env.OPENBB_API_BASE_URL;
  let called = false;
  try {
    const result = await checkStatus(async () => { called = true; });
    assert.equal(result.status, 'not_configured');
    assert.equal(called, false);
  } finally {
    if (previous === undefined) delete process.env.OPENBB_API_BASE_URL;
    else process.env.OPENBB_API_BASE_URL = previous;
  }
});

test('OpenBB adapter blocks non-HTTPS endpoints before network access', async () => {
  const previous = process.env.OPENBB_API_BASE_URL;
  process.env.OPENBB_API_BASE_URL = 'http://127.0.0.1:6900';
  let called = false;
  try {
    const result = await checkStatus(async () => { called = true; });
    assert.equal(result.status, 'invalid_configuration');
    assert.equal(called, false);
  } finally {
    if (previous === undefined) delete process.env.OPENBB_API_BASE_URL;
    else process.env.OPENBB_API_BASE_URL = previous;
  }
});

test('OpenBB adapter accepts a reachable ODP V5 OpenAPI descriptor without exposing endpoint', async () => {
  const previous = process.env.OPENBB_API_BASE_URL;
  process.env.OPENBB_API_BASE_URL = 'https://openbb.example.test';
  let requested = '';
  try {
    const result = await checkStatus(async (url, options) => {
      requested = url;
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => ({ info: { version: '5.0.0', license: { name: 'Apache-2.0' } } }) };
    });
    assert.equal(result.status, 'connected');
    assert.equal(result.version, '5.0.0');
    assert.equal(requested, 'https://openbb.example.test/openapi.json');
    assert.equal(JSON.stringify(result).includes('openbb.example.test'), false);
  } finally {
    if (previous === undefined) delete process.env.OPENBB_API_BASE_URL;
    else process.env.OPENBB_API_BASE_URL = previous;
  }
});

test('OpenBB adapter does not treat a different licence as confirmed ODP V5', async () => {
  const previous = process.env.OPENBB_API_BASE_URL;
  process.env.OPENBB_API_BASE_URL = 'https://openbb.example.test';
  try {
    const result = await checkStatus(async () => ({ ok: true, json: async () => ({ info: { license: { name: 'AGPL-3.0' } } }) }));
    assert.equal(result.status, 'reachable_unverified');
  } finally {
    if (previous === undefined) delete process.env.OPENBB_API_BASE_URL;
    else process.env.OPENBB_API_BASE_URL = previous;
  }
});
