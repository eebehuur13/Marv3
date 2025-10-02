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
}

export interface VectorMatch extends VectorMetadata {
  score: number;
}

function encodeOwnerId(ownerId: string): string {
  let base64: string;
  if (typeof btoa === 'function') {
    base64 = btoa(ownerId);
  } else if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(ownerId, 'utf8').toString('base64');
  } else {
    throw new Error('Base64 encoding not supported in this environment');
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeOwnerId(token: string): string {
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

function partitionForVisibility(visibility: Visibility, ownerId: string): string {
  return visibility === 'public' ? 'public' : `user:${encodeOwnerId(ownerId)}`;
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
    const namespace = partitionForVisibility(metadata.visibility, metadata.ownerId);
    await binding.upsert(namespace, vectors); // V1: namespaced
  }
}

/* =========================
   DELETE
   ========================= */
export async function deleteChunkVectors(
  env: MarbleBindings,
  chunkIds: string[],
  visibility: Visibility,
  ownerId: string,
): Promise<void> {
  if (!chunkIds.length) return;
  const binding: any = env.MARBLE_VECTORS;

  if (isV2(binding)) {
    // ✅ V2: only use remove()
    if (typeof binding.remove === 'function') {
      await binding.remove(chunkIds);
    } else if (typeof binding.deleteByIds === 'function') {
      await binding.deleteByIds(chunkIds);
    } else {
      throw new Error('Vectorize binding does not support delete/remove');
    }
  } else {
    // ✅ V1: namespaced delete
    const namespace = partitionForVisibility(visibility, ownerId);
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
  if (ns === 'public') return { visibility: 'public' };
  if (ns.startsWith('user:')) {
    const encoded = ns.slice('user:'.length);
    const ownerId = decodeOwnerId(encoded);
    return { visibility: 'private', ownerId };
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
    const visibility: Visibility = metadata?.visibility ?? (options.namespace === 'public' ? 'public' : 'private');
    const ownerId =
      metadata?.ownerId ??
      (visibility === 'private' && options.namespace.startsWith('user:')
        ? decodeOwnerId(options.namespace.slice('user:'.length))
        : '');

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
      score: raw.score ?? 0,
    };
  };

  if (isV2(binding)) {
    const filter = filterFromNamespace(options.namespace);
    const baseOptions = {
      topK: options.topK,
      returnValues: false,
      returnMetadata: true,
      filter,
    };

    let response = await binding.query(options.vector, baseOptions);
    let matches = (response?.matches ?? []).map(buildMatch).filter(Boolean) as VectorMatch[];

    if (!matches.length && filter && Object.keys(filter).length) {
      // Fallback: retry without metadata filter in case vectors were stored without it
      response = await binding.query(options.vector, {
        topK: options.topK,
        returnValues: false,
        returnMetadata: true,
      });
      matches = (response?.matches ?? []).map(buildMatch).filter(Boolean) as VectorMatch[];
    }

    return matches;
  }

  // V1 fallback
  const rV1 = await binding.query(options.namespace, {
    vector: options.vector,
    topK: options.topK,
    returnValues: false,
    returnMetadata: true,
  });
  return (rV1?.matches ?? []).map(buildMatch).filter(Boolean) as VectorMatch[];
}

/* Helpers */
export function publicNamespace(): string {
  return 'public';
}
export function privateNamespace(ownerId: string): string {
  return `user:${encodeOwnerId(ownerId)}`;
}
