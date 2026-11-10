'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');
async function appendLedgerEvent(client, tenantId, eventType, subjectId, payload) {
  await client.query(
    'INSERT INTO keel_ledger_event_heads(tenant_id,last_sequence,last_fingerprint) VALUES($1,0,NULL) ON CONFLICT(tenant_id) DO NOTHING',
    [tenantId]
  );
  const head=await client.query(
    'SELECT last_sequence,last_fingerprint FROM keel_ledger_event_heads WHERE tenant_id=$1 FOR UPDATE',
    [tenantId]
  );
  const sequence=BigInt(head.rows[0].last_sequence)+1n;
  const previousFingerprint=head.rows[0].last_fingerprint;
  const eventId=crypto.randomUUID();
  const body={tenantId,eventId,eventType,subjectId,payload,sequence:sequence.toString(),previousFingerprint};
  const fingerprint=crypto.createHash('sha256').update(canonical(body)).digest('hex');
  await client.query(
    'INSERT INTO keel_ledger_events(tenant_id,event_id,event_type,subject_id,tenant_sequence,previous_event_fingerprint,event_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [tenantId,eventId,eventType,subjectId,sequence.toString(),previousFingerprint,fingerprint,JSON.stringify(payload)]
  );
  await client.query(
    'UPDATE keel_ledger_event_heads SET last_sequence=$2,last_fingerprint=$3,updated_at=NOW() WHERE tenant_id=$1',
    [tenantId,sequence.toString(),fingerprint]
  );
}
module.exports={appendLedgerEvent};
