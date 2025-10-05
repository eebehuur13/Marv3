import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import type { AuthenticatedUser } from '../types';
import {
  createTeam,
  getTeamMember,
  getTeamWithMembers,
  inviteTeamMember,
  listActiveTeamIdsForUser,
  listTeamsWithMembers,
  removeTeamMember,
  updateTeamMemberRole,
  acceptTeamInvite,
} from '../lib/org';
import { createTeamInput, inviteTeamMembersInput, updateTeamMemberRoleInput } from '../schemas';

function resolveOrganisationId(env: AppContext['env'], tenant: string | undefined, organizationId?: string): string {
  if (organizationId) return organizationId;
  if (tenant) return tenant;
  if (env.DEFAULT_TENANT) return env.DEFAULT_TENANT;
  return 'default';
}

function ensureOrgManager(user: AuthenticatedUser) {
  const role = user.organizationRole ?? 'member';
  if (role !== 'admin' && role !== 'owner') {
    throw new HTTPException(403, { message: 'Organization admin permissions required.' });
  }
}

function ensureTeamManager(user: AuthenticatedUser, membershipRole: string | null) {
  const orgRole = user.organizationRole ?? 'member';
  if (orgRole === 'owner' || orgRole === 'admin') {
    return;
  }
  if (membershipRole === 'owner' || membershipRole === 'manager') {
    return;
  }
  throw new HTTPException(403, { message: 'Team manager permissions required.' });
}

export async function handleListTeams(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const teams = await listTeamsWithMembers(c.env, organisationId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ teams });
}

export async function handleCreateTeam(c: AppContext) {
  const user = c.get('user');
  ensureOrgManager(user);
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const body = await c.req.json().catch(() => ({}));
  const parsed = createTeamInput.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const team = await createTeam(c.env, organisationId, user.id, parsed.data);
  const summary = await getTeamWithMembers(c.env, team.id);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ team: summary ?? team }, 201);
}

async function assertTeamInOrganisation(env: AppContext['env'], teamId: string, organisationId: string) {
  const team = await getTeamWithMembers(env, teamId);
  if (!team || team.organisation_id !== organisationId) {
    throw new HTTPException(404, { message: 'Team not found' });
  }
  return team;
}

async function ensureInviteesBelongToOrg(env: AppContext['env'], organisationId: string, userIds: string[]) {
  if (!userIds.length) return;
  const placeholders = userIds.map((_, index) => `?${index + 2}`).join(',');
  const existing = await env.MARBLE_DB.prepare(
    `SELECT id FROM users WHERE organization_id = ?1 AND id IN (${placeholders})`,
  )
    .bind(organisationId, ...userIds)
    .all<{ id: string }>();
  const foundIds = new Set((existing.results ?? []).map((row) => row.id));
  for (const id of userIds) {
    if (!foundIds.has(id)) {
      throw new HTTPException(400, { message: 'All invited members must belong to this organization.' });
    }
  }
}

export async function handleInviteMembers(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const teamId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = inviteTeamMembersInput.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const team = await assertTeamInOrganisation(c.env, teamId, organisationId);
  const membership = await getTeamMember(c.env, teamId, user.id);
  ensureTeamManager(user, membership?.role ?? null);

  await ensureInviteesBelongToOrg(c.env, organisationId, parsed.data.userIds);
  for (const userId of parsed.data.userIds) {
    await inviteTeamMember(c.env, teamId, userId, user.id);
  }

  const summary = await getTeamWithMembers(c.env, teamId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ team: summary });
}

export async function handleAcceptInvite(c: AppContext) {
  const user = c.get('user');
  const teamId = c.req.param('id');
  await acceptTeamInvite(c.env, teamId, user.id);
  const summary = await getTeamWithMembers(c.env, teamId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ team: summary });
}

export async function handleUpdateMemberRole(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const teamId = c.req.param('id');
  const memberId = c.req.param('userId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateTeamMemberRoleInput.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  await assertTeamInOrganisation(c.env, teamId, organisationId);
  const membership = await getTeamMember(c.env, teamId, user.id);
  ensureTeamManager(user, membership?.role ?? null);

  await updateTeamMemberRole(c.env, teamId, memberId, parsed.data.role);
  const summary = await getTeamWithMembers(c.env, teamId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ team: summary });
}

export async function handleRemoveMember(c: AppContext) {
  const user = c.get('user');
  const organisationId = resolveOrganisationId(c.env, user.tenant, user.organizationId);
  const teamId = c.req.param('id');
  const memberId = c.req.param('userId');

  await assertTeamInOrganisation(c.env, teamId, organisationId);
  const membership = await getTeamMember(c.env, teamId, user.id);
  ensureTeamManager(user, membership?.role ?? null);

  await removeTeamMember(c.env, teamId, memberId);
  const summary = await getTeamWithMembers(c.env, teamId);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ team: summary });
}
