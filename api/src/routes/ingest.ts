import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import { getFile } from '../lib/db';
import { ingestInput } from '../schemas';
import { ingestFileById } from '../lib/ingestion';

export async function handleIngest(c: AppContext) {
  const user = c.get('user');
  const input = await c.req.json();
  const parsed = ingestInput.safeParse(input);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const file = await getFile(c.env, parsed.data.fileId, user.tenant);
  if (!file) {
    throw new HTTPException(404, { message: 'File not found' });
  }

  if (file.owner_id !== user.id) {
    throw new HTTPException(403, { message: 'You can only ingest your own files' });
  }

  const result = await ingestFileById(c.env, file.id, user.id);
  return c.json(result);
}
