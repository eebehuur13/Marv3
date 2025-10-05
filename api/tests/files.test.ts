import { describe, expect, it, vi } from 'vitest';
import app from '../src/worker';
import { createTestEnv } from './helpers/mock-env';

vi.mock('../src/lib/access', () => ({
  authenticateRequest: vi.fn(async () => ({
    id: 'user@example.com',
    email: 'user@example.com',
    displayName: 'Test User',
    tenant: 'default',
    organizationId: 'default',
    organizationRole: 'owner',
  })),
}));

const timestamp = new Date().toISOString();

describe('files route permissions', () => {
  it('blocks uploads to shared folders owned by another user', async () => {
    const { env, db, ctx } = createTestEnv();

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

    db.folders.set('shared-not-owned', {
      id: 'shared-not-owned',
      tenant: 'default',
      organization_id: 'default',
      name: 'Team Handbook',
      visibility: 'organization',
      owner_id: 'owner@example.com',
      team_id: null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    });

    const form = new FormData();
    form.append('file', new File(['Hello world'], 'notes.txt', { type: 'text/plain' }));
    form.append('folderId', 'shared-not-owned');
    form.append('visibility', 'organization');

    const request = new Request('https://example.com/api/files', {
      method: 'POST',
      body: form,
      headers: {
        'cf-access-jwt-assertion': 'test-token',
      },
    });

    const response = await app.fetch(request, env, ctx);
    expect(response.status).toBe(403);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain('owner');
  });

  it('allows uploads to shared folders you own', async () => {
    const { env, db, r2, ctx } = createTestEnv();

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

    db.folders.set('shared-owned', {
      id: 'shared-owned',
      tenant: 'default',
      organization_id: 'default',
      name: 'My Shared Docs',
      visibility: 'organization',
      owner_id: 'user@example.com',
      team_id: null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    });

    const form = new FormData();
    form.append('file', new File(['Hello world'], 'notes.txt', { type: 'text/plain' }));
    form.append('folderId', 'shared-owned');
    form.append('visibility', 'organization');

    const request = new Request('https://example.com/api/files', {
      method: 'POST',
      body: form,
      headers: {
        'cf-access-jwt-assertion': 'test-token',
      },
    });

    const response = await app.fetch(request, env, ctx);
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { file: { id: string; folder: { id: string } } };
    expect(payload.file.folder.id).toBe('shared-owned');

    // Ensure object persisted to R2 and record stored in D1 mock
    const storedKeys = Array.from(r2.objects.keys());
    expect(storedKeys.some((key) => key.includes('shared-owned'))).toBe(true);
    expect(db.files.size).toBe(1);
  });
});
