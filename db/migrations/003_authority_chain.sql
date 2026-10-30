-- Keel Authority Chain: append-only, tenant-specific event sequence
ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS tenant_sequence BIGINT;
ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS previous_event_fingerprint CHAR(64);
ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS actor_key_id TEXT;
ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS actor_role TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS keel_assurance_events_tenant_sequence_uq ON keel_assurance_events(tenant_id,tenant_sequence) WHERE tenant_id IS NOT NULL;
CREATE OR REPLACE FUNCTION keel_reject_assurance_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Keel Authority Chain events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS keel_assurance_events_immutable ON keel_assurance_events;
CREATE TRIGGER keel_assurance_events_immutable BEFORE UPDATE OR DELETE ON keel_assurance_events
FOR EACH ROW EXECUTE FUNCTION keel_reject_assurance_event_mutation();
