import { HTTPException } from 'hono/http-exception';
import { chunkText } from './chunk';
import { createEmbeddings, OpenAIError } from './openai';
import {
  deleteChunksForFile,
  getFileById,
  insertChunk,
  updateFileAfterConversion,
  updateFileStatus,
} from './db';
import { deleteChunkVectors, upsertChunkVector } from './vectorize';
import type { MarbleBindings } from '../types';
import {
  convertToPlainText,
  deriveTxtFileName,
  TextConversionError,
} from './text-conversion';
import { buildObjectKey } from './storage';

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

  let text: string | null = null;
  let activeFile = file;

  const needsConversion =
    !file.file_name.toLowerCase().endsWith('.txt') ||
    (file.mime_type && file.mime_type !== 'text/plain');

  if (needsConversion) {
    let conversion;
    try {
      const buffer = await object.arrayBuffer();
      conversion = await convertToPlainText({
        arrayBuffer: buffer,
        fileName: file.file_name,
        mimeType: file.mime_type ?? object.httpMetadata?.contentType ?? undefined,
      });
    } catch (error) {
      if (error instanceof TextConversionError) {
        throw new HTTPException(400, { message: error.message });
      }
      console.error('Failed to convert file before ingestion', error);
      throw new HTTPException(500, { message: 'Failed to normalize file before ingestion.' });
    }

    const nextFileName = deriveTxtFileName(file.file_name);
    const nextKey = buildObjectKey({
      visibility: file.visibility,
      ownerId: file.owner_id,
      folderId: file.folder_id,
      fileId: file.id,
      fileName: nextFileName,
    });

    try {
      await env.MARBLE_FILES.put(nextKey, conversion.text, {
        httpMetadata: { contentType: 'text/plain' },
      });
      if (nextKey !== file.r2_key) {
        await env.MARBLE_FILES.delete(file.r2_key);
      }
    } catch (error) {
      console.error('Failed to persist converted text to R2', error);
      throw new HTTPException(500, { message: 'Failed to persist converted text to storage.' });
    }

    await updateFileAfterConversion(env, {
      id: file.id,
      fileName: nextFileName,
      r2Key: nextKey,
      size: conversion.bytes,
      mimeType: 'text/plain',
    });

    activeFile = {
      ...file,
      file_name: nextFileName,
      r2_key: nextKey,
      size: conversion.bytes,
      mime_type: 'text/plain',
    };
    text = conversion.text;
  } else {
    text = await object.text();
  }

  if (!text) {
    throw new HTTPException(400, { message: 'File appears to be empty after conversion.' });
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
      await deleteChunkVectors(env, existing, file.visibility, file.owner_id);
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
      file_id: activeFile.id,
      folder_id: activeFile.folder_id,
      owner_id: activeFile.owner_id,
      visibility: activeFile.visibility,
      chunk_index: index,
      start_line: chunk.startLine,
      end_line: chunk.endLine,
      content: chunk.content,
    });

    try {
      await upsertChunkVector(env, chunkId, embeddings[index], {
        chunkId,
        fileId: activeFile.id,
        folderId: activeFile.folder_id,
        folderName: activeFile.folder_name,
        fileName: activeFile.file_name,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        visibility: activeFile.visibility,
        ownerId: activeFile.owner_id,
      });
    } catch (error) {
      console.error('Vector upsert failed for chunk', chunkId, error);
      throw error;
    }

    if (index === 0) {
      console.log('First chunk upserted', {
        fileId: activeFile.id,
        chunkId,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        visibility: activeFile.visibility,
      });
    }

    insertedChunks += 1;
  }

  await updateFileStatus(env, activeFile.id, 'ready');

  console.log('Ingest completed', {
    fileId: activeFile.id,
    chunks: insertedChunks,
    visibility: activeFile.visibility,
  });

  return { chunks: insertedChunks };
}
