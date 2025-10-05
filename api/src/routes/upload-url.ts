import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import { uploadUrlInput } from '../schemas';
import {
  assertFolderVisibility,
  createFileRecord,
  ensureFolder,
  getFolder,
} from '../lib/db';
import { assertTxtFile, deriveTxtFileName } from '../lib/text-conversion';
import { buildObjectKey } from '../lib/storage';
import { listActiveTeamIdsForUser } from '../lib/org';
import type { Visibility } from '../types';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function normalizeVisibility(value: Visibility): Visibility {
  if (value === 'organization' || value === 'team' || value === 'personal') {
    return value;
  }
  return 'personal';
}

export async function handleUploadUrl(c: AppContext) {
  try {
    const env = c.env;
    const user = c.get('user');
    const organisationId = user.organizationId ?? user.tenant ?? env.DEFAULT_TENANT ?? 'default';
    const teamIds = await listActiveTeamIdsForUser(env, user.id);

    const body = await c.req.json().catch(() => ({} as any));
    const parsed = uploadUrlInput.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.message });
    }

    const visibility = normalizeVisibility(parsed.data.visibility);
    const { folderId, folderName, fileName, size, mimeType } = parsed.data;
    const teamId = visibility === 'team' ? body.teamId ?? null : null;

    if (size > MAX_UPLOAD_BYTES) {
      throw new HTTPException(400, { message: 'File exceeds the 5 MB upload limit.' });
    }

    assertTxtFile({ file_name: fileName, mime_type: mimeType ?? null });

    const normalizedName = deriveTxtFileName(fileName);

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
          teamId,
        },
      );
      folder = await getFolder(env, folderId, organisationId);
    }
    if (!folder) {
      throw new HTTPException(500, { message: 'Unable to resolve folder' });
    }

    if (visibility === 'team') {
      const folderTeamId = folder.team_id ?? teamId;
      if (!folderTeamId) {
        throw new HTTPException(400, { message: 'Team uploads require a team id.' });
      }
      if (!teamIds.includes(folderTeamId)) {
        throw new HTTPException(403, { message: 'You are not a member of the selected team.' });
      }
    }

    assertFolderVisibility(folder, user.id, 'write', teamIds);

    const fileId = crypto.randomUUID();
    const key = buildObjectKey({
      visibility,
      organizationId: organisationId,
      ownerId: user.id,
      folderId,
      teamId: folder.team_id ?? teamId ?? null,
      fileId,
      fileName: normalizedName,
    });

    await createFileRecord(env, {
      id: fileId,
      organisationId,
      tenant: user.tenant,
      folderId,
      ownerId: user.id,
      visibility,
      teamId: folder.team_id ?? teamId ?? null,
      fileName: normalizedName,
      r2Key: key,
      size,
      status: 'uploading',
      mimeType: 'text/plain',
    });

    const contentType = 'text/plain';
    let urlStr: string | null = null;
    const reasons: string[] = [];

    try {
      const res = await env.MARBLE_FILES.createPresignedUrl({
        method: 'PUT',
        key,
        expiration: 900,
        httpMetadata: { contentType },
      });
      const u = (res as any)?.url;
      if (u) urlStr = typeof u === 'string' ? u : u.toString();
    } catch (e: any) {
      reasons.push(`A(expiration+httpMetadata): ${e?.message || e}`);
      console.error('Presign A failed:', e);
    }

    if (!urlStr) {
      try {
        const res = await env.MARBLE_FILES.createPresignedUrl({
          method: 'PUT',
          key,
          expires: 900,
          customHeaders: { 'content-type': contentType },
        });
        const u = (res as any)?.url;
        if (u) urlStr = typeof u === 'string' ? u : u.toString();
      } catch (e: any) {
        reasons.push(`B(expires+customHeaders): ${e?.message || e}`);
        console.error('Presign B failed:', e);
      }
    }

    if (!urlStr) {
      try {
        const res = await env.MARBLE_FILES.createPresignedUrl({
          method: 'PUT',
          key,
          expiration: 900,
        });
        const u = (res as any)?.url;
        if (u) urlStr = typeof u === 'string' ? u : u.toString();
      } catch (e: any) {
        reasons.push(`C(minimal): ${e?.message || e}`);
        console.error('Presign C failed:', e);
      }
    }

    if (!urlStr) {
      return c.json({
        error: `Failed to create upload URL for key ${key}`,
        reasons,
      }, 500);
    }

    return c.json({
      fileId,
      uploadUrl: urlStr,
      key,
    });
  } catch (err) {
    const msg =
      err instanceof HTTPException
        ? err.message
        : (err as any)?.message || String(err);
    if (err instanceof HTTPException) throw err;
    console.error('upload-url error:', err);
    throw new HTTPException(500, { message: msg });
  }
}
