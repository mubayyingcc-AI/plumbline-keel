'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { evaluateAction, fingerprint } = require('./src/core');
const sandboxRunner = require('./src/sandbox-runner');
const assurance = require('./src/assurance');
const tenantSecurity = require('./src/tenant-security');
const authorityChain = require('./src/authority-chain');
const authorityIdentity = require('./src/evidence-authority');
const fractureEngine = require('./src/fracture-engine');
const currencyEngine = require('./src/currency-engine');
const financialState = require('./src/financial-state');
const regulatoryAssurance = require('./src/regulatory-assurance');
const humanCardPairing = require('./src/human-card-pairing');
const humanCardRecoveryApi = require('./src/human-card-recovery-api');
const consumerIdentityApi = require('./src/consumer-identity-api');
const consumerCardSecurityApi = require('./src/consumer-card-security-api');
const ledgerPosting = require('./src/ledger-posting');
const paymentAuthority = require('./src/payment-authority');
const cardControl = require('./src/card-control');
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const MAX_BODY = 256 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMITS = { '/api/leads': 8, '/api/evaluate': 30, '/api/sandbox/runs': 30, '/api/sandbox/payment-authority/runs': 20, '/api/sandbox/human-card/runs': 20 };
const rateBuckets = new Map();

const products = [
  { id:'thread', name:'Keel Thread', category:'Collateral lineage', stage:'POC', description:'Map assets, claims, facilities and obligations across the records an institution connects.', outputs:['Relationship graph','Potential reuse flags','Source-level lineage'], integration:'REST API / structured CSV' },
  { id:'capacity', name:'Keel Capacity', category:'Policy-adjusted capacity', stage:'POC', description:'Calculate capacity against versioned eligibility, encumbrance, haircut and evidence-freshness rules.', outputs:['Gross and net values','Policy adjustments','Unknowns and holds'], integration:'REST API / structured CSV' },
  { id:'scenario', name:'Keel Scenario', category:'Stress propagation', stage:'Design partner', description:'Replay declared shocks through a defined dependency graph and inspect modeled downstream effects.', outputs:['Scenario assumptions','Dependency impact','Before-and-after state'], integration:'API / partner mapping' },
  { id:'evidence', name:'Keel Evidence', category:'Evidence and audit', stage:'POC', description:'Package source references, timestamps, evidence classes, policy versions and record fingerprints.', outputs:['Evidence manifest','Decision fingerprint','Scope and limitation record'], integration:'REST API / structured CSV' },
  { id:'assurance', name:'Keel Assurance Fabric', category:'Decision assurance', stage:'Foundation', description:'Bind source provenance, model context, policy trace, human witness, drift signals and bounded fallback into a persistent ProofDocket.', outputs:['OriginMark provenance','ModelCensus','DecisionWitness','RuleTrace','DriftSentinel','FallbackMandate','ProofDocket'], integration:'Token-restricted REST API / PostgreSQL' },
  { id:'payment-authority', name:'Keel Payment Authority & Agent Control', category:'Mandates and payment lifecycle', stage:'Foundation · non-executing', description:'Evaluate human-issued mandates, purpose and payee scope, spend limits and evidence-backed availability before any authorised provider workflow.', outputs:['Versioned mandates','Spend envelopes','Human approval boundary','Availability-aware decision','Lifecycle and recovery model'], integration:'Internal deterministic evaluator; persistent API integration pending' },
  { id:'card-control', name:'Keel Human Card & Institutional Card Control', category:'Consumer identity, card authority and spend control', stage:'Consumer identity foundation · partner issuance pending', description:'Build a physical-first human card journey with verified consumer identity, partner card-order requests, delivery proof, secure-element pairing, independent recovery and issuer-gated virtual activation.', outputs:['Consumer identity and short-lived session foundation','Physical card order request lifecycle','Delivery and hardware pairing gates','Recovery and issuer-eligibility controls'], integration:'PostgreSQL schema and signed provider-event API; no identity provider, manufacturer or issuer connected' },
  { id:'remittance-integrity', name:'Keel Remittance & Embedded Finance Integrity', category:'Transfer lifecycle and reconciliation', stage:'Architecture + schema foundation', description:'Trace remittance origin, funding, FX, payout, wallet credit and card spend as distinct provider events, with reconciliation and recovery evidence.', outputs:['Canonical transfer identity','Provider event ingestion model','Wallet availability controls','Discrepancy and recovery model'], integration:'Provider-neutral schema foundation; no MTO or wallet adapter connected' }
];

const publicSandboxScenarios = [
  { id:'KFS-001', version:'1.0.0', name:'Fresh evidence and policy evaluation', availability:'EXECUTABLE', dataClass:'synthetic', engine:'Keel collateral evaluator', boundary:'Fresh synthetic evidence only; no external institution or financial system is queried.' },
  { id:'KFS-002', version:'1.0.0', name:'Stale evidence must not pass cleanly', availability:'EXECUTABLE', dataClass:'synthetic', engine:'Keel collateral evaluator', boundary:'Stale synthetic evidence only; no external institution or financial system is queried.' }
];

