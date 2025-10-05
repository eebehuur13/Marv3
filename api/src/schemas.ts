import { z } from 'zod';

export const visibilityEnum = z.enum(['public', 'private']);

export const uploadUrlInput = z.object({
  folderId: z.string().min(1),
  folderName: z.string().min(1),
  visibility: visibilityEnum,
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
  mimeType: z.string().trim().optional(),
});

export const ingestInput = z.object({
  fileId: z.string().min(1),
});

export const chatInput = z.object({
  message: z.string().trim().min(1, 'Message is required'),
  knowledgeMode: z.boolean().optional(),
  scope: z.enum(['personal', 'team', 'org', 'all']).optional(),
});

const visibilityFilterEnum = z.enum(['public', 'private', 'all']);

export const listFilesQuery = z.object({
  folder_id: z.string().optional(),
  visibility: visibilityFilterEnum.optional(),
});

export const listFoldersQuery = z.object({
  visibility: visibilityFilterEnum.optional(),
});

export const createFolderInput = z.object({
  name: z.string().trim().min(1, 'Folder name is required').max(100),
  visibility: visibilityEnum,
});

export const updateFolderInput = z
  .object({
    name: z.string().trim().min(1, 'Folder name is required').max(100).optional(),
    visibility: visibilityEnum.optional(),
  })
  .refine((value) => value.name !== undefined || value.visibility !== undefined, {
    message: 'Provide a new name or visibility to update the folder',
  });
