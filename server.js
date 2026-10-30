'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { evaluateAction, fingerprint } = require('./src/core');
const assurance = require('./src/assurance');
const tenantSecurity = require('./src/tenant-security');
const authorityChain = require('./src/authority-chain');
const authorityIdentity = require('./src/evidence-authority');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const MAX_BODY = 256 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMITS = { '/api/leads': 8, '/api/evaluate': 30 };
const rateBuckets = new Map();

const products = [
  { id:'thread', name:'Keel Thread', category:'Collateral lineage', stage:'POC', description:'Map assets, claims, facilities and obligations across the records an institution connects.', outputs:['Relationship graph','Potential reuse flags','Source-level lineage'], integration:'REST API / structured CSV' },
  { id:'capacity', name:'Keel Capacity', category:'Policy-adjusted capacity', stage:'POC', description:'Calculate capacity against versioned eligibility, encumbrance, haircut and evidence-freshness rules.', outputs:['Gross and net values','Policy adjustments','Unknowns and holds'], integration:'REST API / structured CSV' },
  { id:'scenario', name:'Keel Scenario', category:'Stress propagation', stage:'Design partner', description:'Replay declared shocks through a defined dependency graph and inspect modeled downstream effects.', outputs:['Scenario assumptions','Dependency impact','Before-and-after state'], integration:'API / partner mapping' },
  { id:'evidence', name:'Keel Evidence', category:'Evidence and audit', stage:'POC', description:'Package source references, timestamps, evidence classes, policy versions and record fingerprints.', outputs:['Evidence manifest','Decision fingerprint','Scope and limitation record'], integration:'REST API / structured CSV' },
  { id:'assurance', name:'Keel Assurance Fabric', category:'Decision assurance', stage:'Foundation', description:'Bind source provenance, model context, policy trace, human witness, drift signals and bounded fallback into a persistent ProofDocket.', outputs:['OriginMark provenance','ModelCensus','DecisionWitness','RuleTrace','DriftSentinel','FallbackMandate','ProofDocket'], integration:'Token-restricted REST API / PostgreSQL' }
];

