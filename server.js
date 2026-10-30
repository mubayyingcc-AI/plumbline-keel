'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { evaluateAction } = require('./src/core');

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
  { id:'evidence', name:'Keel Evidence', category:'Evidence and audit', stage:'POC', description:'Package source references, timestamps, evidence classes, policy versions and record fingerprints.', outputs:['Evidence manifest','Decision fingerprint','Scope and limitation record'], integration:'REST API / structured CSV' }
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
