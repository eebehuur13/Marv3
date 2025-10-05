import type { MarbleBindings, Visibility } from '../types';

export function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return 'untitled.txt';
  }
  const normalized = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .replace(/-+/g, '-');
  return normalized.toLowerCase() || 'untitled.txt';
}

interface ObjectKeyArgs {
  visibility: Visibility;
  organizationId: string;
  ownerId: string;
  folderId: string;
  fileId: string;
  fileName: string;
  teamId?: string | null;
}

export function buildObjectKey(args: ObjectKeyArgs): string {
  const baseName = sanitizeFileName(args.fileName);
  let prefix: string;
  if (args.visibility === 'organization') {
    prefix = args.folderId === 'public-root' ? 'public-root' : `organizations/${args.organizationId}`;
  } else if (args.visibility === 'team') {
    const teamSegment = args.teamId ?? 'shared-team';
    prefix = `teams/${teamSegment}`;
  } else {
    prefix = `users/${args.ownerId}`;
  }
  return `${prefix}/${args.folderId}/${args.fileId}-${baseName}`;
}

export async function moveObject(env: MarbleBindings, fromKey: string, toKey: string): Promise<void> {
  if (fromKey === toKey) {
    return;
  }

  const source = await env.MARBLE_FILES.get(fromKey);
  if (!source) {
    throw new Error(`Source object not found for key ${fromKey}`);
  }

  await env.MARBLE_FILES.put(toKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  });
  await env.MARBLE_FILES.delete(fromKey);
}

export async function deleteObject(env: MarbleBindings, key: string): Promise<void> {
  await env.MARBLE_FILES.delete(key);
}

export async function streamObject(env: MarbleBindings, key: string): Promise<R2ObjectBody | null> {
  return env.MARBLE_FILES.get(key);
}
