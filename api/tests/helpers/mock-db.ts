// @ts-nocheck
import type { ChunkRecord, FileRecord, FolderRecord, Visibility } from '../../src/types';

interface UserRow {
  id: string;
  email: string;
  display_name?: string;
  avatar_url?: string;
  tenant: string;
  last_seen: string;
  created_at: string;
}

interface RunResult {
  results?: unknown[];
}

export class MockD1 implements D1Database {
  users = new Map<string, UserRow>();
  folders = new Map<string, FolderRecord & { deleted_at?: string | null }>();
  files = new Map<string, FileRecord>();
  chunks = new Map<string, ChunkRecord>();
  messages: unknown[] = [];

  prepare(query: string) {
    const db = this;
    return {
      args: [] as unknown[],
      bind(...args: unknown[]) {
        this.args = args;
        return this;
      },
      async run() {
        db.execute(query, this.args);
        return {} as RunResult;
      },
      async first<T>() {
        const result = db.execute(query, this.args);
        if (Array.isArray(result)) {
          return (result[0] as T) ?? null;
        }
        return (result as T) ?? null;
      },
      async all<T>() {
        const result = db.execute(query, this.args);
        if (Array.isArray(result)) {
          return { results: result as T[] };
        }
        if (!result) {
          return { results: [] };
        }
        return { results: [result as T] };
      },
    };
  }

  dump() {
    return {
      users: Array.from(this.users.values()),
      folders: Array.from(this.folders.values()),
      files: Array.from(this.files.values()),
      chunks: Array.from(this.chunks.values()),
      messages: this.messages,
    };
  }

  private execute(query: string, args: unknown[]) {
    const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('insert into users')) {
      const [id, email, displayName, avatarUrl, tenant, lastSeen] = args as [
        string,
        string,
        string | null,
        string | null,
        string,
        string,
      ];
      const existing = this.users.get(id);
      this.users.set(id, {
        id,
        email,
        display_name: displayName ?? undefined,
        avatar_url: avatarUrl ?? undefined,
        tenant,
        last_seen: lastSeen,
        created_at: existing?.created_at ?? new Date().toISOString(),
      });
      return null;
    }

    if (normalized.startsWith('update folders set name')) {
      const [id, name, visibility, ownerId, tenant] = args as [
        string,
        string,
        string,
        string | null,
        string,
      ];
      const folder = this.folders.get(id);
      if (folder && folder.tenant === tenant) {
        folder.name = name;
        folder.visibility = visibility as Visibility;
        folder.owner_id = ownerId;
        folder.updated_at = new Date().toISOString();
      }
      return null;
    }

    if (normalized.startsWith('insert into folders')) {
      if (args.length === 6) {
        const [id, tenant, ownerId, name, visibility] = args as [
          string,
          string,
          string | null,
          string,
          string,
        ];
        const timestamp = new Date().toISOString();
        this.folders.set(id, {
          id,
          tenant,
          owner_id: ownerId,
          name,
          visibility: visibility as 'public' | 'private',
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
        });
        return null;
      }

      if (args.length === 5) {
        const [id, tenant, name, visibility, ownerId] = args as [
          string,
          string,
          string,
          string,
          string | null,
        ];
        const existing = this.folders.get(id);
        const timestamp = existing?.created_at ?? new Date().toISOString();
        this.folders.set(id, {
          id,
          tenant,
          owner_id: ownerId,
          name,
          visibility: visibility as 'public' | 'private',
          created_at: timestamp,
          updated_at: new Date().toISOString(),
          deleted_at: existing?.deleted_at ?? null,
        });
        return null;
      }
    }

    if (normalized.startsWith('select id, tenant, owner_id, name, visibility, created_at, updated_at from folders')) {
      const [id] = args as [string];
      const folder = this.folders.get(id);
      if (!folder || folder.deleted_at) {
        return null;
      }
      return {
        id: folder.id,
        tenant: folder.tenant,
        owner_id: folder.owner_id,
        name: folder.name,
        visibility: folder.visibility,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
      } satisfies FolderRecord;
    }

    if (normalized.startsWith('update folders set name')) {
      const [id] = args as [string];
      const folder = this.folders.get(id);
      if (folder) {
        const [, name, visibility] = args as [string, string, string];
        folder.name = name;
        folder.visibility = visibility as 'public' | 'private';
        folder.updated_at = new Date().toISOString();
      }
      return null;
    }

