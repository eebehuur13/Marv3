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

export async function ensureUser(env: MarbleBindings, user: AuthenticatedUser): Promise<void> {
  const now = isoNow();
  await env.MARBLE_DB.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, tenant, last_seen)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       tenant = excluded.tenant,
       last_seen = excluded.last_seen`,
  )
    .bind(user.id, user.email, user.displayName ?? null, user.avatarUrl ?? null, user.tenant, now)
    .run();
}

export interface FolderWithOwner extends FolderRecord {
  owner_email: string | null;
  owner_display_name: string | null;
  file_count?: number;
}

export async function getFolder(env: MarbleBindings, folderId: string, tenant: string): Promise<FolderRecord | null> {
  const detail = await getFolderById(env, folderId, tenant);
  if (!detail) {
    return null;
  }
  const { owner_email: _ownerEmail, owner_display_name: _ownerDisplayName, file_count: _count, ...folder } = detail;
  return folder;
}

export function assertFolderVisibility(folder: FolderRecord, userId: string): void {
  if (folder.deleted_at) {
    throw new HTTPException(404, { message: 'Folder not found' });
  }
  if (folder.visibility === 'public') {
    return;
  }
  if (folder.owner_id !== userId) {
    throw new HTTPException(403, { message: 'Folder is private to another user' });
  }
}

export function assertFolderAccess(folder: FolderWithOwner | null, userId: string): asserts folder is FolderWithOwner {
  if (!folder || folder.deleted_at) {
    throw new HTTPException(404, { message: 'Folder not found' });
  }
  if (folder.visibility === 'private' && folder.owner_id !== userId) {
    throw new HTTPException(403, { message: 'Folder is private to another user' });
  }
}

export interface ListFoldersOptions {
  tenant: string;
  ownerId: string;
  visibility: 'public' | 'private' | 'all';
}

export interface FolderSummaryRow extends FolderWithOwner {
  file_count: number;
}

export async function listFolders(env: MarbleBindings, options: ListFoldersOptions): Promise<FolderSummaryRow[]> {
  const clauses: string[] = ['f.deleted_at IS NULL', 'f.tenant = ?1'];
  const bindings: unknown[] = [options.tenant];

  if (options.visibility === 'public') {
    clauses.push("f.visibility = 'public'");
  } else if (options.visibility === 'private') {
    bindings.push(options.ownerId);
    clauses.push(`f.visibility = 'private' AND f.owner_id = ?${bindings.length}`);
  } else {
    bindings.push(options.ownerId);
    const ownerParam = `?${bindings.length}`;
    clauses.push(`(f.visibility = 'public' OR (f.visibility = 'private' AND f.owner_id = ${ownerParam}))`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const statement = `
    SELECT
      f.id,
      f.tenant,
      f.name,
      f.visibility,
      f.owner_id,
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

