import type { VectorizeIndex } from '@cloudflare/workers-types';

export type Visibility = 'public' | 'private';

export interface MarbleBindings {
  MARBLE_DB: D1Database;
  MARBLE_FILES: R2Bucket;
  MARBLE_VECTORS: VectorizeIndex;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  VECTOR_TOP_K?: string;
  CHUNK_SIZE?: string;
  CHUNK_OVERLAP?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  SKIP_ACCESS_CHECK?: string;
  ALLOWED_ORIGIN?: string;
  DEFAULT_TENANT?: string;
}

export interface MarbleContext {
  user: AuthenticatedUser;
  env: MarbleBindings;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  tenant: string;
}

export interface FolderRecord {
  id: string;
  tenant: string;
  name: string;
  visibility: Visibility;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FileRecord {
  id: string;
  tenant: string;
  folder_id: string;
  owner_id: string;
  visibility: Visibility;
  file_name: string;
  r2_key: string;
  size: number;
  mime_type: string | null;
  status: 'uploading' | 'ready';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ChunkRecord {
  id: string;
  file_id: string;
  folder_id: string;
  owner_id: string;
  visibility: Visibility;
  chunk_index: number;
  start_line: number;
  end_line: number;
  content: string;
  created_at: string;
}

export interface ChatCitation {
  folder: string;
  file: string;
  lines: [number, number];
}

export interface ChatResult {
  answer: string;
  citations: ChatCitation[];
}
