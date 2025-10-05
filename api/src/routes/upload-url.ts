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

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function handleUploadUrl(c: AppContext) {
  try {
    const env = c.env;
    const user = c.get('user');

    const body = await c.req.json().catch(() => ({} as any));
    const parsed = uploadUrlInput.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.message });
    }

    const { folderId, folderName, visibility, fileName, size, mimeType } = parsed.data;

    if (size > MAX_UPLOAD_BYTES) {
      throw new HTTPException(400, { message: 'File exceeds the 5 MB upload limit.' });
    }

    assertTxtFile({ file_name: fileName, mime_type: mimeType ?? null });

    const normalizedName = deriveTxtFileName(fileName);

    let folder = await getFolder(env, folderId, user.tenant);
    if (!folder) {
      const ownerForFolder = folderId === 'public-root' ? null : user.id;
      await ensureFolder(
        env,
        {
          id: folderId,
          tenant: user.tenant,
          name: folderName,
          visibility,
          ownerId: ownerForFolder,
        },
      );
      folder = await getFolder(env, folderId, user.tenant);
    }
    if (!folder) {
      throw new HTTPException(500, { message: 'Unable to resolve folder' });
    }

    assertFolderVisibility(folder, user.id, 'write');

    const fileId = crypto.randomUUID();
    const key = buildObjectKey({
      visibility,
      ownerId: user.id,
      folderId,
      fileId,
      fileName: normalizedName,
    });

    await createFileRecord(env, {
      id: fileId,
      tenant: user.tenant,
      folderId,
      ownerId: user.id,
      visibility,
      fileName: normalizedName,
      r2Key: key,
      size,
      status: 'uploading',
      mimeType: 'text/plain',
    });

    // ---- Try presign (several variants). If all fail, return the exact reason. ----
    const contentType = 'text/plain';
    let urlStr: string | null = null;
    const reasons: string[] = [];

    // Variant A: expiration + httpMetadata.contentType
    try {
      // @ts-ignore runtime differences
      const res = await env.MARBLE_FILES.createPresignedUrl({
        method: 'PUT',
        key,
        expiration: 900,
        httpMetadata: { contentType },
      });
      const u = (res as any)?.url;
      if (u) urlStr = typeof u === 'string' ? u : u.toString();
    } catch (e: any) {
      const msg = e?.message || String(e);
      reasons.push(`A(expiration+httpMetadata): ${msg}`);
      console.error('Presign A failed:', msg);
    }

    // Variant B: expires + customHeaders["content-type"]
    if (!urlStr) {
      try {
        // @ts-ignore runtime differences
        const res = await env.MARBLE_FILES.createPresignedUrl({
          method: 'PUT',
          key,
          expires: 900,
          customHeaders: { 'content-type': contentType },
        });
        const u = (res as any)?.url;
        if (u) urlStr = typeof u === 'string' ? u : u.toString();
      } catch (e: any) {
        const msg = e?.message || String(e);
        reasons.push(`B(expires+customHeaders): ${msg}`);
        console.error('Presign B failed:', msg);
      }
    }

    // Variant C: minimal (no header constraints)
    if (!urlStr) {
      try {
        // @ts-ignore runtime differences
        const res = await env.MARBLE_FILES.createPresignedUrl({
          method: 'PUT',
          key,
          expiration: 900,
        });
        const u = (res as any)?.url;
        if (u) urlStr = typeof u === 'string' ? u : u.toString();
      } catch (e: any) {
        const msg = e?.message || String(e);
        reasons.push(`C(minimal): ${msg}`);
        console.error('Presign C failed:', msg);
      }
    }

    if (!urlStr) {
      // Return the detailed reasons so you can see the *real* R2 error in curl/UI
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
    if (!(err instanceof HTTPException)) {
      console.error('upload-url error:', err);
    }
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(500, { message: msg });
  }
}
