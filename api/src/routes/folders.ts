import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, AppContext } from '../context';
import {
  assertFolderAccess,
  createFolder,
  deleteFolder,
  deleteFile,
  deleteChunksForFile,
  getFolderById,
  listFiles,
  listFolders,
  updateFolder,
  type FolderSummaryRow,
  type FolderWithOwner,
} from '../lib/db';
import { deleteChunkVectors } from '../lib/vectorize';
import { createFolderInput, listFoldersQuery, updateFolderInput } from '../schemas';

function serializeFolder(folder: FolderSummaryRow | (FolderWithOwner & { file_count?: number })) {
  return {
    id: folder.id,
    name: folder.name,
    visibility: folder.visibility,
    fileCount: folder.file_count ?? 0,
    owner: folder.owner_email
      ? {
          id: folder.owner_id,
          email: folder.owner_email,
          displayName: folder.owner_display_name,
        }
      : null,
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  };
}

async function handleList(c: AppContext) {
  const user = c.get('user');
  const query = listFoldersQuery.safeParse(c.req.query());
  if (!query.success) {
    throw new HTTPException(400, { message: query.error.message });
  }

  const folders = await listFolders(c.env, {
    tenant: user.tenant,
    ownerId: user.id,
    visibility: query.data.visibility ?? 'all',
  });

  c.header('Cache-Control', 'private, no-store');
  return c.json({
    folders: folders.map(serializeFolder),
  });
}

async function handleCreate(c: AppContext) {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createFolderInput.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const id = crypto.randomUUID();
  await createFolder(c.env, {
    id,
    tenant: user.tenant,
    ownerId: user.id,
    name: parsed.data.name,
    visibility: parsed.data.visibility,
  });

  const detail = await getFolderById(c.env, id, user.tenant);
  if (!detail) {
    throw new HTTPException(500, { message: 'Failed to create folder' });
  }

  c.header('Cache-Control', 'private, no-store');
  return c.json(
    {
      folder: serializeFolder({ ...detail, file_count: 0 }),
    },
    201,
  );
}

async function handleUpdate(c: AppContext) {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateFolderInput.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const { next } = await updateFolder(c.env, {
    id,
    tenant: user.tenant,
    ownerId: user.id,
    name: parsed.data.name,
    visibility: parsed.data.visibility,
  });

  const [summary] = await listFolders(c.env, {
    tenant: user.tenant,
    ownerId: user.id,
    visibility: 'all',
  }).then((folders) => folders.filter((folder) => folder.id === id));

  c.header('Cache-Control', 'private, no-store');
  return c.json({
    folder: summary
      ? serializeFolder(summary)
      : serializeFolder({ ...next, file_count: 0 }),
  });
}

async function handleDetail(c: AppContext) {
  const user = c.get('user');
  const id = c.req.param('id');
  const folder = await getFolderById(c.env, id, user.tenant);
  assertFolderAccess(folder, user.id);

  c.header('Cache-Control', 'private, no-store');
  return c.json({
    folder: folder
      ? {
          id: folder.id,
          name: folder.name,
          visibility: folder.visibility,
          createdAt: folder.created_at,
          updatedAt: folder.updated_at,
          owner: folder.owner_email
            ? { id: folder.owner_id, email: folder.owner_email, displayName: folder.owner_display_name }
            : null,
        }
      : null,
  });
}

export function registerFolderRoutes(api: Hono<AppEnv>) {
  api.get('/folders', handleList);
  api.get('/folders/:id', handleDetail);
  api.post('/folders', handleCreate);
  api.patch('/folders/:id', handleUpdate);
  api.delete('/folders/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const folder = await getFolderById(c.env, id, user.tenant);
    if (!folder || folder.deleted_at) {
      throw new HTTPException(404, { message: 'Folder not found' });
    }

    if (folder.visibility === 'public') {
      throw new HTTPException(403, { message: 'Shared folders are managed centrally and cannot be deleted.' });
    }

    if (folder.id === 'public-root' || folder.id === 'private-root') {
      throw new HTTPException(403, { message: 'System folders cannot be removed.' });
    }

    if (folder.owner_id && folder.owner_id !== user.id) {
      throw new HTTPException(403, { message: 'You can only delete folders you own.' });
    }

    const files = await listFiles(c.env, {
      tenant: user.tenant,
      ownerId: user.id,
      folderId: id,
      visibility: 'all',
    });

    let removedFiles = 0;
    for (const file of files) {
      if (file.owner_id !== user.id) {
        continue;
      }

      try {
        await c.env.MARBLE_FILES.delete(file.r2_key);
      } catch (error) {
        console.error('Failed to delete file object during folder removal', {
          fileId: file.id,
          folderId: id,
          error,
        });
      }

      const chunkIds = await deleteChunksForFile(c.env, file.id);
      await deleteFile(c.env, file.id);
      if (chunkIds.length) {
        await deleteChunkVectors(c.env, chunkIds, file.visibility, file.owner_id);
      }
      removedFiles += 1;
    }

    await deleteFolder(c.env, { id, tenant: user.tenant, ownerId: user.id, force: true });

    c.header('Cache-Control', 'private, no-store');
    return c.json({ deleted: true, removedFiles });
  });
}
