import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import type { AuthenticatedUser } from '../types';
import { listOrganisationRoster, parseRosterText, replaceOrganisationRoster } from '../lib/org';
import { rosterUploadInput } from '../schemas';

function resolveOrganisationId(env: AppContext['env'], tenant: string | undefined, organizationId?: string): string {
  if (organizationId) return organizationId;
  if (tenant) return tenant;
  if (env.DEFAULT_TENANT) return env.DEFAULT_TENANT;
  return 'default';
}

function ensureOrgAdmin(user: AuthenticatedUser) {
  const role = user.organizationRole ?? 'member';
  if (role !== 'admin' && role !== 'owner') {
    throw new HTTPException(403, { message: 'You need organization admin access for this action.' });
  }
}

export async function handleGetRoster(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const roster = await listOrganisationRoster(c.env, organisationId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ roster });
}

export async function handleUploadRoster(c: AppContext) {
  const user = c.get('user');
  ensureOrgAdmin(user);
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);

  const body = await c.req.json().catch(() => ({}));
  const parsed = rosterUploadInput.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const entries = parseRosterText(parsed.data.text);
  if (!entries.length) {
    throw new HTTPException(400, { message: 'No valid entries found in roster file.' });
  }

  await replaceOrganisationRoster(c.env, organisationId, user.id, entries);
  const roster = await listOrganisationRoster(c.env, organisationId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ roster });
}