    if (normalized.startsWith('select')) {
      if (normalized.includes('from folders f left join users')) {
        const [tenant, maybeOwner] = args as [string, string | undefined];
        const includePrivate = normalized.includes('or (f.visibility =');
        const filterPrivateOnly = normalized.includes("f.visibility = 'private'") && !includePrivate;
        const results = Array.from(this.folders.values())
          .filter((folder) => folder.tenant === tenant && !folder.deleted_at)
          .filter((folder) => {
            if (filterPrivateOnly) {
              return folder.visibility === 'private' && folder.owner_id === maybeOwner;
            }
            if (includePrivate && maybeOwner) {
              return folder.visibility === 'public' || folder.owner_id === maybeOwner;
            }
            if (normalized.includes("f.visibility = 'public'")) {
              return folder.visibility === 'public';
            }
            return true;
          })
          .map((folder) => {
            const owner = folder.owner_id ? this.users.get(folder.owner_id) : undefined;
            const fileCount = Array.from(this.files.values()).filter(
              (file) => file.folder_id === folder.id && !file.deleted_at,
            ).length;
            return {
              ...folder,
              file_count: fileCount,
              owner_email: owner?.email ?? null,
              owner_display_name: owner?.display_name ?? null,
            };
          });
        return results;
      }

      if (normalized.includes('from folders f left join users u on u.id = f.owner_id where f.id = ?1')) {
        const [id, tenant] = args as [string, string?];
        const folder = this.folders.get(id);
        if (!folder || folder.deleted_at) {
          return null;
        }
        if (tenant && folder.tenant !== tenant) {
          return null;
        }
        const owner = folder.owner_id ? this.users.get(folder.owner_id) : undefined;
        return {
          ...folder,
          owner_email: owner?.email ?? null,
          owner_display_name: owner?.display_name ?? null,
        };
      }

      if (normalized.includes('from files fi join folders fo on fo.id = fi.folder_id')) {
        if (normalized.includes('where fi.id = ?1')) {
          const [fileId, tenant] = args as [string, string?];
          const file = this.files.get(fileId);
          if (!file || file.deleted_at) {
            return null;
          }
          if (tenant && file.tenant !== tenant) {
            return null;
          }
          const folder = this.folders.get(file.folder_id);
          const owner = this.users.get(file.owner_id);
          if (!folder || folder.deleted_at || folder.tenant !== file.tenant || !owner) {
            return null;
          }
          return {
            ...file,
            folder_name: folder.name,
            folder_visibility: folder.visibility,
            owner_email: owner.email,
            owner_display_name: owner.display_name ?? null,
          };
        }

        const tenant = args[0] as string;
        let index = 1;
        let folderId: string | undefined;
        if (normalized.includes('fi.folder_id = ?')) {
          folderId = args[index++] as string;
        }
        let ownerFilter: string | undefined;
        const includesPrivateUnion = normalized.includes("or (fi.visibility = 'private'");
        const privateOnly = normalized.includes("fi.visibility = 'private' and fi.owner_id = ?");
        if (privateOnly || includesPrivateUnion) {
          ownerFilter = args[index++] as string;
        }

        const results = Array.from(this.files.values())
          .filter((file) => file.tenant === tenant && !file.deleted_at)
          .filter((file) => {
            const folder = this.folders.get(file.folder_id);
            if (!folder || folder.deleted_at || folder.tenant !== tenant) {
              return false;
            }
            if (folderId && file.folder_id !== folderId) {
              return false;
            }
            if (includesPrivateUnion && ownerFilter) {
              return file.visibility === 'public' || (file.visibility === 'private' && file.owner_id === ownerFilter);
            }
            if (privateOnly && ownerFilter) {
              return file.visibility === 'private' && file.owner_id === ownerFilter;
            }
            return file.visibility === 'public';
          })
          .map((file) => {
            const folder = this.folders.get(file.folder_id);
            const owner = this.users.get(file.owner_id);
            return {
              ...file,
              folder_name: folder?.name ?? 'Folder',
              folder_visibility: folder?.visibility ?? 'private',
              owner_email: owner?.email ?? '',
              owner_display_name: owner?.display_name ?? null,
            };
          });
        return results;
      }

      if (normalized.includes('from files f join folders d on d.id = f.folder_id')) {
        if (normalized.includes('where f.id = ?1')) {
          const [fileId] = args as [string];
          const file = this.files.get(fileId);
          if (!file || file.deleted_at) {
            return null;
          }
          const folder = this.folders.get(file.folder_id);
          const owner = this.users.get(file.owner_id);
          if (!folder || !owner) {
            return null;
          }
          return {
            ...file,
            folder_name: folder.name,
            folder_visibility: folder.visibility,
            owner_email: owner.email,
            owner_display_name: owner.display_name ?? null,
          };
        }

        const [tenant, maybeOwner] = args as [string, string | undefined, string | undefined];
        const isVisibilityPrivate = normalized.includes("f.visibility = 'private'") && !normalized.includes('or');
        const includePrivate = normalized.includes('or (f.visibility =');
        const folderFilter = normalized.includes('f.folder_id = ?');
        const results = Array.from(this.files.values())
          .filter((file) => file.tenant === tenant && !file.deleted_at)
          .filter((file) => {
            let index = 1;
            let folderId: string | undefined;
            if (folderFilter) {
              folderId = args[index++] as string;
            }
            let ownerId: string | undefined;
            if (isVisibilityPrivate || includePrivate) {
              ownerId = args[args.length - 1] as string;
            }
            if (folderId && file.folder_id !== folderId) {
              return false;
            }
            if (isVisibilityPrivate) {
              return file.visibility === 'private' && file.owner_id === ownerId;
            }
            if (normalized.includes("f.visibility = 'public'")) {
              return file.visibility === 'public';
            }
            if (includePrivate && ownerId) {
              return file.visibility === 'public' || file.owner_id === ownerId;
            }
            return true;
          })
          .map((file) => {
            const folder = this.folders.get(file.folder_id);
            const owner = this.users.get(file.owner_id);
            return {
              ...file,
              folder_name: folder?.name ?? 'Folder',
              folder_visibility: folder?.visibility ?? 'private',
              owner_email: owner?.email ?? '',
              owner_display_name: owner?.display_name ?? null,
            };
          });
        return results;
      }

      if (normalized.startsWith('select id from chunks where file_id')) {
        const [fileId] = args as [string];
        return Array.from(this.chunks.values())
          .filter((chunk) => chunk.file_id === fileId)
          .map((chunk) => ({ id: chunk.id }));
      }

      if (normalized.startsWith('select c.id')) {
        const ids = args as string[];
        return ids
          .map((id) => this.chunks.get(id))
          .filter(Boolean)
          .map((chunk) => {
            const file = chunk ? this.files.get(chunk.file_id) : undefined;
            const folder = file ? this.folders.get(file.folder_id) : undefined;
            return {
              ...chunk!,
              file_name: file?.file_name ?? 'file.txt',
              folder_name: folder?.name ?? 'Folder',
            };
          });
      }
    }

