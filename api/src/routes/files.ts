import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import {
  assertFolderAccess,
  createFileRecord,
  ensureFolder,
  getFile,
  getFolderById,
  listFiles,
} from '../lib/db';
import { listFilesQuery } from '../schemas';
import { buildObjectKey } from '../lib/storage';
import type { Visibility } from '../types';
import { ingestFileById } from '../lib/ingestion';
import {
  convertToPlainText,
  deriveTxtFileName,
  TextConversionError,
} from '../lib/text-conversion';

const ALLOWED_VISIBILITIES: Visibility[] = ['public', 'private'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB upper bound keeps conversion predictable

async function parseFormData(c: AppContext) {
  try {
    return await c.req.formData();
  } catch (err) {
    console.error('Failed to parse form data', err);
    throw new HTTPException(400, { message: 'Invalid multipart payload' });
  }
}

export async function handleListFiles(c: AppContext) {
  const user = c.get('user');
  const query = c.req.query();
  const parsed = listFilesQuery.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const folderId = parsed.data.folder_id ?? (typeof query.folderId === 'string' ? query.folderId : undefined);
  const normalizedVisibility = parsed.data.visibility ?? 'all';

  const files = await listFiles(c.env, {
    tenant: user.tenant,
    ownerId: user.id,
    folderId: folderId,
    visibility: normalizedVisibility,
  });

  const payload = files.map((file) => ({
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
    },
    owner: {
      id: file.owner_id,
      email: file.owner_email,
      displayName: file.owner_display_name,
    },
    createdAt: file.created_at,
    updatedAt: file.updated_at,
  }));

  c.header('Cache-Control', 'private, no-store');
  return c.json({ files: payload });
}

export async function handleCreateFile(c: AppContext) {
  const user = c.get('user');
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
    throw new HTTPException(400, { message: "Visibility must be 'public' or 'private'" });
  }

  let folder = await getFolderById(c.env, folderId, user.tenant);

  if (!folder) {
    await ensureFolder(c.env, {
      id: folderId,
      tenant: user.tenant,
      name: typeof form.get('folderName') === 'string' && form.get('folderName')?.trim()
        ? (form.get('folderName') as string).trim()
        : 'Untitled',
      visibility: requestedVisibility,
      ownerId: requestedVisibility === 'public' ? null : user.id,
    });
    folder = await getFolderById(c.env, folderId, user.tenant);
  }

  assertFolderAccess(folder, user.id);

  if (folder.visibility !== requestedVisibility) {
    throw new HTTPException(400, {
      message: `Folder visibility mismatch: expected '${folder.visibility}'`,
    });
  }

  if (fileField.size > MAX_UPLOAD_BYTES) {
    throw new HTTPException(400, { message: 'File exceeds the 5 MB upload limit.' });
  }

  const requestedName = typeof customNameRaw === 'string' && customNameRaw.trim() ? customNameRaw.trim() : fileField.name;
  const arrayBuffer = await fileField.arrayBuffer();

  let conversion;
  try {
    conversion = await convertToPlainText({
      arrayBuffer,
      fileName: fileField.name,
      mimeType: fileField.type,
    });
  } catch (error) {
    if (error instanceof TextConversionError) {
      throw new HTTPException(400, { message: error.message });
    }
    console.error('File conversion failed', error);
    throw new HTTPException(500, { message: 'Failed to convert the uploaded file to text.' });
  }

  if (!conversion.text.trim()) {
    throw new HTTPException(400, { message: 'File appears to be empty after conversion.' });
  }

  const fileName = deriveTxtFileName(requestedName);

  const fileId = crypto.randomUUID();
  const objectKey = buildObjectKey({
    visibility: folder.visibility,
    ownerId: user.id,
    folderId: folder.id,
    fileId,
    fileName,
  });

  try {
    await c.env.MARBLE_FILES.put(objectKey, conversion.text, {
      httpMetadata: { contentType: 'text/plain' },
    });
  } catch (error) {
    console.error('Failed to write object to R2', error);
    throw new HTTPException(500, { message: 'Upload to storage failed' });
  }

  await createFileRecord(c.env, {
    id: fileId,
    tenant: user.tenant,
    folderId: folder.id,
    ownerId: user.id,
    visibility: folder.visibility,
    fileName,
    r2Key: objectKey,
    size: conversion.bytes,
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

  const detail = await getFile(c.env, fileId, user.tenant);
  if (!detail) {
    throw new HTTPException(500, { message: 'Failed to load uploaded file' });
  }

  const payload = {
    id: detail.id,
    name: detail.file_name,
    visibility: detail.visibility,
    status: detail.status,
    size: detail.size,
    mimeType: detail.mime_type,
    folder: {
      id: detail.folder_id,
      name: detail.folder_name,
      visibility: detail.folder_visibility,
    },
    owner: {
      id: detail.owner_id,
      email: detail.owner_email,
      displayName: detail.owner_display_name,
    },
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
  };

  c.header('Cache-Control', 'private, no-store');
  return c.json({ file: payload }, 201);
}
