'use strict';

const FINAL_STATUSES = new Set(['settled','paid','completed']);
const EVENT_STATUSES = new Set(['settled','paid','completed','pending','failed','reversed']);

function fail(code) { throw new Error(code); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(field + '_required');
  return value.trim();
}
function minorUnits(value, field) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) fail(field + '_must_be_integer_minor_units');
  const n = BigInt(value);
  if (n <= 0n) fail(field + '_must_be_positive');
  return n;
}
function timestamp(value, field) {
  const n = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(n)) fail(field + '_must_be_iso_timestamp');
  return n;
}
function normalizeExpected(value) {
  if (!object(value)) fail('expected_transfer_required');
  const transfer = {
    transferId: required(value.transferId,'transferId'),
    providerId: required(value.providerId,'providerId'),
    eventType: required(value.eventType,'eventType'),
    currency: required(value.currency,'currency').toUpperCase(),
    amountMinor: minorUnits(value.amountMinor,'amountMinor').toString(),
    dueBy: required(value.dueBy,'dueBy')
  };
  if (!/^[A-Z]{3}$/.test(transfer.currency)) fail('currency_must_be_iso_4217_code');
  timestamp(transfer.dueBy,'dueBy');
  return transfer;
}
function normalizeEvent(value) {
  if (!object(value)) fail('provider_event_required');
  const event = {
    eventId: required(value.eventId,'eventId'),
    idempotencyKey: required(value.idempotencyKey,'idempotencyKey'),
    transferId: required(value.transferId,'transferId'),
    providerId: required(value.providerId,'providerId'),
    eventType: required(value.eventType,'eventType'),
    currency: required(value.currency,'currency').toUpperCase(),
    amountMinor: minorUnits(value.amountMinor,'amountMinor').toString(),
    status: required(value.status,'status').toLowerCase(),
    occurredAt: required(value.occurredAt,'occurredAt')
  };
  if (!/^[A-Z]{3}$/.test(event.currency)) fail('currency_must_be_iso_4217_code');
  if (!EVENT_STATUSES.has(event.status)) fail('provider_event_status_invalid');
  timestamp(event.occurredAt,'occurredAt');
  return event;
}

function reconcile({ expectedTransfers, providerEvents, now = new Date().toISOString() }) {
  if (!Array.isArray(expectedTransfers) || !Array.isArray(providerEvents)) fail('expected_transfers_and_provider_events_required');
  const nowMs = timestamp(now,'now');
  const expected = expectedTransfers.map(normalizeExpected);
  const events = providerEvents.map(normalizeEvent);
  const expectedIds = new Set();
  for (const item of expected) {
    if (expectedIds.has(item.transferId)) fail('duplicate_expected_transfer_id');
    expectedIds.add(item.transferId);
  }

  const eventIdCounts = new Map(), idempotencyCounts = new Map();
  for (const event of events) {
    eventIdCounts.set(event.eventId,(eventIdCounts.get(event.eventId)||0)+1);
    idempotencyCounts.set(event.idempotencyKey,(idempotencyCounts.get(event.idempotencyKey)||0)+1);
  }
  const consumed = new Set(), results = [];
  for (const item of expected) {
    const matches = events.map((event,index)=>({event,index})).filter(x=>x.event.transferId===item.transferId && x.event.eventType===item.eventType);
    if (!matches.length) {
      results.push({transferId:item.transferId,status:'UNMATCHED',reasons:['PROVIDER_EVENT_MISSING']});
      continue;
    }
    const reasons = [];
    if (matches.length > 1) reasons.push('MULTIPLE_PROVIDER_EVENTS_FOR_EXPECTED_TRANSFER');
    matches.forEach(match=>consumed.add(match.index));
    const chosen = matches[0];
    const event = chosen.event;
    if (eventIdCounts.get(event.eventId)>1) reasons.push('DUPLICATE_PROVIDER_EVENT_ID');
    if (idempotencyCounts.get(event.idempotencyKey)>1) reasons.push('DUPLICATE_IDEMPOTENCY_KEY');
    if (event.providerId!==item.providerId) reasons.push('PROVIDER_MISMATCH');
    if (event.currency!==item.currency) reasons.push('CURRENCY_MISMATCH');
    const occurredAt = Date.parse(event.occurredAt);
    if (occurredAt>nowMs) reasons.push('FUTURE_PROVIDER_EVENT');
    if (occurredAt>timestamp(item.dueBy,'dueBy')) reasons.push('LATE_PROVIDER_EVENT');
    const actual = BigInt(event.amountMinor), expectedAmount = BigInt(item.amountMinor);
    if (event.status==='failed' || event.status==='reversed') reasons.push('PROVIDER_EVENT_NOT_SETTLED');
    if (actual>expectedAmount) reasons.push('AMOUNT_OVERSTATEMENT');
    if (reasons.length) {
      results.push({transferId:item.transferId,status:'EXCEPTION',eventId:event.eventId,reasons});
      continue;
    }
    if (actual<expectedAmount) {
      results.push({transferId:item.transferId,status:'PARTIAL',eventId:event.eventId,expectedMinor:item.amountMinor,observedMinor:event.amountMinor,reasons:['PARTIAL_SETTLEMENT_NOT_FINAL']});
      continue;
    }
    if (!FINAL_STATUSES.has(event.status)) {
      results.push({transferId:item.transferId,status:'PENDING',eventId:event.eventId,reasons:['PROVIDER_STATUS_NOT_FINAL']});
      continue;
    }
    results.push({transferId:item.transferId,status:'MATCHED',eventId:event.eventId,amountMinor:event.amountMinor,currency:event.currency,reasons:[]});
  }

  events.forEach((event,index)=>{
    if (!consumed.has(index)) {
      const target=expected.find(item=>item.transferId===event.transferId);
      results.push({transferId:event.transferId,status:'EXCEPTION',eventId:event.eventId,reasons:[target?'UNEXPECTED_PROVIDER_EVENT_TYPE':'UNEXPECTED_PROVIDER_EVENT']});
    }
  });

  const summary = {
    expected:expected.length,
    matched:results.filter(x=>x.status==='MATCHED').length,
    partial:results.filter(x=>x.status==='PARTIAL').length,
    pending:results.filter(x=>x.status==='PENDING').length,
    unmatched:results.filter(x=>x.status==='UNMATCHED').length,
    exceptions:results.filter(x=>x.status==='EXCEPTION').length
  };
  const status = summary.exceptions ? 'EXCEPTIONS' :
    (summary.partial || summary.pending || summary.unmatched) ? 'INCOMPLETE' : 'MATCHED';
  return {
    status,
    summary,
    results,
    reconciledAt:new Date(nowMs).toISOString(),
    execution:'DISABLED',
    boundary:'Declared synthetic records were compared only. This is not confirmation of bank settlement, funds availability, legal discharge or provider truth.'
  };
}

module.exports = { reconcile, normalizeExpected, normalizeEvent };
