// frontend/src/lib/api.ts

// Simple error class so callers can inspect HTTP status and login URL
export class HttpError extends Error {
  status?: number;
  loginUrl?: string;
}

// --- Types ---
export interface SessionResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    organizationRole: string;
  };
  tenant: string;
  organisation: {
    id: string;
    role: string;
  };
  teams: string[];
}

export type Visibility = 'organization' | 'personal' | 'team';

export interface FolderSummary {
  id: string;
  name: string;
  visibility: Visibility;
  teamId: string | null;
  fileCount: number;
  owner: {
    id: string;
    email: string;
    displayName: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileSummary {
  id: string;
  name: string;
  visibility: Visibility;
  status: 'uploading' | 'ready';
  size: number;
  mimeType: string | null;
  folder: {
    id: string;
    name: string;
    visibility: Visibility;
    teamId: string | null;
  };
  owner: {
    id: string;
    email: string;
    displayName: string | null;
  };
  hasDirectAccess?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberSummary {
  user_id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  role: 'member' | 'manager' | 'owner';
  status: 'pending' | 'active' | 'removed';
}

export interface TeamRecord {
  id: string;
  organisation_id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamSummary {
  id: string;
  organisation_id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  members: TeamMemberSummary[];
}

export interface RosterEntry {
  id: string;
  organisation_id: string;
  user_id: string | null;
  email: string;
  display_name: string | null;
  role: 'member' | 'admin' | 'owner';
  status: 'pending' | 'invited' | 'active' | 'removed';
  invited_by: string | null;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  user_display_name: string | null;
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
  access_level: 'viewer' | 'editor';
  email: string;
  display_name: string | null;
}

export interface FileSharingSummary {
  id: string;
  visibility: Visibility;
  team_id: string | null;
  permissions: FilePermissionSummary[];
}

export interface ChatResponse {
  id: string;
  answer: string;
  citations: Array<{ folder: string; file: string; lines: [number, number] }>;
  sources: Array<{
    order: number;
    chunkId: string;
    folderName: string;
    fileName: string;
    startLine: number;
    endLine: number;
    content: string;
  }>;
}

// --- Base URL from env ---
const RAW_API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim();
const FALLBACK_API_BASE = 'http://127.0.0.1:8787';
const RAW_APP_BASE = (import.meta.env.VITE_APP_BASE ?? '').trim();
const FALLBACK_APP_BASE = 'http://localhost:5173';

function stripTrailingSlash(value: string): string {
  if (!value) return value;
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveApiBase(): string {
  if (RAW_API_BASE) {
    return stripTrailingSlash(RAW_API_BASE);
  }
  if (typeof window !== 'undefined') {
    return '';
  }
  return stripTrailingSlash(FALLBACK_API_BASE);
}

function resolveAppBase(): string {
  if (RAW_APP_BASE) {
    return stripTrailingSlash(RAW_APP_BASE);
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return stripTrailingSlash(FALLBACK_APP_BASE);
}

export const API_BASE = resolveApiBase();

const TEAM_DOMAIN = (import.meta.env.VITE_CF_ACCESS_TEAM_DOMAIN ?? '').trim();
const APP_BASE = resolveAppBase();

function apiHost(): string {
  if (API_BASE) {
    try {
      return new URL(API_BASE).host;
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined') {
    return window.location.host;
  }
  try {
    return new URL(FALLBACK_API_BASE).host;
  } catch {
    return '';
  }
}

function normalizedBase(): string | null {
  return API_BASE || null;
}

export function getAccessLoginUrl(redirectTarget?: string): string {
  const target = redirectTarget ?? (typeof window !== 'undefined' ? window.location.href : APP_BASE || '/');
  const workerBase = normalizedBase() ?? (typeof window !== 'undefined' ? window.location.origin : FALLBACK_API_BASE);

  if (TEAM_DOMAIN) {
    const redirect = new URL('/api/session', workerBase);
    redirect.searchParams.set('next', target);
    const url = new URL(`/cdn-cgi/access/login/${apiHost()}`, `https://${TEAM_DOMAIN}`);
    url.searchParams.set('redirect_url', redirect.toString());
    return url.toString();
  }

  const fallback = new URL('/cdn-cgi/access/login', workerBase);
  fallback.searchParams.set('redirect_url', target);
  return fallback.toString();
}

export function getAccessLogoutUrl(redirectTarget?: string): string {
  const target = redirectTarget ?? (typeof window !== 'undefined' ? window.location.origin : APP_BASE || '/');
  const workerBase = normalizedBase() ?? (typeof window !== 'undefined' ? window.location.origin : FALLBACK_API_BASE);

  if (TEAM_DOMAIN) {
    const url = new URL('/cdn-cgi/access/logout', `https://${TEAM_DOMAIN}`);
    url.searchParams.set('return_to', target);
    return url.toString();
  }

  const fallback = new URL('/cdn-cgi/access/logout', workerBase);
  fallback.searchParams.set('return_to', target);
  return fallback.toString();
}

// --- Fetch helper ---
async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...init,
    });
  } catch (err) {
    if (err instanceof TypeError) {
      const error = new HttpError('Failed to reach the Marble API. Check your network or CORS configuration.');
      error.status = 0;
      throw error;
    }
    throw err;
  }
  if (!response.ok) {
    const text = await response.text();
    let message = text || `Request failed with ${response.status}`;
    let loginUrl: string | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: string; loginUrl?: string };
      if (parsed.error) {
        message = parsed.error;
      }
      if (parsed.loginUrl) {
        loginUrl = parsed.loginUrl;
      }
    } catch {
      // Ignore JSON parse errors; use raw text
    }
    const error = new HttpError(message);
    error.status = response.status;
    if (loginUrl) {
      error.loginUrl = loginUrl;
    } else if (response.status === 401 || response.status === 403) {
      error.loginUrl = getAccessLoginUrl();
    }
    throw error;
  }
  return response.json() as Promise<T>;
}

// --- API functions ---
export function fetchSession(): Promise<SessionResponse> {
  return fetchJSON('/api/session');
}

export function fetchFolders(params: { visibility?: 'organization' | 'personal' | 'team' | 'all' } = {}): Promise<{ folders: FolderSummary[] }>
{
  const search = new URLSearchParams();
  if (params.visibility) {
    search.set('visibility', params.visibility);
  }
  const query = search.toString();
  return fetchJSON(`/api/folders${query ? `?${query}` : ''}`);
}

export function createFolder(body: { name: string; visibility: Visibility; teamId?: string | null }): Promise<{ folder: FolderSummary }> {
  return fetchJSON('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateFolder(
  id: string,
  body: { name?: string; visibility?: Visibility; teamId?: string | null },
): Promise<{ folder: FolderSummary }>
{
  return fetchJSON(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteFolder(id: string): Promise<{ deleted: boolean; removedFiles?: number }>
{
  return fetchJSON(`/api/folders/${id}`, { method: 'DELETE' });
}

export function fetchFiles(params: { visibility?: 'organization' | 'personal' | 'team' | 'all'; folderId?: string }): Promise<{ files: FileSummary[] }>
{
  const search = new URLSearchParams();
  if (params.visibility) search.set('visibility', params.visibility);
  if (params.folderId) search.set('folderId', params.folderId);
  const query = search.toString();
  return fetchJSON(`/api/files${query ? `?${query}` : ''}`);
}

export async function uploadFile(formData: FormData): Promise<{ file: FileSummary }> {
  const response = await fetch(`${API_BASE}/api/files`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed with ${response.status}`);
  }
  return response.json();
}

export function updateFile(
  id: string,
  body: { name?: string; visibility?: Visibility; teamId?: string | null },
): Promise<{ file: FileSummary }>
{
  return fetchJSON(`/api/files/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteFile(id: string): Promise<{ deleted: boolean }> {
  return fetchJSON(`/api/files/${id}`, { method: 'DELETE' });
}

export type ChatScope = 'personal' | 'team' | 'org' | 'all';

export function sendChat(message: string, knowledgeMode: boolean, scope: ChatScope): Promise<ChatResponse> {
  return fetchJSON('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, knowledgeMode, scope }),
  });
}

export function fetchRoster(): Promise<{ roster: RosterEntry[] }> {
  return fetchJSON('/api/organization/roster');
}

export function uploadRoster(text: string): Promise<{ roster: RosterEntry[] }> {
  return fetchJSON('/api/organization/roster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export function fetchTeams(): Promise<{ teams: TeamSummary[] }> {
  return fetchJSON('/api/teams');
}

export async function createTeam(input: { name: string; description?: string | null }): Promise<{ team: TeamSummary }>
{
  const result = await fetchJSON('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }) as { team: TeamSummary | TeamRecord };

  const { team } = result;
  if ('members' in team) {
    return { team };
  }
  return {
    team: {
      ...team,
      members: [],
    },
  };
}

export function inviteTeamMembers(teamId: string, userIds: string[]): Promise<{ team: TeamSummary | null }>
{
  return fetchJSON(`/api/teams/${teamId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  });
}

export function acceptTeamInvite(teamId: string): Promise<{ team: TeamSummary | null }>
{
  return fetchJSON(`/api/teams/${teamId}/accept`, {
    method: 'POST',
  });
}

export function updateTeamMemberRole(teamId: string, userId: string, role: 'member' | 'manager' | 'owner'): Promise<{ team: TeamSummary | null }>
{
  return fetchJSON(`/api/teams/${teamId}/members/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

export function removeTeamMember(teamId: string, userId: string): Promise<{ team: TeamSummary | null }>
{
  return fetchJSON(`/api/teams/${teamId}/members/${userId}`, {
    method: 'DELETE',
  });
}

export function searchDirectoryUsers(query: string, limit = 50): Promise<{ results: DirectoryEntry[] }>
{
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchJSON(`/api/directory/users${qs ? `?${qs}` : ''}`);
}

export function getFileSharing(id: string): Promise<{ sharing: FileSharingSummary }> {
  return fetchJSON(`/api/files/${id}/sharing`);
}

export function updateFileSharing(id: string, payload: { visibility: Visibility; teamId?: string | null; permissions: Array<{ userId: string; accessLevel: 'viewer' | 'editor' }> }): Promise<{ sharing: FileSharingSummary }>
{
  return fetchJSON(`/api/files/${id}/sharing`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
