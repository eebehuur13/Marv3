import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import { deleteChunkVectors } from '../lib/vectorize';
import { deleteChunksForFile, deleteFile, getFile } from '../lib/db';

export async function handleDeleteFile(c: AppContext) {
  const user = c.get('user');
  const fileId = c.req.param('id');

  const file = await getFile(c.env, fileId, user.tenant);
  if (!file) {
    throw new HTTPException(404, { message: 'File not found' });
  }

  if (file.owner_id !== user.id) {
    throw new HTTPException(403, { message: 'You can only delete your own files' });
  }

  await c.env.MARBLE_FILES.delete(file.r2_key);
  const chunkIds = await deleteChunksForFile(c.env, fileId);
  await deleteFile(c.env, fileId);
  if (chunkIds.length) {
    await deleteChunkVectors(c.env, chunkIds, file.visibility, file.owner_id);
  }

  return c.json({ deleted: true });
}
