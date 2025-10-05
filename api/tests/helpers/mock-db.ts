// @ts-nocheck
import type {
  ChunkRecord,
  FilePermissionRecord,
  FileRecord,
  FolderRecord,
  OrganisationRecord,
  OrganisationRosterEntry,
  TeamMemberRecord,
  TeamRecord,
  Visibility,
} from '../../src/types';

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  tenant: string;
  organization_id: string;
  organization_role: string;
  username: string | null;
  title: string | null;
  last_seen: string;
  created_at: string;
}

interface RunResult {
  results?: unknown[];
  meta?: { changes: number };
}

function isoNow(): string {
  return new Date().toISOString();
}

const toVisibility = (value: string | null | undefined): Visibility => {
  if (value === 'organization' || value === 'personal' || value === 'team') {
    return value;
  }
  return 'personal';
};

export class MockD1 implements D1Database {
  organisations = new Map<string, OrganisationRecord>();
  roster = new Map<string, OrganisationRosterEntry>();
  users = new Map<string, UserRow>();
  folders = new Map<string, FolderRecord & { deleted_at?: string | null }>();
  files = new Map<string, FileRecord & { deleted_at?: string | null }>();
  chunks = new Map<string, ChunkRecord>();
  teams = new Map<string, TeamRecord>();
  teamMembers = new Map<string, TeamMemberRecord>();
  filePermissions = new Map<string, Map<string, FilePermissionRecord>>();
  messages: unknown[] = [];

  prepare(query: string) {
    const db = this;
    return {
      query,
      args: [] as unknown[],
      bind(...args: unknown[]) {
        this.args = args;
        return this;
      },
      async run() {
        const result = db.execute(query, this.args);
        return result ?? { meta: { changes: 0 } };
      },
      async first<T>() {
        const result = db.execute(query, this.args);
        if (Array.isArray(result)) {
          return (result[0] as T) ?? null;
        }
        return (result as T) ?? null;
      },
      async all<T>() {
        const result = db.execute(query, this.args);
        if (Array.isArray(result)) {
          return { results: result as T[] };
        }
        if (result == null) {
          return { results: [] };
        }
        return { results: [result as T] };
      },
      async raw() {
        throw new Error('Not implemented');
      },
    };
  }

  dump() {
    return {
      organisations: Array.from(this.organisations.values()),
      roster: Array.from(this.roster.values()),
      users: Array.from(this.users.values()),
      folders: Array.from(this.folders.values()),
      files: Array.from(this.files.values()),
      chunks: Array.from(this.chunks.values()),
      teams: Array.from(this.teams.values()),
      teamMembers: Array.from(this.teamMembers.values()),
      permissions: Array.from(this.filePermissions.entries()),
      messages: this.messages,
    };
  }

