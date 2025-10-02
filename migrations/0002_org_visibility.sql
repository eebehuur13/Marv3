-- Add richer user profile fields
ALTER TABLE users RENAME COLUMN name TO display_name;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN tenant TEXT NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE users SET tenant = 'default' WHERE tenant IS NULL;
UPDATE users SET last_seen = COALESCE(last_seen, created_at);

-- Folder metadata for tenancy and lifecycle
ALTER TABLE folders ADD COLUMN tenant TEXT NOT NULL DEFAULT 'default';
ALTER TABLE folders ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE folders ADD COLUMN deleted_at TEXT;
UPDATE folders SET tenant = 'default' WHERE tenant IS NULL;
UPDATE folders SET updated_at = COALESCE(updated_at, created_at);

-- File metadata for tenancy and soft-delete
ALTER TABLE files ADD COLUMN tenant TEXT NOT NULL DEFAULT 'default';
ALTER TABLE files ADD COLUMN mime_type TEXT;
ALTER TABLE files ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE files ADD COLUMN deleted_at TEXT;
UPDATE files SET tenant = 'default' WHERE tenant IS NULL;
UPDATE files SET updated_at = COALESCE(updated_at, created_at);

-- Helpful indexes for tenancy + visibility filters
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant, email);
CREATE INDEX IF NOT EXISTS idx_folders_tenant_visibility ON folders(tenant, visibility);
CREATE INDEX IF NOT EXISTS idx_folders_owner_visibility ON folders(owner_id, visibility);
CREATE INDEX IF NOT EXISTS idx_files_tenant_visibility ON files(tenant, visibility);
CREATE INDEX IF NOT EXISTS idx_files_owner_visibility ON files(owner_id, visibility);