let poolPromise;
async function dbPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!poolPromise) {
    poolPromise = (async () => {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 8000,
        query_timeout: 10000
      });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS keel_leads (
          id UUID PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          lead_type TEXT NOT NULL CHECK (lead_type IN ('partnership','integration','pilot','general')),
          name TEXT NOT NULL,
          organization TEXT NOT NULL,
          email TEXT NOT NULL,
          role TEXT,
          region TEXT,
          interest TEXT,
          message TEXT,
          consent BOOLEAN NOT NULL DEFAULT FALSE,
          source TEXT NOT NULL DEFAULT 'website'
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS keel_leads_created_at_idx ON keel_leads (created_at DESC)');
      await pool.query("CREATE TABLE IF NOT EXISTS keel_model_census (model_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model_name TEXT NOT NULL, version TEXT NOT NULL, owner_ref TEXT NOT NULL, purpose TEXT NOT NULL, access_scope TEXT NOT NULL, external BOOLEAN NOT NULL DEFAULT FALSE, model_fingerprint CHAR(64) NOT NULL, registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("CREATE TABLE IF NOT EXISTS keel_proof_dockets (docket_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decision_id TEXT NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('ALLOW','HOLD','REVIEW')), docket_fingerprint CHAR(64) NOT NULL UNIQUE, decision_fingerprint CHAR(64) NOT NULL, payload JSONB NOT NULL)");
      await pool.query('CREATE INDEX IF NOT EXISTS keel_proof_dockets_created_idx ON keel_proof_dockets(created_at DESC)');
      await pool.query("CREATE TABLE IF NOT EXISTS keel_assurance_events (event_id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), event_type TEXT NOT NULL CHECK (event_type IN ('MODEL_REGISTERED','DOCKET_CREATED','DRIFT_DETECTED','FALLBACK_RESTRICTED','WITNESS_RECORDED')), subject_id TEXT NOT NULL, event_fingerprint CHAR(64) NOT NULL, payload JSONB NOT NULL)");
      await pool.query('CREATE INDEX IF NOT EXISTS keel_assurance_events_subject_idx ON keel_assurance_events(subject_id,created_at DESC)');
      await pool.query("CREATE TABLE IF NOT EXISTS keel_tenants (tenant_id UUID PRIMARY KEY, tenant_name TEXT NOT NULL, tenant_slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("CREATE TABLE IF NOT EXISTS keel_tenant_keys (key_id TEXT PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), token_hash CHAR(64) NOT NULL UNIQUE, label TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin','reviewer','analyst','integration')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_used_at TIMESTAMPTZ)");
      await pool.query("ALTER TABLE keel_tenant_keys ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'");
      await pool.query('CREATE INDEX IF NOT EXISTS keel_tenant_keys_tenant_idx ON keel_tenant_keys(tenant_id,status)');
      await pool.query("ALTER TABLE keel_tenant_keys ADD COLUMN IF NOT EXISTS principal_id UUID");
      await pool.query("CREATE TABLE IF NOT EXISTS keel_principals (principal_id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), display_name TEXT NOT NULL, email TEXT NOT NULL, external_subject TEXT, identity_assurance TEXT NOT NULL DEFAULT 'self_asserted' CHECK (identity_assurance IN ('self_asserted','externally_verified')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,email), UNIQUE(tenant_id,principal_id))");
      await pool.query("DO $keel$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='keel_tenant_keys_principal_fk') THEN ALTER TABLE keel_tenant_keys ADD CONSTRAINT keel_tenant_keys_principal_fk FOREIGN KEY (tenant_id,principal_id) REFERENCES keel_principals(tenant_id,principal_id); END IF; END $keel$");
      await pool.query("CREATE TABLE IF NOT EXISTS keel_delegations (delegation_id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), grantor_principal_id UUID NOT NULL, grantee_principal_id UUID NOT NULL, scopes JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), FOREIGN KEY (tenant_id,grantor_principal_id) REFERENCES keel_principals(tenant_id,principal_id), FOREIGN KEY (tenant_id,grantee_principal_id) REFERENCES keel_principals(tenant_id,principal_id), CHECK (grantor_principal_id <> grantee_principal_id))");
      await pool.query("CREATE TABLE IF NOT EXISTS keel_docket_approvals (approval_id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), docket_id TEXT NOT NULL, principal_id UUID NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('approve','reject')), rationale TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), FOREIGN KEY (tenant_id,principal_id) REFERENCES keel_principals(tenant_id,principal_id), UNIQUE(tenant_id,docket_id,principal_id))");
      await pool.query("CREATE INDEX IF NOT EXISTS keel_principals_tenant_idx ON keel_principals(tenant_id,status)");
      await pool.query("CREATE INDEX IF NOT EXISTS keel_delegations_tenant_idx ON keel_delegations(tenant_id,expires_at,status)");
      await pool.query("CREATE INDEX IF NOT EXISTS keel_docket_approvals_tenant_idx ON keel_docket_approvals(tenant_id,docket_id,created_at)");

      await pool.query('ALTER TABLE keel_model_census ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES keel_tenants(tenant_id)');
      await pool.query('ALTER TABLE keel_proof_dockets ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES keel_tenants(tenant_id)');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES keel_tenants(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS keel_model_census_tenant_idx ON keel_model_census(tenant_id,model_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS keel_proof_dockets_tenant_idx ON keel_proof_dockets(tenant_id,created_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS keel_assurance_events_tenant_idx ON keel_assurance_events(tenant_id,created_at DESC)');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS tenant_sequence BIGINT');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS previous_event_fingerprint CHAR(64)');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS actor_key_id TEXT');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS actor_role TEXT');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS keel_assurance_events_tenant_sequence_uq ON keel_assurance_events(tenant_id,tenant_sequence) WHERE tenant_id IS NOT NULL');
      await pool.query("CREATE OR REPLACE FUNCTION keel_reject_assurance_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $ BEGIN RAISE EXCEPTION 'Keel Authority Chain events are append-only'; END; $");
      await pool.query('DROP TRIGGER IF EXISTS keel_assurance_events_immutable ON keel_assurance_events');
      await pool.query('CREATE TRIGGER keel_assurance_events_immutable BEFORE UPDATE OR DELETE ON keel_assurance_events FOR EACH ROW EXECUTE FUNCTION keel_reject_assurance_event_mutation()');
      return pool;
    })().catch(err => { poolPromise = null; throw err; });
  }
  return poolPromise;
}

function send(res, status, payload, type='application/json; charset=utf-8', extraHeaders={}) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://images.unsplash.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
    'Cache-Control': type.startsWith('application/json') ? 'no-store' : 'public, max-age=60',
    ...extraHeaders
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(payload) : payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      reject(Object.assign(new Error('Content-Type must be application/json'), { status: 415 }));
      return;
    }
    let raw = '';
    let finished = false;
    req.on('data', chunk => {
      if (finished) return;
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) {
        finished = true;
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.resume();
      }
    });
    req.on('end', () => {
      if (finished) return;
      try {
        const parsed = JSON.parse(raw || '{}');
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('JSON object required');
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('A valid JSON object is required'), { status: 400 }));
      }
    });
    req.on('error', error => {
      if (!finished) reject(error);
    });
  });
}

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}
function rateLimited(req, route) {
  const limit = RATE_LIMITS[route];
  if (!limit) return false;
  const now = Date.now();
  const key = route + ':' + requestIp(req);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}