  private execute(query: string, args: unknown[]): RunResult | unknown[] | unknown | null {
    const normalized = query.replace(/\s+/g, ' ').trim().toUpperCase();

    if (normalized.startsWith('INSERT INTO ORGANISATIONS')) {
      const [id] = args as [string];
      const now = isoNow();
      const existing = this.organisations.get(id);
      if (!existing) {
        this.organisations.set(id, {
          id,
          slug: id,
          name: id,
          domain: null,
          created_at: now,
          updated_at: now,
        });
      }
      return { meta: { changes: existing ? 0 : 1 } };
    }

    if (normalized.startsWith('INSERT OR IGNORE INTO ORGANISATIONS')) {
      const [id, slug, name] = args as [string, string, string];
      const now = isoNow();
      if (!this.organisations.has(id)) {
        this.organisations.set(id, {
          id,
          slug,
          name,
          domain: null,
          created_at: now,
          updated_at: now,
        });
      }
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('ALTER TABLE')) {
      return { meta: { changes: 0 } };
    }

    if (normalized.startsWith('INSERT INTO USERS')) {
      const [
        id,
        email,
        displayName,
        avatarUrl,
        tenant,
        lastSeen,
        organisationId,
        organisationRole,
        username,
        title,
      ] = args as [string, string, string | null, string | null, string, string, string, string | null, string | null, string | null];
      const now = isoNow();
      const existing = this.users.get(id);
      const row: UserRow = {
        id,
        email,
        display_name: displayName ?? null,
        avatar_url: avatarUrl ?? null,
        tenant,
        organization_id: organisationId,
        organization_role: organisationRole ?? existing?.organization_role ?? 'member',
        username: username ?? existing?.username ?? null,
        title: title ?? existing?.title ?? null,
        last_seen: lastSeen,
        created_at: existing?.created_at ?? now,
      };
      this.users.set(id, row);
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('UPDATE USERS SET ORGANIZATION_ROLE =')) {
      const [id, role] = args as [string, string];
      const user = this.users.get(id);
      if (user) {
        user.organization_role = role ?? user.organization_role;
      }
      return { meta: { changes: user ? 1 : 0 } };
    }

    if (normalized.startsWith('UPDATE USERS SET ORGANIZATION_ROLE = COALESCE')) {
      const [id] = args as [string];
      const user = this.users.get(id);
      if (user && !user.organization_role) {
        user.organization_role = 'member';
      }
      return { meta: { changes: user ? 1 : 0 } };
    }

    if (normalized.startsWith('SELECT ID, ROLE FROM ORGANISATION_ROSTER')) {
      const [organisationId, email] = args as [string, string];
      const match = Array.from(this.roster.values()).find(
        (entry) => entry.organisation_id === organisationId && entry.email.toLowerCase() === email.toLowerCase(),
      );
      return match ? [{ id: match.id, role: match.role }] : [];
    }

    if (normalized.startsWith('UPDATE ORGANISATION_ROSTER SET USER_ID')) {
      const [id, userId, joinedAt] = args as [string, string, string];
      const entry = this.roster.get(id);
      if (entry) {
        entry.user_id = userId;
        entry.status = 'active';
        entry.joined_at = entry.joined_at ?? joinedAt;
        entry.updated_at = isoNow();
      }
      return { meta: { changes: entry ? 1 : 0 } };
    }

    if (normalized.startsWith('INSERT INTO ORGANISATION_ROSTER')) {
      const [
        id,
        organisationId,
        email,
        displayName,
        role,
        status,
        invitedBy,
        invitedAt,
        joinedAt,
        createdAt,
        updatedAt,
      ] = args as [
        string,
        string,
        string,
        string | null,
        string,
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
      ];
      if (this.roster.has(id)) {
        return { meta: { changes: 0 } };
      }
      this.roster.set(id, {
        id,
        organisation_id: organisationId,
        user_id: null,
        email,
        display_name: displayName ?? null,
        role: role as OrganisationRosterEntry['role'],
        status: status as OrganisationRosterEntry['status'],
        invited_by: invitedBy ?? null,
        invited_at: invitedAt ?? null,
        joined_at: joinedAt ?? null,
        created_at: createdAt ?? isoNow(),
        updated_at: updatedAt ?? isoNow(),
        user_email: null,
        user_display_name: null,
      });
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('SELECT TEAM_ID FROM TEAM_MEMBERS')) {
      const [userId] = args as [string];
      const results = Array.from(this.teamMembers.values())
        .filter((member) => member.user_id === userId && member.status === 'active')
        .map((member) => ({ team_id: member.team_id }));
      return results;
    }

    if (normalized.startsWith('INSERT INTO TEAM_MEMBERS')) {
      const [teamId, userId, role, status, invitedBy, invitedAt] = args as [
        string,
        string,
        string,
        string,
        string | null,
        string | null,
      ];
      const key = `${teamId}:${userId}`;
      const existing = this.teamMembers.get(key);
      const now = isoNow();
      this.teamMembers.set(key, {
        team_id: teamId,
        user_id: userId,
        role: (role ?? existing?.role ?? 'member') as TeamMemberRecord['role'],
        status: (existing?.status === 'active' ? existing.status : (status as TeamMemberRecord['status'])) ?? 'pending',
        invited_by: invitedBy ?? existing?.invited_by ?? null,
        invited_at: invitedAt ?? existing?.invited_at ?? null,
        joined_at: existing?.joined_at ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('UPDATE TEAM_MEMBERS SET STATUS =')) {
      const [teamId, userId, joinedAt] = args as [string, string, string];
      const key = `${teamId}:${userId}`;
      const existing = this.teamMembers.get(key);
      if (existing) {
        existing.status = 'active';
        existing.joined_at = existing.joined_at ?? joinedAt;
        existing.updated_at = isoNow();
      }
      return { meta: { changes: existing ? 1 : 0 } };
    }

    if (normalized.startsWith('UPDATE TEAM_MEMBERS SET ROLE =')) {
      const [teamId, userId, role] = args as [string, string, string];
      const key = `${teamId}:${userId}`;
      const existing = this.teamMembers.get(key);
      if (existing) {
        existing.role = role as TeamMemberRecord['role'];
        existing.updated_at = isoNow();
      }
      return { meta: { changes: existing ? 1 : 0 } };
    }

    if (normalized.startsWith('UPDATE TEAM_MEMBERS SET STATUS = ')) {
      const [teamId, userId] = args as [string, string];
      const key = `${teamId}:${userId}`;
      const existing = this.teamMembers.get(key);
      if (existing) {
        existing.status = 'removed';
        existing.updated_at = isoNow();
      }
      return { meta: { changes: existing ? 1 : 0 } };
    }

    if (normalized.startsWith('CREATE TABLE')) {
      return { meta: { changes: 0 } };
    }

    if (normalized.startsWith('INSERT INTO FOLDERS')) {
      if (args.length === 9) {
        const [id, tenant, organisationId, ownerId, name, visibility, teamId, createdAt, updatedAt] = args as [
          string,
          string,
          string,
          string | null,
          string,
          string,
          string | null,
          string,
          string,
        ];
        this.folders.set(id, {
          id,
          tenant,
          organization_id: organisationId,
          name,
          visibility: toVisibility(visibility),
          owner_id: ownerId ?? null,
          team_id: teamId ?? null,
          created_at: createdAt,
          updated_at: updatedAt,
          deleted_at: null,
        });
      } else {
        const [id, tenant, organisationId, name, visibility, ownerId, teamId] = args as [
          string,
          string,
          string,
          string,
          string,
          string | null,
          string | null,
        ];
        const existing = this.folders.get(id);
        const now = isoNow();
        this.folders.set(id, {
          id,
          tenant,
          organization_id: organisationId,
          name,
          visibility: toVisibility(visibility),
          owner_id: ownerId ?? existing?.owner_id ?? null,
          team_id: teamId ?? existing?.team_id ?? null,
          created_at: existing?.created_at ?? now,
          updated_at: now,
          deleted_at: existing?.deleted_at ?? null,
        });
      }
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('UPDATE FOLDERS SET NAME')) {
      const [id, name, visibility, ownerId, teamId, organisationId] = args as [
        string,
        string,
        string,
        string | null,
        string | null,
        string,
      ];
      const folder = this.folders.get(id);
      if (folder && folder.organization_id === organisationId) {
        folder.name = name;
        folder.visibility = toVisibility(visibility);
        folder.owner_id = ownerId ?? folder.owner_id;
        folder.team_id = teamId ?? null;
        folder.updated_at = isoNow();
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }

    if (normalized.startsWith('UPDATE FOLDERS SET DELETED_AT')) {
      const [id, organisationId] = args as [string, string];
      const folder = this.folders.get(id);
      if (folder && folder.organization_id === organisationId) {
        folder.deleted_at = isoNow();
        folder.updated_at = folder.deleted_at;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }

    if (normalized.includes('FROM FOLDERS F LEFT JOIN FILES FI')) {
      const organisationId = args[0] as string;
      const remainingArgs = args.slice(1);
      const results = Array.from(this.folders.values())
        .filter((folder) => folder.organization_id === organisationId && !folder.deleted_at)
        .filter((folder) => {
          if (normalized.includes("F.VISIBILITY = 'ORGANIZATION'")) {
            if (normalized.includes('OR (F.VISIBILITY')) {
              const fragments: Visibility[] = [];
              if (normalized.includes("F.VISIBILITY = 'ORGANIZATION'")) {
                if (folder.visibility === 'organization') {
                  return true;
                }
                fragments.push('organization');
              }
              let offset = 0;
              if (normalized.includes("F.VISIBILITY = 'PERSONAL'")) {
                const ownerId = remainingArgs[offset++] as string;
                if (folder.visibility === 'personal' && folder.owner_id === ownerId) {
                  return true;
                }
              }
              if (normalized.includes("F.VISIBILITY = 'TEAM'")) {
                const teamIds = remainingArgs.slice(offset).map(String);
                if (folder.visibility === 'team' && folder.team_id && teamIds.includes(folder.team_id)) {
                  return true;
                }
              }
              return folder.visibility === 'organization';
            }
            return folder.visibility === 'organization';
          }
          if (normalized.includes("F.VISIBILITY = 'PERSONAL' AND F.OWNER_ID")) {
            const ownerId = remainingArgs[0] as string;
            return folder.visibility === 'personal' && folder.owner_id === ownerId;
          }
          if (normalized.includes("F.VISIBILITY = 'TEAM' AND F.TEAM_ID IN")) {
            const teamIds = remainingArgs.map(String);
            return folder.visibility === 'team' && folder.team_id && teamIds.includes(folder.team_id);
          }
          return true;
        })
        .map((folder) => {
          const owner = folder.owner_id ? this.users.get(folder.owner_id) : undefined;
          const fileCount = Array.from(this.files.values()).filter(
            (file) => file.folder_id === folder.id && !file.deleted_at,
          ).length;
          return {
            ...folder,
            file_count: fileCount,
            owner_email: owner?.email ?? null,
            owner_display_name: owner?.display_name ?? null,
          };
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return results;
    }

    if (normalized.includes('FROM FOLDERS F LEFT JOIN USERS U ON U.ID = F.OWNER_ID WHERE F.ID = ?1')) {
      const [id, organisationId] = args as [string, string];
      const folder = this.folders.get(id);
      if (!folder || folder.organization_id !== organisationId || folder.deleted_at) {
        return null;
      }
      const owner = folder.owner_id ? this.users.get(folder.owner_id) : undefined;
      return {
        ...folder,
        owner_email: owner?.email ?? null,
        owner_display_name: owner?.display_name ?? null,
      };
    }

    if (normalized.startsWith('SELECT COUNT(*) AS COUNT FROM FILES')) {
      const [folderId, organisationId] = args as [string, string];
      const count = Array.from(this.files.values()).filter(
        (file) => file.folder_id === folderId && file.organization_id === organisationId && !file.deleted_at,
      ).length;
      return { count };
    }

    if (normalized.startsWith('INSERT INTO FILES')) {
      const [
        id,
        tenant,
        organisationId,
        folderId,
        ownerId,
        teamId,
        visibility,
        fileName,
        r2Key,
        size,
        mimeType,
        status,
      ] = args as [
        string,
        string,
        string,
        string,
        string,
        string | null,
        string,
        string,
        string,
        number,
        string | null,
        FileRecord['status'],
      ];
      const now = isoNow();
      this.files.set(id, {
        id,
        tenant,
        organization_id: organisationId,
        folder_id: folderId,
        owner_id: ownerId,
        team_id: teamId ?? null,
        visibility: toVisibility(visibility),
        file_name: fileName,
        r2_key: r2Key,
        size,
        mime_type: mimeType ?? null,
        status,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('UPDATE FILES SET STATUS')) {
      const [fileId, status] = args as [string, FileRecord['status']];
      const file = this.files.get(fileId);
      if (file) {
        file.status = status;
        file.updated_at = isoNow();
      }
      return { meta: { changes: file ? 1 : 0 } };
    }

    if (normalized.startsWith('UPDATE FILES SET FILE_NAME')) {
      const [fileName, r2Key, size, mimeType, fileId] = args as [string, string, number, string, string];
      const file = this.files.get(fileId);
      if (file) {
        file.file_name = fileName;
        file.r2_key = r2Key;
        file.size = size;
        file.mime_type = mimeType;
        file.updated_at = isoNow();
      }
      return { meta: { changes: file ? 1 : 0 } };
    }

    if (normalized.startsWith('UPDATE FILES SET VISIBILITY')) {
      const [fileId, visibility, teamId] = args as [string, string, string | null];
      const file = this.files.get(fileId);
      if (file) {
        file.visibility = toVisibility(visibility);
        file.team_id = teamId ?? null;
        file.updated_at = isoNow();
      }
      return { meta: { changes: file ? 1 : 0 } };
    }

    if (normalized.includes('FROM FILES FI JOIN FOLDERS FO')) {
      const fileId = args[0] as string;
      const organisationId = args.length > 1 ? (args[1] as string) : undefined;
      const file = this.files.get(fileId);
      if (!file || file.deleted_at) {
        return null;
      }
      if (organisationId && file.organization_id !== organisationId) {
        return null;
      }
      const folder = this.folders.get(file.folder_id);
      const owner = this.users.get(file.owner_id);
      if (!folder || folder.deleted_at || !owner) {
        return null;
      }
      return {
        ...file,
        folder_name: folder.name,
        folder_visibility: folder.visibility,
        folder_team_id: folder.team_id ?? null,
        owner_email: owner.email,
        owner_display_name: owner.display_name,
        has_direct_access: 1,
      };
    }

    if (normalized.includes('FROM FILES F JOIN FOLDERS D')) {
      const [tenantOrOrg] = args as [string];
      const results = Array.from(this.files.values())
        .filter((file) => !file.deleted_at && file.tenant === tenantOrOrg)
        .map((file) => {
          const folder = this.folders.get(file.folder_id);
          const owner = this.users.get(file.owner_id);
          return {
            ...file,
            folder_name: folder?.name ?? 'Folder',
            folder_visibility: folder?.visibility ?? 'personal',
            folder_team_id: folder?.team_id ?? null,
            owner_email: owner?.email ?? '',
            owner_display_name: owner?.display_name ?? null,
          };
        });
      return results;
    }

    if (normalized.startsWith('DELETE FROM FILES WHERE ID = ?1')) {
      const [fileId] = args as [string];
      const file = this.files.get(fileId);
      if (file) {
        this.files.delete(fileId);
      }
      return { meta: { changes: file ? 1 : 0 } };
    }

    if (normalized.startsWith('DELETE FROM FILE_PERMISSIONS WHERE FILE_ID')) {
      const [fileId] = args as [string];
      const permissions = this.filePermissions.get(fileId);
      const before = permissions ? permissions.size : 0;
      this.filePermissions.delete(fileId);
      return { meta: { changes: before } };
    }

    if (normalized.startsWith('DELETE FROM FILE_PERMISSIONS')) {
      const [fileId] = args as [string];
      this.filePermissions.delete(fileId);
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('INSERT INTO FILE_PERMISSIONS')) {
      const [fileId, userId, accessLevel, grantedBy, createdAt] = args as [
        string,
        string,
        string,
        string | null,
        string,
      ];
      const map = this.filePermissions.get(fileId) ?? new Map<string, FilePermissionRecord>();
      map.set(userId, {
        file_id: fileId,
        user_id: userId,
        access_level: accessLevel as FilePermissionRecord['access_level'],
        granted_by: grantedBy ?? null,
        created_at: createdAt,
      });
      this.filePermissions.set(fileId, map);
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('SELECT FP.USER_ID, FP.ACCESS_LEVEL')) {
      const [fileId] = args as [string];
      const permissions = Array.from(this.filePermissions.get(fileId)?.values() ?? []);
      return permissions.map((permission) => {
        const user = this.users.get(permission.user_id);
        return {
          ...permission,
          email: user?.email ?? '',
          display_name: user?.display_name ?? null,
        };
      });
    }

    if (normalized.startsWith('INSERT INTO CHUNKS')) {
      const [id, fileId, folderId, organisationId, ownerId, teamId, visibility, chunkIndex, startLine, endLine, content] = args as [
        string,
        string,
        string,
        string,
        string,
        string | null,
        string,
        number,
        number,
        number,
        string,
      ];
      this.chunks.set(id, {
        id,
        file_id: fileId,
        folder_id: folderId,
        organization_id: organisationId,
        owner_id: ownerId,
        team_id: teamId ?? null,
        visibility: toVisibility(visibility),
        chunk_index: chunkIndex,
        start_line: startLine,
        end_line: endLine,
        content,
        created_at: isoNow(),
      });
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('DELETE FROM CHUNKS WHERE FILE_ID')) {
      const [fileId] = args as [string];
      for (const [chunkId, chunk] of this.chunks.entries()) {
        if (chunk.file_id === fileId) {
          this.chunks.delete(chunkId);
        }
      }
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('SELECT ID FROM CHUNKS WHERE FILE_ID')) {
      const [fileId] = args as [string];
      return Array.from(this.chunks.values())
        .filter((chunk) => chunk.file_id === fileId)
        .map((chunk) => ({ id: chunk.id }));
    }

    if (normalized.startsWith('SELECT C.ID')) {
      const ids = args as string[];
      return ids
        .map((id) => this.chunks.get(id))
        .filter(Boolean)
        .map((chunk) => {
          const file = chunk ? this.files.get(chunk.file_id) : undefined;
          const folder = file ? this.folders.get(file.folder_id) : undefined;
          return {
            ...chunk!,
            file_name: file?.file_name ?? 'file.txt',
            folder_name: folder?.name ?? 'Folder',
          };
        });
    }

    if (normalized.startsWith('INSERT INTO MESSAGES')) {
      const record = {
        id: args[0],
        user_id: args[1],
        question: args[2],
        answer: args[3],
        citations: args[4],
      };
      this.messages.push(record);
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith('SELECT 1')) {
      return [{ 1: 1 }];
    }

    console.warn('Unhandled mock query', query, args);
    return null;
  }
}
