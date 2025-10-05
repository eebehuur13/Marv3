import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import {
  assertFolderAccess,
  createFileRecord,
  ensureFolder,
  getFile,
  getFolderById,
  listFiles,
  type FileWithFolder,
} from '../lib/db';
import { listFilesQuery, updateFileInput, updateFileSharingInput } from '../schemas';
import { buildObjectKey } from '../lib/storage';
import type { Visibility } from '../types';
import { ingestFileById } from '../lib/ingestion';
import { assertTxtFile, deriveTxtFileName } from '../lib/text-conversion';
import {
  getFileSharingSummary,
  listActiveTeamIdsForUser,
  updateFileSharing,
} from '../lib/org';

const ALLOWED_VISIBILITIES: Visibility[] = ['personal', 'organization', 'team'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB upper bound keeps conversion predictable

function resolveOrganisationId(env: AppContext['env'], tenant: string | undefined, organizationId?: string): string {
  if (organizationId) return organizationId;
  if (tenant) return tenant;
  if (env.DEFAULT_TENANT) return env.DEFAULT_TENANT;
  return 'default';
}

function serializeFileRecord(file: FileWithFolder) {
  return {
    id: file.id,
    name: file.file_name,
    visibility: file.visibility,
    status: file.status,
    size: file.size,
    mimeType: file.mime_type,
    folder: {
      id: file.folder_id,
      name: file.folder_name,
      visibility: file.folder_visibility,
      teamId: file.folder_team_id,
    },
    owner: {
      id: file.owner_id,
      email: file.owner_email,
      displayName: file.owner_display_name,
    },
    hasDirectAccess: Boolean(file.has_direct_access),
    createdAt: file.created_at,
    updatedAt: file.updated_at,
  };
}

async function parseFormData(c: AppContext) {
  try {
    return await c.req.formData();
  } catch (err) {
    console.error('Failed to parse form data', err);
    throw new HTTPException(400, { message: 'Invalid multipart payload' });
  }
}

function normalizeVisibilityParam(value: string | undefined): 'organization' | 'personal' | 'team' | 'all' {
  if (!value) return 'all';
  const lowered = value.toLowerCase();
  if (lowered === 'public' || lowered === 'org' || lowered === 'organization') return 'organization';
  if (lowered === 'private' || lowered === 'personal') return 'personal';
  if (lowered === 'team') return 'team';
  if (lowered === 'all') return 'all';
  return 'all';
}

export async function handleListFiles(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const teamIds = await listActiveTeamIdsForUser(c.env, user.id);

  const query = c.req.query();
  const parsed = listFilesQuery.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const folderId = parsed.data.folder_id ?? (typeof query.folderId === 'string' ? query.folderId : undefined);
  const requestedVisibility = normalizeVisibilityParam(parsed.data.visibility ?? query.visibility);

  const files = await listFiles(c.env, {
    organisationId,
    userId: user.id,
    teamIds,
    folderId,
    visibility: requestedVisibility,
  });

  const payload = files.map(serializeFileRecord);

  c.header('Cache-Control', 'private, no-store');
  return c.json({ files: payload });
}

export async function handleUpdateFile(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const teamIds = await listActiveTeamIdsForUser(c.env, user.id);
  const fileId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateFileInput.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const desired = parsed.data;

  const file = await getFile(c.env, fileId, organisationId);
  if (!file) {
    throw new HTTPException(404, { message: 'File not found' });
  }

  if (file.owner_id !== user.id) {
    if (desired.name !== undefined) {
      throw new HTTPException(403, { message: 'You can only rename files you own.' });
    }
    if (desired.visibility !== undefined) {
      throw new HTTPException(403, { message: 'You can only change visibility for files you own.' });
    }
  }

  if (desired.name !== undefined) {
    const trimmed = desired.name.trim();
    if (!trimmed) {
      throw new HTTPException(400, { message: 'File name cannot be empty.' });
    }
    const nextName = deriveTxtFileName(trimmed);
    await c.env.MARBLE_DB.prepare(
      `UPDATE files SET file_name = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
    )
      .bind(fileId, nextName)
      .run();
  }

  if (desired.visibility !== undefined) {
    if (desired.visibility === 'team') {
      const teamId = desired.teamId ?? null;
      if (!teamId) {
        throw new HTTPException(400, { message: 'Team visibility requires a team id.' });
      }
      if (!teamIds.includes(teamId)) {
        throw new HTTPException(403, { message: 'You are not a member of the selected team.' });
      }
    }

    const sharing = await getFileSharingSummary(c.env, fileId);
    await updateFileSharing(c.env, fileId, user.id, {
      visibility: desired.visibility,
      teamId: desired.visibility === 'team' ? desired.teamId ?? sharing.team_id ?? null : null,
      permissions: (sharing.permissions ?? []).map((permission) => ({
        userId: permission.user_id,
        accessLevel: permission.access_level,
      })),
    });
  }

  const detail = await getFile(c.env, fileId, organisationId);
  if (!detail) {
    throw new HTTPException(500, { message: 'Failed to load updated file' });
  }

  c.header('Cache-Control', 'private, no-store');
  return c.json({ file: serializeFileRecord(detail) });
}

export async function handleCreateFile(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const teamIds = await listActiveTeamIdsForUser(c.env, user.id);

  const form = await parseFormData(c);

  const fileField = form.get('file');
  if (!(fileField instanceof File)) {
    throw new HTTPException(400, { message: 'Expected a file upload' });
  }

  const folderIdRaw = form.get('folderId');
  const visibilityRaw = form.get('visibility');
  const customNameRaw = form.get('name');

  const folderId = typeof folderIdRaw === 'string' ? folderIdRaw.trim() : '';
  const requestedVisibility = typeof visibilityRaw === 'string' ? (visibilityRaw.trim() as Visibility) : '';
  if (!folderId) {
    throw new HTTPException(400, { message: 'Folder is required' });
  }
  if (!ALLOWED_VISIBILITIES.includes(requestedVisibility)) {
    throw new HTTPException(400, { message: "Visibility must be personal, team, or organization" });
  }

  let folder = await getFolderById(c.env, folderId, organisationId);

  if (!folder) {
    const ownerForFolder = folderId === 'public-root' ? null : user.id;
    await ensureFolder(c.env, {
      id: folderId,
      organisationId,
      tenant: user.tenant,
      name:
        typeof form.get('folderName') === 'string' && form.get('folderName')?.trim()
          ? (form.get('folderName') as string).trim()
          : 'Untitled',
      visibility: requestedVisibility,
      ownerId: ownerForFolder,
      teamId: requestedVisibility === 'team' ? form.get('teamId')?.toString() ?? null : null,
    });
    folder = await getFolderById(c.env, folderId, organisationId);
  }

  assertFolderAccess(folder, user.id, 'write', teamIds);

  if (folder.visibility !== requestedVisibility) {
    throw new HTTPException(400, {
      message: `Folder visibility mismatch: expected '${folder.visibility}'`,
    });
  }

  if (fileField.size > MAX_UPLOAD_BYTES) {
    throw new HTTPException(400, { message: 'File exceeds the 5 MB upload limit.' });
  }

  assertTxtFile({ file_name: fileField.name, mime_type: fileField.type || null });

  const requestedName = typeof customNameRaw === 'string' && customNameRaw.trim() ? customNameRaw.trim() : fileField.name;
  const text = await fileField.text();
  if (!text.trim()) {
    throw new HTTPException(400, { message: 'Uploaded file appears to be empty.' });
  }

  const fileName = deriveTxtFileName(requestedName);

  const fileId = crypto.randomUUID();
  const objectKey = buildObjectKey({
    visibility: folder.visibility,
    ownerId: user.id,
    organizationId: organisationId,
    teamId: folder.team_id ?? null,
    folderId: folder.id,
    fileId,
    fileName,
  });

  try {
    await c.env.MARBLE_FILES.put(objectKey, text, {
      httpMetadata: { contentType: 'text/plain' },
    });
  } catch (error) {
    console.error('Failed to write object to R2', error);
    throw new HTTPException(500, { message: 'Upload to storage failed' });
  }

  await createFileRecord(c.env, {
    id: fileId,
    organisationId,
    tenant: user.tenant,
    folderId: folder.id,
    ownerId: user.id,
    teamId: folder.team_id ?? null,
    visibility: folder.visibility,
    fileName,
    r2Key: objectKey,
    size: fileField.size,
    status: 'uploading',
    mimeType: 'text/plain',
  });

  const scheduleIngestion = async () => {
    try {
      await ingestFileById(c.env, fileId, user.id);
    } catch (error) {
      console.error('Background ingestion failed', { fileId, error });
    }
  };
  if (c.executionCtx) {
    c.executionCtx.waitUntil(scheduleIngestion());
  } else {
    scheduleIngestion().catch((error) => {
      console.error('Ingestion error (no waitUntil)', { fileId, error });
    });
  }

  const detail = await getFile(c.env, fileId, organisationId);
  if (!detail) {
    throw new HTTPException(500, { message: 'Failed to load uploaded file' });
  }

  const payload = serializeFileRecord(detail);

  c.header('Cache-Control', 'private, no-store');
  return c.json({ file: payload }, 201);
}

export async function handleGetFileSharing(c: AppContext) {
  const fileId = c.req.param('id');
  const summary = await getFileSharingSummary(c.env, fileId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ sharing: summary });
}

export async function handleUpdateFileSharing(c: AppContext) {
  const user = c.get('user');
  const fileId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateFileSharingInput.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  await updateFileSharing(c.env, fileId, user.id, parsed.data);
  const summary = await getFileSharingSummary(c.env, fileId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ sharing: summary });
}
