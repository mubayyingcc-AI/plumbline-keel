-- Return the complete direct and transitive role-membership chain for keel_backup.
-- The only permitted inherited role is keel_backup_reader.
WITH RECURSIVE inherited_roles(role_oid) AS (
  SELECT m.roleid
  FROM pg_auth_members m
  JOIN pg_roles member ON member.oid=m.member
  WHERE member.rolname='keel_backup'
  UNION
  SELECT m.roleid
  FROM pg_auth_members m
  JOIN inherited_roles inherited ON m.member=inherited.role_oid
)
SELECT COALESCE(string_agg(r.rolname, ',' ORDER BY r.rolname),'')
FROM inherited_roles inherited
JOIN pg_roles r ON r.oid=inherited.role_oid;
