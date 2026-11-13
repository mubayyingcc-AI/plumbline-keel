-- The tenant-snapshot worker holds one exported snapshot connection while
-- opening a pg_dump/psql connection for each sequential export phase. Allow a
-- small bounded headroom for overlapping preflight/metadata connections while
-- keeping the dedicated backup login tightly capped.
ALTER ROLE keel_backup CONNECTION LIMIT 6;

DO $keel$
DECLARE v_limit INTEGER;
BEGIN
  SELECT rolconnlimit INTO v_limit FROM pg_roles WHERE rolname='keel_backup';
  IF v_limit <> 6 THEN
    RAISE EXCEPTION 'backup_role_connection_limit_not_applied:%', v_limit;
  END IF;
END
$keel$;
