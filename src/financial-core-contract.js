'use strict';

// Authoritative, versioned database-object inventory. Update only alongside reviewed
// migrations and acceptance tests. Relations/functions below are extracted from
// migrations 001-023; tenant RLS is checked independently for every discovered
// public relation carrying tenant_id.
const FINANCIAL_CORE_CONTRACT_VERSION = '1.2.0';

const REQUIRED_MIGRATIONS = Object.freeze([
  '001_assurance_fabric.sql','002_tenant_isolation.sql','003_authority_chain.sql',
  '004_regulatory_assurance.sql','005_payment_authority.sql','006_card_remittance_foundation.sql',
  '007_human_card_device_registry.sql','008_human_card_pairing_challenges.sql',
  '009_human_card_recovery.sql','010_consumer_identity_card_provisioning.sql',
  '011_consumer_card_security.sql','012_double_entry_ledger.sql',
  '013_ledger_posting_and_reservations.sql','014_accounting_books_and_periods.sql',
  '015_period_close_dual_control.sql','016_global_tenant_rls_and_auth.sql',
  '017_provider_outbox_inbox_reconciliation.sql','018_keel_authority_action_assurance.sql',
  '019_kAAA_provider_authority_event_type.sql','020_rls_aware_backup_identity.sql',
  '021_ai_release_assessments.sql','022_direct_tenant_fk_coverage.sql',
  '023_backup_role_connection_capacity.sql'
]);

// Every CREATE TABLE relation found in migrations 001-023 (deduplicated).
const REQUIRED_TABLES = Object.freeze([
  'keel_model_census','keel_proof_dockets','keel_assurance_events',
  'keel_tenants','keel_tenant_keys',
  'keel_regulatory_sources','keel_regulatory_obligations','keel_regulatory_controls',
  'keel_regulatory_mappings','keel_regulatory_evidence','keel_regulatory_findings',
  'keel_regulatory_actions','keel_conformity_dockets','keel_regulatory_assessments',
  'keel_regulatory_applicability_decisions',
  'keel_payment_mandates','keel_payment_intents','keel_payment_reservations',
  'keel_payment_approvals','keel_payment_provider_events','keel_payment_ledger_entries',
  'keel_payment_outbox','keel_payment_evidence','keel_payment_revocations',
  'keel_payment_funding_positions','keel_payment_card_programmes','keel_payment_card_profiles',
  'keel_payment_ledger_accounts','keel_payment_ledger_transactions','keel_payment_ledger_postings',
  'keel_remittance_transfers','keel_remittance_events',
  'keel_human_card_devices','keel_human_card_activation_events',
  'keel_human_card_pairing_challenges','keel_human_card_recovery_groups',
  'keel_human_card_recovery_trustees','keel_human_card_recovery_requests',
  'keel_human_card_recovery_approvals',
  'keel_consumer_accounts','keel_consumer_external_identities','keel_consumer_identity_events',
  'keel_human_card_orders','keel_consumer_provisioning_events','keel_consumer_event_chain',
  'keel_consumer_cards','keel_consumer_card_partner_events',
  'keel_consumer_card_verification_events','keel_consumer_card_pairing_challenges',
  'keel_consumer_recovery_groups','keel_consumer_recovery_trustees',
  'keel_consumer_recovery_requests','keel_consumer_recovery_approvals',
  'keel_consumer_card_security_outbox','keel_consumer_card_security_events',
  'keel_ledger_accounts','keel_ledger_journals','keel_ledger_lines',
  'keel_ledger_account_balances','keel_ledger_reservations','keel_ledger_event_heads',
  'keel_ledger_events','keel_accounting_books','keel_accounting_book_accounts',
  'keel_accounting_periods','keel_accounting_period_close_requests',
  'keel_accounting_period_closures','keel_provider_outbox','keel_provider_inbox',
  'keel_provider_reconciliation_cases','keel_authority_envelopes',
  'keel_action_proof_objects','keel_authority_action_approvals',
  'keel_ai_release_assessments'
]);

// Every CREATE FUNCTION name found in migrations 003-021 (deduplicated).
const REQUIRED_FUNCTIONS = Object.freeze([
  'keel_reject_assurance_event_mutation',
  'keel_reserve_payment_capacity','keel_assert_posted_ledger_balanced',
  'keel_reject_posted_ledger_mutation','keel_reject_posted_transaction_mutation',
  'keel_reject_consumer_event_mutation','keel_reject_consumer_card_event_mutation',
  'keel_ledger_reject_posted_mutation','keel_ledger_reject_posted_header_mutation',
  'keel_ledger_assert_balanced','keel_ledger_account_currency_guard',
  'keel_ledger_account_metadata_guard','keel_ledger_balance_currency_guard',
  'keel_ledger_reservation_guard','keel_ledger_events_immutable',
  'keel_accounting_period_transition_guard','keel_ledger_journal_period_guard',
  'keel_accounting_period_close_request_guard',
  'keel_accounting_period_close_request_no_delete',
  'keel_accounting_period_closure_immutable',
  'keel_authenticate_tenant_key','keel_touch_tenant_key',
  'keel_reject_kAAA_evidence_mutation','keel_backup_tenant_ids',
  'keel_reject_ai_release_assessment_mutation'
]);

module.exports = {
  FINANCIAL_CORE_CONTRACT_VERSION,
  REQUIRED_MIGRATIONS,
  REQUIRED_TABLES,
  REQUIRED_FUNCTIONS
};
