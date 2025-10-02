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
  };
  tenant: string;
}

export type Visibility = 'public' | 'private';

export interface FolderSummary {
  id: string;
  name: string;
  visibility: Visibility;
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
  };
  owner: {
    id: string;
    email: string;
    displayName: string | null;
  };
  createdAt: string;
  updatedAt: string;
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
const FALLBACK_API_BASE = 'https://strategicfork.xyz';
const RAW_APP_BASE = (import.meta.env.VITE_APP_BASE ?? '').trim();
const FALLBACK_APP_BASE = 'https://strategicfork.xyz';

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

export function fetchFolders(params: { visibility?: 'public' | 'private' | 'all' } = {}): Promise<{ folders: FolderSummary[] }>
{
  const search = new URLSearchParams();
  if (params.visibility) {
    search.set('visibility', params.visibility);
  }
  const query = search.toString();
  return fetchJSON(`/api/folders${query ? `?${query}` : ''}`);
}

export function createFolder(body: { name: string; visibility: Visibility }): Promise<{ folder: FolderSummary }> {
  return fetchJSON('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateFolder(id: string, body: { name?: string; visibility?: Visibility }): Promise<{ folder: FolderSummary }>
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

export function fetchFiles(params: { visibility?: 'public' | 'private' | 'all'; folderId?: string }): Promise<{ files: FileSummary[] }>
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

export function updateFile(id: string, body: { name?: string; visibility?: Visibility; folderId?: string }): Promise<{ file: FileSummary }>
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

export function sendChat(message: string, knowledgeMode: boolean): Promise<ChatResponse> {
  return fetchJSON('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, knowledgeMode }),
  });
}
