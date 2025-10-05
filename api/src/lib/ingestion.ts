import { HTTPException } from 'hono/http-exception';
import { chunkText } from './chunk';
import { createEmbeddings, OpenAIError } from './openai';
import { deleteChunksForFile, getFileById, insertChunk, updateFileStatus } from './db';
import { deleteChunkVectors, upsertChunkVector } from './vectorize';
import type { MarbleBindings } from '../types';
import { assertTxtFile } from './text-conversion';

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Normalize whatever the embeddings provider returns to number[][]
function normalizeEmbeddings(maybe: any): number[][] {
  if (maybe && Array.isArray(maybe.data)) {
    return maybe.data.map((d: any) => d.embedding);
  }
  if (Array.isArray(maybe) && Array.isArray(maybe[0])) {
    return maybe as number[][];
  }
  if (Array.isArray(maybe) && typeof maybe[0] === 'number') {
    return [maybe as number[]];
  }
  if (maybe && Array.isArray(maybe.vectors)) {
    return maybe.vectors as number[][];
  }
  throw new Error('Embedding response not in a known format');
}

export async function ingestFileById(env: MarbleBindings, fileId: string, actingUserId: string): Promise<{ chunks: number }>
{
  const file = await getFileById(env, fileId);
  if (!file) {
    throw new HTTPException(404, { message: 'File not found' });
  }
  if (file.owner_id !== actingUserId) {
    throw new HTTPException(403, { message: 'You can only ingest your own files' });
  }

  const object = await env.MARBLE_FILES.get(file.r2_key);
  if (!object) {
    throw new HTTPException(404, { message: 'Uploaded object not found in R2' });
  }

  assertTxtFile(file);

  const text = await object.text();

  if (!text) {
    throw new HTTPException(400, { message: 'Uploaded file appears to be empty.' });
  }

  const chunkSize = parseNumber(env.CHUNK_SIZE, 1500);
  const overlap = parseNumber(env.CHUNK_OVERLAP, 200);
  const chunks = chunkText(text, { chunkSize, overlap });

  if (!chunks.length) {
    throw new HTTPException(400, { message: 'No content found to ingest' });
  }

  let rawEmbeddings: number[][] | any;
  try {
    rawEmbeddings = await createEmbeddings(
      env,
      chunks.map((chunk) => chunk.content),
    );
  } catch (error) {
    console.error('Embedding generation failed', error);
    if (error instanceof OpenAIError) {
      throw new HTTPException(502, { message: error.message });
    }
    throw new HTTPException(500, { message: (error as Error)?.message || String(error) });
  }

  let embeddings: number[][];
  try {
    embeddings = normalizeEmbeddings(rawEmbeddings);
  } catch (e: any) {
    console.error('normalizeEmbeddings failed', e);
    throw new HTTPException(500, {
      message: `Failed to parse embeddings: ${e?.message || String(e)}`,
    });
  }

  if (embeddings.length !== chunks.length) {
    throw new HTTPException(500, {
      message: `Embedding count mismatch: got ${embeddings.length}, expected ${chunks.length}`,
    });
  }

  const existing = await deleteChunksForFile(env, file.id);
  if (existing.length) {
    try {
      await deleteChunkVectors(env, existing, {
        visibility: file.visibility,
        ownerId: file.owner_id,
        organizationId: file.organization_id,
        teamId: file.team_id ?? null,
      });
    } catch (error) {
      console.error('Vector delete failed', { fileId: file.id, error });
      throw error;
    }
  }

  let insertedChunks = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkId = crypto.randomUUID();

    await insertChunk(env, {
      id: chunkId,
      file_id: file.id,
      folder_id: file.folder_id,
      organization_id: file.organization_id,
      owner_id: file.owner_id,
      team_id: file.team_id ?? null,
      visibility: file.visibility,
      chunk_index: index,
      start_line: chunk.startLine,
      end_line: chunk.endLine,
      content: chunk.content,
    });

    try {
      await upsertChunkVector(env, chunkId, embeddings[index], {
        chunkId,
        fileId: file.id,
        folderId: file.folder_id,
        folderName: file.folder_name,
        fileName: file.file_name,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        visibility: file.visibility,
        ownerId: file.owner_id,
        organizationId: file.organization_id,
        teamId: file.team_id ?? null,
      });
    } catch (error) {
      console.error('Vector upsert failed for chunk', chunkId, error);
      throw error;
    }

    if (index === 0) {
      console.log('First chunk upserted', {
        fileId: file.id,
        chunkId,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        visibility: file.visibility,
      });
    }

    insertedChunks += 1;
  }

  await updateFileStatus(env, file.id, 'ready');

  console.log('Ingest completed', {
    fileId: file.id,
    chunks: insertedChunks,
    visibility: file.visibility,
  });

  return { chunks: insertedChunks };
}
