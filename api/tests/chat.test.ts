import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/worker';
import { createTestEnv } from './helpers/mock-env';
import { organizationNamespace, personalNamespace } from '../src/lib/vectorize';

vi.mock('../src/lib/access', () => ({
  authenticateRequest: vi.fn(async () => ({
    id: 'user@example.com',
    email: 'user@example.com',
    displayName: 'Test User',
    tenant: 'default',
    organizationId: 'default',
    organizationRole: 'admin',
  })),
}));

describe('chat route', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns structured answer with citations', async () => {
    const { env, db, vector, ctx } = createTestEnv();

    const timestamp = new Date().toISOString();
    db.folders.set('public-root', {
      id: 'public-root',
      tenant: 'default',
      organization_id: 'default',
      name: 'Org Shared',
      visibility: 'organization',
      owner_id: null,
      team_id: null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    });

    db.files.set('file-1', {
      id: 'file-1',
      tenant: 'default',
      organization_id: 'default',
      folder_id: 'public-root',
      owner_id: 'user@example.com',
      team_id: null,
      visibility: 'organization',
      file_name: 'handbook.txt',
      r2_key: 'public/public-root/file-1-handbook.txt',
      size: 128,
      status: 'ready',
      mime_type: 'text/plain',
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    });

    db.chunks.set('chunk-1', {
      id: 'chunk-1',
      file_id: 'file-1',
      folder_id: 'public-root',
      organization_id: 'default',
      owner_id: 'user@example.com',
      team_id: null,
      visibility: 'organization',
      chunk_index: 0,
      start_line: 1,
      end_line: 4,
      content: 'Project Marble empowers teams to chat with their files.',
      created_at: new Date().toISOString(),
    });

    vector.queryResults[organizationNamespace('default')] = [
      {
        id: 'chunk-1',
        score: 0.92,
        metadata: {
          chunkId: 'chunk-1',
          fileId: 'file-1',
          folderId: 'public-root',
          folderName: 'Org Shared',
          fileName: 'handbook.txt',
          startLine: 1,
          endLine: 4,
          visibility: 'organization',
          ownerId: 'user@example.com',
          organizationId: 'default',
        },
      },
    ];

    // Ensure personal namespace has no results to avoid fallback noise
    vector.queryResults[personalNamespace('user@example.com')] = [];

    global.fetch = vi.fn(async (input, init) => {
      if (typeof input === 'string' && input.endsWith('/embeddings')) {
        const body = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({ data: body.input.map(() => ({ embedding: [0.1, 0.2, 0.3] })) }),
          { status: 200 },
        );
      }
      if (typeof input === 'string' && input.endsWith('/responses')) {
        return new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      answer: 'Marble lets the org chat with shared text files.',
                      citations: [
                        { folder: 'Org Shared', file: 'handbook.txt', lines: [1, 4] },
                      ],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (typeof input === 'string' && input.includes('/cdn-cgi/access/certs')) {
        return new Response(JSON.stringify({ keys: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'What does Marble do?', knowledgeMode: true }),
      headers: {
        'Content-Type': 'application/json',
        'cf-access-jwt-assertion': 'test-token',
      },
    });

    const response = await app.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      answer: string;
      citations: Array<{ folder: string; file: string; lines: [number, number] }>;
    };

    expect(data.answer).toContain('Marble lets the org chat');
    expect(data.citations[0]).toEqual({
      folder: 'Org Shared',
      file: 'handbook.txt',
      lines: [1, 4],
    });
    expect(db.messages).toHaveLength(1);
  });

  it('supports freeform chat without lookup', async () => {
    const { env, ctx } = createTestEnv();

    global.fetch = vi.fn(async (input) => {
      if (typeof input === 'string' && input.endsWith('/responses')) {
        return new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      answer: 'Hello! How can I help you today?',
                      citations: [],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (typeof input === 'string' && input.includes('/cdn-cgi/access/certs')) {
        return new Response(JSON.stringify({ keys: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hello there!', knowledgeMode: false }),
      headers: {
        'Content-Type': 'application/json',
        'cf-access-jwt-assertion': 'test-token',
      },
    });

    const response = await app.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      answer: string;
      citations: Array<{ folder: string; file: string; lines: [number, number] }>;
      sources: unknown[];
    };

    expect(data.answer).toContain('Hello');
    expect(data.citations).toEqual([]);
    expect(data.sources).toEqual([]);
  });
});
