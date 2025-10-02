// @ts-nocheck
import { Buffer } from 'node:buffer';
import type { ExecutionContext, R2Bucket, VectorizeIndex } from '@cloudflare/workers-types';
import type { MarbleBindings } from '../../src/types';
import { MockD1 } from './mock-db';

type R2ObjectStub = {
  key: string;
  body: string;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

class MockR2 {
  objects = new Map<string, R2ObjectStub>();

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    return {
      text: async () => object.body,
      body: object.body,
      httpMetadata: object.httpMetadata ?? { contentType: 'text/plain' },
      customMetadata: object.customMetadata ?? {},
    };
  }

  async put(key: string, body: string | ReadableStream, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
    if (body instanceof ReadableStream) {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const decoder = new TextDecoder();
      const text = decoder.decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
      this.objects.set(key, { key, body: text, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
    } else {
      this.objects.set(key, { key, body, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
    }
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async createPresignedUrl() {
    return { url: 'https://example.com/presigned' };
  }
}

class MockVectorize implements VectorizeIndex {
  upserts: Array<{ namespace: string; vector: { id: string; metadata: unknown; values: number[] } }> = [];
  queries: Array<{ namespace: string; topK: number; vector: number[] }> = [];
  deletions: Array<{ namespace: string; ids: string[] }> = [];
  queryResults: Record<string, Array<{ id: string; score: number; metadata?: unknown }>> = {};

  async upsert(namespace: string, vector: { id: string; metadata: unknown; values: number[] }) {
    this.upserts.push({ namespace, vector });
  }

  async query(namespace: string, options: { vector: number[]; topK: number }) {
    this.queries.push({ namespace, topK: options.topK, vector: options.vector });
    return {
      matches: this.queryResults[namespace] ?? [],
    };
  }

  async delete(namespace: string, ids: string[]) {
    this.deletions.push({ namespace, ids });
  }
}

export interface TestContext {
  env: MarbleBindings;
  db: MockD1;
  r2: MockR2;
  vector: MockVectorize;
  ctx: ExecutionContext;
}

export function createTestEnv(): TestContext {
  const db = new MockD1();
  const r2 = new MockR2();
  const vector = new MockVectorize();

  const env: MarbleBindings = {
    MARBLE_DB: db,
    MARBLE_FILES: r2 as unknown as R2Bucket,
    MARBLE_VECTORS: vector,
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-4.1-mini',
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    VECTOR_TOP_K: '8',
    CHUNK_SIZE: '1200',
    CHUNK_OVERLAP: '200',
    CF_ACCESS_AUD: 'test-aud',
    CF_ACCESS_TEAM_DOMAIN: 'team.example.com',
    DEFAULT_TENANT: 'default',
  };

  const ctx: ExecutionContext = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  };

  return { env, db, r2, vector, ctx };
}