    if (normalized.startsWith('insert into files')) {
      const [id, tenant, folderId, ownerId, visibility, fileName, r2Key, size, mimeType, status] = args as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        string | null,
        FileRecord['status'],
      ];
      const timestamp = new Date().toISOString();
      this.files.set(id, {
        id,
        tenant,
        folder_id: folderId,
        owner_id: ownerId,
        visibility: visibility as 'public' | 'private',
        file_name: fileName,
        r2_key: r2Key,
        size,
        mime_type: mimeType ?? null,
        status,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      });
      return null;
    }

    if (normalized.startsWith('update files set status')) {
      const [fileId, status] = args as [string, FileRecord['status']];
      const file = this.files.get(fileId);
      if (file) {
        file.status = status;
        file.updated_at = new Date().toISOString();
      }
      return null;
    }

    if (normalized.startsWith('update files set ')) {
      const fileId = args[args.length - 1] as string;
      const file = this.files.get(fileId);
      if (file) {
        const setClause = normalized.split('set')[1].split('where')[0].split(',');
        let index = 0;
        setClause.forEach((clause) => {
          const trimmed = clause.trim();
          if (trimmed.startsWith('file_name =')) {
            file.file_name = args[index++] as string;
          } else if (trimmed.startsWith('visibility =')) {
            file.visibility = args[index++] as Visibility;
          } else if (trimmed.startsWith('folder_id =')) {
            file.folder_id = args[index++] as string;
          } else if (trimmed.startsWith('r2_key =')) {
            file.r2_key = args[index++] as string;
          } else if (trimmed.startsWith('mime_type =')) {
            file.mime_type = (args[index++] as string | null) ?? null;
          } else if (trimmed.startsWith('size =')) {
            file.size = args[index++] as number;
          }
        });
        file.updated_at = new Date().toISOString();
      }
      return null;
    }

    if (normalized.startsWith('update files set deleted_at')) {
      const [fileId] = args as [string];
      const file = this.files.get(fileId);
      if (file) {
        file.deleted_at = new Date().toISOString();
        file.updated_at = file.deleted_at;
      }
      return null;
    }

    if (normalized.startsWith('delete from files where id = ?1')) {
      const [fileId] = args as [string];
      this.files.delete(fileId);
      return null;
    }

    if (normalized.startsWith('delete from chunks where file_id')) {
      const [fileId] = args as [string];
      for (const [chunkId, chunk] of this.chunks.entries()) {
        if (chunk.file_id === fileId) {
          this.chunks.delete(chunkId);
        }
      }
      return null;
    }

    if (normalized.startsWith('insert into chunks')) {
      const [id, fileId, folderId, ownerId, visibility, chunkIndex, startLine, endLine, content] = args as [
        string,
        string,
        string,
        string,
        string,
        number,
        number,
        number,
        string,
      ];
      this.chunks.set(id, {
        id,
        file_id: fileId,
        folder_id: folderId,
        owner_id: ownerId,
        visibility: visibility as 'public' | 'private',
        chunk_index: chunkIndex,
        start_line: startLine,
        end_line: endLine,
        content,
        created_at: new Date().toISOString(),
      });
      return null;
    }

    if (normalized.startsWith('insert into messages')) {
      const record = {
        id: args[0],
        user_id: args[1],
        question: args[2],
        answer: args[3],
        citations: args[4],
      };
      this.messages.push(record);
      return null;
    }

    throw new Error(`Unsupported query in mock DB: ${query}`);
  }
}
