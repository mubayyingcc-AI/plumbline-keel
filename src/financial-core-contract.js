'use strict';

// Single versioned contract shared by migration application and readiness inspection.
// Keep object inventories aligned with reviewed migrations and their acceptance tests.
const FINANCIAL_CORE_CONTRACT_VERSION = '1.1.0';

const REQUIRED_MIGRATIONS = Object.freeze([
  '012_double_entry_ledger.sql',
  '013_ledger_posting_and_reservations.sql',
  '014_accounting_books_and_periods.sql',
  '015_period_close_dual_control.sql',
  '016_global_tenant_rls_and_auth.sql',
  '017_provider_outbox_inbox_reconciliation.sql',
  '018_keel_authority_action_assurance.sql',
  '019_kAAA_provider_authority_event_type.sql',
  '020_rls_aware_backup_identity.sql',
  '021_ai_release_assessments.sql',
  '022_direct_tenant_fk_coverage.sql',
  '023_backup_role_connection_capacity.sql'
]);

// All tenant-scoped financial-core relations introduced or required by migrations
// 012-023. Catalog inspection separately discovers any additional tenant_id tables.
const REQUIRED_TABLES = Object.freeze([
  'keel_tenants',
  'keel_tenant_keys',
  'keel_principals',
  'keel_ledger_accounts',
  'keel_ledger_journals',
  'keel_ledger_lines',
  'keel_ledger_account_balances',
  'keel_ledger_reservations',
  'keel_ledger_event_heads',
  'keel_ledger_events',
  'keel_accounting_books',
  'keel_accounting_book_accounts',
  'keel_accounting_periods',
  'keel_accounting_period_close_requests',
  'keel_accounting_period_closures',
  'keel_provider_outbox',
  'keel_provider_inbox',
  'keel_provider_reconciliation_cases',
  'keel_authority_envelopes',
  'keel_action_proof_objects',
  'keel_authority_action_approvals',
  'keel_ai_release_assessments',
  'keel_regulatory_mappings',
  'keel_regulatory_obligations'
]);

// Critical database functions are checked by catalog name; signature-specific
// invocation/grant checks remain separate acceptance requirements.
const REQUIRED_FUNCTIONS = Object.freeze([
  'keel_authenticate_tenant_key',
  'keel_touch_tenant_key',
  'keel_ledger_reject_posted_mutation',
  'keel_ledger_reject_posted_header_mutation',
  'keel_ledger_assert_balanced',
  'keel_ledger_account_currency_guard',
  'keel_ledger_account_metadata_guard',
  'keel_ledger_balance_currency_guard',
  'keel_ledger_reservation_guard',
  'keel_ledger_events_immutable',
  'keel_accounting_period_transition_guard',
  'keel_ledger_journal_period_guard',
  'keel_accounting_period_close_request_guard',
  'keel_accounting_period_close_request_no_delete',
  'keel_accounting_period_closure_immutable',
  'keel_backup_tenant_ids',
  'keel_reject_kAAA_evidence_mutation',
  'keel_reject_ai_release_assessment_mutation'
]);

module.exports = {
  FINANCIAL_CORE_CONTRACT_VERSION,
  REQUIRED_MIGRATIONS,
  REQUIRED_TABLES,
  REQUIRED_FUNCTIONS
};
