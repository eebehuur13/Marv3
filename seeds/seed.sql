INSERT OR IGNORE INTO organisations (id, slug, name)
VALUES ('default', 'default', 'Default Organization');

INSERT OR IGNORE INTO users (id, email, display_name, tenant, last_seen, organization_id, organization_role)
VALUES (
  'user-demo-1',
  'demo@marble.team',
  'Demo User',
  'default',
  CURRENT_TIMESTAMP,
  'default',
  'admin'
);

INSERT OR IGNORE INTO folders (id, tenant, organization_id, name, visibility, owner_id, created_at, updated_at)
VALUES
  ('public-root', 'default', 'default', 'Org Shared', 'organization', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('private-root', 'default', 'default', 'My Space', 'personal', 'user-demo-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO organisation_roster (id, organisation_id, email, display_name, role, status, created_at, updated_at)
VALUES ('roster-default-owner', 'default', 'eebehuur13@gmail.com', 'Org Owner', 'owner', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
