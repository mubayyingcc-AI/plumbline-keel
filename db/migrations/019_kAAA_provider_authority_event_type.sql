-- Extend the immutable ledger event vocabulary for KAAA provider authority proofs.
ALTER TABLE public.keel_ledger_events DROP CONSTRAINT IF EXISTS keel_ledger_events_event_type_check;
ALTER TABLE public.keel_ledger_events ADD CONSTRAINT keel_ledger_events_event_type_check CHECK(event_type IN (
 'ACCOUNT_CREATED','JOURNAL_POSTED','RESERVATION_CREATED',
 'RESERVATION_RELEASED','RESERVATION_CONSUMED','PROJECTION_REBUILT',
 'AUTHORITY_ACTION_PROVEN'
));
