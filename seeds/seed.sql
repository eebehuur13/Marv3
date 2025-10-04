INSERT OR IGNORE INTO users (id, email) VALUES
  ('user-demo-1', 'demo@marble.team');

INSERT OR IGNORE INTO folders (id, name, visibility, owner_id) VALUES
  ('public-root', 'Org Shared', 'public', NULL),
  ('private-root', 'My Space', 'private', 'user-demo-1');
