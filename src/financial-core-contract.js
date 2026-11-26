'use strict';

// Single versioned contract shared by migration application and readiness inspection.
// Update this file only when the corresponding migration files and acceptance
// tests are included in the same reviewed change.
const FINANCIAL_CORE_CONTRACT_VERSION = '1.0.0';

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
  'keel_ai_release_assessments'
]);

module.exports = { FINANCIAL_CORE_CONTRACT_VERSION, REQUIRED_MIGRATIONS, REQUIRED_TABLES };
