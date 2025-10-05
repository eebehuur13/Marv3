import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import { createEmbeddings, generateGeneralAnswer, generateStructuredAnswer } from '../lib/openai';
import { chatInput } from '../schemas';
import { getChunksByIds, recordChat } from '../lib/db';
import { privateNamespace, publicNamespace, queryNamespace, type VectorMatch } from '../lib/vectorize';

// Normalize embedding provider output to number[]
function normalizeQuestionEmbedding(maybe: any): number[] {
  // OpenAI embeddings: { data: [{ embedding: number[] }] }
  if (maybe && Array.isArray(maybe.data) && maybe.data[0]?.embedding) {
    return maybe.data[0].embedding as number[];
  }
  // number[][] (e.g. direct return from createEmbeddings)
  if (Array.isArray(maybe) && Array.isArray(maybe[0])) {
    return maybe[0] as number[];
  }
  // Already number[]
  if (Array.isArray(maybe) && typeof maybe[0] === 'number') {
    return maybe as number[];
  }
  // Some wrappers: { vectors: number[][] }
  if (maybe && Array.isArray(maybe.vectors) && Array.isArray(maybe.vectors[0])) {
    return maybe.vectors[0] as number[];
  }
  throw new Error('Question embedding not in a known format');
}

function parseTopK(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

export async function handleChat(c: AppContext) {
  const user = c.get('user');
  const requestBody = await c.req.json();
  const parsed = chatInput.safeParse(requestBody);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const rawMessage = parsed.data.message.trim();
  if (!rawMessage) {
    throw new HTTPException(400, { message: 'Message cannot be empty' });
  }

  const knowledgeMode = parsed.data.knowledgeMode ?? false;
  const scope = parsed.data.scope ?? 'all';
  const lookupMatch = rawMessage.match(/^\/lookup\s*(.*)$/i);
  const shouldLookup = knowledgeMode || Boolean(lookupMatch);

  if (!shouldLookup) {
    const chatId = crypto.randomUUID();
    const structured = await generateGeneralAnswer(c.env, rawMessage);

    await recordChat(c.env, {
      id: chatId,
      user_id: user.id,
      question: rawMessage,
      answer: structured.answer,
      citations: JSON.stringify(structured.citations ?? []),
    });

    return c.json({
      id: chatId,
      answer: structured.answer,
      citations: structured.citations ?? [],
      sources: [],
    });
  }

  if (scope === 'team') {
    const chatId = crypto.randomUUID();
    const placeholder =
      'Team-scope search is coming soon. For now, choose Personal, Organization, or All to search indexed content.';
    await recordChat(c.env, {
      id: chatId,
      user_id: user.id,
      question: rawMessage,
      answer: placeholder,
      citations: JSON.stringify([]),
    });
    return c.json({
      id: chatId,
      answer: placeholder,
      citations: [],
      sources: [],
    });
  }

  const lookupQuery = lookupMatch ? (lookupMatch[1] ?? '').trim() : rawMessage;
  if (!lookupQuery) {
    throw new HTTPException(400, { message: 'Knowledge mode requires a non-empty question' });
  }

  // 1) Embed & normalize to number[]
  let embedding: number[];
  try {
    const raw = await createEmbeddings(c.env, [lookupQuery]);
    embedding = normalizeQuestionEmbedding(raw);
  } catch (e: any) {
    throw new HTTPException(500, { message: `Failed to embed lookup: ${e?.message || String(e)}` });
  }

  const topK = parseTopK(c.env.VECTOR_TOP_K);

  // 2) Query public + private; if a namespace errors, return []
  const namespaces: string[] = [];
  if (scope === 'all' || scope === 'org') {
    namespaces.push(publicNamespace());
  }
  if (scope === 'all' || scope === 'personal') {
    namespaces.push(privateNamespace(user.id));
  }
  const results = await Promise.all(
    namespaces.map(async (namespace) => {
      try {
        return await queryNamespace(c.env, { namespace, vector: embedding, topK });
      } catch (err) {
        console.error('queryNamespace error for', namespace, err);
        return [] as VectorMatch[];
      }
    }),
  );

  // 3) Merge by best score per chunk
  const merged = new Map<string, { score: number; match: VectorMatch }>();
  results.flat().forEach((match) => {
    const prev = merged.get(match.chunkId);
    if (!prev || (match.score ?? 0) > prev.score) {
      merged.set(match.chunkId, { score: match.score ?? 0, match });
    }
  });

  const topMatches = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const chunkIds = topMatches.map((e) => e.match.chunkId);
  console.log('Lookup results', {
    query: lookupQuery,
    topK,
    matches: topMatches.length,
    scope,
  });
  if (!chunkIds.length) {
    const chatId = crypto.randomUUID();
    return c.json({
      id: chatId,
      answer: "I couldn't find anything relevant in your Marble files.",
      citations: [],
      sources: [],
    });
  }

  // 4) Pull chunk rows (for content)
  const chunks = await getChunksByIds(c.env, chunkIds);
  const byId = new Map(chunks.map((ch) => [ch.id, ch]));

  const contexts = topMatches
    .map((e, index) => {
      const ch = byId.get(e.match.chunkId);
      if (!ch) return null;
      return {
        order: index,
        chunkId: ch.id,
        folderName: ch.folder_name,
        fileName: ch.file_name,
        startLine: ch.start_line,
        endLine: ch.end_line,
        content: ch.content,
      };
    })
    .filter(Boolean) as Array<{
      order: number;
      chunkId: string;
      folderName: string;
      fileName: string;
      startLine: number;
      endLine: number;
      content: string;
    }>;

  if (!contexts.length) {
    const chatId = crypto.randomUUID();
    return c.json({
      id: chatId,
      answer: "I couldn't find anything relevant in your Marble files.",
      citations: [],
      sources: [],
    });
  }

  console.log('Lookup contexts selected', {
    query: lookupQuery,
    contexts: contexts.length,
    first: contexts[0]?.chunkId,
  });

  // 5) Ask your LLM to synthesize
  const structured = await generateStructuredAnswer(
    c.env,
    rawMessage,
    contexts.map((cxt) => ({
      folderName: cxt.folderName,
      fileName: cxt.fileName,
      startLine: cxt.startLine,
      endLine: cxt.endLine,
      content: cxt.content,
    })),
  );

  const chatId = crypto.randomUUID();
  await recordChat(c.env, {
    id: chatId,
    user_id: user.id,
    question: rawMessage,
    answer: structured.answer,
    citations: JSON.stringify(structured.citations),
  });

  return c.json({
    id: chatId,
    answer: structured.answer,
    citations: structured.citations,
    sources: contexts,
  });
}