export async function countFilesInFolder(env: MarbleBindings, folderId: string, tenant: string): Promise<number> {
  const result = await env.MARBLE_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM files
     WHERE folder_id = ?1 AND tenant = ?2 AND deleted_at IS NULL`,
  )
    .bind(folderId, tenant)
    .first<{ count: number }>();
  return Number(result?.count ?? 0);
}

export async function deleteFolder(
  env: MarbleBindings,
  data: { id: string; tenant: string; ownerId: string; force?: boolean },
): Promise<void> {
  const folder = await getFolderById(env, data.id, data.tenant);
  if (!folder) {
    throw new HTTPException(404, { message: 'Folder not found' });
  }
  if (folder.id === 'public-root' || folder.id === 'private-root') {
    throw new HTTPException(403, { message: 'System folders cannot be deleted.' });
  }

  if (folder.owner_id && folder.owner_id !== data.ownerId) {
    throw new HTTPException(403, { message: 'You can only delete folders you own.' });
  }

  const remaining = await countFilesInFolder(env, folder.id, data.tenant);
  if (remaining > 0 && !data.force) {
    throw new HTTPException(400, { message: 'Move or delete the folder files first.' });
  }

  await env.MARBLE_DB.prepare(
    `UPDATE folders
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND tenant = ?2`,
  )
    .bind(folder.id, data.tenant)
    .run();
}

export async function createFolder(
  env: MarbleBindings,
  data: { id: string; tenant: string; ownerId: string; name: string; visibility: Visibility },
): Promise<void> {
  const now = isoNow();
  await env.MARBLE_DB.prepare(
    `INSERT INTO folders (id, tenant, owner_id, name, visibility, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(data.id, data.tenant, data.ownerId, data.name, data.visibility, now)
    .run();
}

export async function updateFolder(
  env: MarbleBindings,
  data: { id: string; tenant: string; ownerId: string; name?: string; visibility?: Visibility },
): Promise<{ next: FolderWithOwner }>
{
  const current = await env.MARBLE_DB.prepare(
    `SELECT id, tenant, name, visibility, owner_id, created_at, updated_at, deleted_at
     FROM folders
     WHERE id = ?1 AND tenant = ?2`,
  )
    .bind(data.id, data.tenant)
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

  await env.MARBLE_DB.prepare(
    `UPDATE folders
     SET name = ?2,
         visibility = ?3,
         owner_id = ?4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND tenant = ?5`,
  )
    .bind(data.id, nextName, nextVisibility, nextOwner, data.tenant)
    .run();

  const next = await getFolderById(env, data.id, data.tenant);
  if (!next) {
    throw new HTTPException(500, { message: 'Failed to load updated folder' });
  }
  return { next };
}

export async function getFolderById(env: MarbleBindings, id: string, tenant: string): Promise<FolderWithOwner | null> {
  const result = await env.MARBLE_DB.prepare(
    `SELECT
        f.id,
        f.tenant,
        f.name,
        f.visibility,
        f.owner_id,
        f.created_at,
        f.updated_at,
        f.deleted_at,
        u.email AS owner_email,
        u.display_name AS owner_display_name
     FROM folders f
     LEFT JOIN users u ON u.id = f.owner_id
     WHERE f.id = ?1 AND f.tenant = ?2`,
  )
    .bind(id, tenant)
    .first<FolderWithOwner>();

  if (!result || result.deleted_at) {
    return null;
  }
  return result;
}

export async function ensureFolder(
  env: MarbleBindings,
  data: { id: string; tenant: string; name: string; visibility: Visibility; ownerId: string | null },
): Promise<void> {
  await env.MARBLE_DB.prepare(
    `INSERT INTO folders (id, tenant, name, visibility, owner_id)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET
       tenant = excluded.tenant,
       name = excluded.name,
       visibility = excluded.visibility,
       owner_id = excluded.owner_id,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(data.id, data.tenant, data.name, data.visibility, data.ownerId)
    .run();
}

export interface CreateFileRecordInput {
  id: string;
  tenant: string;
  folderId: string;
  ownerId: string;
  visibility: Visibility;
  fileName: string;
  r2Key: string;
  size: number;
  status: FileRecord['status'];
  mimeType?: string | null;
}

export async function createFileRecord(env: MarbleBindings, data: CreateFileRecordInput): Promise<void> {
  await env.MARBLE_DB.prepare(
    `INSERT INTO files (id, tenant, folder_id, owner_id, visibility, file_name, r2_key, size, mime_type, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      data.id,
      data.tenant,
      data.folderId,
      data.ownerId,
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
  owner_email: string;
  owner_display_name: string | null;
}

export async function getFile(env: MarbleBindings, fileId: string, tenant?: string): Promise<FileWithFolder | null> {
  const clauses: string[] = ['fi.id = ?1', 'fi.deleted_at IS NULL', 'fo.deleted_at IS NULL'];
  const bindings: unknown[] = [fileId];

  if (tenant) {
    bindings.push(tenant);
    clauses.push(`fi.tenant = ?${bindings.length}`);
  }

  const statement = `
    SELECT
      fi.id,
      fi.tenant,
      fi.folder_id,
      fi.owner_id,
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
  tenant: string;
  ownerId: string;
  folderId?: string;
  visibility?: 'public' | 'private' | 'all';
}

export async function listFiles(env: MarbleBindings, filters: ListFilesFilters): Promise<FileWithFolder[]> {
  const clauses: string[] = ['fi.deleted_at IS NULL', 'fo.deleted_at IS NULL', 'fi.tenant = ?1'];
  const bindings: unknown[] = [filters.tenant];

  if (filters.folderId) {
    bindings.push(filters.folderId);
    clauses.push(`fi.folder_id = ?${bindings.length}`);
  }

  if (!filters.visibility || filters.visibility === 'all') {
    bindings.push(filters.ownerId);
    const ownerParam = `?${bindings.length}`;
    clauses.push(`(fi.visibility = 'public' OR (fi.visibility = 'private' AND fi.owner_id = ${ownerParam}))`);
  } else if (filters.visibility === 'public') {
    clauses.push("fi.visibility = 'public'");
  } else {
    bindings.push(filters.ownerId);
    clauses.push(`fi.visibility = 'private' AND fi.owner_id = ?${bindings.length}`);
  }

  const statement = `
    SELECT
      fi.id,
      fi.tenant,
      fi.folder_id,
      fi.owner_id,
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
      u.email AS owner_email,
      u.display_name AS owner_display_name
    FROM files fi
    JOIN folders fo ON fo.id = fi.folder_id
    JOIN users u ON u.id = fi.owner_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY datetime(fi.created_at) DESC
  `;

  const results = await env.MARBLE_DB.prepare(statement).bind(...bindings).all<FileWithFolder>();
  return results.results ?? [];
}

export async function deleteFile(env: MarbleBindings, fileId: string): Promise<void> {
  await env.MARBLE_DB.prepare('DELETE FROM files WHERE id = ?1').bind(fileId).run();
}

export async function insertChunk(
  env: MarbleBindings,
  record: Pick<ChunkRecord, 'id' | 'file_id' | 'folder_id' | 'owner_id' | 'visibility' | 'chunk_index' | 'start_line' | 'end_line' | 'content'>,
): Promise<void> {
  await env.MARBLE_DB.prepare(
    `INSERT INTO chunks (id, file_id, folder_id, owner_id, visibility, chunk_index, start_line, end_line, content)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      record.id,
      record.file_id,
      record.folder_id,
      record.owner_id,
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

export interface ChunkWithContext extends ChunkRecord {
  file_name: string;
  folder_name: string;
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
      c.owner_id,
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
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(data.id, data.user_id, data.question, data.answer, data.citations)
    .run();
}
