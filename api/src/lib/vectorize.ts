// api/src/lib/vectorize.ts
import type { MarbleBindings, Visibility } from '../types';

export interface VectorMetadata {
  chunkId: string;
  fileId: string;
  folderId: string;
  folderName: string;
  fileName: string;
  startLine: number;
  endLine: number;
  visibility: Visibility;
  ownerId: string;
  organizationId: string;
  teamId?: string | null;
}

export interface VectorMatch extends VectorMetadata {
  score: number;
}

function encodeIdentifier(value: string): string {
  let base64: string;
  if (typeof btoa === 'function') {
    base64 = btoa(value);
  } else if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(value, 'utf8').toString('base64');
  } else {
    throw new Error('Base64 encoding not supported in this environment');
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeIdentifier(token: string): string {
  if (!token) return '';
  const padded = token.padEnd(token.length + ((4 - (token.length % 4)) % 4), '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    if (typeof atob === 'function') {
      return atob(base64);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(base64, 'base64').toString('utf8');
    }
  } catch {
    // ignore and fall through
  }
  return '';
}

function partitionForVisibility(metadata: VectorMetadata): string {
  if (metadata.visibility === 'organization') {
    return organizationNamespace(metadata.organizationId);
  }
  if (metadata.visibility === 'team') {
    if (!metadata.teamId) {
      return 'team:unknown';
    }
    return teamNamespace(metadata.teamId);
  }
  return personalNamespace(metadata.ownerId);
}

/** Detect V2 binding: remove()/describe() present or upsert/query single-arg form */
function isV2(binding: any): boolean {
  try {
    if (typeof binding?.remove === 'function') return true;
    if (typeof binding?.describe === 'function') return true;
    if (typeof binding?.insert === 'function') return true;
    if (typeof binding?.upsert === 'function' && binding.upsert.length === 1) return true;
    if (typeof binding?.deleteByIds === 'function') return true;
  } catch {}
  return false;
}

/* =========================
   UPSERT
   ========================= */
export async function upsertChunkVector(
  env: MarbleBindings,
  chunkId: string,
  embedding: number[],
  metadata: VectorMetadata,
): Promise<void> {
  const vectors = [{ id: chunkId, values: embedding, metadata }];
  const binding: any = env.MARBLE_VECTORS;

  if (isV2(binding)) {
    await binding.upsert(vectors); // V2: single-arg
  } else {
    const namespace = partitionForVisibility(metadata);
    await binding.upsert(namespace, vectors); // V1: namespaced
  }
}

/* =========================
   DELETE
   ========================= */
export async function deleteChunkVectors(
  env: MarbleBindings,
  chunkIds: string[],
  metadata: { visibility: Visibility; ownerId: string; organizationId: string; teamId?: string | null },
): Promise<void> {
  if (!chunkIds.length) return;
  const binding: any = env.MARBLE_VECTORS;

  if (isV2(binding)) {
    if (typeof binding.remove === 'function') {
      await binding.remove(chunkIds);
    } else if (typeof binding.deleteByIds === 'function') {
      await binding.deleteByIds(chunkIds);
    } else {
      throw new Error('Vectorize binding does not support delete/remove');
    }
  } else {
    const namespace = partitionForVisibility({
      chunkId: '',
      fileId: '',
      folderId: '',
      folderName: '',
      fileName: '',
      startLine: 0,
      endLine: 0,
      visibility: metadata.visibility,
      ownerId: metadata.ownerId,
      organizationId: metadata.organizationId,
      teamId: metadata.teamId ?? null,
    });
    await binding.delete(namespace, chunkIds);
  }
}

/* ==============
   QUERY
   ============== */
interface QueryOptions {
  vector: number[];
  topK: number;
  namespace: string;
}

function filterFromNamespace(ns: string): Record<string, unknown> {
  if (ns.startsWith('org:')) {
    return { visibility: 'organization', organizationId: decodeIdentifier(ns.slice(4)) };
  }
  if (ns.startsWith('team:')) {
    return { visibility: 'team', teamId: decodeIdentifier(ns.slice(5)) };
  }
  if (ns.startsWith('user:')) {
    return { visibility: 'personal', ownerId: decodeIdentifier(ns.slice(5)) };
  }
  return {};
}

export async function queryNamespace(env: MarbleBindings, options: QueryOptions): Promise<VectorMatch[]> {
  const binding: any = env.MARBLE_VECTORS;
  const buildMatch = (raw: any): VectorMatch | null => {
    if (!raw) return null;
    const metadata = (raw.metadata ?? null) as Partial<VectorMetadata> | null;
    const chunkId = metadata?.chunkId ?? raw.chunkId ?? raw.id;
    if (!chunkId) {
      console.warn('Vector match missing chunkId', { namespace: options.namespace, raw });
      return null;
    }
    const namespaceFilter = filterFromNamespace(options.namespace);
    const visibility: Visibility = metadata?.visibility ?? (namespaceFilter.visibility as Visibility ?? 'personal');
    const ownerId = metadata?.ownerId ?? (visibility === 'personal' ? namespaceFilter.ownerId : '');
    const organizationId = metadata?.organizationId ?? (visibility === 'organization' ? namespaceFilter.organizationId : '');
    const teamId = metadata?.teamId ?? (visibility === 'team' ? namespaceFilter.teamId : null);

    return {
      chunkId,
      fileId: metadata?.fileId ?? '',
      folderId: metadata?.folderId ?? '',
      folderName: metadata?.folderName ?? '',
      fileName: metadata?.fileName ?? '',
      startLine: metadata?.startLine ?? 0,
      endLine: metadata?.endLine ?? 0,
      visibility,
      ownerId,
      organizationId,
      teamId,
      score: raw.score ?? 0,
    };
  };

  if (isV2(binding)) {
    const filter = filterFromNamespace(options.namespace);
    const baseOptions: any = {
      topK: options.topK,
      returnValues: false,
      returnMetadata: true,
    };
    if (Object.keys(filter).length) {
      baseOptions.filter = filter;
    }

    let response = await binding.query(options.vector, baseOptions);
    let matches = (response?.matches ?? []).map(buildMatch).filter(Boolean) as VectorMatch[];

    if (!matches.length && filter && Object.keys(filter).length) {
      response = await binding.query(options.vector, {
        topK: options.topK,
        returnValues: false,
        returnMetadata: true,
      });
      matches = (response?.matches ?? []).map(buildMatch).filter(Boolean) as VectorMatch[];
    }

    return matches;
  }

  const rV1 = await binding.query(options.namespace, {
    vector: options.vector,
    topK: options.topK,
    returnValues: false,
    returnMetadata: true,
  });
  return (rV1?.matches ?? []).map(buildMatch).filter(Boolean) as VectorMatch[];
}

/* Helpers */
export function organizationNamespace(organisationId: string): string {
  return `org:${encodeIdentifier(organisationId)}`;
}

export function personalNamespace(userId: string): string {
  return `user:${encodeIdentifier(userId)}`;
}

export function teamNamespace(teamId: string): string {
  return `team:${encodeIdentifier(teamId)}`;
}