function sameOriginIfBrowser(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const expectedHost = String(req.headers.host || '').toLowerCase();
    const originUrl = new URL(origin);
    return originUrl.host.toLowerCase() === expectedHost;
  } catch {
    return false;
  }
}
function assuranceAuthorized(req) {
  const expected = process.env.KEEL_ASSURANCE_TOKEN;
  if (!expected) return false;
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\\s+/i,'');
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
async function recordEventWithClient(client, tenant, type, subjectId, payload) {
  const tenantLock=await client.query("SELECT tenant_id,status FROM keel_tenants WHERE tenant_id=$1 FOR UPDATE",[tenant.tenant_id]);
  if(!tenantLock.rowCount || tenantLock.rows[0].status!=='active') throw Object.assign(new Error('tenant_not_active'),{status:403});
  const last=await client.query('SELECT tenant_sequence,event_fingerprint FROM keel_assurance_events WHERE tenant_id=$1 ORDER BY tenant_sequence DESC LIMIT 1',[tenant.tenant_id]);
  const sequence=last.rowCount?Number(last.rows[0].tenant_sequence)+1:1;
  const previousFingerprint=last.rowCount?last.rows[0].event_fingerprint:null;
  const event={tenantId:tenant.tenant_id,sequence,previousFingerprint,eventId:crypto.randomUUID(),eventType:type,subjectId,actorKeyId:tenant.key_id,actorRole:tenant.role,payload};
  const eventFingerprint=authorityChain.eventDigest(event);
  await client.query('INSERT INTO keel_assurance_events (event_id,tenant_id,tenant_sequence,previous_event_fingerprint,actor_key_id,actor_role,event_type,subject_id,event_fingerprint,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[event.eventId,event.tenantId,sequence,previousFingerprint,event.actorKeyId,event.actorRole,type,subjectId,eventFingerprint,JSON.stringify(payload)]);
  return {eventId:event.eventId,sequence,eventFingerprint};
}
async function recordEvent(pool, tenant, type, subjectId, payload) {
  const client=await pool.connect();
  try { await client.query('BEGIN'); const result=await recordEventWithClient(client,tenant,type,subjectId,payload); await client.query('COMMIT'); return result; }
  catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function authenticateTenant(req) {
  const token=tenantSecurity.keyFromAuthorization(req.headers.authorization);
  if(!token) return null;
  const pool=await dbPool(); if(!pool) return null;
  const hash=tenantSecurity.hashPresentedKey(token);
  const result=await pool.query("SELECT t.tenant_id,t.tenant_name,t.tenant_slug,k.key_id,k.role,k.principal_id,p.display_name AS principal_name,p.email AS principal_email FROM keel_tenant_keys k JOIN keel_tenants t ON t.tenant_id=k.tenant_id LEFT JOIN keel_principals p ON p.principal_id=k.principal_id AND p.status='active' WHERE k.token_hash=$1 AND k.status='active' AND t.status='active' LIMIT 1",[hash]);
  if(!result.rowCount) return null;
  await pool.query('UPDATE keel_tenant_keys SET last_used_at=NOW() WHERE key_id=$1',[result.rows[0].key_id]);
  return result.rows[0];
}
function cleanString(value, max=2000) {
  return typeof value === 'string' ? value.trim().slice(0,max) : '';
}
function demoPayload() {
  const now = new Date().toISOString();
  return {
    synthetic: true,
    state: { currency:'USD', assets:[{
      id:'ASSET-SYN-001', grossValue:10000000, encumberedValue:2000000,
      evidence:[{id:'EVID-SYN-001',source:'Plumbline Keel synthetic fixture',observedAt:now,class:'simulated',encumbranceStatus:'known'}]
    }]},
    policy:{id:'POLICY-SYN-001',version:'1.0.0',haircutRate:0.1,maxEvidenceAgeMs:86400000},
    action:{id:'ACTION-SYN-001',type:'financing_request',amount:7000000,authorized:true}
  };
}
const apiDescription = {
  openapi:'3.1.0',
  info:{title:'Plumbline Keel API',version:'0.3.1',description:'Advisory evaluation and enquiry intake. No external financial registries are queried.'},
  paths:{
    '/api/health':{get:{summary:'Service and database readiness'}},
    '/api/products':{get:{summary:'Current product catalogue'}},
    '/api/assurance/status':{get:{summary:'Assurance Fabric availability'}},
    '/api/tenants/bootstrap':{post:{summary:'Create institution tenant and one-time owner API key'}},
    '/api/tenants/keys':{post:{summary:'Issue tenant-scoped role key (owner/admin only)'}},
    '/api/tenants/keys/revoke':{post:{summary:'Revoke a tenant-scoped API key (owner/admin only)'}},
    '/api/assurance/records':{get:{summary:'Read tenant-scoped assurance records'}},
    '/api/assurance/chain/verify':{get:{summary:'Verify tenant event sequence and hash chain'}},
    '/api/assurance/dockets/{docketId}/export':{get:{summary:'Export tenant-scoped docket evidence manifest'}},
    '/api/assurance/principals':{post:{summary:'Create named principal and reviewer credential'}},
    '/api/assurance/delegations':{post:{summary:'Grant expiring scoped authority'}},
    '/api/assurance/models':{post:{summary:'Register model (token restricted)'}},
    '/api/assurance/dockets':{post:{summary:'Create ProofDocket (token restricted)'}},
    '/api/assurance/drift':{post:{summary:'Record fingerprint drift (token restricted)'} },
    '/api/demo':{get:{summary:'Evaluate synthetic demonstration portfolio'}},
    '/api/evaluate':{post:{summary:'Evaluate caller-supplied state against a versioned policy'}},
    '/api/leads':{post:{summary:'Persist partnership, integration or pilot enquiry'}}
  }
};

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const route = url.pathname;
  try {
    if (req.method === 'GET' && route === '/api/health') {
      let database = 'not_configured';
      if (process.env.DATABASE_URL) {
        try { const pool = await dbPool(); await pool.query('SELECT 1'); database = 'connected'; }
        catch { database = 'unavailable'; }
      }
      const ok = database === 'connected';
      return send(res, ok ? 200 : 503, {
        ok, service:'Plumbline Keel', version:'0.3.1',
        mode:'advisory_platform', database,
        api:'available', leadPersistence:ok ? 'available' : 'unavailable',
        integrations:'customer-configured; no external registries connected'
      });
    }
    if (req.method === 'GET' && route === '/api/assurance/status') {
      return send(res,200,{fabric:'Keel Assurance Fabric',version:'1.0',availability:'available',tenantIsolation:'credential-scoped',boundary:'Advisory evidence records only; no external registry verification or financial execution.'});
    }
    if (req.method === 'POST' && route === '/api/tenants/bootstrap') {
      if (!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const expected=process.env.KEEL_TENANT_BOOTSTRAP_TOKEN;
      if (!expected) return send(res,503,{error:'tenant_bootstrap_not_configured'});
      const supplied=String(req.headers.authorization||'').replace(/^Bearer\\s+/i,'');
      const a=Buffer.from(supplied), b=Buffer.from(expected);
      if (!a.length || a.length!==b.length || !crypto.timingSafeEqual(a,b)) return send(res,401,{error:'bootstrap_authorization_required'});
      const pool=await dbPool(); if(!pool) return send(res,503,{error:'tenant_storage_unavailable'});
      const tenant=tenantSecurity.normalizeTenant(await readBody(req));
      const issued=tenantSecurity.issueTenantKey(), tenantId=crypto.randomUUID(), client=await pool.connect();
      try { await client.query('BEGIN'); await client.query('INSERT INTO keel_tenants (tenant_id,tenant_name,tenant_slug) VALUES ($1,$2,$3)',[tenantId,tenant.name,tenant.slug]); await client.query('INSERT INTO keel_tenant_keys (key_id,tenant_id,token_hash,label,role) VALUES ($1,$2,$3,$4,$5)',[issued.keyId,tenantId,issued.tokenHash,'Initial institution key','owner']); await client.query('COMMIT'); }
      catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return send(res,201,{ok:true,tenant:{id:tenantId,name:tenant.name,slug:tenant.slug},apiKey:issued.token,keyId:issued.keyId,warning:'This key is shown once; only its hash is stored.'});
    }
    if(req.method==='POST' && route==='/api/assurance/principals'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!['owner','admin'].includes(actor.role)) return send(res,403,{error:'tenant_role_insufficient',requiredRole:'admin'});
      const body=await readBody(req), principal=authorityIdentity.normalizePrincipal(body), issued=tenantSecurity.issueTenantKey(), principalId=crypto.randomUUID(), pool=await dbPool(), client=await pool.connect();
      try { await client.query('BEGIN'); await client.query("INSERT INTO keel_principals(principal_id,tenant_id,display_name,email,external_subject,identity_assurance) VALUES($1,$2,$3,$4,$5,'self_asserted')",[principalId,actor.tenant_id,principal.displayName,principal.email,principal.externalSubject]); await client.query("INSERT INTO keel_tenant_keys(key_id,tenant_id,token_hash,label,role,principal_id) VALUES($1,$2,$3,$4,'reviewer',$5)",[issued.keyId,actor.tenant_id,issued.tokenHash,principal.displayName,principalId]); await client.query('COMMIT'); }
      catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return send(res,201,{ok:true,principal:{principalId,displayName:principal.displayName,email:principal.email,identityAssurance:'self_asserted'},keyId:issued.keyId,role:'reviewer',apiKey:issued.token,warning:'Key shown once. Identity remains self-asserted until external identity verification is integrated.'});
    }
    if(req.method==='POST' && route==='/api/assurance/delegations'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!actor.principal_id || !['owner','admin'].includes(actor.role)) return send(res,403,{error:'named_admin_principal_required'});
      const body=await readBody(req), delegation=authorityIdentity.normalizeDelegation(body,actor.principal_id), pool=await dbPool();
      const grantee=await pool.query("SELECT principal_id FROM keel_principals WHERE tenant_id=$1 AND principal_id=$2 AND status='active'",[actor.tenant_id,delegation.granteePrincipalId]);
      if(!grantee.rowCount) return send(res,404,{error:'active_grantee_not_found'});
      const id=crypto.randomUUID(); await pool.query('INSERT INTO keel_delegations(delegation_id,tenant_id,grantor_principal_id,grantee_principal_id,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.tenant_id,actor.principal_id,delegation.granteePrincipalId,JSON.stringify(delegation.scopes),delegation.expiresAt]);
      return send(res,201,{ok:true,delegationId:id,...delegation});
    }
    const approvalPrefix='/api/assurance/dockets/';
    const approvalSuffix='/approvals';
    const approvalMatch=route.startsWith(approvalPrefix) && route.endsWith(approvalSuffix) ? [null,route.slice(approvalPrefix.length,-approvalSuffix.length)] : null;
    if(req.method==='POST' && approvalMatch){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!actor.principal_id) return send(res,403,{error:'named_reviewer_required'});
      if(!['owner','admin','reviewer'].includes(actor.role)) {
        const delegated=await (await dbPool()).query("SELECT 1 FROM keel_delegations WHERE tenant_id=$1 AND grantee_principal_id=$2 AND status='active' AND expires_at>NOW() AND scopes ? 'docket:approve' LIMIT 1",[actor.tenant_id,actor.principal_id]);
        if(!delegated.rowCount) return send(res,403,{error:'docket_approval_authority_required'});
      }
      const body=await readBody(req), decision=authorityIdentity.approvalDecision(body), pool=await dbPool(), docketId=decodeURIComponent(approvalMatch[1]);
      const docket=await pool.query('SELECT docket_id FROM keel_proof_dockets WHERE tenant_id=$1 AND docket_id=$2',[actor.tenant_id,docketId]);
      if(!docket.rowCount) return send(res,404,{error:'tenant_docket_not_found'});
      const client=await pool.connect(); let count=0, rejected=false;
      try {
        await client.query('BEGIN');
        const locked=await client.query('SELECT docket_id FROM keel_proof_dockets WHERE tenant_id=$1 AND docket_id=$2 FOR UPDATE',[actor.tenant_id,docketId]);
        if(!locked.rowCount) { await client.query('ROLLBACK'); return send(res,404,{error:'tenant_docket_not_found'}); }
        const prior=await client.query('SELECT principal_id FROM keel_docket_approvals WHERE tenant_id=$1 AND docket_id=$2',[actor.tenant_id,docketId]);
        if(prior.rows.some(x=>x.principal_id===actor.principal_id)) { await client.query('ROLLBACK'); return send(res,409,{error:'principal_already_acted'}); }
        const docketPayload=await client.query('SELECT payload FROM keel_proof_dockets WHERE tenant_id=$1 AND docket_id=$2',[actor.tenant_id,docketId]);
        const submitter=docketPayload.rows[0]?.payload?.decisionWitness?.reviewerId;
        if(submitter && submitter===actor.key_id) { await client.query('ROLLBACK'); return send(res,403,{error:'submitter_cannot_approve_own_docket'}); }
        await client.query('INSERT INTO keel_docket_approvals(approval_id,tenant_id,docket_id,principal_id,decision,rationale) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),actor.tenant_id,docketId,actor.principal_id,decision.decision,decision.rationale]);
        const q=await client.query("SELECT COUNT(DISTINCT principal_id)::int AS count, BOOL_OR(decision='reject') AS rejected FROM keel_docket_approvals WHERE tenant_id=$1 AND docket_id=$2",[actor.tenant_id,docketId]);
        count=q.rows[0].count; rejected=q.rows[0].rejected===true;
        await recordEventWithClient(client,actor,'WITNESS_RECORDED',docketId,{principalId:actor.principal_id,decision:decision.decision,rationale:decision.rationale,distinctApprovals:count,rejected:q.rows[0].rejected});
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return send(res,201,{ok:true,docketId,recordedBy:actor.principal_id,distinctApprovals:count,threshold:2,rejected,approvalState:rejected?'rejected':(count>=2?'two_person_threshold_met':'awaiting_second_independent_principal'),note:'Two distinct authenticated principals have acted; this does not authorize financial execution.'});
    }
    if(req.method==='POST' && ['/api/tenants/keys','/api/tenants/keys/revoke'].includes(route)){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const tenant=await authenticateTenant(req); if(!tenant) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!['owner','admin'].includes(tenant.role)) return send(res,403,{error:'tenant_role_insufficient',requiredRole:'admin'});
      const pool=await dbPool(), payload=await readBody(req);
      if(route==='/api/tenants/keys/revoke'){
        const keyId=cleanString(payload.keyId,100); if(!keyId) return send(res,400,{error:'key_id_required'});
        const result=await pool.query("UPDATE keel_tenant_keys SET status='revoked' WHERE key_id=$1 AND tenant_id=$2 AND status='active' RETURNING key_id",[keyId,tenant.tenant_id]);
        if(!result.rowCount) return send(res,404,{error:'active_tenant_key_not_found'});
        return send(res,200,{ok:true,revokedKeyId:keyId});
      }
      const role=cleanString(payload.role,30), label=cleanString(payload.label,120);
      if(!['admin','reviewer','analyst','integration'].includes(role)) return send(res,400,{error:'invalid_key_role'});
      if(!label) return send(res,400,{error:'key_label_required'});
      const issued=tenantSecurity.issueTenantKey();
      await pool.query('INSERT INTO keel_tenant_keys (key_id,tenant_id,token_hash,label,role) VALUES ($1,$2,$3,$4,$5)',[issued.keyId,tenant.tenant_id,issued.tokenHash,label,role]);
      return send(res,201,{ok:true,keyId:issued.keyId,role,label,apiKey:issued.token,warning:'This key is shown once. Store it securely; only its hash is retained.'});
    }
    if (req.method === 'POST' && ['/api/assurance/models','/api/assurance/dockets','/api/assurance/drift'].includes(route)) {
      if (!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const tenant=await authenticateTenant(req); if(!tenant) return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool(); if(!pool) return send(res,503,{error:'assurance_storage_unavailable'});
      const payload=await readBody(req);
      const requiredRole=route==='/api/assurance/dockets'?'reviewer':'integration';
      if(!['owner','admin',requiredRole].includes(tenant.role)) return send(res,403,{error:'tenant_role_insufficient',requiredRole});
      if(route==='/api/assurance/models'){
        const m=assurance.buildModelCensus(payload), scopedId=tenant.tenant_id+':'+m.modelId;
        await pool.query('INSERT INTO keel_model_census (model_id,tenant_id,provider,model_name,version,owner_ref,purpose,access_scope,external,model_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (model_id) DO UPDATE SET provider=EXCLUDED.provider,model_name=EXCLUDED.model_name,version=EXCLUDED.version,owner_ref=EXCLUDED.owner_ref,purpose=EXCLUDED.purpose,access_scope=EXCLUDED.access_scope,external=EXCLUDED.external,model_fingerprint=EXCLUDED.model_fingerprint,updated_at=NOW() WHERE keel_model_census.tenant_id=EXCLUDED.tenant_id',[scopedId,tenant.tenant_id,m.provider,m.modelName,m.version,m.owner,m.purpose,m.accessScope,m.external,m.modelFingerprint]);
        await recordEvent(pool,tenant,'MODEL_REGISTERED',m.modelId,m);
        return send(res,201,{ok:true,modelId:m.modelId,modelFingerprint:m.modelFingerprint});
      }
      if(route==='/api/assurance/dockets'){
        const docketInput={...payload,witness:{...(payload.witness||{}),reviewerId:tenant.key_id,role:tenant.role}};
        const d=assurance.buildProofDocket(docketInput);
        const client=await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('INSERT INTO keel_proof_dockets (docket_id,tenant_id,decision_id,decision,docket_fingerprint,decision_fingerprint,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)',[d.docketId,tenant.tenant_id,d.decision.decisionId,d.decision.decision,d.docketFingerprint,d.decision.recordFingerprint,JSON.stringify(d)]);
          await recordEventWithClient(client,tenant,'DOCKET_CREATED',d.docketId,{docketFingerprint:d.docketFingerprint,decision:d.decision.decision});
          if(d.fallbackMandate.status==='restricted') await recordEventWithClient(client,tenant,'FALLBACK_RESTRICTED',d.docketId,d.fallbackMandate);
          if(d.decisionWitness.status!=='pending') await recordEventWithClient(client,tenant,'WITNESS_RECORDED',d.docketId,d.decisionWitness);
          await client.query('COMMIT');
        } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
        return send(res,201,{ok:true,docketId:d.docketId,decision:d.decision.decision,docketFingerprint:d.docketFingerprint,proofDocket:d});
      }
      const drift=assurance.assessDrift(payload.previous,payload.current); await recordEvent(pool,tenant,'DRIFT_DETECTED',drift.driftId,drift);
      return send(res,201,{ok:true,drift});
    }
    if(req.method==='GET' && route==='/api/assurance/records'){
      const tenant=await authenticateTenant(req); if(!tenant) return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool(), limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||25)));
      const q=await Promise.all([
        pool.query('SELECT model_id,provider,model_name,version,owner_ref,purpose,access_scope,external,model_fingerprint,registered_at,updated_at FROM keel_model_census WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT $2',[tenant.tenant_id,limit]),
        pool.query('SELECT docket_id,created_at,decision_id,decision,docket_fingerprint,decision_fingerprint FROM keel_proof_dockets WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2',[tenant.tenant_id,limit]),
        pool.query('SELECT event_id,created_at,tenant_sequence,previous_event_fingerprint,event_type,subject_id,actor_key_id,actor_role,event_fingerprint FROM keel_assurance_events WHERE tenant_id=$1 ORDER BY tenant_sequence DESC LIMIT $2',[tenant.tenant_id,limit])
      ]);
      return send(res,200,{tenant:{id:tenant.tenant_id,name:tenant.tenant_name},models:q[0].rows,dockets:q[1].rows,events:q[2].rows});
    }
    if(req.method==='GET' && route.startsWith('/api/assurance/dockets/') && route.endsWith('/export')){
      const tenant=await authenticateTenant(req); if(!tenant) return send(res,401,{error:'valid_tenant_api_key_required'});
      const prefix='/api/assurance/dockets/', suffix='/export';
      const docketId=decodeURIComponent(route.slice(prefix.length,-suffix.length));
      if(!docketId || docketId.includes('/')) return send(res,400,{error:'invalid_docket_id'});
      const pool=await dbPool(); if(!pool) return send(res,503,{error:'assurance_storage_unavailable'});
      const [docket,approvals,events]=await Promise.all([
        pool.query('SELECT docket_id,created_at,decision_id,decision,docket_fingerprint,decision_fingerprint,payload FROM keel_proof_dockets WHERE tenant_id=$1 AND docket_id=$2',[tenant.tenant_id,docketId]),
        pool.query('SELECT a.principal_id,p.display_name,p.email,a.decision,a.rationale,a.created_at FROM keel_docket_approvals a JOIN keel_principals p ON p.tenant_id=a.tenant_id AND p.principal_id=a.principal_id WHERE a.tenant_id=$1 AND a.docket_id=$2 ORDER BY a.created_at ASC',[tenant.tenant_id,docketId]),
        pool.query('SELECT tenant_id,tenant_sequence,previous_event_fingerprint,event_id,event_type,subject_id,actor_key_id,actor_role,payload,event_fingerprint FROM keel_assurance_events WHERE tenant_id=$1 AND subject_id=$2 ORDER BY tenant_sequence ASC',[tenant.tenant_id,docketId])
      ]);
      if(!docket.rowCount) return send(res,404,{error:'tenant_docket_not_found'});
      const chainVerification=authorityChain.verifyChain((await pool.query('SELECT tenant_id,tenant_sequence,previous_event_fingerprint,event_id,event_type,subject_id,actor_key_id,actor_role,payload,event_fingerprint FROM keel_assurance_events WHERE tenant_id=$1 AND tenant_sequence IS NOT NULL ORDER BY tenant_sequence ASC',[tenant.tenant_id])).rows.map(row=>({tenantId:row.tenant_id,sequence:Number(row.tenant_sequence),previousFingerprint:row.previous_event_fingerprint,eventId:row.event_id,eventType:row.event_type,subjectId:row.subject_id,actorKeyId:row.actor_key_id,actorRole:row.actor_role,payload:row.payload,eventFingerprint:row.event_fingerprint})));
      const manifest=authorityIdentity.exportManifest({tenantId:tenant.tenant_id,docket:{...docket.rows[0],approvals:approvals.rows,events:events.rows},chainVerification});
      return send(res,200,manifest,'application/json; charset=utf-8',{'Content-Disposition':'attachment; filename="keel-evidence-'+docketId.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json"'});
    }
    if(req.method==='GET' && route==='/api/assurance/chain/verify'){
      const tenant=await authenticateTenant(req); if(!tenant) return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool();
      if(!pool) return send(res,503,{error:'assurance_storage_unavailable'});
      const result=await pool.query('SELECT tenant_id,tenant_sequence,previous_event_fingerprint,event_id,event_type,subject_id,actor_key_id,actor_role,payload,event_fingerprint FROM keel_assurance_events WHERE tenant_id=$1 AND tenant_sequence IS NOT NULL ORDER BY tenant_sequence ASC',[tenant.tenant_id]);
      const verification=authorityChain.verifyChain(result.rows.map(row=>({tenantId:row.tenant_id,sequence:Number(row.tenant_sequence),previousFingerprint:row.previous_event_fingerprint,eventId:row.event_id,eventType:row.event_type,subjectId:row.subject_id,actorKeyId:row.actor_key_id,actorRole:row.actor_role,payload:row.payload,eventFingerprint:row.event_fingerprint})));
      return send(res,200,{tenant:{id:tenant.tenant_id,name:tenant.tenant_name},verification,checkedAt:new Date().toISOString(),note:'Verifies the stored tenant event sequence and fingerprints; it is not an independent external notarization.'});
    }
    if (req.method === 'GET' && route === '/api/products') {
      return send(res,200,{products,notice:'Stage labels describe current product maturity; no external financial data sources are connected by default.'});
    }
    if (req.method === 'GET' && route === '/api/openapi.json') {
      return send(res,200,apiDescription);
    }
    if (req.method === 'GET' && route === '/api/demo') {
      const payload = demoPayload();
      return send(res,200,{synthetic:true,result:evaluateAction(payload)});
    }
    if (req.method === 'POST' && ['/api/evaluate','/api/leads'].includes(route)) {
      if (!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      if (rateLimited(req,route)) return send(res,429,{error:'rate_limit_exceeded',message:'Please wait before submitting another request.'},undefined,{'Retry-After':'60'});
      const payload = await readBody(req);
      if (route === '/api/evaluate') {
        try {
          const result = evaluateAction(payload);
          return send(res,200,{synthetic:payload.synthetic === true,result});
        } catch (error) {
          return send(res,400,{error:'invalid_financial_payload',message:error.message});
        }
      }
      const lead = {
        id:crypto.randomUUID(),
        type:cleanString(payload.type,30),
        name:cleanString(payload.name,120),
        organization:cleanString(payload.organization,160),
        email:cleanString(payload.email,254).toLowerCase(),
        role:cleanString(payload.role,120),
        region:cleanString(payload.region,100),
        interest:cleanString(payload.interest,300),
        message:cleanString(payload.message,3000),
        consent:payload.consent === true
      };
      if (payload.website) return send(res,202,{ok:true,message:'Request received.'});
      if (!['partnership','integration','pilot','general'].includes(lead.type)) return send(res,400,{error:'invalid_lead_type'});
      if (!lead.name || !lead.organization || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || !lead.consent) {
        return send(res,400,{error:'validation_failed',message:'Name, organization, valid email and consent are required.'});
      }
      const pool = await dbPool();
      if (!pool) return send(res,503,{error:'persistence_unavailable',message:'Lead capture is not configured.'});
      await pool.query(
        'INSERT INTO keel_leads (id,lead_type,name,organization,email,role,region,interest,message,consent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [lead.id,lead.type,lead.name,lead.organization,lead.email,lead.role,lead.region,lead.interest,lead.message,lead.consent]
      );
      return send(res,201,{ok:true,leadId:lead.id,message:'Your request has been recorded.'});
    }
    if (req.method === 'GET' && ['/', '/index.html'].includes(route)) {
      return send(res,200,fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),'text/html; charset=utf-8');
    }
    return send(res,404,{error:'not_found'});
  } catch (error) {
    const status = error.status || (error.message && /required|must be|invalid|exceeds/.test(error.message) ? 400 : 500);
    if (status >= 500) console.error('request_failed', { route, status, name:error.name });
    return send(res,status,{error:status === 500 ? 'internal_error' : 'invalid_request',message:status === 500 ? 'The request could not be completed.' : error.message});
  }
});
if (require.main === module) {
  server.listen(PORT,HOST,() => console.log('Plumbline Keel listening on ' + HOST + ':' + PORT));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM',shutdown);
  process.on('SIGINT',shutdown);
}
module.exports = { server, demoPayload, products, rateLimited, readBody };