const publicPaymentAuthorityScenarios = [
  { id:'PA-001', name:'Within mandate and verified capacity', expectedDecision:'ALLOW_WITHIN_MANDATE' },
  { id:'PA-002', name:'Human approval threshold exceeded', expectedDecision:'HUMAN_APPROVAL_REQUIRED' },
  { id:'PA-003', name:'Stale funding availability', expectedDecision:'HOLD' },
  { id:'PA-004', name:'Payee outside mandate scope', expectedDecision:'DENY' }
];
const publicHumanCardScenarios = [
  { id:'HC-001', name:'Sandbox profile with unverified funding boundary', availabilityExpected:'HOLD' }
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
      await pool.query("ALTER TABLE keel_assurance_events DROP CONSTRAINT IF EXISTS keel_assurance_events_event_type_check");
      await pool.query("ALTER TABLE keel_assurance_events ADD CONSTRAINT keel_assurance_events_event_type_check CHECK (event_type IN ('MODEL_REGISTERED','DOCKET_CREATED','DRIFT_DETECTED','FALLBACK_RESTRICTED','WITNESS_RECORDED','PRINCIPAL_CREATED','DELEGATION_GRANTED','DELEGATION_REVOKED','FRACTURE_ASSESSED','CURRENCY_ACCOUNT_CREATED','CURRENCY_TRANSFER_PREPARED'))");
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
      await pool.query("CREATE TABLE IF NOT EXISTS keel_fracture_assessments (assessment_id TEXT PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), status TEXT NOT NULL CHECK (status IN ('watch','strained','fractured')), scenario_id TEXT NOT NULL, input_fingerprint CHAR(64) NOT NULL, result_fingerprint CHAR(64) NOT NULL, payload JSONB NOT NULL)");
      await pool.query('CREATE INDEX IF NOT EXISTS keel_fracture_assessments_tenant_idx ON keel_fracture_assessments(tenant_id,created_at DESC)');
      await pool.query("CREATE TABLE IF NOT EXISTS keel_currency_accounts (account_id TEXT PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), owner_ref TEXT NOT NULL, instrument_code TEXT NOT NULL, account_type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,account_id))");
      await pool.query('CREATE INDEX IF NOT EXISTS keel_currency_accounts_tenant_idx ON keel_currency_accounts(tenant_id,created_at DESC)');
      await pool.query("CREATE TABLE IF NOT EXISTS keel_currency_transfer_intents (transfer_id TEXT PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), from_account_id TEXT NOT NULL, to_account_id TEXT NOT NULL, instrument_code TEXT NOT NULL, amount_units NUMERIC(78,0) NOT NULL CHECK(amount_units>0), idempotency_key TEXT NOT NULL, condition JSONB, status TEXT NOT NULL DEFAULT 'prepared' CHECK(status='prepared'), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,idempotency_key), FOREIGN KEY(tenant_id,from_account_id) REFERENCES keel_currency_accounts(tenant_id,account_id), FOREIGN KEY(tenant_id,to_account_id) REFERENCES keel_currency_accounts(tenant_id,account_id))");
      await pool.query('CREATE INDEX IF NOT EXISTS keel_currency_intents_tenant_idx ON keel_currency_transfer_intents(tenant_id,created_at DESC)');
      await pool.query("CREATE TABLE IF NOT EXISTS keel_financial_objects (object_id TEXT NOT NULL, tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), object_type TEXT NOT NULL, currency_or_unit TEXT NOT NULL, gross_units NUMERIC(78,0) NOT NULL CHECK(gross_units>=0), encumbered_units NUMERIC(78,0), evidence_status TEXT NOT NULL, lifecycle_status TEXT NOT NULL, source_ref TEXT NOT NULL, external_object_ref TEXT NOT NULL, object_fingerprint CHAR(64) NOT NULL, observed_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,object_id), UNIQUE(tenant_id,source_ref,external_object_ref))");
      await pool.query('CREATE INDEX IF NOT EXISTS keel_financial_objects_tenant_idx ON keel_financial_objects(tenant_id,updated_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS keel_assurance_events_tenant_idx ON keel_assurance_events(tenant_id,created_at DESC)');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS tenant_sequence BIGINT');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS previous_event_fingerprint CHAR(64)');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS actor_key_id TEXT');
      await pool.query('ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS actor_role TEXT');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS keel_assurance_events_tenant_sequence_uq ON keel_assurance_events(tenant_id,tenant_sequence) WHERE tenant_id IS NOT NULL');
      await pool.query("CREATE OR REPLACE FUNCTION keel_reject_assurance_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Keel Authority Chain events are append-only'; END; $$");
      await pool.query('DROP TRIGGER IF EXISTS keel_assurance_events_immutable ON keel_assurance_events');
      await pool.query('CREATE TRIGGER keel_assurance_events_immutable BEFORE UPDATE OR DELETE ON keel_assurance_events FOR EACH ROW EXECUTE FUNCTION keel_reject_assurance_event_mutation()');

      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_sources (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), source_id TEXT NOT NULL, source_type TEXT NOT NULL CHECK(source_type IN ('law','harmonised_standard','standard','guidance','contract','internal_policy')), jurisdiction TEXT NOT NULL, title TEXT NOT NULL, authority_uri TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,source_id))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_obligations (tenant_id UUID NOT NULL, obligation_id TEXT NOT NULL, source_id TEXT NOT NULL, source_version TEXT NOT NULL, locator TEXT NOT NULL, regulated_role TEXT NOT NULL, effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ, payload JSONB NOT NULL, version_fingerprint CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,obligation_id,source_version), FOREIGN KEY(tenant_id,source_id) REFERENCES keel_regulatory_sources(tenant_id,source_id), CHECK(effective_to IS NULL OR effective_to>effective_from))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_controls (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), control_id TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('proposed','approved','implemented','operating','ineffective','suspended','retired')), owner_principal_id UUID, payload JSONB NOT NULL, control_fingerprint CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,control_id,version))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_mappings (tenant_id UUID NOT NULL, mapping_id UUID NOT NULL, obligation_id TEXT NOT NULL, obligation_version TEXT NOT NULL, control_id TEXT NOT NULL, control_version TEXT NOT NULL, evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb, approved_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,mapping_id), FOREIGN KEY(tenant_id,obligation_id,obligation_version) REFERENCES keel_regulatory_obligations(tenant_id,obligation_id,source_version), FOREIGN KEY(tenant_id,control_id,control_version) REFERENCES keel_regulatory_controls(tenant_id,control_id,version))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_evidence (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), evidence_id TEXT NOT NULL, version TEXT NOT NULL, verification_state TEXT NOT NULL CHECK(verification_state IN ('self_asserted','source_authenticated','independently_verified','rejected')), valid_until TIMESTAMPTZ, payload JSONB NOT NULL, evidence_fingerprint CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,evidence_id,version))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_findings (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), finding_id TEXT NOT NULL, obligation_id TEXT NOT NULL, code TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('low','moderate','high','critical')), status TEXT NOT NULL CHECK(status IN ('open','in_progress','closed','reopened')), payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,finding_id))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_actions (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), action_id TEXT NOT NULL, finding_id TEXT NOT NULL, owner_principal_id UUID, due_at TIMESTAMPTZ, status TEXT NOT NULL CHECK(status IN ('open','in_progress','implemented','verified','rejected')), payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,action_id), FOREIGN KEY(tenant_id,finding_id) REFERENCES keel_regulatory_findings(tenant_id,finding_id))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_conformity_dockets (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), docket_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('DRAFT','IN_REVIEW','ACCEPTED_WITH_GAPS','READY_FOR_EXTERNAL_REVIEW','SUPERSEDED')), manifest_fingerprint CHAR(64) NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,docket_id), UNIQUE(tenant_id,manifest_fingerprint))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_assessments (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), assessment_id TEXT NOT NULL, assessment_fingerprint CHAR(64) NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,assessment_id), UNIQUE(tenant_id,assessment_fingerprint))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS keel_regulatory_applicability_decisions (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), decision_id UUID NOT NULL, obligation_id TEXT NOT NULL, obligation_version TEXT NOT NULL, applicable BOOLEAN NOT NULL, rationale JSONB NOT NULL, reviewer_principal_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,decision_id), FOREIGN KEY(tenant_id,obligation_id,obligation_version) REFERENCES keel_regulatory_obligations(tenant_id,obligation_id,source_version), FOREIGN KEY(tenant_id,reviewer_principal_id) REFERENCES keel_principals(tenant_id,principal_id))`);
      await pool.query('CREATE INDEX IF NOT EXISTS keel_reg_findings_tenant_idx ON keel_regulatory_findings(tenant_id,status,severity)');
      await pool.query('CREATE INDEX IF NOT EXISTS keel_reg_dockets_tenant_idx ON keel_conformity_dockets(tenant_id,created_at DESC)');
      const runtimeUrl = process.env.KEEL_RUNTIME_DATABASE_URL;
      if (!runtimeUrl) return pool;
      const runtimePool = new Pool({
        connectionString: runtimeUrl,
        ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 8000,
        query_timeout: 10000
      });
      try {
        await runtimePool.query('SELECT 1');
        await pool.end();
        return runtimePool;
      } catch (error) {
        await runtimePool.end().catch(() => {});
        await pool.end().catch(() => {});
        throw error;
      }
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
  const result=await pool.query("SELECT t.tenant_id,t.tenant_name,t.tenant_slug,k.key_id,k.role,k.principal_id,p.display_name AS principal_name,p.email AS principal_email,p.identity_assurance FROM keel_tenant_keys k JOIN keel_tenants t ON t.tenant_id=k.tenant_id LEFT JOIN keel_principals p ON p.principal_id=k.principal_id AND p.status='active' WHERE k.token_hash=$1 AND k.status='active' AND t.status='active' LIMIT 1",[hash]);
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
    '/api/sandbox/scenarios':{get:{summary:'Executable public synthetic sandbox scenarios'}},
    '/api/sandbox/payment-authority/scenarios':{get:{summary:'Executable synthetic Payment Authority scenarios'}},
    '/api/sandbox/human-card/scenarios':{get:{summary:'Executable synthetic Human Card scenarios'}},
    '/api/sandbox/payment-authority/runs':{post:{summary:'Evaluate a synthetic payment intent against a human-issued mandate; no execution'}},
    '/api/sandbox/human-card/runs':{post:{summary:'Run a synthetic Human Card profile and unverified funding-boundary test'}},
    '/api/ledger/status':{get:{summary:'Ledger migration, runtime-role and row-level security readiness'}},
    '/api/assurance/status':{get:{summary:'Assurance Fabric availability'}},
    '/api/human-card/pairing/challenge':{post:{summary:'Issue one-time challenge to a delivered, attested physical Human Card'}},
    '/api/human-card/pairing/verify':{post:{summary:'Verify Ed25519 physical-card proof of possession and pair device'}},
    '/api/human-card/recovery/groups':{post:{summary:'Create recovery group with independently verified trustees'}},
    '/api/human-card/recovery/requests':{post:{summary:'Lock a lost or compromised physical card and open trustee recovery'}},
    '/api/human-card/recovery/requests/{requestId}/approvals':{post:{summary:'Record independent trustee recovery decision'}},
    '/api/human-card/recovery/requests/{requestId}/finalise':{post:{summary:'Finalise delayed recovery into replacement-card pending state'}},
    '/api/consumer/identity/provider-events':{post:{summary:'Receive signed identity-verification provider events'}},
    '/api/consumer/me':{get:{summary:'Read authenticated consumer identity and Human Card order status'}},
    '/api/consumer/card-orders':{post:{summary:'Submit an idempotent physical Human Card order request'}},
    '/api/consumer/cards':{get:{summary:'List consumer Human Cards and security status'}},
    '/api/consumer/cards/pairing/challenge':{post:{summary:'Issue physical Human Card secure-element pairing challenge'}},
    '/api/consumer/cards/pairing/verify':{post:{summary:'Verify consumer physical-card proof of possession'}},
    '/api/consumer/cards/lock':{post:{summary:'Emergency lock consumer physical card'}},
    '/api/consumer/recovery/groups':{post:{summary:'Create independent consumer recovery trustee group'}},
    '/api/consumer/recovery/requests':{post:{summary:'Open delayed consumer card recovery'}},
    '/api/consumer/recovery/requests/{requestId}/approval':{post:{summary:'Record independent trustee recovery approval'}},
    '/api/consumer/recovery/requests/{requestId}/finalise':{post:{summary:'Complete delayed recovery and require replacement card'}},
    '/api/partners/card-programme/events':{post:{summary:'Receive signed card partner personalisation events'}},
    '/api/partners/card-attestation/events':{post:{summary:'Receive signed independent hardware attestation events'}},
    '/api/partners/card-delivery/events':{post:{summary:'Receive signed independent card delivery events'}},
    '/api/tenants/bootstrap':{post:{summary:'Create institution tenant and one-time owner API key'}},
    '/api/ledger/accounts':{get:{summary:'List tenant ledger accounts and explicit currency exponents'},post:{summary:'Create a tenant ledger account with configured ISO currency minor-unit exponent'}},
    '/api/ledger/events/verify':{get:{summary:'Verify the tenant append-only ledger event hash chain'}},
    '/api/ledger/journals':{post:{summary:'Atomically post an immutable balanced journal'}},
    '/api/ledger/accounts/{accountId}/balance':{get:{summary:'Read ledger, reserved and available balances'}},
    '/api/ledger/reservations':{post:{summary:'Reserve available ledger funds'}},
    '/api/ledger/reservations/{reservationId}/release':{post:{summary:'Release an active funds reservation'}},
    '/api/ledger/reservations/{reservationId}/consume':{post:{summary:'Atomically consume a reservation with a journal'}},
    '/api/tenants/keys':{post:{summary:'Issue tenant-scoped role key (owner/admin only)'}},
    '/api/tenants/keys/revoke':{post:{summary:'Revoke a tenant-scoped API key (owner/admin only)'}},
    '/api/assurance/records':{get:{summary:'Read tenant-scoped assurance records'}},
    '/api/fracture/assessments':{get:{summary:'List tenant-scoped fracture assessments'},post:{summary:'Run and persist a Financial Fracture assessment'}},
    '/api/currency/instruments':{get:{summary:'List currency and service-credit instrument references'}},
    '/api/currency/accounts':{get:{summary:'List tenant simulation accounts'},post:{summary:'Create tenant simulation account'}},
    '/api/currency/transfers/prepare':{post:{summary:'Prepare non-settling conditional transfer intent'}},
    '/api/currency/transfers':{get:{summary:'List prepared simulation transfer intents'}},
    '/api/assurance/chain/verify':{get:{summary:'Verify tenant event sequence and hash chain'}},
    '/api/assurance/dockets/{docketId}/export':{get:{summary:'Export tenant-scoped docket evidence manifest'}},
    '/api/assurance/principals':{post:{summary:'Create named principal and reviewer credential'}},
    '/api/assurance/delegations':{post:{summary:'Grant expiring scoped authority'}},
    '/api/assurance/delegations/revoke':{post:{summary:'Revoke a delegation granted by the authenticated administrator'}},
    '/api/assurance/models':{post:{summary:'Register model (token restricted)'}},
    '/api/assurance/dockets':{post:{summary:'Create ProofDocket (token restricted)'}},
    '/api/assurance/drift':{post:{summary:'Record fingerprint drift (token restricted)'} },
    '/api/regulatory/sources':{get:{summary:'List tenant regulatory sources'},post:{summary:'Register a regulatory source'}},
    '/api/regulatory/obligations':{get:{summary:'List obligation versions'},post:{summary:'Register immutable obligation version'}},
    '/api/regulatory/applicability/evaluate':{post:{summary:'Evaluate obligation applicability for a scoped entity/system'}},
    '/api/regulatory/controls':{get:{summary:'List tenant controls'},post:{summary:'Register a versioned control'}},
    '/api/regulatory/evidence':{post:{summary:'Register self-asserted evidence; trusted verification requires connector'}},
    '/api/regulatory/mappings':{post:{summary:'Map obligation version to control and evidence'}},
    '/api/regulatory/gaps/evaluate':{post:{summary:'Evaluate evidence-linked control coverage'}},
    '/api/regulatory/findings':{get:{summary:'List regulatory findings'}},
    '/api/regulatory/assessments':{get:{summary:'List immutable regulatory coverage snapshots'}},
    '/api/regulatory/dockets':{get:{summary:'List regulatory evidence dockets'},post:{summary:'Create docket from server-generated assessment'}},
    '/api/regulatory/dockets/{docketId}/export':{get:{summary:'Export tenant regulatory evidence docket'}},
    '/api/regulatory/actions':{post:{summary:'Create corrective action against a finding'}},
    '/api/regulatory/changes/impact-assessments':{post:{summary:'Assess impact of a regulatory source version change'}},
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
    if (await humanCardRecoveryApi.handle({req,res,route,authenticateTenant,dbPool,send,readBody,sameOriginIfBrowser,recordEventWithClient,crypto,cleanString})) return;
    if (await consumerCardSecurityApi.handle({req,res,route,send,dbPool,readBody,sameOriginIfBrowser})) return;
    if (await consumerIdentityApi.handle({req,res,route,send,dbPool,crypto,readBody,sameOriginIfBrowser})) return;
    if (req.method === 'POST' && route === '/api/human-card/pairing/challenge') {
      if (!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);
      if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!actor.principal_id) return send(res,403,{error:'named_principal_required'});
      if(actor.identity_assurance!=='externally_verified') return send(res,403,{error:'externally_verified_cardholder_identity_required'});
      const body=await readBody(req),cardId=cleanString(body.cardId,100);
      if(!cardId) return send(res,400,{error:'card_id_required'});
      const pool=await dbPool();if(!pool)return send(res,503,{error:'card_registry_unavailable'});
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const device=await client.query('SELECT * FROM keel_human_card_devices WHERE tenant_id=$1 AND card_id=$2 AND principal_id=$3 FOR UPDATE',[actor.tenant_id,cardId,actor.principal_id]);
        if(!device.rowCount){await client.query('ROLLBACK');return send(res,404,{error:'human_card_not_found'});}
        const d=device.rows[0];
        if(d.device_status!=='delivered_pending_pairing'||d.lifecycle_state!=='physical_card_delivered_pending_pairing'||!d.delivery_verified_at){await client.query('ROLLBACK');return send(res,409,{error:'physical_card_delivery_not_verified_or_card_not_pairable'});}
        if(d.hardware_attestation_verified!==true||!d.hardware_attestation_verifier_id||!d.hardware_attested_at||!d.attestation_reference){await client.query('ROLLBACK');return send(res,409,{error:'independent_hardware_attestation_required'});}
        if(!d.device_public_key||!d.key_fingerprint){await client.query('ROLLBACK');return send(res,409,{error:'device_public_key_not_provisioned'});}
        const challenge=humanCardPairing.createPairingChallenge({tenantId:actor.tenant_id,principalId:actor.principal_id,cardId,counter:Number(d.last_challenge_counter)+1});
        await client.query('INSERT INTO keel_human_card_pairing_challenges(tenant_id,challenge_id,card_id,principal_id,nonce_hash,expected_counter,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.tenant_id,challenge.challengeId,cardId,actor.principal_id,challenge.nonceHash,challenge.counter,challenge.expiresAt]);
        await recordEventWithClient(client,actor,'HUMAN_CARD_PAIRING_CHALLENGE_ISSUED',cardId,{challengeId:challenge.challengeId,counter:challenge.counter,expiresAt:challenge.expiresAt});
        await client.query('COMMIT');
        return send(res,201,{ok:true,challenge:{challengeId:challenge.challengeId,nonce:challenge.nonce,counter:challenge.counter,expiresAt:challenge.expiresAt,message:challenge.message,algorithm:'Ed25519',hardwareAttestation:'independently_verified'}});
      } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
    }
    if (req.method === 'POST' && route === '/api/human-card/pairing/verify') {
      if (!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);
      if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!actor.principal_id) return send(res,403,{error:'named_principal_required'});
      if(actor.identity_assurance!=='externally_verified') return send(res,403,{error:'externally_verified_cardholder_identity_required'});
      const body=await readBody(req),challengeId=cleanString(body.challengeId,64),nonce=cleanString(body.nonce,128),signature=cleanString(body.signature,256);
      if(!challengeId||!nonce||!signature)return send(res,400,{error:'challenge_id_nonce_and_signature_required'});
      const pool=await dbPool();if(!pool)return send(res,503,{error:'card_registry_unavailable'});
      const client=await pool.connect();
      try {
        await client.query('BEGIN');

        const q=await client.query('SELECT c.*,d.device_public_key,d.key_fingerprint,d.device_status,d.lifecycle_state,d.hardware_attestation_verified,d.last_challenge_counter FROM keel_human_card_pairing_challenges c JOIN keel_human_card_devices d ON d.tenant_id=c.tenant_id AND d.card_id=c.card_id WHERE c.tenant_id=$1 AND c.challenge_id=$2 AND c.principal_id=$3 FOR UPDATE OF c,d',[actor.tenant_id,challengeId,actor.principal_id]);
        if(!q.rowCount){await client.query('ROLLBACK');return send(res,404,{error:'pairing_challenge_not_found'});}
        const c=q.rows[0];
        if(c.consumed_at){await client.query('ROLLBACK');return send(res,409,{error:'pairing_challenge_already_consumed'});}
        await client.query('UPDATE keel_human_card_pairing_challenges SET consumed_at=NOW() WHERE tenant_id=$1 AND challenge_id=$2',[actor.tenant_id,challengeId]);
        let nonceValid=false;try{nonceValid=humanCardPairing.hashNonce(nonce)===c.nonce_hash;}catch{nonceValid=false;}
        const expiryIso=c.expires_at instanceof Date?c.expires_at.toISOString():new Date(c.expires_at).toISOString();
        const expired=humanCardPairing.isExpired(expiryIso);
        const deviceEligible=c.device_status==='delivered_pending_pairing'&&c.lifecycle_state==='physical_card_delivered_pending_pairing'&&c.hardware_attestation_verified===true;
        const counterValid=Number(c.expected_counter)===Number(c.last_challenge_counter)+1;
        const message=[humanCardPairing.VERSION,c.tenant_id,c.principal_id,c.card_id,c.challenge_id,nonce,String(c.expected_counter),expiryIso].join('\n');

        let fingerprintValid=false;try{fingerprintValid=humanCardPairing.fingerprintPublicKey(c.device_public_key)===String(c.key_fingerprint||'').trim();}catch{fingerprintValid=false;}
        const signatureValid=nonceValid&&!expired&&deviceEligible&&counterValid&&fingerprintValid&&humanCardPairing.verifyPairingSignature({publicKeyPem:c.device_public_key,message,signatureBase64url:signature});
        if(!signatureValid){
          await recordEventWithClient(client,actor,'HUMAN_CARD_PAIRING_FAILED',c.card_id,{challengeId,expired,nonceValid,deviceEligible,counterValid});
          await client.query('COMMIT');
          return send(res,401,{error:'physical_card_pairing_proof_invalid_or_expired'});
        }
        await client.query("UPDATE keel_human_card_devices SET device_status='paired',lifecycle_state='physical_card_paired',paired_at=NOW(),last_challenge_counter=$3,updated_at=NOW() WHERE tenant_id=$1 AND card_id=$2",[actor.tenant_id,c.card_id,c.expected_counter]);
        await recordEventWithClient(client,actor,'HUMAN_CARD_PAIRED',c.card_id,{challengeId,counter:Number(c.expected_counter)});
        await client.query('COMMIT');
        return send(res,200,{ok:true,card:{cardId:c.card_id,status:'paired',lifecycleState:'physical_card_paired',counter:Number(c.expected_counter)},nextRequirement:'independent_recovery_setup_and_test',virtualChannel:'LOCKED'});
      } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
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
      const body=await readBody(req), principal=authorityIdentity.normalizePrincipal(body);
      const role=cleanString(body.role||'reviewer',30);
      if(!['admin','reviewer','analyst','integration'].includes(role)) return send(res,400,{error:'invalid_principal_role',allowed:['admin','reviewer','analyst','integration']});
      const issued=tenantSecurity.issueTenantKey(), principalId=crypto.randomUUID(), pool=await dbPool(), client=await pool.connect();
      try { await client.query('BEGIN'); await client.query("INSERT INTO keel_principals(principal_id,tenant_id,display_name,email,external_subject,identity_assurance) VALUES($1,$2,$3,$4,$5,'self_asserted')",[principalId,actor.tenant_id,principal.displayName,principal.email,principal.externalSubject]); await client.query("INSERT INTO keel_tenant_keys(key_id,tenant_id,token_hash,label,role,principal_id) VALUES($1,$2,$3,$4,$5,$6)",[issued.keyId,actor.tenant_id,issued.tokenHash,principal.displayName,role,principalId]); await recordEventWithClient(client,actor,'PRINCIPAL_CREATED',principalId,{displayName:principal.displayName,email:principal.email,role,identityAssurance:'self_asserted'}); await client.query('COMMIT'); }
      catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return send(res,201,{ok:true,principal:{principalId,displayName:principal.displayName,email:principal.email,identityAssurance:'self_asserted'},keyId:issued.keyId,role,apiKey:issued.token,warning:'Key shown once. Identity remains self-asserted until external identity verification is integrated.'});
    }
    if(req.method==='POST' && route==='/api/assurance/delegations/revoke'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!actor.principal_id || !['owner','admin'].includes(actor.role)) return send(res,403,{error:'named_admin_principal_required'});
      const body=await readBody(req), delegationId=cleanString(body.delegationId,80); if(!delegationId) return send(res,400,{error:'delegation_id_required'});
      const pool=await dbPool();
      const client=await pool.connect();
      try { await client.query('BEGIN'); const result=await client.query("UPDATE keel_delegations SET status='revoked' WHERE tenant_id=$1 AND delegation_id=$2 AND grantor_principal_id=$3 AND status='active' RETURNING delegation_id,grantee_principal_id,scopes"); if(!result.rowCount) { await client.query('ROLLBACK'); return send(res,404,{error:'active_granted_delegation_not_found'}); } await recordEventWithClient(client,actor,'DELEGATION_REVOKED',delegationId,{grantorPrincipalId:actor.principal_id,granteePrincipalId:result.rows[0].grantee_principal_id,scopes:result.rows[0].scopes}); await client.query('COMMIT'); }
      catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return send(res,200,{ok:true,revokedDelegationId:delegationId});
    }
    if(req.method==='POST' && route==='/api/assurance/delegations'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!actor.principal_id || !['owner','admin'].includes(actor.role)) return send(res,403,{error:'named_admin_principal_required'});
      const body=await readBody(req), delegation=authorityIdentity.normalizeDelegation(body,actor.principal_id), pool=await dbPool();
      const grantee=await pool.query("SELECT principal_id FROM keel_principals WHERE tenant_id=$1 AND principal_id=$2 AND status='active'",[actor.tenant_id,delegation.granteePrincipalId]);
      if(!grantee.rowCount) return send(res,404,{error:'active_grantee_not_found'});
      const id=crypto.randomUUID(), client=await pool.connect();
      try { await client.query('BEGIN'); await client.query('INSERT INTO keel_delegations(delegation_id,tenant_id,grantor_principal_id,grantee_principal_id,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.tenant_id,actor.principal_id,delegation.granteePrincipalId,JSON.stringify(delegation.scopes),delegation.expiresAt]); await recordEventWithClient(client,actor,'DELEGATION_GRANTED',id,{grantorPrincipalId:actor.principal_id,granteePrincipalId:delegation.granteePrincipalId,scopes:delegation.scopes,expiresAt:delegation.expiresAt}); await client.query('COMMIT'); }
      catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
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
        const submitterPrincipal=docketPayload.rows[0]?.payload?.decisionWitness?.principalId;
        const submitterKey=docketPayload.rows[0]?.payload?.decisionWitness?.reviewerId;
        if((submitterPrincipal && submitterPrincipal===actor.principal_id) || (!submitterPrincipal && submitterKey===actor.key_id)) { await client.query('ROLLBACK'); return send(res,403,{error:'submitter_cannot_approve_own_docket'}); }
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
        const docketInput={...payload,witness:{...(payload.witness||{}),reviewerId:tenant.key_id,principalId:tenant.principal_id||null,role:tenant.role}};
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
    if(req.method==='POST' && route==='/api/financial-state/objects') {
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!['owner','admin','integration'].includes(actor.role)) return send(res,403,{error:'tenant_role_insufficient',requiredRole:'integration'});
      const object=financialState.normalizeFinancialObject(await readBody(req)), pool=await dbPool();
      if(!pool) return send(res,503,{error:'financial_state_storage_unavailable'});
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO keel_financial_objects(object_id,tenant_id,object_type,currency_or_unit,gross_units,encumbered_units,evidence_status,lifecycle_status,source_ref,external_object_ref,object_fingerprint,observed_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[object.objectId,actor.tenant_id,object.objectType,object.currencyOrUnit,object.grossUnits,object.encumberedUnits,object.evidenceStatus,object.lifecycleStatus,object.sourceRef,object.externalObjectRef,object.objectFingerprint,object.observedAt,JSON.stringify(object)]);
        await recordEventWithClient(client,actor,'FINANCIAL_OBJECT_RECORDED',object.objectId,{objectFingerprint:object.objectFingerprint,objectType:object.objectType,evidenceStatus:object.evidenceStatus,sourceRef:object.sourceRef});
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return send(res,201,{ok:true,object,availability:financialState.assessAvailability(object)});
    }
    if(req.method==='GET' && route==='/api/financial-state/objects') {
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool(); if(!pool) return send(res,503,{error:'financial_state_storage_unavailable'});
      const rows=await pool.query('SELECT payload FROM keel_financial_objects WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 250',[actor.tenant_id]);
      const snapshot=financialState.buildStateSnapshot(rows.rows.map(x=>x.payload),{id:'keel-default-availability',version:'1',maxEvidenceAgeMs:86400000});
      return send(res,200,{ok:true,snapshot});
    }
    if(req.method==='GET' && route==='/api/currency/instruments'){
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      return send(res,200,{instruments:currencyEngine.INSTRUMENTS,notice:'Catalogue and service-credit simulation only; no money is issued, held or settled.'});
    }
    if(req.method==='POST' && route==='/api/currency/accounts'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      const body=await readBody(req), account=currencyEngine.newAccount(body), pool=await dbPool();
      if(!pool) return send(res,503,{error:'currency_storage_unavailable'});
      const client=await pool.connect();
      try { await client.query('BEGIN'); await client.query('INSERT INTO keel_currency_accounts(account_id,tenant_id,owner_ref,instrument_code,account_type) VALUES($1,$2,$3,$4,$5)',[account.accountId,actor.tenant_id,account.ownerRef,account.instrumentCode,account.accountType]); await recordEventWithClient(client,actor,'CURRENCY_ACCOUNT_CREATED',account.accountId,{instrumentCode:account.instrumentCode,accountType:account.accountType,ledgerMode:account.ledgerMode}); await client.query('COMMIT'); }
      catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
      return send(res,201,{ok:true,account});
    }
    if(req.method==='GET' && route==='/api/currency/accounts'){
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool(); if(!pool) return send(res,503,{error:'currency_storage_unavailable'});
      const rows=await pool.query('SELECT account_id,owner_ref,instrument_code,account_type,created_at FROM keel_currency_accounts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[actor.tenant_id]);
      return send(res,200,{count:rows.rowCount,accounts:rows.rows,notice:'These are simulation accounts, not bank or custodial accounts.'});
    }
    if(req.method==='POST' && route==='/api/currency/transfers/prepare'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      const body=await readBody(req), intent=currencyEngine.prepareTransfer(body), pool=await dbPool();
      if(!pool) return send(res,503,{error:'currency_storage_unavailable'});
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const accounts=await client.query('SELECT account_id FROM keel_currency_accounts WHERE tenant_id=$1 AND account_id=ANY($2::text[]) FOR UPDATE',[actor.tenant_id,[intent.fromAccountId,intent.toAccountId]]);
        if(accounts.rowCount!==2) throw Object.assign(new Error('both_accounts_must_exist_in_same_tenant'),{status:404});
        await client.query('INSERT INTO keel_currency_transfer_intents(transfer_id,tenant_id,from_account_id,to_account_id,instrument_code,amount_units,idempotency_key,condition) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[intent.transferId,actor.tenant_id,intent.fromAccountId,intent.toAccountId,intent.instrumentCode,intent.amountUnits,intent.idempotencyKey,intent.condition?JSON.stringify(intent.condition):null]);
        await recordEventWithClient(client,actor,'CURRENCY_TRANSFER_PREPARED',intent.transferId,{instrumentCode:intent.instrumentCode,amountUnits:intent.amountUnits,fromAccountId:intent.fromAccountId,toAccountId:intent.toAccountId,status:'prepared',mode:'simulation_only'});
        await client.query('COMMIT');
      } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
      return send(res,201,{ok:true,intent,notice:'Prepared simulation intent only. No balance is debited, no payment is sent and no asset is transferred.'});
    }
    if(req.method==='GET' && route==='/api/currency/transfers'){
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool(); if(!pool) return send(res,503,{error:'currency_storage_unavailable'});
      const rows=await pool.query('SELECT transfer_id,from_account_id,to_account_id,instrument_code,amount_units,idempotency_key,condition,status,created_at FROM keel_currency_transfer_intents WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[actor.tenant_id]);
      return send(res,200,{count:rows.rowCount,intents:rows.rows,notice:'Prepared simulation intents are not settled transactions.'});
    }
    if(req.method==='POST' && route==='/api/fracture/assessments'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      const input=await readBody(req), result=fractureEngine.assessFracture(input), pool=await dbPool();
      if(!pool) return send(res,503,{error:'fracture_storage_unavailable'});
      const client=await pool.connect();
      try { await client.query('BEGIN'); await client.query('INSERT INTO keel_fracture_assessments(assessment_id,tenant_id,status,scenario_id,input_fingerprint,result_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[result.assessmentId,actor.tenant_id,result.status,result.scenarioId,result.inputFingerprint,result.resultFingerprint,JSON.stringify(result)]); await recordEventWithClient(client,actor,'FRACTURE_ASSESSED',result.assessmentId,{status:result.status,scenarioId:result.scenarioId,resultFingerprint:result.resultFingerprint,systemicFlags:result.systemicFlags}); await client.query('COMMIT'); }
      catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return send(res,201,{ok:true,assessment:result});
    }
    if(req.method==='GET' && route==='/api/fracture/assessments'){
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool(); if(!pool) return send(res,503,{error:'fracture_storage_unavailable'});
      const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||25)));
      const rows=await pool.query('SELECT assessment_id,created_at,status,scenario_id,input_fingerprint,result_fingerprint,payload FROM keel_fracture_assessments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2',[actor.tenant_id,limit]);
      return send(res,200,{ok:true,count:rows.rowCount,assessments:rows.rows});
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
      const signingKey=process.env.KEEL_EXPORT_PRIVATE_KEY_PEM;
      if(!signingKey) return send(res,503,{error:'evidence_export_signing_not_configured',message:'Configure KEEL_EXPORT_PRIVATE_KEY_PEM with an Ed25519 private key before issuing signed evidence exports.'});
      const manifest=authorityIdentity.exportManifest({tenantId:tenant.tenant_id,docket:{...docket.rows[0],approvals:approvals.rows,events:events.rows},chainVerification});
      const signed=authorityIdentity.signManifest(manifest,signingKey,process.env.KEEL_EXPORT_KEY_ID);
      return send(res,200,signed,'application/json; charset=utf-8',{'Content-Disposition':'attachment; filename="keel-evidence-'+docketId.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json"'});
    }
    if(req.method==='GET' && route==='/api/assurance/chain/verify'){
      const tenant=await authenticateTenant(req); if(!tenant) return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool();
      if(!pool) return send(res,503,{error:'assurance_storage_unavailable'});
      const result=await pool.query('SELECT tenant_id,tenant_sequence,previous_event_fingerprint,event_id,event_type,subject_id,actor_key_id,actor_role,payload,event_fingerprint FROM keel_assurance_events WHERE tenant_id=$1 AND tenant_sequence IS NOT NULL ORDER BY tenant_sequence ASC',[tenant.tenant_id]);
      const verification=authorityChain.verifyChain(result.rows.map(row=>({tenantId:row.tenant_id,sequence:Number(row.tenant_sequence),previousFingerprint:row.previous_event_fingerprint,eventId:row.event_id,eventType:row.event_type,subjectId:row.subject_id,actorKeyId:row.actor_key_id,actorRole:row.actor_role,payload:row.payload,eventFingerprint:row.event_fingerprint})));
      return send(res,200,{tenant:{id:tenant.tenant_id,name:tenant.tenant_name},verification,checkedAt:new Date().toISOString(),note:'Verifies the stored tenant event sequence and fingerprints; it is not an independent external notarization.'});
    }


    if(req.method==='GET' && ['/api/regulatory/sources','/api/regulatory/obligations','/api/regulatory/controls','/api/regulatory/dockets','/api/regulatory/assessments'].includes(route)){
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool();if(!pool)return send(res,503,{error:'regulatory_storage_unavailable'});
      const table=route.endsWith('/sources')?'keel_regulatory_sources':route.endsWith('/obligations')?'keel_regulatory_obligations':route.endsWith('/controls')?'keel_regulatory_controls':route.endsWith('/dockets')?'keel_conformity_dockets':'keel_regulatory_assessments';
      const rows=await pool.query('SELECT * FROM '+table+' WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 250',[actor.tenant_id]);return send(res,200,{count:rows.rowCount,records:rows.rows});
    }
    if(req.method==='POST' && route==='/api/regulatory/applicability/evaluate'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const b=await readBody(req),pool=await dbPool();
      const q=await pool.query('SELECT payload FROM keel_regulatory_obligations WHERE tenant_id=$1 AND obligation_id=$2 AND source_version=$3',[actor.tenant_id,b.obligationId,b.obligationVersion]);
      if(!q.rowCount)return send(res,404,{error:'tenant_obligation_version_not_found'});
      const decision=regulatoryAssurance.evaluateApplicability(q.rows[0].payload,b.context,b.asOf||new Date());
      const id=crypto.randomUUID(),client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO keel_regulatory_applicability_decisions(tenant_id,decision_id,obligation_id,obligation_version,applicable,rationale,reviewer_principal_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.tenant_id,id,b.obligationId,b.obligationVersion,decision.applicable,JSON.stringify(decision),actor.principal_id||null]);await recordEventWithClient(client,actor,'REGULATORY_APPLICABILITY_EVALUATED',id,{obligationId:b.obligationId,obligationVersion:b.obligationVersion,applicable:decision.applicable,decisionFingerprint:decision.decisionFingerprint});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,200,{ok:true,decisionId:id,decision});
    }
    // Regulatory Assurance Fabric: tenant-authenticated evidence and control workflows.
    if(req.method==='POST' && route==='/api/regulatory/sources'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req); if(!actor) return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!['owner','admin','integration'].includes(actor.role)) return send(res,403,{error:'tenant_role_insufficient'});
      const b=await readBody(req), sourceType=cleanString(b.sourceType,40), sourceId=cleanString(b.sourceId,120), jurisdiction=cleanString(b.jurisdiction,80), title=cleanString(b.title,300);
      if(!['law','harmonised_standard','standard','guidance','contract','internal_policy'].includes(sourceType)||!sourceId||!jurisdiction||!title) return send(res,400,{error:'invalid_regulatory_source'});
      const pool=await dbPool(), client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO keel_regulatory_sources(tenant_id,source_id,source_type,jurisdiction,title,authority_uri) VALUES($1,$2,$3,$4,$5,$6)',[actor.tenant_id,sourceId,sourceType,jurisdiction,title,b.authorityUri||null]);await recordEventWithClient(client,actor,'REGULATORY_SOURCE_REGISTERED',sourceId,{sourceType,jurisdiction,title});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,201,{ok:true,sourceId});
    }
    if(req.method==='POST' && route==='/api/regulatory/obligations'){
      if(!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!['owner','admin','reviewer'].includes(actor.role))return send(res,403,{error:'tenant_role_insufficient'});
      const obligation=regulatoryAssurance.normalizeObligation(await readBody(req)),pool=await dbPool(),client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO keel_regulatory_obligations(tenant_id,obligation_id,source_id,source_version,locator,regulated_role,effective_from,effective_to,payload,version_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[actor.tenant_id,obligation.obligationId,obligation.sourceId,obligation.sourceVersion,obligation.locator,obligation.regulatedRole,obligation.effectiveFrom,obligation.effectiveTo,JSON.stringify(obligation),obligation.versionFingerprint]);await recordEventWithClient(client,actor,'REGULATORY_OBLIGATION_VERSIONED',obligation.obligationId,{sourceVersion:obligation.sourceVersion,fingerprint:obligation.versionFingerprint});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,201,{ok:true,obligation});
    }
    if(req.method==='POST' && route==='/api/regulatory/controls'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const control=regulatoryAssurance.normalizeControl(await readBody(req)),pool=await dbPool(),client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO keel_regulatory_controls(tenant_id,control_id,version,state,owner_principal_id,payload,control_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.tenant_id,control.controlId,control.version,control.state,control.ownerPrincipalId,JSON.stringify(control),control.controlFingerprint]);await recordEventWithClient(client,actor,'REGULATORY_CONTROL_VERSIONED',control.controlId,{version:control.version,state:control.state,fingerprint:control.controlFingerprint});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,201,{ok:true,control});
    }
    if(req.method==='POST' && route==='/api/regulatory/evidence'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const evidence=regulatoryAssurance.normalizeEvidence(await readBody(req));
      if(evidence.verificationState!=='self_asserted') return send(res,403,{error:'external_evidence_verification_requires_trusted_connector',message:'Direct tenant uploads cannot self-assign source-authenticated or independently-verified status.'});
      const pool=await dbPool(),client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO keel_regulatory_evidence(tenant_id,evidence_id,version,verification_state,valid_until,payload,evidence_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.tenant_id,evidence.evidenceId,evidence.version,evidence.verificationState,evidence.validUntil,JSON.stringify(evidence),evidence.evidenceFingerprint]);await recordEventWithClient(client,actor,'REGULATORY_EVIDENCE_REGISTERED',evidence.evidenceId,{version:evidence.version,verificationState:evidence.verificationState,fingerprint:evidence.evidenceFingerprint});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,201,{ok:true,evidence});
    }
    if(req.method==='POST' && route==='/api/regulatory/mappings'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!['owner','admin','reviewer'].includes(actor.role))return send(res,403,{error:'tenant_role_insufficient'});
      const b=await readBody(req),id=crypto.randomUUID(),pool=await dbPool(),client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO keel_regulatory_mappings(tenant_id,mapping_id,obligation_id,obligation_version,control_id,control_version,evidence_ids,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[actor.tenant_id,id,b.obligationId,b.obligationVersion,b.controlId,b.controlVersion,JSON.stringify(b.evidenceIds||[]),actor.principal_id||null]);await recordEventWithClient(client,actor,'REGULATORY_MAPPING_CREATED',id,{obligationId:b.obligationId,controlId:b.controlId});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,201,{ok:true,mappingId:id});
    }
    if(req.method==='POST' && route==='/api/regulatory/gaps/evaluate'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool();if(!pool)return send(res,503,{error:'regulatory_storage_unavailable'});
      const [oq,cq,mq,eq]=await Promise.all([
       pool.query('SELECT payload FROM keel_regulatory_obligations WHERE tenant_id=$1',[actor.tenant_id]),
       pool.query('SELECT payload FROM keel_regulatory_controls WHERE tenant_id=$1',[actor.tenant_id]),
       pool.query('SELECT obligation_id,control_id,evidence_ids FROM keel_regulatory_mappings WHERE tenant_id=$1',[actor.tenant_id]),
       pool.query('SELECT payload FROM keel_regulatory_evidence WHERE tenant_id=$1',[actor.tenant_id])
      ]);
      const coverage=regulatoryAssurance.evaluateCoverage({obligations:oq.rows.map(x=>x.payload),controls:cq.rows.map(x=>x.payload),mappings:mq.rows.map(x=>({obligationId:x.obligation_id,controlId:x.control_id,evidenceIds:x.evidence_ids})),evidenceLinks:eq.rows.map(x=>x.payload)});
      const assessmentId='REGASS-'+coverage.assessmentFingerprint.slice(0,24),client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO keel_regulatory_assessments(tenant_id,assessment_id,assessment_fingerprint,snapshot) VALUES($1,$2,$3,$4)',[actor.tenant_id,assessmentId,coverage.assessmentFingerprint,JSON.stringify(coverage)]);for(const finding of coverage.findings)await client.query("INSERT INTO keel_regulatory_findings(tenant_id,finding_id,obligation_id,code,severity,status,payload) VALUES($1,$2,$3,$4,$5,'open',$6) ON CONFLICT(tenant_id,finding_id) DO NOTHING",[actor.tenant_id,finding.findingId,finding.obligationId,finding.code,finding.severity,JSON.stringify(finding)]);await recordEventWithClient(client,actor,'REGULATORY_GAPS_EVALUATED',assessmentId,{summary:coverage.summary,fingerprint:coverage.assessmentFingerprint});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,200,{ok:true,assessmentId,coverage});
    }
    if(req.method==='GET' && route==='/api/regulatory/findings'){
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool();if(!pool)return send(res,503,{error:'regulatory_storage_unavailable'});
      const rows=await pool.query('SELECT finding_id,obligation_id,code,severity,status,payload,created_at FROM keel_regulatory_findings WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 250',[actor.tenant_id]);return send(res,200,{count:rows.rowCount,findings:rows.rows});
    }
    if(req.method==='POST' && route==='/api/regulatory/dockets'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const b=await readBody(req);if(!b.assessmentId||!b.scope)return send(res,400,{error:'assessment_id_and_scope_required'});
      const pool=await dbPool(),assessment=await pool.query('SELECT snapshot FROM keel_regulatory_assessments WHERE tenant_id=$1 AND assessment_id=$2',[actor.tenant_id,b.assessmentId]);
      if(!assessment.rowCount)return send(res,404,{error:'tenant_regulatory_assessment_not_found'});
      if(b.state&&b.state!=='DRAFT')return send(res,403,{error:'external_review_state_requires_controlled_human_approval'});
      const coverage=assessment.rows[0].snapshot,docket=regulatoryAssurance.createConformityDocket({...b,tenantId:actor.tenant_id,coverage,findings:coverage.findings,state:'DRAFT'}),client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO keel_conformity_dockets(tenant_id,docket_id,state,manifest_fingerprint,snapshot) VALUES($1,$2,$3,$4,$5)',[actor.tenant_id,docket.docketId,docket.state,docket.manifestFingerprint,JSON.stringify(docket)]);await recordEventWithClient(client,actor,'REGULATORY_DOCKET_CREATED',docket.docketId,{state:docket.state,manifestFingerprint:docket.manifestFingerprint});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,201,{ok:true,docket});
    }
    if(req.method==='GET' && route.startsWith('/api/regulatory/dockets/') && route.endsWith('/export')){
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const id=decodeURIComponent(route.slice('/api/regulatory/dockets/'.length,-'/export'.length)),pool=await dbPool();
      const row=await pool.query('SELECT snapshot FROM keel_conformity_dockets WHERE tenant_id=$1 AND docket_id=$2',[actor.tenant_id,id]);if(!row.rowCount)return send(res,404,{error:'regulatory_docket_not_found'});
      return send(res,200,{export:row.rows[0].snapshot,notice:'Evidence assessment only; not certification, legal advice or a declaration of conformity.'});
    }
    if(req.method==='POST' && route==='/api/regulatory/actions'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const b=await readBody(req),id=cleanString(b.actionId,120)||crypto.randomUUID(),ownerId=cleanString(b.ownerPrincipalId,80),dueAt=b.dueAt||null,pool=await dbPool();
      if(!b.findingId||!ownerId||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(ownerId))return send(res,400,{error:'finding_id_and_valid_owner_principal_required'});
      if(dueAt&&!Number.isFinite(Date.parse(dueAt)))return send(res,400,{error:'invalid_action_due_date'});
      const [finding,owner]=await Promise.all([pool.query('SELECT finding_id FROM keel_regulatory_findings WHERE tenant_id=$1 AND finding_id=$2',[actor.tenant_id,b.findingId]),pool.query("SELECT principal_id FROM keel_principals WHERE tenant_id=$1 AND principal_id=$2 AND status='active'",[actor.tenant_id,ownerId])]);
      if(!finding.rowCount)return send(res,404,{error:'tenant_finding_not_found'});if(!owner.rowCount)return send(res,404,{error:'active_tenant_action_owner_not_found'});
      const client=await pool.connect();
      try{await client.query('BEGIN');await client.query("INSERT INTO keel_regulatory_actions(tenant_id,action_id,finding_id,owner_principal_id,due_at,status,payload) VALUES($1,$2,$3,$4,$5,'open',$6)",[actor.tenant_id,id,b.findingId,ownerId,dueAt,JSON.stringify(b)]);await recordEventWithClient(client,actor,'REGULATORY_ACTION_CREATED',id,{findingId:b.findingId,ownerPrincipalId:ownerId,dueAt});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
      return send(res,201,{ok:true,actionId:id,status:'open'});
    }

    if(req.method==='GET' && route==='/api/regulatory/actions'){
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const rows=await (await dbPool()).query('SELECT action_id,finding_id,owner_principal_id,due_at,status,payload,created_at FROM keel_regulatory_actions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 250',[actor.tenant_id]);return send(res,200,{count:rows.rowCount,actions:rows.rows});
    }
    if(req.method==='POST' && route==='/api/regulatory/actions/transition'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      if(!actor.principal_id||!['owner','admin','reviewer'].includes(actor.role))return send(res,403,{error:'named_independent_reviewer_required'});
      const b=await readBody(req),id=cleanString(b.actionId,120),next=cleanString(b.status,30),pool=await dbPool(),client=await pool.connect();
      if(!id||!['in_progress','implemented','verified','rejected'].includes(next))return send(res,400,{error:'invalid_action_transition'});
      try{
       await client.query('BEGIN');
       const q=await client.query('SELECT action_id,finding_id,owner_principal_id,status,payload FROM keel_regulatory_actions WHERE tenant_id=$1 AND action_id=$2 FOR UPDATE',[actor.tenant_id,id]);
       if(!q.rowCount){await client.query('ROLLBACK');return send(res,404,{error:'tenant_action_not_found'});}
       const a=q.rows[0],allowed={open:['in_progress','rejected'],in_progress:['implemented','rejected'],implemented:['verified','rejected'],verified:[],rejected:[]};
       if(!allowed[a.status]?.includes(next)){await client.query('ROLLBACK');return send(res,409,{error:'invalid_action_state_transition',from:a.status,to:next});}
       if(next==='verified'&&String(a.owner_principal_id)===String(actor.principal_id)){await client.query('ROLLBACK');return send(res,403,{error:'action_owner_cannot_verify_own_remediation'});}
       const payload={...(a.payload||{}),lastTransition:{from:a.status,to:next,reviewerPrincipalId:actor.principal_id,rationale:cleanString(b.rationale,1000),evidenceRefs:Array.isArray(b.evidenceRefs)?b.evidenceRefs:[],at:new Date().toISOString()}};
       if(next==='verified'&&(!payload.lastTransition.rationale||!payload.lastTransition.evidenceRefs.length)){await client.query('ROLLBACK');return send(res,400,{error:'verification_requires_rationale_and_evidence'});}
       await client.query('UPDATE keel_regulatory_actions SET status=$3,payload=$4 WHERE tenant_id=$1 AND action_id=$2',[actor.tenant_id,id,next,JSON.stringify(payload)]);
       if(next==='verified'){
        const open=await client.query("SELECT COUNT(*)::int AS count FROM keel_regulatory_actions WHERE tenant_id=$1 AND finding_id=$2 AND action_id<>$3 AND status<>'verified'",[actor.tenant_id,a.finding_id,id]);
        if(open.rows[0].count===0)await client.query("UPDATE keel_regulatory_findings SET status='closed' WHERE tenant_id=$1 AND finding_id=$2",[actor.tenant_id,a.finding_id]);
       }
       await recordEventWithClient(client,actor,'REGULATORY_ACTION_TRANSITIONED',id,payload.lastTransition);await client.query('COMMIT');
       return send(res,200,{ok:true,actionId:id,status:next});
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }
    if(req.method==='POST' && route==='/api/regulatory/changes/impact-assessments'){
      if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      const actor=await authenticateTenant(req);if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const b=await readBody(req),pool=await dbPool();
      const [oq,mq,cq]=await Promise.all([pool.query('SELECT payload FROM keel_regulatory_obligations WHERE tenant_id=$1',[actor.tenant_id]),pool.query('SELECT obligation_id,control_id FROM keel_regulatory_mappings WHERE tenant_id=$1',[actor.tenant_id]),pool.query('SELECT payload FROM keel_regulatory_controls WHERE tenant_id=$1',[actor.tenant_id])]);
      const impact=regulatoryAssurance.assessRegulatoryChange({oldVersion:b.oldVersion,newVersion:b.newVersion,obligations:oq.rows.map(x=>x.payload),mappings:mq.rows.map(x=>({obligationId:x.obligation_id,controlId:x.control_id})),controls:cq.rows.map(x=>x.payload)});
      await recordEvent(pool,actor,'REGULATORY_CHANGE_IMPACT_ASSESSED',impact.impactFingerprint,impact);return send(res,200,{ok:true,impact});
    }
    if (req.method === 'GET' && route === '/api/ledger/status') {
      const pool = await dbPool();
      if (!pool) return send(res,503,{ok:false,status:'BLOCKED',reason:'database_not_configured'});
      const [migrations, role, rls] = await Promise.all([
        pool.query("SELECT version, applied_at FROM keel_schema_migrations WHERE version = ANY($1::text[]) ORDER BY version",[['012_double_entry_ledger.sql','013_ledger_posting_and_reservations.sql']]),
        pool.query("SELECT current_user AS role, r.rolsuper AS is_superuser, r.rolbypassrls AS bypasses_rls FROM pg_roles r WHERE r.rolname=current_user"),
        pool.query("SELECT COUNT(*)::int AS ledger_tables, COUNT(*) FILTER (WHERE c.relrowsecurity)::int AS rls_enabled, COUNT(*) FILTER (WHERE c.relforcerowsecurity)::int AS rls_forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY($1::text[])",[['keel_ledger_accounts','keel_ledger_journals','keel_ledger_lines','keel_ledger_account_balances','keel_ledger_reservations','keel_ledger_event_heads','keel_ledger_events']])
      ]);
      const runtime = role.rows[0] || {};
      const controls = rls.rows[0] || {};
      const migrationsReady = migrations.rowCount === 2;
      const roleReady = runtime.role === 'keel_runtime' && runtime.is_superuser === false && runtime.bypasses_rls === false;
      const rlsReady = controls.ledger_tables === 7 && controls.rls_enabled === 7 && controls.rls_forced === 7;
      return send(res,(migrationsReady && roleReady && rlsReady)?200:503,{
        ok:migrationsReady && roleReady && rlsReady,
        status:(migrationsReady && roleReady && rlsReady)?'READY':'BLOCKED',
        runtimeRole:runtime.role || 'unknown',
        privilegedRuntime:runtime.is_superuser === true || runtime.bypasses_rls === true,
        migrations:migrations.rows,
        rowLevelSecurity:{ledgerTables:controls.ledger_tables,enabled:controls.rls_enabled,forced:controls.rls_forced},
        boundary:'Ledger schema and tenant row-level security only; accounting periods, trial balance, reconciliation and external settlement are separate capabilities.'
      });
    }

    // Ledger APIs: tenant-scoped accounting records only; no external payment execution.
    if (route.startsWith('/api/ledger/')) {
      const actor=await authenticateTenant(req);
      if(!actor)return send(res,401,{error:'valid_tenant_api_key_required'});
      const pool=await dbPool();
      if(!pool)return send(res,503,{error:'ledger_storage_unavailable'});
      const canWrite=['owner','admin','integration'].includes(actor.role);
      if(req.method==='POST'&&!canWrite)return send(res,403,{error:'ledger_write_role_required'});
      if(req.method==='POST'&&!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
      if(req.method==='POST'&&route==='/api/ledger/accounts'){
        if(!['owner','admin'].includes(actor.role))return send(res,403,{error:'ledger_account_admin_required'});
        const account=await ledgerPosting.createAccount(pool,actor.tenant_id,await readBody(req));
        return send(res,201,{ok:true,account});
      }
      if(req.method==='GET'&&route==='/api/ledger/events/verify'){
        const verification=await ledgerPosting.verifyLedgerEventChain(pool,actor.tenant_id);
        return send(res,verification.valid?200:409,{ok:verification.valid,verification});
      }
      if(req.method==='GET'&&route==='/api/ledger/accounts'){
        const accounts=await ledgerPosting.listAccounts(pool,actor.tenant_id);
        return send(res,200,{count:accounts.length,accounts});
      }
      if(req.method==='POST'&&route==='/api/ledger/journals'){
        const result=await ledgerPosting.postJournal(pool,actor.tenant_id,await readBody(req));
        return send(res,result.replay?200:201,{ok:true,...result,notice:'Ledger posting only; this does not initiate or confirm an external payment or settlement.'});
      }
      const balanceMatch=route.match(/^\/api\/ledger\/accounts\/([^/]+)\/balance$/);
      if(req.method==='GET'&&balanceMatch){
        const balance=await ledgerPosting.getAccountBalance(pool,actor.tenant_id,decodeURIComponent(balanceMatch[1]));
        return send(res,200,{ok:true,balance});
      }
      if(req.method==='POST'&&route==='/api/ledger/reservations'){
        const result=await ledgerPosting.createReservation(pool,actor.tenant_id,await readBody(req));
        return send(res,result.replay?200:201,{ok:true,...result});
      }
      const releaseMatch=route.match(/^\/api\/ledger\/reservations\/([^/]+)\/release$/);
      if(req.method==='POST'&&releaseMatch){
        const b=await readBody(req);
        const result=await ledgerPosting.releaseReservation(pool,actor.tenant_id,decodeURIComponent(releaseMatch[1]),b.reason);
        return send(res,200,{ok:true,...result});
      }
      const consumeMatch=route.match(/^\/api\/ledger\/reservations\/([^/]+)\/consume$/);
      if(req.method==='POST'&&consumeMatch){
        const b=await readBody(req);
        const result=await ledgerPosting.consumeReservation(pool,actor.tenant_id,decodeURIComponent(consumeMatch[1]),b.journal);
        return send(res,result.status==='expired'?409:(result.replay?200:201),{ok:result.status!=='expired',...result});
      }
      return send(res,404,{error:'ledger_route_not_found'});
    }
    if (req.method === 'GET' && route === '/api/sandbox/scenarios') {
      return send(res,200,{
        scenarios:publicSandboxScenarios,
        notice:'Only scenarios marked EXECUTABLE are runnable in the public synthetic sandbox. Other financial test families remain outside this endpoint until their actual engines are integrated.'
      });
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
    if (req.method === 'GET' && route === '/api/sandbox/payment-authority/scenarios') {
      return send(res,200,{scenarios:publicPaymentAuthorityScenarios,notice:'Deterministic synthetic mandate tests only. No payment instruction, reservation, debit or settlement is created.'});
    }
    if (req.method === 'POST' && route === '/api/sandbox/payment-authority/runs') {
      if (!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      if (rateLimited(req,route)) return send(res,429,{error:'rate_limit_exceeded'},undefined,{'Retry-After':'60'});
      const body=await readBody(req),scenario=publicPaymentAuthorityScenarios.find(x=>x.id===body.scenarioId);
      if(!scenario)return send(res,400,{error:'sandbox_scenario_invalid'});
      const tenantId='tenant-public-synthetic',now=new Date().toISOString();
      const mandate={tenantId,mandateId:'mandate-public-synthetic-001',version:1,status:'active',granteeId:'agent-public-synthetic',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z',currency:'USD',channels:['card'],purposes:['supplier'],payeeIds:['payee-public-synthetic-001'],merchantIds:['merchant-public-synthetic-001'],fundingSourceIds:['funding-public-synthetic-001'],maxSingleMinor:'500000',periodLimitMinor:'1000000'};
      const intent={id:'intent-'+scenario.id,agentId:'agent-public-synthetic',amountMinor:scenario.id==='PA-002'?'30000':'10000',currency:'USD',purpose:'supplier',payeeId:scenario.id==='PA-004'?'payee-out-of-scope':'payee-public-synthetic-001',merchantId:'merchant-public-synthetic-001',channel:'card',fundingSourceId:'funding-public-synthetic-001',periodCommittedMinor:'10000'};
      const availability={currency:'USD',status:'reconciled',fresh:scenario.id!=='PA-003',restricted:false,eligibleBalanceMinor:'100000',restrictedMinor:'5000',obligationsReserveMinor:'10000',policyReserveMinor:'5000',activeReservationsMinor:'10000',providerHoldsMinor:'0'};
      const policy={policyId:'PA-PUBLIC-001',version:'1.0.0',status:'active',humanApprovalAboveMinor:'25000'};
      try{
        const result=paymentAuthority.evaluatePayment({tenantId,mandate,intent,availability,policy,now});
        return send(res,200,{ok:true,synthetic:true,scenario,expectedDecision:scenario.expectedDecision,passed:result.decision===scenario.expectedDecision,result,execution:'DISABLED',boundary:'Evaluation only. No reservation, approval, provider instruction, debit or settlement occurred.'});
      }catch(error){return send(res,400,{error:'payment_authority_scenario_invalid',message:error.message});}
    }
    if (req.method === 'GET' && route === '/api/sandbox/human-card/scenarios') {
      return send(res,200,{scenarios:publicHumanCardScenarios,notice:'Sandbox credential only. No issuer, payment credential or real funds.'});
    }
    if (req.method === 'POST' && route === '/api/sandbox/human-card/runs') {
      if (!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      if (rateLimited(req,route)) return send(res,429,{error:'rate_limit_exceeded'},undefined,{'Retry-After':'60'});
      const body=await readBody(req);
      if(body.scenarioId!=='HC-001')return send(res,400,{error:'sandbox_scenario_invalid'});
      const now=new Date(),card=cardControl.createCardProfile({cardId:'keel-sandbox-card-0001',principalId:'principal-public-synthetic',programmeId:'keel-public-sandbox',mandateId:'mandate-public-synthetic-001',mandateVersion:1,currency:'USD',channel:'virtual',issuanceMode:'sandbox'});
      const position={currency:'USD',verificationClass:'self_asserted',signatureVerified:false,reconciliationState:'unreconciled',observedAt:new Date(now.getTime()-60000).toISOString(),expiresAt:new Date(now.getTime()+300000).toISOString(),eligibleBalanceMinor:'100000',restrictedMinor:'0',obligationsMinor:'0',policyReserveMinor:'0',providerHoldsMinor:'0'};
      const fundingAvailability=cardControl.calculateAvailable(position,[],now);
      return send(res,200,{ok:true,synthetic:true,scenario:publicHumanCardScenarios[0],card,fundingAvailability,execution:'DISABLED',boundary:'Synthetic profile only. No issuer, PAN, CVV, payment token, real funds or card issuance.'});
    }
    if (req.method === 'POST' && route === '/api/sandbox/runs') {
      if (!sameOriginIfBrowser(req)) return send(res,403,{error:'origin_not_allowed'});
      if (rateLimited(req,route)) return send(res,429,{error:'rate_limit_exceeded',message:'Please wait before running another sandbox scenario.'},undefined,{'Retry-After':'60'});
      const payload = await readBody(req);
      try {
        const record = sandboxRunner.runPublicScenario(payload.scenarioId, evaluateAction);
        return send(res,200,{ok:true,record,notice:'Synthetic public test evidence only. This record is not signed, persisted, independently audited or a regulatory certification.'});
      } catch (error) {
        return send(res,400,{error:'sandbox_scenario_invalid',message:error.message});
      }
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
