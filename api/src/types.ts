import type { VectorizeIndex } from '@cloudflare/workers-types';

export type Visibility = 'personal' | 'team' | 'organization';
export type OrganizationRole = 'member' | 'admin' | 'owner';
export type TeamRole = 'member' | 'manager' | 'owner';
export type InviteStatus = 'pending' | 'invited' | 'active' | 'removed';
export type TeamMemberStatus = 'pending' | 'active' | 'removed';
export type FileAccessLevel = 'viewer' | 'editor';

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
  organizationId?: string;
  organizationRole?: OrganizationRole;
  primaryTeamId?: string | null;
  username?: string | null;
  title?: string | null;
}

export interface OrganisationRecord {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganisationRosterEntry {
  id: string;
  organisation_id: string;
  user_id: string | null;
  email: string;
  display_name: string | null;
  role: OrganizationRole;
  status: InviteStatus;
  invited_by: string | null;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamRecord {
  id: string;
  organisation_id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberRecord {
  team_id: string;
  user_id: string;
  role: TeamRole;
  status: TeamMemberStatus;
  invited_by: string | null;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderRecord {
  id: string;
  tenant: string;
  organization_id: string;
  name: string;
  visibility: Visibility;
  owner_id: string | null;
  team_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FileRecord {
  id: string;
  tenant: string;
  organization_id: string;
  folder_id: string;
  owner_id: string;
  team_id: string | null;
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

export interface FilePermissionRecord {
  file_id: string;
  user_id: string;
  access_level: FileAccessLevel;
  granted_by: string | null;
  created_at: string;
}

export interface ChunkRecord {
  id: string;
  file_id: string;
  folder_id: string;
  organization_id: string;
  owner_id: string;
  team_id: string | null;
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
