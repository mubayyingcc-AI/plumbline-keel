'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { evaluateAction } = require('./src/core');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const MAX_BODY = 256 * 1024;
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
        connectionTimeoutMillis: 5000
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
function send(res, status, payload, type='application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': type.startsWith('application/json') ? 'no-store' : 'public, max-age=60'
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(payload) : payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(Object.assign(new Error('A valid JSON body is required'), { status: 400 })); }
    });
    req.on('error', reject);
  });
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
function cleanString(value, max=2000) {
  return typeof value === 'string' ? value.trim().slice(0,max) : '';
}
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      let database = 'not_configured';
      if (process.env.DATABASE_URL) {
        try { const pool = await dbPool(); await pool.query('SELECT 1'); database = 'connected'; }
        catch { database = 'unavailable'; }
      }
      return send(res, database === 'unavailable' ? 503 : 200, {
        ok: database !== 'unavailable',
        service:'Plumbline Keel',
        version:'0.3.0',
        mode:'advisory_platform',
        database,
        integrations:'customer-configured; no external registries connected'
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/products') {
      return send(res,200,{products,notice:'Stage labels describe current product maturity; no external financial data sources are connected by default.'});
    }
    if (req.method === 'GET' && url.pathname === '/api/demo') {
      const payload = demoPayload();
      return send(res,200,{synthetic:true,result:evaluateAction(payload)});
    }
    if (req.method === 'POST' && url.pathname === '/api/evaluate') {
      const payload = await readBody(req);
      return send(res,200,{synthetic:payload.synthetic === true,result:evaluateAction(payload)});
    }
    if (req.method === 'POST' && url.pathname === '/api/leads') {
      const payload = await readBody(req);
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
      if (!['partnership','integration','pilot','general'].includes(lead.type)) return send(res,400,{error:'invalid_lead_type'});
      if (!lead.name || !lead.organization || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || !lead.consent) {
        return send(res,400,{error:'validation_failed',message:'Name, organization, valid email and consent are required.'});
      }
      const pool = await dbPool();
      if (!pool) return send(res,503,{error:'persistence_unavailable',message:'Lead capture is not configured. Please contact the team through the published business channel.'});
      await pool.query(
        'INSERT INTO keel_leads (id,lead_type,name,organization,email,role,region,interest,message,consent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [lead.id,lead.type,lead.name,lead.organization,lead.email,lead.role,lead.region,lead.interest,lead.message,lead.consent]
      );
      return send(res,201,{ok:true,leadId:lead.id,message:'Your request has been recorded. The team can now review it.'});
    }
    if (req.method === 'GET' && ['/', '/index.html'].includes(url.pathname)) {
      return send(res,200,fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),'text/html; charset=utf-8');
    }
    return send(res,404,{error:'not_found'});
  } catch (error) {
    const status = error.status || (error.message && /required|must be|invalid|exceeds/.test(error.message) ? 400 : 500);
    return send(res,status,{error:status === 500 ? 'internal_error' : 'invalid_request',message:status === 500 ? 'The request could not be completed.' : error.message});
  }
});
if (require.main === module) server.listen(PORT,HOST,() => console.log('Plumbline Keel listening on ' + HOST + ':' + PORT));
module.exports = { server, demoPayload, products };
