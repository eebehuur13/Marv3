// api/src/routes/debug.ts
import type { AppContext } from '../context';
import { HTTPException } from 'hono/http-exception';
import { createEmbeddings } from '../lib/openai';
import { organizationNamespace, personalNamespace, queryNamespace, teamNamespace } from '../lib/vectorize';
import { listActiveTeamIdsForUser } from '../lib/org';

/**
 * GET /api/debug/query?q=some+text[&scope=organization|personal|team|all]
 * Uses your real embeddings + vector index. Helpful to verify search end-to-end.
 */
export async function handleDebugQuery(c: AppContext) {
  const user = c.get('user');
  const organisationId = user.organizationId ?? user.tenant ?? c.env.DEFAULT_TENANT ?? 'default';
  const teamIds = await listActiveTeamIdsForUser(c.env, user.id);
  const url = new URL(c.req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const scope = (url.searchParams.get('scope') || 'all').toLowerCase();

  if (!q) throw new HTTPException(400, { message: 'Missing q' });

  const vectors = await createEmbeddings(c.env, [q]);
  const vec = vectors[0] || [];
  const vectorDims = Array.isArray(vec) ? vec.length : -1;

  const topK = parseTopK(c.env.VECTOR_TOP_K, 8);

  try {
    const namespaces: string[] = [];
    if (scope === 'all' || scope === 'organization') {
      namespaces.push(organizationNamespace(organisationId));
    }
    if (scope === 'all' || scope === 'personal') {
      namespaces.push(personalNamespace(user.id));
    }
    if ((scope === 'all' || scope === 'team') && teamIds.length) {
      namespaces.push(...teamIds.map((teamId) => teamNamespace(teamId)));
    }

    const promises = namespaces.map((namespace) =>
      queryNamespace(c.env, { namespace, vector: vec, topK }).catch((err) => {
        console.error('debug query namespace error', namespace, err);
        return [];
      }),
    );

    const results = promises.length ? (await Promise.all(promises)).flat() : [];

    return c.json({
      q,
      vectorDims,
      matches: results.map((m: any) => ({
        score: m.score,
        chunkId: m.chunkId,
        fileId: m.fileId,
        fileName: m.fileName,
        folderId: m.folderId,
        folderName: m.folderName,
        visibility: m.visibility,
        ownerId: m.ownerId,
        organizationId: m.organizationId,
        teamId: m.teamId ?? null,
        startLine: m.startLine,
        endLine: m.endLine,
      })),
    });
  } catch (e: any) {
    return c.json(
      {
        q,
        vectorDims,
        error: String(e?.message || e),
      },
      500,
    );
  }
}

/**
 * GET /api/debug/file?fileId=...
 * Lists the chunks for a file from D1 so you can copy exact text.
 */
export async function handleDebugFile(c: AppContext) {
  const url = new URL(c.req.url);
  const fileId = url.searchParams.get('fileId') || '';
  if (!fileId) throw new HTTPException(400, { message: 'Missing fileId' });

  const rows = await c.env.MARBLE_DB.prepare(
    `SELECT id, file_id, folder_id, owner_id, visibility, chunk_index, start_line, end_line, content
     FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC`
  )
    .bind(fileId)
    .all<any>();

  const results = rows.results ?? [];
  return c.json({
    fileId,
    chunkCount: results.length,
    sample: results.slice(0, 3).map((r: any) => ({
      chunkId: r.id,
      range: [r.start_line, r.end_line],
      preview: (r.content || '').slice(0, 200),
    })),
    chunkIds: results.map((r: any) => r.id),
  });
}

/**
 * GET /api/debug/probe-file?fileId=...
 * Embeds the FIRST chunk's text from that file and queries the index.
 * If this returns matches, your vectors are present and discoverable.
 */
export async function handleDebugProbeFile(c: AppContext) {
  const user = c.get('user');
  const organisationId = user.organizationId ?? user.tenant ?? c.env.DEFAULT_TENANT ?? 'default';
  const teamIds = await listActiveTeamIdsForUser(c.env, user.id);
  const url = new URL(c.req.url);
  const fileId = url.searchParams.get('fileId') || '';
  if (!fileId) throw new HTTPException(400, { message: 'Missing fileId' });

  const row = await c.env.MARBLE_DB.prepare(
    `SELECT id, file_id, owner_id, visibility, organization_id, team_id, folder_id, chunk_index, start_line, end_line, content
     FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC LIMIT 1`
  )
    .bind(fileId)
    .first<any>();

  if (!row) throw new HTTPException(404, { message: 'No chunks for that file' });

  const [vec] = await createEmbeddings(c.env, [row.content || '']);
  const topK = 10;

  let namespace: string;
  if (row.visibility === 'organization') {
    namespace = organizationNamespace(row.organization_id ?? organisationId);
  } else if (row.visibility === 'team') {
    const teamId = row.team_id ?? teamIds[0];
    if (!teamId) {
      throw new HTTPException(400, { message: 'Team chunk missing team id for probe.' });
    }
    namespace = teamNamespace(teamId);
  } else {
    namespace = personalNamespace(row.owner_id);
  }

  const matches = await queryNamespace(c.env, {
    namespace,
    vector: vec,
    topK,
  });

  return c.json({
    fileId,
    probeChunkId: row.id,
    probePreview: (row.content || '').slice(0, 200),
    matches,
  });
}

/**
 * GET /api/debug/stats
 * If supported, returns Vectorize index info (handy to see if it’s empty).
 */
export async function handleDebugStats(c: AppContext) {
  try {
    const describe = (c.env as any)?.MARBLE_VECTORS?.describe;
    if (typeof describe !== 'function') {
      return c.json({ error: 'describe() not supported on this binding' }, 400);
    }
    const stats = await describe();
    return c.json(stats);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
}

/* utils */
function parseTopK(v: string | undefined, fallback: number) {
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
