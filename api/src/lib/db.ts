import { HTTPException } from 'hono/http-exception';
import type {
  AuthenticatedUser,
  ChunkRecord,
  FileRecord,
  FolderRecord,
  MarbleBindings,
  Visibility,
} from '../types';

function isoNow(): string {
  return new Date().toISOString();
}

function normalizeTenant(env: MarbleBindings, tenant: string | undefined): string {
  return tenant?.trim() || env.DEFAULT_TENANT || 'default';
}

async function ensureOrganisation(env: MarbleBindings, organisationId: string): Promise<void> {
  await env.MARBLE_DB.prepare(
    `INSERT INTO organisations (id, slug, name)
     VALUES (?1, ?1, ?1)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(organisationId)
    .run();
}

export async function ensureUser(env: MarbleBindings, user: AuthenticatedUser): Promise<void> {
  const now = isoNow();
  const tenant = normalizeTenant(env, user.tenant);
  const organisationId = user.organizationId ?? tenant;

  await ensureOrganisation(env, organisationId);

  await env.MARBLE_DB.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, tenant, last_seen, organization_id, organization_role, username, title)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       tenant = excluded.tenant,
       last_seen = excluded.last_seen,
       organization_id = excluded.organization_id,
       organization_role = COALESCE(excluded.organization_role, users.organization_role),
       username = COALESCE(excluded.username, users.username),
       title = COALESCE(excluded.title, users.title)`
  )
    .bind(
      user.id,
      user.email,
      user.displayName ?? null,
      user.avatarUrl ?? null,
      tenant,
      now,
      organisationId,
      user.organizationRole ?? null,
      user.username ?? null,
      user.title ?? null,
    )
    .run();

  await env.MARBLE_DB.prepare(
    `UPDATE users
     SET organization_role = COALESCE(organization_role, 'member')
     WHERE id = ?1`
  )
    .bind(user.id)
    .run();

  const rosterEntry = await env.MARBLE_DB.prepare(
    `SELECT id, role
     FROM organisation_roster
     WHERE organisation_id = ?1 AND lower(email) = lower(?2)
     LIMIT 1`,
  )
    .bind(organisationId, user.email)
    .first<{ id: string; role: string }>();

  if (rosterEntry) {
    await env.MARBLE_DB.prepare(
      `UPDATE organisation_roster
       SET user_id = ?2,
           status = 'active',
           joined_at = COALESCE(joined_at, ?3),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    )
      .bind(rosterEntry.id, user.id, now)
      .run();

    await env.MARBLE_DB.prepare(
      `UPDATE users
       SET organization_role = ?2
       WHERE id = ?1`,
    )
      .bind(user.id, rosterEntry.role)
      .run();
  }
}

export interface FolderWithOwner extends FolderRecord {
  owner_email: string | null;
  owner_display_name: string | null;
  file_count?: number;
}

export async function getFolder(env: MarbleBindings, folderId: string, organisationId: string): Promise<FolderRecord | null> {
  const detail = await getFolderById(env, folderId, organisationId);
  if (!detail) {
    return null;
  }
  const { owner_email: _ownerEmail, owner_display_name: _ownerDisplayName, file_count: _count, ...folder } = detail;
  return folder;
}

type FolderAccessScope = FolderRecord | FolderWithOwner;

function assertFolderPresence<T extends FolderAccessScope | null>(
  folder: T,
): asserts folder is Exclude<T, null> {
  if (!folder || folder.deleted_at) {
    throw new HTTPException(404, { message: 'Folder not found' });
  }
}

function isFolderOwner(folder: FolderAccessScope, userId: string): boolean {
  return folder.owner_id === userId;
}

function isTeamMember(folder: FolderAccessScope, teamIds: string[]): boolean {
  return folder.team_id ? teamIds.includes(folder.team_id) : false;
}

export function assertFolderVisibility<T extends FolderAccessScope | null>(
  folder: T,
  userId: string,
  mode: 'read' | 'write' = 'read',
  teamIds: string[] = [],
): asserts folder is Exclude<T, null> {
  assertFolderPresence(folder);

  if (folder.visibility === 'personal' && !isFolderOwner(folder, userId)) {
    throw new HTTPException(403, { message: 'Folder is private to another user' });
  }

  if (folder.visibility === 'team' && !isTeamMember(folder, teamIds) && !isFolderOwner(folder, userId)) {
    throw new HTTPException(403, { message: 'You are not a member of this team' });
  }

  if (mode === 'write') {
    if (folder.visibility === 'organization' && folder.owner_id && !isFolderOwner(folder, userId)) {
      throw new HTTPException(403, { message: 'Only the folder owner can modify this shared folder' });
    }
    if (folder.visibility === 'team' && !isFolderOwner(folder, userId)) {
      throw new HTTPException(403, { message: 'Only the folder owner can modify this team folder' });
    }
    if (!folder.owner_id && folder.id === 'public-root') {
      throw new HTTPException(403, { message: 'The shared root folder is read-only.' });
    }
  }
}

export function assertFolderAccess(
  folder: FolderWithOwner | null,
  userId: string,
  mode: 'read' | 'write' = 'read',
  teamIds: string[] = [],
): asserts folder is FolderWithOwner {
  assertFolderVisibility(folder, userId, mode, teamIds);
}

export interface ListFoldersOptions {
  organisationId: string;
  userId: string;
  teamIds?: string[];
  visibility: 'organization' | 'personal' | 'team' | 'all';
}

export interface FolderSummaryRow extends FolderWithOwner {
  file_count: number;
}

export async function listFolders(env: MarbleBindings, options: ListFoldersOptions): Promise<FolderSummaryRow[]> {
  const clauses: string[] = ['f.deleted_at IS NULL', 'f.organization_id = ?1'];
  const bindings: unknown[] = [options.organisationId];
  const teamIds = options.teamIds ?? [];

  if (options.visibility === 'organization') {
    clauses.push("f.visibility = 'organization'");
  } else if (options.visibility === 'personal') {
    bindings.push(options.userId);
    clauses.push(`f.visibility = 'personal' AND f.owner_id = ?${bindings.length}`);
  } else if (options.visibility === 'team') {
    if (!teamIds.length) {
      return [];
    }
    const placeholders = teamIds.map((_, index) => `?${bindings.length + index + 1}`).join(',');
    bindings.push(...teamIds);
    clauses.push(`f.visibility = 'team' AND f.team_id IN (${placeholders})`);
  } else {
    const fragments: string[] = [];
    fragments.push("f.visibility = 'organization'");
    bindings.push(options.userId);
    const ownerParam = `?${bindings.length}`;
    fragments.push(`(f.visibility = 'personal' AND f.owner_id = ${ownerParam})`);
    if (teamIds.length) {
      const placeholders = teamIds.map((_, index) => `?${bindings.length + index + 1}`).join(',');
      bindings.push(...teamIds);
      fragments.push(`(f.visibility = 'team' AND f.team_id IN (${placeholders}))`);
    }
    clauses.push(`(${fragments.join(' OR ')})`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const statement = `
    SELECT
      f.id,
      f.tenant,
      f.organization_id,
      f.name,
      f.visibility,
      f.owner_id,
      f.team_id,
      f.created_at,
      f.updated_at,
      f.deleted_at,
      COALESCE(COUNT(fi.id), 0) AS file_count,
      u.email AS owner_email,
      u.display_name AS owner_display_name
    FROM folders f
    LEFT JOIN files fi ON fi.folder_id = f.id AND fi.deleted_at IS NULL
    LEFT JOIN users u ON u.id = f.owner_id
    ${where}
    GROUP BY f.id
    ORDER BY datetime(f.updated_at) DESC
  `;

  const results = await env.MARBLE_DB.prepare(statement).bind(...bindings).all<FolderSummaryRow>();
  return results.results ?? [];
}

export async function countFilesInFolder(env: MarbleBindings, folderId: string, organisationId: string): Promise<number> {
  const result = await env.MARBLE_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM files
     WHERE folder_id = ?1 AND organization_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(folderId, organisationId)
    .first<{ count: number }>();
  return Number(result?.count ?? 0);
}

export async function deleteFolder(
  env: MarbleBindings,
  data: { id: string; organisationId: string; ownerId: string; force?: boolean },
): Promise<void> {
  const folder = await getFolderById(env, data.id, data.organisationId);
  if (!folder) {
    throw new HTTPException(404, { message: 'Folder not found' });
  }
  if (folder.id === 'public-root' || folder.id === 'private-root') {
    throw new HTTPException(403, { message: 'System folders cannot be deleted.' });
  }

  if (folder.owner_id && folder.owner_id !== data.ownerId) {
    throw new HTTPException(403, { message: 'You can only delete folders you own.' });
  }

  const remaining = await countFilesInFolder(env, folder.id, data.organisationId);
  if (remaining > 0 && !data.force) {
    throw new HTTPException(400, { message: 'Move or delete the folder files first.' });
  }

  await env.MARBLE_DB.prepare(
    `UPDATE folders
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND organization_id = ?2`,
  )
    .bind(folder.id, data.organisationId)
    .run();
}

export async function createFolder(
  env: MarbleBindings,
  data: {
    id: string;
    organisationId: string;
    tenant: string;
    ownerId: string | null;
    name: string;
    visibility: Visibility;
    teamId?: string | null;
  },
): Promise<void> {
  if (data.visibility === 'team' && !data.teamId) {
    throw new HTTPException(400, { message: 'Team folders require a team id.' });
  }
  const now = isoNow();
  await env.MARBLE_DB.prepare(
    `INSERT INTO folders (id, tenant, organization_id, owner_id, name, visibility, team_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`
  )
    .bind(data.id, data.tenant, data.organisationId, data.ownerId, data.name, data.visibility, data.teamId ?? null, now)
    .run();
}

export async function updateFolder(
  env: MarbleBindings,
  data: {
    id: string;
    organisationId: string;
    ownerId: string;
    name?: string;
    visibility?: Visibility;
    teamId?: string | null;
  },
): Promise<{ next: FolderWithOwner }>
{
  const current = await env.MARBLE_DB.prepare(
    `SELECT id, tenant, organization_id, name, visibility, owner_id, team_id, created_at, updated_at, deleted_at
     FROM folders
     WHERE id = ?1 AND organization_id = ?2`,
  )
    .bind(data.id, data.organisationId)
    .first<FolderRecord>();

  if (!current || current.deleted_at) {
    throw new HTTPException(404, { message: 'Folder not found' });
  }
  if (current.owner_id && current.owner_id !== data.ownerId) {
    throw new HTTPException(403, { message: 'You can only modify folders you own.' });
  }

  const nextVisibility = data.visibility ?? current.visibility;
  const nextOwner = data.ownerId;
  const nextName = data.name?.trim() ? data.name.trim() : current.name;
  const nextTeam = nextVisibility === 'team' ? data.teamId ?? current.team_id : null;
  if (nextVisibility === 'team' && !nextTeam) {
    throw new HTTPException(400, { message: 'Team folders require a team id.' });
  }

  await env.MARBLE_DB.prepare(
    `UPDATE folders
     SET name = ?2,
         visibility = ?3,
         owner_id = ?4,
         team_id = ?5,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND organization_id = ?6`,
  )
    .bind(data.id, nextName, nextVisibility, nextOwner, nextTeam, data.organisationId)
    .run();

  const next = await getFolderById(env, data.id, data.organisationId);
  if (!next) {
    throw new HTTPException(500, { message: 'Failed to load updated folder' });
  }
  return { next };
}

export async function getFolderById(env: MarbleBindings, id: string, organisationId: string): Promise<FolderWithOwner | null> {
  const result = await env.MARBLE_DB.prepare(
    `SELECT
        f.id,
        f.tenant,
        f.organization_id,
        f.name,
        f.visibility,
        f.owner_id,
        f.team_id,
        f.created_at,
        f.updated_at,
        f.deleted_at,
        u.email AS owner_email,
        u.display_name AS owner_display_name
     FROM folders f
     LEFT JOIN users u ON u.id = f.owner_id
     WHERE f.id = ?1 AND f.organization_id = ?2`,
  )
    .bind(id, organisationId)
    .first<FolderWithOwner>();

  if (!result || result.deleted_at) {
    return null;
  }
  return result;
}

export async function ensureFolder(
  env: MarbleBindings,
  data: {
    id: string;
    organisationId: string;
    tenant: string;
    name: string;
    visibility: Visibility;
    ownerId: string | null;
    teamId?: string | null;
  },
): Promise<void> {
  if (data.visibility === 'team' && !data.teamId) {
    throw new HTTPException(400, { message: 'Team folders require a team id.' });
  }
  await env.MARBLE_DB.prepare(
    `INSERT INTO folders (id, tenant, organization_id, name, visibility, owner_id, team_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       tenant = excluded.tenant,
       name = excluded.name,
       visibility = excluded.visibility,
       owner_id = excluded.owner_id,
       team_id = excluded.team_id,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(data.id, data.tenant, data.organisationId, data.name, data.visibility, data.ownerId, data.teamId ?? null)
    .run();
}

export interface CreateFileRecordInput {
  id: string;
  organisationId: string;
  tenant: string;
  folderId: string;
  ownerId: string;
  teamId?: string | null;
  visibility: Visibility;
  fileName: string;
  r2Key: string;
  size: number;
  status: FileRecord['status'];
  mimeType?: string | null;
}

export async function createFileRecord(env: MarbleBindings, data: CreateFileRecordInput): Promise<void> {
  if (data.visibility === 'team' && !data.teamId) {
    throw new HTTPException(400, { message: 'Team visibility requires a team id.' });
  }
  await env.MARBLE_DB.prepare(
    `INSERT INTO files (id, tenant, organization_id, folder_id, owner_id, team_id, visibility, file_name, r2_key, size, mime_type, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  )
    .bind(
      data.id,
      data.tenant,
      data.organisationId,
      data.folderId,
      data.ownerId,
      data.teamId ?? null,
      data.visibility,
      data.fileName,
      data.r2Key,
      data.size,
      data.mimeType ?? null,
      data.status,
    )
    .run();
}

export async function updateFileStatus(env: MarbleBindings, fileId: string, status: FileRecord['status']): Promise<void> {
  await env.MARBLE_DB.prepare(
    `UPDATE files
     SET status = ?2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1`,
  )
    .bind(fileId, status)
    .run();
}

export async function updateFileAfterConversion(
  env: MarbleBindings,
  data: { id: string; fileName: string; r2Key: string; size: number; mimeType: string },
): Promise<void> {
  await env.MARBLE_DB.prepare(
    `UPDATE files
     SET file_name = ?1,
         r2_key = ?2,
         size = ?3,
         mime_type = ?4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?5`,
  )
    .bind(data.fileName, data.r2Key, data.size, data.mimeType, data.id)
    .run();
}

export interface FileWithFolder extends FileRecord {
  folder_name: string;
  folder_visibility: Visibility;
  folder_team_id: string | null;
  owner_email: string;
  owner_display_name: string | null;
  has_direct_access?: number;
}

export async function getFile(env: MarbleBindings, fileId: string, organisationId?: string): Promise<FileWithFolder | null> {
  const clauses: string[] = ['fi.id = ?1', 'fi.deleted_at IS NULL', 'fo.deleted_at IS NULL'];
  const bindings: unknown[] = [fileId];

  if (organisationId) {
    bindings.push(organisationId);
    clauses.push(`fi.organization_id = ?${bindings.length}`);
  }

  const statement = `
    SELECT
      fi.id,
      fi.tenant,
      fi.organization_id,
      fi.folder_id,
      fi.owner_id,
      fi.team_id,
      fi.visibility,
      fi.file_name,
      fi.r2_key,
      fi.size,
      fi.mime_type,
      fi.status,
      fi.created_at,
      fi.updated_at,
      fi.deleted_at,
      fo.name AS folder_name,
      fo.visibility AS folder_visibility,
      fo.team_id AS folder_team_id,
      u.email AS owner_email,
      u.display_name AS owner_display_name
    FROM files fi
    JOIN folders fo ON fo.id = fi.folder_id
    JOIN users u ON u.id = fi.owner_id
    WHERE ${clauses.join(' AND ')}
  `;

  const result = await env.MARBLE_DB.prepare(statement).bind(...bindings).first<FileWithFolder>();
  if (!result) {
    return null;
  }
  return result;
}

export async function getFileById(env: MarbleBindings, fileId: string): Promise<FileWithFolder | null> {
  return getFile(env, fileId);
}

export interface ListFilesFilters {
  organisationId: string;
  userId: string;
  teamIds?: string[];
  folderId?: string;
  visibility?: 'organization' | 'personal' | 'team' | 'all';
}

export async function listFiles(env: MarbleBindings, filters: ListFilesFilters): Promise<FileWithFolder[]> {
  const teamIds = filters.teamIds ?? [];
  const clauses: string[] = ['fi.deleted_at IS NULL', 'fo.deleted_at IS NULL', 'fi.organization_id = ?1'];
  const bindings: unknown[] = [filters.organisationId];

  if (filters.folderId) {
    bindings.push(filters.folderId);
    clauses.push(`fi.folder_id = ?${bindings.length}`);
  }

  const fragments: string[] = [];
  if (!filters.visibility || filters.visibility === 'all' || filters.visibility === 'organization') {
    fragments.push("fi.visibility = 'organization'");
  }

  bindings.push(filters.userId);
  const ownerParam = `?${bindings.length}`;
  if (!filters.visibility || filters.visibility === 'all' || filters.visibility === 'personal') {
    fragments.push(`(fi.visibility = 'personal' AND fi.owner_id = ${ownerParam})`);
    fragments.push(`(fi.visibility = 'personal' AND fp.user_id = ${ownerParam})`);
  }

  if (!filters.visibility || filters.visibility === 'all' || filters.visibility === 'team') {
    if (teamIds.length) {
      const placeholders = teamIds.map((_, index) => `?${bindings.length + index + 1}`).join(',');
      bindings.push(...teamIds);
      fragments.push(`(fi.visibility = 'team' AND fi.team_id IN (${placeholders}))`);
    }
  }

  if (!fragments.length) {
    return [];
  }

  clauses.push(`(${fragments.join(' OR ')})`);

  const statement = `
    SELECT DISTINCT
      fi.id,
      fi.tenant,
      fi.organization_id,
      fi.folder_id,
      fi.owner_id,
      fi.team_id,
      fi.visibility,
      fi.file_name,
      fi.r2_key,
      fi.size,
      fi.mime_type,
      fi.status,
      fi.created_at,
      fi.updated_at,
      fi.deleted_at,
      fo.name AS folder_name,
      fo.visibility AS folder_visibility,
      fo.team_id AS folder_team_id,
      u.email AS owner_email,
      u.display_name AS owner_display_name,
      CASE WHEN fp.user_id IS NULL THEN 0 ELSE 1 END AS has_direct_access
    FROM files fi
    JOIN folders fo ON fo.id = fi.folder_id
    JOIN users u ON u.id = fi.owner_id
    LEFT JOIN file_permissions fp ON fp.file_id = fi.id AND fp.user_id = ?${ownerParam.slice(1)}
    WHERE ${clauses.join(' AND ')}
    ORDER BY datetime(fi.created_at) DESC
  `;

  const results = await env.MARBLE_DB.prepare(statement).bind(...bindings).all<FileWithFolder>();
  return results.results ?? [];
}

export async function deleteFile(env: MarbleBindings, fileId: string): Promise<void> {
  await env.MARBLE_DB.prepare('DELETE FROM files WHERE id = ?1').bind(fileId).run();
}

export interface ChunkWithContext extends ChunkRecord {
  file_name: string;
  folder_name: string;
}

export async function insertChunk(
  env: MarbleBindings,
  record: Pick<
    ChunkRecord,
    | 'id'
    | 'file_id'
    | 'folder_id'
    | 'organization_id'
    | 'owner_id'
    | 'team_id'
    | 'visibility'
    | 'chunk_index'
    | 'start_line'
    | 'end_line'
    | 'content'
  >,
): Promise<void> {
  await env.MARBLE_DB.prepare(
    `INSERT INTO chunks (id, file_id, folder_id, organization_id, owner_id, team_id, visibility, chunk_index, start_line, end_line, content)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  )
    .bind(
      record.id,
      record.file_id,
      record.folder_id,
      record.organization_id,
      record.owner_id,
      record.team_id ?? null,
      record.visibility,
      record.chunk_index,
      record.start_line,
      record.end_line,
      record.content,
    )
    .run();
}

export async function deleteChunksForFile(env: MarbleBindings, fileId: string): Promise<string[]> {
  const chunkIds = await env.MARBLE_DB.prepare('SELECT id FROM chunks WHERE file_id = ?1')
    .bind(fileId)
    .all<{ id: string }>();

  await env.MARBLE_DB.prepare('DELETE FROM chunks WHERE file_id = ?1').bind(fileId).run();
  return (chunkIds.results ?? []).map((row) => row.id);
}

export async function getChunksByIds(env: MarbleBindings, chunkIds: string[]): Promise<ChunkWithContext[]> {
  if (!chunkIds.length) {
    return [];
  }
  const placeholders = chunkIds.map((_, idx) => `?${idx + 1}`).join(',');
  const statement = `
    SELECT
      c.id,
      c.file_id,
      c.folder_id,
      c.organization_id,
      c.owner_id,
      c.team_id,
      c.visibility,
      c.chunk_index,
      c.start_line,
      c.end_line,
      c.content,
      c.created_at,
      f.file_name,
      d.name AS folder_name
    FROM chunks c
    JOIN files f ON f.id = c.file_id
    JOIN folders d ON d.id = c.folder_id
    WHERE c.id IN (${placeholders})
  `;
  const results = await env.MARBLE_DB.prepare(statement).bind(...chunkIds).all<ChunkWithContext>();
  return results.results ?? [];
}

export async function recordChat(
  env: MarbleBindings,
  data: { id: string; user_id: string; question: string; answer: string; citations: string },
): Promise<void> {
  await env.MARBLE_DB.prepare(
    `INSERT INTO messages (id, user_id, question, answer, citations)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  )
    .bind(data.id, data.user_id, data.question, data.answer, data.citations)
    .run();
}
