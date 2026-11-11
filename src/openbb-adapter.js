'use strict';

const OPENAPI_PATH = '/openapi.json';
const TIMEOUT_MS = 2500;

function configuredBase() {
  const raw = process.env.OPENBB_API_BASE_URL;
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return parsed.toString().replace(/\/$/, '');
}

async function checkStatus(fetchImpl = globalThis.fetch) {
  const base = configuredBase();
  if (!process.env.OPENBB_API_BASE_URL) {
    return { status: 'not_configured', software: 'Open Data Platform V5', probe: 'not_run', detail: 'No server-side endpoint configured; no external request made.' };
  }
  if (!base) {
    return { status: 'invalid_configuration', software: 'Open Data Platform V5', probe: 'blocked', detail: 'A credential-free HTTPS base URL is required.' };
  }
  if (typeof fetchImpl !== 'function') {
    return { status: 'unavailable', software: 'Open Data Platform V5', probe: 'unsupported_runtime', detail: 'HTTP client unavailable.' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(base + OPENAPI_PATH, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) return { status: 'unavailable', software: 'Open Data Platform V5', probe: 'http_error', detail: 'OpenAPI probe returned a non-success response.' };
    const spec = await response.json();
    const license = spec && spec.info && spec.info.license && spec.info.license.name;
    if (license && license !== 'Apache-2.0') {
      return { status: 'reachable_unverified', software: 'Open Data Platform', probe: 'license_mismatch', detail: 'Endpoint reachable; expected ODP V5 Apache-2.0 metadata was not confirmed.' };
    }
    return { status: 'connected', software: 'Open Data Platform V5', version: (spec.info && spec.info.version) || null, probe: 'openapi_reachable', detail: 'OpenAPI metadata reachable. This does not verify provider data rights or data quality.' };
  } catch {
    return { status: 'unavailable', software: 'Open Data Platform V5', probe: 'connection_failed', detail: 'Endpoint did not pass the bounded connectivity check.' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { checkStatus };
