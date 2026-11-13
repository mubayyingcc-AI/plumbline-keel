-- Add direct tenant-parent foreign keys to tenant-scoped finance and regulatory
-- tables whose existing composite FKs already enforce tenant-consistent parents.
-- NOT VALID is used only to separate creation from validation; validation is
-- mandatory in this migration and failure aborts the transaction.
DO $keel$
DECLARE
  v_table TEXT;
  v_child_att SMALLINT;
  v_parent_att SMALLINT;
  v_constraint TEXT;
  v_validated BOOLEAN;
  v_missing INTEGER;
BEGIN
  FOR v_table IN
    SELECT unnest(ARRAY[
      'keel_accounting_book_accounts',
      'keel_accounting_period_close_requests',
      'keel_accounting_period_closures',
      'keel_ledger_account_balances',
      'keel_ledger_lines',
      'keel_regulatory_mappings',
      'keel_regulatory_obligations'
    ]::TEXT[])
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'tenant_fk_required_table_missing:%', v_table;
    END IF;

    SELECT attnum INTO v_child_att
      FROM pg_attribute
     WHERE attrelid = to_regclass(format('public.%I', v_table))
       AND attname = 'tenant_id'
       AND atttypid = 'uuid'::regtype
       AND attnum > 0 AND NOT attisdropped;
    IF v_child_att IS NULL THEN
      RAISE EXCEPTION 'tenant_fk_uuid_column_missing:%', v_table;
    END IF;

    SELECT attnum INTO v_parent_att
      FROM pg_attribute
     WHERE attrelid = 'public.keel_tenants'::regclass
       AND attname = 'tenant_id'
       AND atttypid = 'uuid'::regtype
       AND attnum > 0 AND NOT attisdropped;
    IF v_parent_att IS NULL THEN
      RAISE EXCEPTION 'tenant_registry_uuid_column_missing';
    END IF;

    SELECT conname, convalidated
      INTO v_constraint, v_validated
      FROM pg_constraint
     WHERE conrelid = to_regclass(format('public.%I', v_table))
       AND confrelid = 'public.keel_tenants'::regclass
       AND contype = 'f'
       AND conkey = ARRAY[v_child_att]::smallint[]
       AND confkey = ARRAY[v_parent_att]::smallint[]
     ORDER BY convalidated DESC, conname
     LIMIT 1;

    IF NOT FOUND THEN
      v_constraint := v_table || '_tenant_fk';
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.keel_tenants(tenant_id) NOT VALID',
        v_table, v_constraint
      );
      v_validated := FALSE;
    END IF;

    IF NOT v_validated THEN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', v_table, v_constraint);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_missing
  FROM unnest(ARRAY[
    'keel_accounting_book_accounts',
    'keel_accounting_period_close_requests',
    'keel_accounting_period_closures',
    'keel_ledger_account_balances',
    'keel_ledger_lines',
    'keel_regulatory_mappings',
    'keel_regulatory_obligations'
  ]::TEXT[]) AS expected(table_name)
  JOIN pg_class c ON c.relname = expected.table_name
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute child_key ON child_key.attrelid = c.oid
    AND child_key.attname = 'tenant_id' AND child_key.attnum > 0 AND NOT child_key.attisdropped
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint fk
    WHERE fk.conrelid = c.oid
      AND fk.confrelid = 'public.keel_tenants'::regclass
      AND fk.contype = 'f'
      AND fk.convalidated
      AND fk.conkey = ARRAY[child_key.attnum]::smallint[]
      AND fk.confkey = ARRAY[v_parent_att]::smallint[]
  );

  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'direct_tenant_fk_coverage_incomplete:%', v_missing;
  END IF;
END
$keel$;
