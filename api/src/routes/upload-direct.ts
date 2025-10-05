import type { AppContext } from '../context';
import { HTTPException } from 'hono/http-exception';
import {
  assertFolderVisibility,
  createFileRecord,
  ensureFolder,
  getFolder,
} from '../lib/db';
import { ingestFileById } from '../lib/ingestion';
import { buildObjectKey } from '../lib/storage';
import type { Visibility } from '../types';
import { listActiveTeamIdsForUser } from '../lib/org';

function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9.-]/g, '')
    .toLowerCase();
}

function normalizeVisibility(value: string | null): Visibility {
  const lowered = (value ?? '').toLowerCase();
  if (lowered === 'organization' || lowered === 'organisation' || lowered === 'public' || lowered === 'org') {
    return 'organization';
  }
  if (lowered === 'team') {
    return 'team';
  }
  return 'personal';
}

// Accepts raw text body. Query params: folderId, folderName, visibility, fileName, size
export async function handleUploadDirect(c: AppContext) {
  const env = c.env;
  const user = c.get('user');
  const organisationId = user.organizationId ?? user.tenant ?? env.DEFAULT_TENANT ?? 'default';
  const teamIds = await listActiveTeamIdsForUser(env, user.id);

  const url = new URL(c.req.url);
  const folderId = url.searchParams.get('folderId') || '';
  const folderName = url.searchParams.get('folderName') || '';
  const visibility = normalizeVisibility(url.searchParams.get('visibility'));
  const teamIdParam = url.searchParams.get('teamId');
  const fileName = url.searchParams.get('fileName') || '';
  const sizeParam = url.searchParams.get('size');

  if (!folderId || !folderName || !fileName) {
    throw new HTTPException(400, { message: 'Missing required query params' });
  }
  if (!fileName.toLowerCase().endsWith('.txt')) {
    throw new HTTPException(400, { message: 'Only .txt files are supported' });
  }

  let folder = await getFolder(env, folderId, organisationId);
  if (!folder) {
    const ownerForFolder = folderId === 'public-root' ? null : user.id;
    await ensureFolder(
      env,
      {
        id: folderId,
        organisationId,
        tenant: user.tenant,
        name: folderName,
        visibility,
        ownerId: ownerForFolder,
        teamId: visibility === 'team' ? teamIdParam ?? null : null,
      },
    );
    folder = await getFolder(env, folderId, organisationId);
  }
  if (!folder) {
    throw new HTTPException(500, { message: 'Unable to resolve folder' });
  }

  if (visibility === 'team') {
    const teamId = folder.team_id ?? teamIdParam ?? null;
    if (!teamId) {
      throw new HTTPException(400, { message: 'Team uploads require a team id.' });
    }
    if (!teamIds.includes(teamId)) {
      throw new HTTPException(403, { message: 'You are not a member of that team.' });
    }
  }

  assertFolderVisibility(folder, user.id, 'write', teamIds);

  const fileId = crypto.randomUUID();
  const safeName = sanitizeFileName(fileName);
  const key = buildObjectKey({
    visibility,
    organizationId: organisationId,
    ownerId: user.id,
    folderId,
    teamId: folder.team_id ?? teamIdParam ?? null,
    fileId,
    fileName: safeName,
  });

  const text = await c.req.text(); // raw text body
  const contentType = 'text/plain';

  try {
    await env.MARBLE_FILES.put(key, text, {
      httpMetadata: { contentType },
    });
  } catch (e: any) {
    console.error('R2 put error:', e?.message || e);
    throw new HTTPException(500, { message: 'Failed to upload to R2' });
  }

  const fileSize = sizeParam ? Number.parseInt(sizeParam, 10) || text.length : text.length;

  await createFileRecord(env, {
    id: fileId,
    organisationId,
    tenant: user.tenant,
    folderId,
    ownerId: user.id,
    visibility,
    teamId: folder.team_id ?? teamIdParam ?? null,
    fileName,
    r2Key: key,
    size: fileSize,
    status: 'uploading',
    mimeType: contentType,
  });

  const triggerIngestion = async () => {
    try {
      await ingestFileById(env, fileId, user.id);
    } catch (error) {
      console.error('Background ingestion failed (upload-direct)', { fileId, error });
    }
  };
  if (c.executionCtx) {
    c.executionCtx.waitUntil(triggerIngestion());
  } else {
    triggerIngestion().catch((error) => {
      console.error('Ingestion error (no waitUntil)', { fileId, error });
    });
  }

  return c.json({ fileId, key, uploaded: true });
}
