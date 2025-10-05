import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import { directoryQuerySchema } from '../schemas';
import { searchDirectory } from '../lib/org';

function resolveOrganisationId(env: AppContext['env'], tenant: string | undefined, organizationId?: string): string {
  if (organizationId) return organizationId;
  if (tenant) return tenant;
  if (env.DEFAULT_TENANT) return env.DEFAULT_TENANT;
  return 'default';
}

export async function handleDirectorySearch(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const parsed = directoryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }
  const limit = parsed.data.limit ?? 50;
  const query = parsed.data.q ?? '';
  const results = await searchDirectory(c.env, organisationId, query, limit);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ results });
}
