-- Expand Marble schema with organizations, teams, and sharing metadata

-- 1. Organizations catalog
CREATE TABLE IF NOT EXISTS organisations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed organizations from existing tenants (if any)
INSERT OR IGNORE INTO organisations (id, slug, name)
SELECT DISTINCT tenant, tenant, tenant
FROM (
  SELECT tenant FROM users
  UNION
  SELECT tenant FROM folders
  UNION
  SELECT tenant FROM files
)
WHERE tenant IS NOT NULL AND tenant <> '';

-- Ensure default org exists for local development
INSERT OR IGNORE INTO organisations (id, slug, name)
VALUES ('default', 'default', 'Default Organization');

-- 2. Extend users with organization/team metadata
ALTER TABLE users ADD COLUMN organization_id TEXT REFERENCES organisations(id);
ALTER TABLE users ADD COLUMN organization_role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN title TEXT;
ALTER TABLE users ADD COLUMN primary_team_id TEXT;
UPDATE users SET organization_id = COALESCE(tenant, 'default') WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_org_email ON users(organization_id, email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 3. Preserve existing folder/file/chunk data before reshaping tables
ALTER TABLE folders RENAME TO folders_old;
ALTER TABLE files RENAME TO files_old;
ALTER TABLE chunks RENAME TO chunks_old;

-- 4. Roster + teams metadata
CREATE TABLE IF NOT EXISTS organisation_roster (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'owner')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'active', 'removed')),
  invited_by TEXT REFERENCES users(id),
  invited_at TEXT,
  joined_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organisation_id, email)
);

CREATE INDEX IF NOT EXISTS idx_organisation_roster_org_email ON organisation_roster(organisation_id, email);
CREATE INDEX IF NOT EXISTS idx_organisation_roster_status ON organisation_roster(organisation_id, status);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  owner_id TEXT REFERENCES users(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organisation_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(organisation_id);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'manager', 'owner')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed')),
  invited_by TEXT REFERENCES users(id),
  invited_at TEXT,
  joined_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_status ON team_members(team_id, status);

-- 5. Rebuild folders table with organization/team-aware visibility
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('personal', 'team', 'organization')),
  owner_id TEXT REFERENCES users(id),
  team_id TEXT REFERENCES teams(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

INSERT INTO folders (id, tenant, organization_id, name, visibility, owner_id, team_id, created_at, updated_at, deleted_at)
SELECT
  id,
  tenant,
  COALESCE(tenant, 'default') AS organization_id,
  name,
  CASE visibility WHEN 'public' THEN 'organization' ELSE 'personal' END AS visibility,
  owner_id,
  NULL AS team_id,
  created_at,
  updated_at,
  deleted_at
FROM folders_old;

CREATE INDEX IF NOT EXISTS idx_folders_org_visibility ON folders(organization_id, visibility);
CREATE INDEX IF NOT EXISTS idx_folders_owner_visibility ON folders(owner_id, visibility);
CREATE INDEX IF NOT EXISTS idx_folders_team ON folders(team_id);

-- 6. Rebuild files table with organization/team-aware visibility
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organisations(id),
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  team_id TEXT REFERENCES teams(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('personal', 'team', 'organization')),
  file_name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'ready')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

INSERT INTO files (
  id,
  tenant,
  organization_id,
  folder_id,
  owner_id,
  team_id,
  visibility,
  file_name,
  r2_key,
  size,
  mime_type,
  status,
  created_at,
  updated_at,
  deleted_at
)
SELECT
  id,
  tenant,
  COALESCE(tenant, 'default') AS organization_id,
  folder_id,
  owner_id,
  NULL AS team_id,
  CASE visibility WHEN 'public' THEN 'organization' ELSE 'personal' END AS visibility,
  file_name,
  r2_key,
  size,
  mime_type,
  status,
  created_at,
  updated_at,
  deleted_at
FROM files_old;

CREATE INDEX IF NOT EXISTS idx_files_org_visibility ON files(organization_id, visibility);
CREATE INDEX IF NOT EXISTS idx_files_owner_visibility ON files(owner_id, visibility);
CREATE INDEX IF NOT EXISTS idx_files_team ON files(team_id);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);

-- 7. Chunk metadata gains organization/team visibility
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id),
  organization_id TEXT NOT NULL REFERENCES organisations(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  team_id TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('personal', 'team', 'organization')),
  chunk_index INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO chunks (
  id,
  file_id,
  folder_id,
  organization_id,
  owner_id,
  team_id,
  visibility,
  chunk_index,
  start_line,
  end_line,
  content,
  created_at
)
SELECT
  c.id,
  c.file_id,
  c.folder_id,
  COALESCE(f.organization_id, 'default') AS organization_id,
  c.owner_id,
  NULL AS team_id,
  CASE c.visibility WHEN 'public' THEN 'organization' ELSE 'personal' END AS visibility,
  c.chunk_index,
  c.start_line,
  c.end_line,
  c.content,
  c.created_at
FROM chunks_old c
LEFT JOIN files f ON f.id = c.file_id;

CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_org_visibility ON chunks(organization_id, visibility);
CREATE INDEX IF NOT EXISTS idx_chunks_owner_visibility ON chunks(owner_id, visibility);
CREATE INDEX IF NOT EXISTS idx_chunks_team ON chunks(team_id);

-- 8. File-level sharing overrides
CREATE TABLE IF NOT EXISTS file_permissions (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('viewer', 'editor')),
  granted_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (file_id, user_id)
);

-- 9. Cleanup old tables
DROP TABLE IF EXISTS chunks_old;
DROP TABLE IF EXISTS files_old;
DROP TABLE IF EXISTS folders_old;

