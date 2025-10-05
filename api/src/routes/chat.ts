import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context';
import { createEmbeddings, generateGeneralAnswer, generateStructuredAnswer } from '../lib/openai';
import { chatInput } from '../schemas';
import { getChunksByIds, recordChat } from '../lib/db';
import {
  organizationNamespace,
  personalNamespace,
  queryNamespace,
  teamNamespace,
  type VectorMatch,
} from '../lib/vectorize';
import { listActiveTeamIdsForUser } from '../lib/org';

// Normalize embedding provider output to number[]
function normalizeQuestionEmbedding(maybe: any): number[] {
  if (maybe && Array.isArray(maybe.data) && maybe.data[0]?.embedding) {
    return maybe.data[0].embedding as number[];
  }
  if (Array.isArray(maybe) && Array.isArray(maybe[0])) {
    return maybe[0] as number[];
  }
  if (Array.isArray(maybe) && typeof maybe[0] === 'number') {
    return maybe as number[];
  }
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
  const organisationId = user.organizationId ?? user.tenant ?? c.env.DEFAULT_TENANT ?? 'default';
  const teamIds = await listActiveTeamIdsForUser(c.env, user.id);

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

  const namespaces: string[] = [];
  if (scope === 'all' || scope === 'org') {
    namespaces.push(organizationNamespace(organisationId));
  }
  if (scope === 'all' || scope === 'personal') {
    namespaces.push(personalNamespace(user.id));
  }
  if ((scope === 'all' || scope === 'team') && teamIds.length) {
    namespaces.push(...teamIds.map((teamId) => teamNamespace(teamId)));
  }

  if (scope === 'team' && !teamIds.length) {
    const chatId = crypto.randomUUID();
    const placeholder = 'Join a team to search team-specific knowledge. You are not a member of any teams yet.';
    await recordChat(c.env, {
      id: chatId,
      user_id: user.id,
      question: rawMessage,
      answer: placeholder,
      citations: JSON.stringify([]),
    });
    return c.json({ id: chatId, answer: placeholder, citations: [], sources: [] });
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

  const structured = await generateStructuredAnswer(c.env, {
    question: lookupQuery,
    contexts,
  });

  const chatId = crypto.randomUUID();
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
    sources: contexts,
  });
}
