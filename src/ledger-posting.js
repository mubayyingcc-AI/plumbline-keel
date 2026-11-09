'use strict';

const crypto = require('node:crypto');
const { validateJournal } = require('./ledger-engine');
const { canonical } = require('./authority-chain');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const MAX_AMOUNT = 10n ** 78n - 1n;

function fail(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  throw error;
}
function amount(value, field = 'amountMinor') {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value)) fail(field + '_invalid');
  const n = BigInt(value);
  if (n <= 0n || n > MAX_AMOUNT) fail(field + '_out_of_range');
  return n;
}
function actorTenant(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('tenant_id_invalid');
  return value;
}
function key(value) {
  if (typeof value !== 'string' || !KEY.test(value)) fail('idempotency_key_invalid');
  return value;
}
function normalBalance(account, debit, credit) {
  return account.normal_side === 'debit' ? debit - credit : credit - debit;
}
async function lockAccount(client, tenantId, accountId, includeSuspended = false) {
  const result = await client.query(
    'SELECT tenant_id,account_id,account_code,account_name,account_class,currency,normal_side,status,allow_negative_balance,is_reservable FROM keel_ledger_accounts WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE',
    [tenantId, accountId]
  );
  if (!result.rowCount) fail('ledger_account_not_found', 404);
  if (!includeSuspended && result.rows[0].status !== 'active') fail('ledger_account_not_active', 409);
  return result.rows[0];
}
async function readProjection(client, tenantId, account) {
  const result=await client.query(
    'SELECT debit_total::text,credit_total::text,normal_balance_minor::text,version FROM keel_ledger_account_balances WHERE tenant_id=$1 AND account_id=$2',
    [tenantId,account.account_id]
  );
  if(!result.rowCount)fail('ledger_balance_projection_missing',503);
  const row=result.rows[0];
  return {debit:BigInt(row.debit_total),credit:BigInt(row.credit_total),balance:BigInt(row.normal_balance_minor),version:Number(row.version)};
}
async function applyJournalProjection(client, tenantId, account, lines) {
  let debit=0n,credit=0n;
  for(const line of lines){
    if(line.accountId!==account.account_id)continue;
    if(line.side==='debit')debit+=BigInt(line.amountMinor);else credit+=BigInt(line.amountMinor);
  }
  const delta=account.normal_side==='debit'?debit-credit:credit-debit;
  const result=await client.query(
    `UPDATE keel_ledger_account_balances SET
       debit_total=debit_total+$3,credit_total=credit_total+$4,
       normal_balance_minor=normal_balance_minor+$5,version=version+1,updated_at=NOW()
     WHERE tenant_id=$1 AND account_id=$2
     RETURNING normal_balance_minor::text`,
    [tenantId,account.account_id,debit.toString(),credit.toString(),delta.toString()]
  );
  if(!result.rowCount)fail('ledger_balance_projection_missing',503);
  const balance=BigInt(result.rows[0].normal_balance_minor);
  if(balance<0n&&!account.allow_negative_balance)fail('ledger_account_insufficient_funds',409);
  return balance;
}
async function verifyAccountProjectionWithClient(client,tenantId,account) {
  const projection=await readProjection(client,tenantId,account);
  const totals=await client.query(
    `SELECT COALESCE(SUM(l.amount_minor) FILTER(WHERE l.side='debit'),0)::text AS debit_total,
            COALESCE(SUM(l.amount_minor) FILTER(WHERE l.side='credit'),0)::text AS credit_total
       FROM keel_ledger_lines l JOIN keel_ledger_journals j
         ON j.tenant_id=l.tenant_id AND j.journal_id=l.journal_id
      WHERE l.tenant_id=$1 AND l.account_id=$2 AND j.status='posted'`,
    [tenantId,account.account_id]
  );
  const debit=BigInt(totals.rows[0].debit_total),credit=BigInt(totals.rows[0].credit_total);
  const computed=normalBalance(account,debit,credit);
  return {matches:projection.debit===debit&&projection.credit===credit&&projection.balance===computed,
    projection:{debitTotalMinor:projection.debit.toString(),creditTotalMinor:projection.credit.toString(),balanceMinor:projection.balance.toString(),version:projection.version},
    computed:{debitTotalMinor:debit.toString(),creditTotalMinor:credit.toString(),balanceMinor:computed.toString()}};
}
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
async function verifyLedgerEventChain(pool,tenantIdInput) {
  requirePool(pool);
  const tenantId=actorTenant(tenantIdInput);
  return withTransaction(pool,async client=>{
    const rows=await client.query(
      'SELECT event_id,event_type,subject_id,tenant_sequence::text,previous_event_fingerprint,event_fingerprint,payload FROM keel_ledger_events WHERE tenant_id=$1 ORDER BY tenant_sequence',
      [tenantId]
    );
    let previous=null,expected=1n;
    for(const row of rows.rows){
      const sequence=BigInt(row.tenant_sequence);
      if(sequence!==expected||row.previous_event_fingerprint!==previous){
        return {valid:false,verifiedEvents:(expected-1n).toString(),failure:'sequence_or_link_mismatch',eventId:row.event_id};
      }
      const body={tenantId,eventId:row.event_id,eventType:row.event_type,subjectId:row.subject_id,payload:row.payload,sequence:sequence.toString(),previousFingerprint:row.previous_event_fingerprint};
      const computed=crypto.createHash('sha256').update(canonical(body)).digest('hex');
      if(computed!==row.event_fingerprint)return {valid:false,verifiedEvents:Number(expected-1n),failure:'fingerprint_mismatch',eventId:row.event_id};
      previous=row.event_fingerprint;expected++;
    }
    const head=await client.query('SELECT last_sequence::text,last_fingerprint FROM keel_ledger_event_heads WHERE tenant_id=$1',[tenantId]);
    const last=expected-1n;
    const headMatches=last===0n?!head.rowCount||(head.rows[0].last_sequence==='0'&&head.rows[0].last_fingerprint===null):
      head.rowCount&&BigInt(head.rows[0].last_sequence)===last&&head.rows[0].last_fingerprint===previous;
    return {valid:Boolean(headMatches),verifiedEvents:last.toString(),headFingerprint:previous,failure:headMatches?null:'event_head_mismatch'};
  },tenantId);
}
async function verifyAccountProjection(pool,tenantIdInput,accountId) {
  requirePool(pool);
  const tenantId=actorTenant(tenantIdInput);
  if(typeof accountId!=='string'||!accountId.trim())fail('ledger_account_id_required');
  return withTransaction(pool,async client=>{
    const account=await lockAccount(client,tenantId,accountId.trim(),true);
    return verifyAccountProjectionWithClient(client,tenantId,account);
  },tenantId);
}
async function activeReservations(client, tenantId, accountId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(amount_minor),0)::text AS reserved
     FROM keel_ledger_reservations
     WHERE tenant_id=$1 AND account_id=$2 AND status='active' AND (expires_at IS NULL OR expires_at>NOW())`,
    [tenantId, accountId]
  );
  return BigInt(r.rows[0].reserved);
}
async function postJournalWithClient(client, tenantId, input) {
  const journal = validateJournal({ ...input, tenantId });
  if (journal.reversalOfJournalId) {
    const original=await client.query(
      "SELECT journal_id,status FROM keel_ledger_journals WHERE tenant_id=$1 AND journal_id=$2 FOR UPDATE",
      [tenantId,journal.reversalOfJournalId]
    );
    if(!original.rowCount||original.rows[0].status!=='posted')fail('ledger_reversal_original_not_posted',409);
    const originalLines=await client.query(
      'SELECT account_id,side,currency,amount_minor::text FROM keel_ledger_lines WHERE tenant_id=$1 AND journal_id=$2 ORDER BY line_number',
      [tenantId,journal.reversalOfJournalId]
    );
    const expected=originalLines.rows.map(line=>({accountId:line.account_id,side:line.side==='debit'?'credit':'debit',currency:line.currency,amountMinor:line.amount_minor}));
    if(JSON.stringify(expected)!==JSON.stringify(journal.lines))fail('ledger_reversal_must_exactly_reverse_original',409);
  }
  const existing = await client.query('SELECT journal_id,fingerprint,status FROM keel_ledger_journals WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE',[tenantId,journal.idempotencyKey]);
  if (existing.rowCount) { const prior=existing.rows[0]; if(prior.fingerprint!==journal.fingerprint||prior.journal_id!==journal.journalId)fail('ledger_idempotency_conflict',409); if(prior.status!=='posted')fail('ledger_idempotency_incomplete',409); return {journalId:prior.journal_id,fingerprint:journal.fingerprint,status:'posted',replay:true}; }
  // Lock accounts in stable lexical order to reduce deadlock risk.
  const ids = [...new Set(journal.lines.map(line => line.accountId))].sort();
  const accounts = new Map();
  for (const id of ids) accounts.set(id, await lockAccount(client, tenantId, id));
  for (const line of journal.lines) {
    const account = accounts.get(line.accountId);
    if (account.currency !== line.currency) fail('ledger_line_account_currency_mismatch');
  }

  const inserted = await client.query(
    `INSERT INTO keel_ledger_journals
       (tenant_id,journal_id,idempotency_key,description,source_ref,effective_at,status,fingerprint,reversal_of_journal_id)
     VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8)
     ON CONFLICT(tenant_id,idempotency_key) DO NOTHING
     RETURNING journal_id`,
    [tenantId,journal.journalId,journal.idempotencyKey,journal.description,journal.sourceRef,journal.effectiveAt,journal.fingerprint,journal.reversalOfJournalId]
  );
  if (!inserted.rowCount) {
    const prior = await client.query(
      'SELECT journal_id,fingerprint,status FROM keel_ledger_journals WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE',
      [tenantId,journal.idempotencyKey]
    );
    if (!prior.rowCount) fail('ledger_idempotency_race_retry', 409);
    if (prior.rows[0].fingerprint !== journal.fingerprint || prior.rows[0].journal_id !== journal.journalId) {
      fail('ledger_idempotency_conflict', 409);
    }
    if (prior.rows[0].status !== 'posted') fail('ledger_idempotency_incomplete', 409);
    return { journalId: prior.rows[0].journal_id, fingerprint: journal.fingerprint, status: 'posted', replay: true };
  }

  for (let i = 0; i < journal.lines.length; i++) {
    const line = journal.lines[i];
    await client.query(
      'INSERT INTO keel_ledger_lines(tenant_id,journal_id,line_number,account_id,side,currency,amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [tenantId,journal.journalId,i+1,line.accountId,line.side,line.currency,line.amountMinor]
    );
  }

  // Post inside this transaction before refreshing projections; deferred SQL constraints independently verify balance at COMMIT.
  await client.query("UPDATE keel_ledger_journals SET status='posted',posted_at=NOW() WHERE tenant_id=$1 AND journal_id=$2 AND status='draft'",[tenantId,journal.journalId]);
  // Refresh each account projection under the account row lock and protect active reservations.
  for (const id of ids) {
    const account = accounts.get(id);
    const balance = await applyJournalProjection(client, tenantId, account, journal.lines);
    const reserved = await activeReservations(client, tenantId, id);
    if (!account.allow_negative_balance && balance < reserved) fail('ledger_posting_would_breach_active_reservations', 409);
  }
  await appendLedgerEvent(client,tenantId,'JOURNAL_POSTED',journal.journalId,{fingerprint:journal.fingerprint,sourceRef:journal.sourceRef,effectiveAt:journal.effectiveAt,lineCount:journal.lineCount,totalsByCurrency:journal.totalsByCurrency});
  return { journalId: journal.journalId, fingerprint: journal.fingerprint, status: 'posted', replay: false };
}
async function withTransaction(pool, work, tenantId) {
  // PostgreSQL SERIALIZABLE transactions can legitimately abort under contention.
  // Retry only known transient transaction failures; never retry business rejections.
  for (let attempt=1; attempt<=3; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      if (tenantId) await client.query("SELECT set_config('keel.tenant_id',$1,true)",[tenantId]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      const code=error && error.code;
      if ((code==='40001'||code==='40P01') && attempt<3) continue;
      throw error;
    } finally { client.release(); }
  }
  fail('ledger_transaction_retry_exhausted',409);
}
function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') fail('ledger_storage_unavailable', 503);
}
async function createAccount(pool, tenantIdInput, account) {
  requirePool(pool);
  const tenantId = actorTenant(tenantIdInput);
  if (!account || typeof account !== 'object') fail('ledger_account_required');
  const accountId = typeof account.accountId === 'string' ? account.accountId.trim() : '';
  const code = typeof account.accountCode === 'string' ? account.accountCode.trim() : '';
  const name = typeof account.accountName === 'string' ? account.accountName.trim() : '';
  const currency = account.currency;
  const accountClass = account.accountClass;
  const normalSide = account.normalSide;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(accountId)) fail('ledger_account_id_invalid');
  if (!code || code.length > 64 || !name || name.length > 180) fail('ledger_account_metadata_invalid');
  if (!/^[A-Z]{3}$/.test(currency || '')) fail('ledger_account_currency_invalid');
  if (!['asset','liability','equity','income','expense','memorandum'].includes(accountClass)) fail('ledger_account_class_invalid');
  if (!['debit','credit'].includes(normalSide)) fail('ledger_account_normal_side_invalid');
  if (accountClass !== 'memorandum') {
    const expected = ['asset','expense'].includes(accountClass) ? 'debit' : 'credit';
    if (normalSide !== expected) fail('ledger_account_normal_side_class_mismatch');
  }
  return withTransaction(pool, async client => {
    await client.query(
      `INSERT INTO keel_ledger_accounts
       (tenant_id,account_id,account_code,account_name,account_class,currency,normal_side,status,allow_negative_balance,is_reservable)
       VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)`,
      [tenantId,accountId,code,name,accountClass,currency,normalSide,account.allowNegativeBalance===true,account.isReservable===true]
    );
    await client.query('INSERT INTO keel_ledger_account_balances(tenant_id,account_id,currency) VALUES($1,$2,$3)',[tenantId,accountId,currency]);
    await appendLedgerEvent(client,tenantId,'ACCOUNT_CREATED',accountId,{currency,accountClass,normalSide,allowNegativeBalance:account.allowNegativeBalance===true,isReservable:account.isReservable===true});
    return { accountId, currency, accountClass, normalSide, status: 'active' };
  }, tenantId);
}
async function postJournal(pool, tenantIdInput, journal) {
  requirePool(pool);
  const tenantId = actorTenant(tenantIdInput);
  return withTransaction(pool, client => postJournalWithClient(client, tenantId, journal), tenantId);
}
async function listAccounts(pool,tenantIdInput) {
  requirePool(pool);
  const tenantId=actorTenant(tenantIdInput);
  return withTransaction(pool,async client=>{
    const result=await client.query(
      `SELECT a.account_id,a.account_code,a.account_name,a.account_class,a.currency,
              a.normal_side,a.status,a.allow_negative_balance,a.is_reservable,
              COALESCE(b.debit_total,0)::text AS debit_total_minor,
              COALESCE(b.credit_total,0)::text AS credit_total_minor,
              COALESCE(b.normal_balance_minor,0)::text AS ledger_balance_minor,
              COALESCE(r.reserved_minor,0)::text AS reserved_minor
         FROM keel_ledger_accounts a
         LEFT JOIN keel_ledger_account_balances b
           ON b.tenant_id=a.tenant_id AND b.account_id=a.account_id
         LEFT JOIN (
           SELECT tenant_id,account_id,SUM(amount_minor) AS reserved_minor
             FROM keel_ledger_reservations
            WHERE status='active' AND (expires_at IS NULL OR expires_at>NOW())
            GROUP BY tenant_id,account_id
         ) r ON r.tenant_id=a.tenant_id AND r.account_id=a.account_id
        WHERE a.tenant_id=$1 ORDER BY a.account_code,a.currency,a.account_id`,
      [tenantId]
    );
    return result.rows.map(row=>({
      accountId:row.account_id,accountCode:row.account_code,accountName:row.account_name,
      accountClass:row.account_class,currency:row.currency,normalSide:row.normal_side,
      status:row.status,allowNegativeBalance:row.allow_negative_balance,isReservable:row.is_reservable,
      debitTotalMinor:row.debit_total_minor,creditTotalMinor:row.credit_total_minor,
      ledgerBalanceMinor:row.ledger_balance_minor,reservedMinor:row.reserved_minor,
      availableMinor:(BigInt(row.ledger_balance_minor)-BigInt(row.reserved_minor)).toString()
    }));
  },tenantId);
}
async function getAccountBalance(pool, tenantIdInput, accountId) {
  requirePool(pool);
  const tenantId = actorTenant(tenantIdInput);
  if (typeof accountId !== 'string' || !accountId.trim()) fail('ledger_account_id_required');
  return withTransaction(pool, async client => {
    const account = await lockAccount(client, tenantId, accountId.trim(), true);
    const projection = await readProjection(client, tenantId, account);
    const balance = projection.balance;
    const reserved = await activeReservations(client, tenantId, accountId.trim());
    return {
      accountId: account.account_id, currency: account.currency, normalSide: account.normal_side,
      debitTotalMinor: projection.debit.toString(), creditTotalMinor: projection.credit.toString(),
      ledgerBalanceMinor: balance.toString(), reservedMinor: reserved.toString(),
      availableMinor: (balance-reserved).toString()
    };
  }, tenantId);
}
async function createReservation(pool, tenantIdInput, input) {
  requirePool(pool);
  const tenantId = actorTenant(tenantIdInput);
  if (!input || typeof input !== 'object') fail('reservation_required');
  const reservationId = typeof input.reservationId === 'string' ? input.reservationId.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(reservationId)) fail('reservation_id_invalid');
  const idem = key(input.idempotencyKey);
  const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
  if (!accountId) fail('reservation_account_required');
  const value = amount(input.amountMinor);
  const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
  if (!purpose || purpose.length > 300) fail('reservation_purpose_required');
  const expiresAt = input.expiresAt || null;
  if (expiresAt !== null && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now())) fail('reservation_expiry_invalid');
  return withTransaction(pool, async client => {
    const account = await lockAccount(client, tenantId, accountId);
    if (!account.is_reservable) fail('ledger_account_not_reservable', 409);
    const replay=await client.query(
      'SELECT reservation_id,account_id,currency,amount_minor::text,purpose,status,expires_at FROM keel_ledger_reservations WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE',
      [tenantId,idem]
    );
    if(replay.rowCount){
      const p=replay.rows[0];
      if(p.reservation_id!==reservationId||p.account_id!==accountId||p.currency!==account.currency||p.amount_minor!==value.toString()||p.purpose!==purpose)fail('reservation_idempotency_conflict',409);
      if(p.status==='active'&&p.expires_at&&new Date(p.expires_at).getTime()<=Date.now()){
        await client.query("UPDATE keel_ledger_reservations SET status='expired',closed_at=NOW(),close_reason='expired' WHERE tenant_id=$1 AND reservation_id=$2",[tenantId,p.reservation_id]);
        return {reservationId:p.reservation_id,status:'expired',replay:true};
      }
      return {reservationId:p.reservation_id,status:p.status,replay:true};
    }
    const projection = await readProjection(client, tenantId, account);
    const balance = projection.balance;
    const reserved = await activeReservations(client, tenantId, accountId);
    if (balance - reserved < value && !account.allow_negative_balance) fail('ledger_insufficient_available_balance', 409);
    const inserted = await client.query(
      `INSERT INTO keel_ledger_reservations
       (tenant_id,reservation_id,idempotency_key,account_id,currency,amount_minor,purpose,status,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8)
       ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING reservation_id`,
      [tenantId,reservationId,idem,accountId,account.currency,value.toString(),purpose,expiresAt]
    );
    if (!inserted.rowCount) {
      const prior = await client.query(
        'SELECT reservation_id,account_id,currency,amount_minor::text,purpose,status,expires_at FROM keel_ledger_reservations WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE',
        [tenantId,idem]
      );
      if (!prior.rowCount) fail('reservation_idempotency_race_retry',409);
      const p=prior.rows[0];
      if(p.reservation_id!==reservationId||p.account_id!==accountId||p.currency!==account.currency||p.amount_minor!==value.toString()||p.purpose!==purpose)fail('reservation_idempotency_conflict',409);
      return {reservationId:p.reservation_id,status:p.status,replay:true};
    }
    await appendLedgerEvent(client,tenantId,'RESERVATION_CREATED',reservationId,{accountId,currency:account.currency,amountMinor:value.toString(),purpose,expiresAt});
    return {reservationId,status:'active',replay:false};
  }, tenantId);
}
async function releaseReservation(pool, tenantIdInput, reservationId, reason) {
  requirePool(pool);
  const tenantId = actorTenant(tenantIdInput);
  if (typeof reservationId !== 'string' || !reservationId.trim()) fail('reservation_id_required');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) fail('reservation_release_reason_required');
  return withTransaction(pool, async client => {
    const row=await client.query('SELECT reservation_id,status FROM keel_ledger_reservations WHERE tenant_id=$1 AND reservation_id=$2 FOR UPDATE',[tenantId,reservationId.trim()]);
    if(!row.rowCount)fail('reservation_not_found',404);
    if(row.rows[0].status==='released')return {reservationId,status:'released',replay:true};
    if(row.rows[0].status!=='active')fail('reservation_not_active',409);
    const expiry=await client.query('SELECT expires_at IS NOT NULL AND expires_at<=NOW() AS expired FROM keel_ledger_reservations WHERE tenant_id=$1 AND reservation_id=$2',[tenantId,reservationId.trim()]);
    const next=expiry.rows[0].expired?'expired':'released';
    await client.query('UPDATE keel_ledger_reservations SET status=$3,closed_at=NOW(),close_reason=$4 WHERE tenant_id=$1 AND reservation_id=$2',[tenantId,reservationId.trim(),next,reason.trim()]);
    await appendLedgerEvent(client,tenantId,'RESERVATION_RELEASED',reservationId.trim(),{reason:reason.trim(),status:next});
    return {reservationId,status:next,replay:false};
  }, tenantId);
}
async function consumeReservation(pool, tenantIdInput, reservationId, journal) {
  requirePool(pool);
  const tenantId=actorTenant(tenantIdInput);
  const validatedJournal=validateJournal({...journal,tenantId});
  if(typeof reservationId!=='string'||!reservationId.trim())fail('reservation_id_required');
  return withTransaction(pool,async client=>{
    const r=await client.query('SELECT * FROM keel_ledger_reservations WHERE tenant_id=$1 AND reservation_id=$2 FOR UPDATE',[tenantId,reservationId.trim()]);
    if(!r.rowCount)fail('reservation_not_found',404);
    const reservation=r.rows[0];
    if(reservation.status==='consumed') {
      const existing=await client.query('SELECT journal_id,fingerprint FROM keel_ledger_journals WHERE tenant_id=$1 AND idempotency_key=$2',[tenantId,validatedJournal.idempotencyKey]);
      if(existing.rowCount&&existing.rows[0].journal_id===validatedJournal.journalId&&existing.rows[0].fingerprint===validatedJournal.fingerprint)return {reservationId,status:'consumed',journalId:validatedJournal.journalId,replay:true};
      fail('reservation_already_consumed',409);
    }
    if(reservation.status!=='active')fail('reservation_not_active',409);
    const live=await client.query('SELECT ($1::timestamptz IS NULL OR $1::timestamptz>NOW()) AS live',[reservation.expires_at]);
    if(!live.rows[0].live){
      await client.query("UPDATE keel_ledger_reservations SET status='expired',closed_at=NOW(),close_reason='expired_before_consumption' WHERE tenant_id=$1 AND reservation_id=$2",[tenantId,reservationId.trim()]);
      await appendLedgerEvent(client,tenantId,'RESERVATION_RELEASED',reservationId.trim(),{status:'expired',reason:'expired_before_consumption'});
      return {reservationId,status:'expired',replay:false};
    }
    const checked=validatedJournal;
    const account=await lockAccount(client,tenantId,reservation.account_id);
    let reduction=0n;
    for(const line of checked.lines){
      if(line.accountId!==reservation.account_id||line.currency!==reservation.currency)continue;
      const n=BigInt(line.amountMinor);
      reduction += line.side===account.normal_side ? -n : n;
    }
    if(reduction!==-BigInt(reservation.amount_minor))fail('reservation_journal_amount_mismatch',409);
    await client.query("UPDATE keel_ledger_reservations SET status='consumed',closed_at=NOW(),close_reason='consumed_by_journal:'||$3 WHERE tenant_id=$1 AND reservation_id=$2",[tenantId,reservationId.trim(),checked.journalId]);
    const posted=await postJournalWithClient(client,tenantId,journal);
    await appendLedgerEvent(client,tenantId,'RESERVATION_CONSUMED',reservationId.trim(),{journalId:posted.journalId});
    return {reservationId,status:'consumed',journalId:posted.journalId,replay:posted.replay};
  }, tenantId);
}
module.exports={createAccount,postJournal,getAccountBalance,listAccounts,createReservation,releaseReservation,consumeReservation,verifyAccountProjection,verifyLedgerEventChain,normalBalance,amount,withTransaction};
