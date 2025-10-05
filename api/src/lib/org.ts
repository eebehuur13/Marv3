import { HTTPException } from 'hono/http-exception';
import type {
  FileAccessLevel,
  MarbleBindings,
  OrganisationRosterEntry,
  TeamMemberRecord,
  TeamMemberStatus,
  TeamRecord,
  Visibility,
} from '../types';

interface ParsedRosterEntry {
  email: string;
  displayName: string | null;
  role: 'member' | 'admin' | 'owner';
}

interface TeamMemberWithUser extends TeamMemberRecord {
  email: string;
  display_name: string | null;
  username: string | null;
}

export interface TeamSummary extends TeamRecord {
  members: TeamMemberWithUser[];
}

export interface DirectoryEntry {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  title: string | null;
  organization_role: string | null;
  teams: string[];
}

export interface FilePermissionSummary {
  user_id: string;
  access_level: FileAccessLevel;
  email: string;
  display_name: string | null;
}

export interface FileSharingSummary {
  id: string;
  visibility: Visibility;
  team_id: string | null;
  permissions: FilePermissionSummary[];
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseRosterLine(line: string): ParsedRosterEntry | null {
  const stripped = line.trim();
  if (!stripped || stripped.startsWith('#')) {
    return null;
  }

  let role: ParsedRosterEntry['role'] = 'member';
  let working = stripped;

  const roleMatch = stripped.match(/[,|\s]+(member|admin|owner)$/i);
  if (roleMatch && roleMatch.index !== undefined) {
    role = roleMatch[1].toLowerCase() as ParsedRosterEntry['role'];
    working = stripped.slice(0, roleMatch.index).trim();
  }

  let email = working;
  let displayName: string | null = null;

  const angled = working.match(/^(.*?)<([^>]+)>$/);
  if (angled) {
    displayName = angled[1].trim() || null;
    email = angled[2].trim();
  } else {
    const tokens = working.split(/[\s,;]+/).filter(Boolean);
    const maybeEmail = tokens.pop();
    if (maybeEmail) {
      email = maybeEmail;
    }
    if (tokens.length) {
      displayName = tokens.join(' ').trim() || null;
    }
  }

  email = normalizeEmail(email);
  if (!email || !email.includes('@')) {
    return null;
  }

  return { email, displayName, role };
}

export function parseRosterText(text: string): ParsedRosterEntry[] {
  const entries = text
    .split(/\r?\n/)
    .map(parseRosterLine)
    .filter(Boolean) as ParsedRosterEntry[];

  const map = new Map<string, ParsedRosterEntry>();
  for (const entry of entries) {
    if (!map.has(entry.email)) {
      map.set(entry.email, entry);
    }
  }
  return Array.from(map.values());
}
export async function replaceOrganisationRoster(
  env: MarbleBindings,
  organisationId: string,
  uploadedBy: string,
  entries: ParsedRosterEntry[],
): Promise<void> {
  const now = new Date().toISOString();

  const existing = await env.MARBLE_DB.prepare(
    `SELECT id, email FROM organisation_roster WHERE organisation_id = ?1`,
  )
    .bind(organisationId)
    .all<{ id: string; email: string }>();
  const existingMap = new Map((existing.results ?? []).map((row) => [normalizeEmail(row.email), row]));

  const seen = new Set<string>();
  for (const entry of entries) {
    seen.add(entry.email);
    const rosterId = existingMap.get(entry.email)?.id ?? crypto.randomUUID();
    await env.MARBLE_DB.prepare(
      `INSERT INTO organisation_roster (id, organisation_id, email, display_name, role, status, invited_by, invited_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?8)
       ON CONFLICT(organisation_id, email) DO UPDATE SET
         display_name = excluded.display_name,
         role = excluded.role,
         status = CASE
           WHEN organisation_roster.status = 'active' THEN 'active'
           WHEN organisation_roster.status = 'invited' THEN 'invited'
           ELSE organisation_roster.status
         END,
         updated_at = CURRENT_TIMESTAMP`
    )
      .bind(rosterId, organisationId, entry.email, entry.displayName, entry.role, uploadedBy, now, now)
      .run();
  }

  const toRemove = (existing.results ?? []).filter((row) => !seen.has(normalizeEmail(row.email)));
  for (const row of toRemove) {
    await env.MARBLE_DB.prepare(
      `UPDATE organisation_roster
       SET status = 'removed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    )
      .bind(row.id)
      .run();
  }
}

export async function listOrganisationRoster(env: MarbleBindings, organisationId: string): Promise<Array<OrganisationRosterEntry & { user_email: string | null; user_display_name: string | null }>> {
  const results = await env.MARBLE_DB.prepare(
    `SELECT
       r.id,
       r.organisation_id,
       r.user_id,
       r.email,
       r.display_name,
       r.role,
       r.status,
       r.invited_by,
       r.invited_at,
       r.joined_at,
       r.created_at,
       r.updated_at,
       u.email AS user_email,
       u.display_name AS user_display_name
     FROM organisation_roster r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.organisation_id = ?1
     ORDER BY r.status DESC, lower(r.email)`,
  )
    .bind(organisationId)
    .all<OrganisationRosterEntry & { user_email: string | null; user_display_name: string | null }>();
  return results.results ?? [];
}
function slugifyTeamName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function ensureUniqueTeamSlug(env: MarbleBindings, organisationId: string, base: string): Promise<string> {
  const canonical = base || 'team';
  const slugs = await env.MARBLE_DB.prepare(
    `SELECT slug FROM teams WHERE organisation_id = ?1`,
  )
    .bind(organisationId)
    .all<{ slug: string }>();
  const taken = new Set((slugs.results ?? []).map((row) => row.slug));

  if (!taken.has(canonical)) {
    return canonical;
  }
  let counter = 2;
  while (taken.has(`${canonical}-${counter}`)) {
    counter += 1;
  }
  return `${canonical}-${counter}`;
}
export async function createTeam(
  env: MarbleBindings,
  organisationId: string,
  creatorId: string,
  data: { name: string; description?: string | null },
): Promise<TeamRecord> {
  const existing = await env.MARBLE_DB.prepare(
    `SELECT team_id
     FROM team_members
     WHERE user_id = ?1 AND status = 'active'
     LIMIT 1`,
  )
    .bind(creatorId)
    .first<{ team_id: string }>();

  if (existing) {
    throw new HTTPException(400, {
      message: 'You already belong to a team. Leave it before creating a new one.',
    });
  }

  const trimmed = data.name.trim();
  if (!trimmed) {
    throw new HTTPException(400, { message: 'Team name is required' });
  }
  const slug = await ensureUniqueTeamSlug(env, organisationId, slugifyTeamName(trimmed));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.MARBLE_DB.prepare(
    `INSERT INTO teams (id, organisation_id, name, slug, description, owner_id, created_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?7)`
  )
    .bind(id, organisationId, trimmed, slug, data.description ?? null, creatorId, now)
    .run();

  await env.MARBLE_DB.prepare(
    `INSERT INTO team_members (team_id, user_id, role, status, invited_by, invited_at, joined_at, created_at, updated_at)
     VALUES (?1, ?2, 'owner', 'active', ?2, ?3, ?3, ?3, ?3)
     ON CONFLICT(team_id, user_id) DO UPDATE SET
       role = 'owner',
       status = 'active',
       joined_at = COALESCE(team_members.joined_at, excluded.joined_at),
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(id, creatorId, now)
    .run();

  const created = await env.MARBLE_DB.prepare(
    `SELECT id, organisation_id, name, slug, description, owner_id, created_by, created_at, updated_at
     FROM teams WHERE id = ?1`,
  )
    .bind(id)
    .first<TeamRecord>();
  if (!created) {
    throw new HTTPException(500, { message: 'Failed to create team' });
  }
  return created;
}

export async function listTeamsWithMembers(env: MarbleBindings, organisationId: string): Promise<TeamSummary[]> {
  const teams = await env.MARBLE_DB.prepare(
    `SELECT id, organisation_id, name, slug, description, owner_id, created_by, created_at, updated_at
     FROM teams
     WHERE organisation_id = ?1
     ORDER BY lower(name)`
  )
    .bind(organisationId)
    .all<TeamRecord>();
  const results = teams.results ?? [];
  if (!results.length) {
    return [];
  }

  const teamIds = results.map((team) => team.id);
  const placeholders = teamIds.map((_, index) => `?${index + 1}`).join(',');
  const members = await env.MARBLE_DB.prepare(
    `SELECT
       tm.team_id,
       tm.user_id,
       tm.role,
       tm.status,
       tm.invited_by,
       tm.invited_at,
       tm.joined_at,
       tm.created_at,
       tm.updated_at,
       u.email,
       u.display_name,
       u.username
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id IN (${placeholders})
     ORDER BY tm.team_id, lower(u.display_name)`,
  )
    .bind(...teamIds)
    .all<TeamMemberWithUser>();

  const grouped = new Map<string, TeamMemberWithUser[]>();
  for (const member of members.results ?? []) {
    const bucket = grouped.get(member.team_id);
    if (bucket) {
      bucket.push(member);
    } else {
      grouped.set(member.team_id, [member]);
    }
  }

  return results.map((team) => ({
    ...team,
    members: grouped.get(team.id) ?? [],
  }));
}
export async function listActiveTeamIdsForUser(env: MarbleBindings, userId: string): Promise<string[]> {
  const results = await env.MARBLE_DB.prepare(
    `SELECT team_id FROM team_members WHERE user_id = ?1 AND status = 'active'`,
  )
    .bind(userId)
    .all<{ team_id: string }>();
  return (results.results ?? []).map((row) => row.team_id);
}

export async function inviteTeamMember(
  env: MarbleBindings,
  teamId: string,
  userId: string,
  invitedBy: string,
): Promise<void> {
  const existing = await env.MARBLE_DB.prepare(
    `SELECT tm.team_id, tm.status
     FROM team_members tm
     WHERE tm.user_id = ?1 AND tm.team_id != ?2 AND tm.status IN ('pending', 'active')
     LIMIT 1`,
  )
    .bind(userId, teamId)
    .first<{ team_id: string; status: TeamMemberStatus }>();

  if (existing) {
    throw new HTTPException(400, {
      message: existing.status === 'active'
        ? 'User already belongs to another team.'
        : 'User already has a pending invitation from another team.',
    });
  }

  const now = new Date().toISOString();
  await env.MARBLE_DB.prepare(
    `INSERT INTO team_members (team_id, user_id, role, status, invited_by, invited_at, created_at, updated_at)
     VALUES (?1, ?2, 'member', 'pending', ?3, ?4, ?4, ?4)
     ON CONFLICT(team_id, user_id) DO UPDATE SET
       invited_by = excluded.invited_by,
       invited_at = excluded.invited_at,
       status = CASE WHEN team_members.status = 'active' THEN team_members.status ELSE 'pending' END,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(teamId, userId, invitedBy, now)
    .run();
}

export async function acceptTeamInvite(env: MarbleBindings, teamId: string, userId: string): Promise<void> {
  const existing = await env.MARBLE_DB.prepare(
    `SELECT tm.team_id, tm.status
     FROM team_members tm
     WHERE tm.user_id = ?1 AND tm.team_id != ?2 AND tm.status = 'active'
     LIMIT 1`,
  )
    .bind(userId, teamId)
    .first<{ team_id: string }>();

  if (existing) {
    throw new HTTPException(400, {
      message: 'You already belong to another team. Leave your current team before accepting a new invite.',
    });
  }

  const now = new Date().toISOString();
  const result = await env.MARBLE_DB.prepare(
    `UPDATE team_members
     SET status = 'active',
         joined_at = COALESCE(joined_at, ?3),
         updated_at = CURRENT_TIMESTAMP
     WHERE team_id = ?1 AND user_id = ?2`,
  )
    .bind(teamId, userId, now)
    .run();
  if ((result as any)?.meta?.changes === 0) {
    throw new HTTPException(404, { message: 'Invitation not found' });
  }
}

export async function updateTeamMemberRole(env: MarbleBindings, teamId: string, userId: string, role: 'member' | 'manager' | 'owner'): Promise<void> {
  const result = await env.MARBLE_DB.prepare(
    `UPDATE team_members
     SET role = ?3,
         updated_at = CURRENT_TIMESTAMP
     WHERE team_id = ?1 AND user_id = ?2`,
  )
    .bind(teamId, userId, role)
    .run();
  if ((result as any)?.meta?.changes === 0) {
    throw new HTTPException(404, { message: 'Team member not found' });
  }
}

export async function removeTeamMember(env: MarbleBindings, teamId: string, userId: string): Promise<void> {
  await env.MARBLE_DB.prepare(
    `UPDATE team_members
     SET status = 'removed',
         updated_at = CURRENT_TIMESTAMP
     WHERE team_id = ?1 AND user_id = ?2`,
  )
    .bind(teamId, userId)
    .run();
}
export async function searchDirectory(
  env: MarbleBindings,
  organisationId: string,
  query: string,
  limit = 50,
): Promise<DirectoryEntry[]> {
  const normalized = query.trim().toLowerCase();
  const like = `%${normalized}%`;
  const results = await env.MARBLE_DB.prepare(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.username,
       u.title,
       u.organization_role,
       GROUP_CONCAT(DISTINCT t.name) AS teams
     FROM users u
     LEFT JOIN team_members tm ON tm.user_id = u.id AND tm.status = 'active'
     LEFT JOIN teams t ON t.id = tm.team_id
     WHERE u.organization_id = ?1
       AND (
         ?2 = '' OR
         lower(u.email) LIKE ?3 OR
         lower(COALESCE(u.display_name, '')) LIKE ?3 OR
         lower(COALESCE(u.username, '')) LIKE ?3
       )
     GROUP BY u.id
     ORDER BY lower(COALESCE(u.display_name, u.email))
     LIMIT ?4`,
  )
    .bind(organisationId, normalized, like, limit)
    .all<DirectoryEntry & { teams: string | null }>();

  return (results.results ?? []).map((row) => ({
    ...row,
    teams: row.teams ? row.teams.split(',') : [],
  }));
}
export async function getFileSharingSummary(env: MarbleBindings, fileId: string): Promise<FileSharingSummary> {
  const file = await env.MARBLE_DB.prepare(
    `SELECT id, visibility, team_id FROM files WHERE id = ?1`,
  )
    .bind(fileId)
    .first<{ id: string; visibility: Visibility; team_id: string | null }>();
  if (!file) {
    throw new HTTPException(404, { message: 'File not found' });
  }

  const permissions = await env.MARBLE_DB.prepare(
    `SELECT fp.user_id, fp.access_level, u.email, u.display_name
     FROM file_permissions fp
     JOIN users u ON u.id = fp.user_id
     WHERE fp.file_id = ?1
     ORDER BY lower(u.display_name)`
  )
    .bind(fileId)
    .all<FilePermissionSummary>();

  return {
    id: file.id,
    visibility: file.visibility,
    team_id: file.team_id,
    permissions: permissions.results ?? [],
  };
}

export async function updateFileSharing(
  env: MarbleBindings,
  fileId: string,
  actingUserId: string,
  data: { visibility: Visibility; teamId?: string | null; permissions: Array<{ userId: string; accessLevel: FileAccessLevel }> },
): Promise<void> {
  if (data.visibility === 'team' && !data.teamId) {
    throw new HTTPException(400, { message: 'Team visibility requires a team id.' });
  }
  const now = new Date().toISOString();
  const teamId = data.visibility === 'team' ? data.teamId ?? null : null;

  const updateResult = await env.MARBLE_DB.prepare(
    `UPDATE files
     SET visibility = ?2,
         team_id = ?3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1`,
  )
    .bind(fileId, data.visibility, teamId)
    .run();
  if ((updateResult as any)?.meta?.changes === 0) {
    throw new HTTPException(404, { message: 'File not found' });
  }

  await env.MARBLE_DB.prepare(
    `UPDATE chunks
     SET visibility = ?2,
         team_id = ?3
     WHERE file_id = ?1`,
  )
    .bind(fileId, data.visibility, teamId)
    .run();

  const uniquePermissions = new Map<string, FileAccessLevel>();
  for (const permission of data.permissions) {
    const level = permission.accessLevel;
    if (level !== 'viewer' && level !== 'editor') {
      throw new HTTPException(400, { message: `Unsupported access level: ${level}` });
    }
    uniquePermissions.set(permission.userId, level);
  }

  const keepIds = Array.from(uniquePermissions.keys());
  if (keepIds.length) {
    const placeholders = keepIds.map((_, index) => `?${index + 2}`).join(',');
    await env.MARBLE_DB.prepare(
      `DELETE FROM file_permissions
       WHERE file_id = ?1
         AND user_id NOT IN (${placeholders})`,
    )
      .bind(fileId, ...keepIds)
      .run();
  } else {
    await env.MARBLE_DB.prepare(`DELETE FROM file_permissions WHERE file_id = ?1`).bind(fileId).run();
  }

  for (const [userId, level] of uniquePermissions.entries()) {
    await env.MARBLE_DB.prepare(
      `INSERT INTO file_permissions (file_id, user_id, access_level, granted_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(file_id, user_id) DO UPDATE SET
         access_level = excluded.access_level,
         granted_by = excluded.granted_by,
         created_at = excluded.created_at`
    )
      .bind(fileId, userId, level, actingUserId, now)
      .run();
  }
}
export async function getTeamWithMembers(env: MarbleBindings, teamId: string): Promise<TeamSummary | null> {
  const team = await env.MARBLE_DB.prepare(
    `SELECT id, organisation_id, name, slug, description, owner_id, created_by, created_at, updated_at
     FROM teams
     WHERE id = ?1`,
  )
    .bind(teamId)
    .first<TeamRecord>();
  if (!team) {
    return null;
  }

  const members = await env.MARBLE_DB.prepare(
    `SELECT
       tm.team_id,
       tm.user_id,
       tm.role,
       tm.status,
       tm.invited_by,
       tm.invited_at,
       tm.joined_at,
       tm.created_at,
       tm.updated_at,
       u.email,
       u.display_name,
       u.username
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ?1
     ORDER BY lower(u.display_name)`,
  )
    .bind(teamId)
    .all<TeamMemberWithUser>();

  return {
    ...team,
    members: members.results ?? [],
  };
}

export async function getTeamMember(env: MarbleBindings, teamId: string, userId: string): Promise<TeamMemberWithUser | null> {
  const record = await env.MARBLE_DB.prepare(
    `SELECT
       tm.team_id,
       tm.user_id,
       tm.role,
       tm.status,
       tm.invited_by,
       tm.invited_at,
       tm.joined_at,
       tm.created_at,
       tm.updated_at,
       u.email,
       u.display_name,
       u.username
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ?1 AND tm.user_id = ?2
     LIMIT 1`,
  )
    .bind(teamId, userId)
    .first<TeamMemberWithUser>();
  return record ?? null;
}
