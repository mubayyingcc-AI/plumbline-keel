'use strict';

const { validateJournal } = require('./ledger-engine');

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
async function lockAccount(client, tenantId, accountId) {
  const result = await client.query(
    'SELECT tenant_id,account_id,account_code,account_name,account_class,currency,normal_side,status,allow_negative_balance,is_reservable FROM keel_ledger_accounts WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE',
    [tenantId, accountId]
  );
  if (!result.rowCount) fail('ledger_account_not_found', 404);
  if (result.rows[0].status !== 'active') fail('ledger_account_not_active', 409);
  return result.rows[0];
}
async function refreshProjection(client, tenantId, account) {
  const result = await client.query(
    `SELECT
       COALESCE(SUM(l.amount_minor) FILTER (WHERE l.side='debit'),0)::text AS debit_total,
       COALESCE(SUM(l.amount_minor) FILTER (WHERE l.side='credit'),0)::text AS credit_total
     FROM keel_ledger_lines l
     JOIN keel_ledger_journals j ON j.tenant_id=l.tenant_id AND j.journal_id=l.journal_id
     WHERE l.tenant_id=$1 AND l.account_id=$2 AND j.status='posted'`,
    [tenantId, account.account_id]
  );
  const debit = BigInt(result.rows[0].debit_total);
  const credit = BigInt(result.rows[0].credit_total);
  const balance = normalBalance(account, debit, credit);
  if (balance < 0n && !account.allow_negative_balance) fail('ledger_account_insufficient_funds', 409);
  await client.query(
    `INSERT INTO keel_ledger_account_balances(tenant_id,account_id,currency,debit_total,credit_total,normal_balance_minor,version,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,1,NOW())
     ON CONFLICT(tenant_id,account_id) DO UPDATE SET
       debit_total=EXCLUDED.debit_total,credit_total=EXCLUDED.credit_total,
       normal_balance_minor=EXCLUDED.normal_balance_minor,
       version=keel_ledger_account_balances.version+1,updated_at=NOW()`,
    [tenantId, account.account_id, account.currency, debit.toString(), credit.toString(), balance.toString()]
  );
  return balance;
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
       (tenant_id,journal_id,idempotency_key,description,source_ref,effective_at,status,fingerprint)
     VALUES($1,$2,$3,$4,$5,$6,'draft',$7)
     ON CONFLICT(tenant_id,idempotency_key) DO NOTHING
     RETURNING journal_id`,
    [tenantId,journal.journalId,journal.idempotencyKey,journal.description,journal.sourceRef,journal.effectiveAt,journal.fingerprint]
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
    const balance = await refreshProjection(client, tenantId, account);
    const reserved = await activeReservations(client, tenantId, id);
    if (!account.allow_negative_balance && balance < reserved) fail('ledger_posting_would_breach_active_reservations', 409);
  }
  return { journalId: journal.journalId, fingerprint: journal.fingerprint, status: 'posted', replay: false };
}
async function withTransaction(pool, work, tenantId) {
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
    throw error;
  } finally { client.release(); }
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
    return { accountId, currency, accountClass, normalSide, status: 'active' };
  }, tenantId);
}
async function postJournal(pool, tenantIdInput, journal) {
  requirePool(pool);
  const tenantId = actorTenant(tenantIdInput);
  return withTransaction(pool, client => postJournalWithClient(client, tenantId, journal), tenantId);
}
async function getAccountBalance(pool, tenantIdInput, accountId) {
  requirePool(pool);
  const tenantId = actorTenant(tenantIdInput);
  if (typeof accountId !== 'string' || !accountId.trim()) fail('ledger_account_id_required');
  const client = await pool.connect();
  try {
    const account = await lockAccount(client, tenantId, accountId.trim());
    const balance = await refreshProjection(client, tenantId, account);
    const reserved = await activeReservations(client, tenantId, accountId.trim());
    return {
      accountId: account.account_id, currency: account.currency, normalSide: account.normal_side,
      debitTotalMinor: (await client.query('SELECT debit_total::text FROM keel_ledger_account_balances WHERE tenant_id=$1 AND account_id=$2',[tenantId,accountId.trim()])).rows[0].debit_total,
      creditTotalMinor: (await client.query('SELECT credit_total::text FROM keel_ledger_account_balances WHERE tenant_id=$1 AND account_id=$2',[tenantId,accountId.trim()])).rows[0].credit_total,
      ledgerBalanceMinor: balance.toString(), reservedMinor: reserved.toString(),
      availableMinor: (balance-reserved).toString()
    };
  } finally { client.release(); }
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
  if (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt))) fail('reservation_expiry_invalid');
  return withTransaction(pool, async client => {
    const account = await lockAccount(client, tenantId, accountId);
    if (!account.is_reservable) fail('ledger_account_not_reservable', 409);
    const balance = await refreshProjection(client, tenantId, account);
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
    await client.query("UPDATE keel_ledger_reservations SET status='released',closed_at=NOW(),close_reason=$3 WHERE tenant_id=$1 AND reservation_id=$2",[tenantId,reservationId.trim(),reason.trim()]);
    return {reservationId,status:'released',replay:false};
  }, tenantId);
}
async function consumeReservation(pool, tenantIdInput, reservationId, journal) {
  requirePool(pool);
  const tenantId=actorTenant(tenantIdInput);
  if(typeof reservationId!=='string'||!reservationId.trim())fail('reservation_id_required');
  return withTransaction(pool,async client=>{
    const r=await client.query('SELECT * FROM keel_ledger_reservations WHERE tenant_id=$1 AND reservation_id=$2 FOR UPDATE',[tenantId,reservationId.trim()]);
    if(!r.rowCount)fail('reservation_not_found',404);
    const reservation=r.rows[0];
    if(reservation.status==='consumed') {
      const existing=await client.query('SELECT journal_id,fingerprint FROM keel_ledger_journals WHERE tenant_id=$1 AND idempotency_key=$2',[tenantId,journal.idempotencyKey]);
      if(existing.rowCount&&existing.rows[0].journal_id===journal.journalId)return {reservationId,status:'consumed',journalId:journal.journalId,replay:true};
      fail('reservation_already_consumed',409);
    }
    if(reservation.status!=='active'||(reservation.expires_at&&new Date(reservation.expires_at).getTime()<=Date.now()))fail('reservation_not_active',409);
    const checked=validateJournal({...journal,tenantId});
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
    return {reservationId,status:'consumed',journalId:posted.journalId,replay:posted.replay};
  }, tenantId);
}
module.exports={createAccount,postJournal,getAccountBalance,createReservation,releaseReservation,consumeReservation};
