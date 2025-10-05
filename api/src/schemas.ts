import { z } from 'zod';

export const visibilityEnum = z.enum(['organization', 'personal', 'team']);

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

const visibilityFilterEnum = z.enum(['organization', 'personal', 'team', 'all']);

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
  teamId: z.string().optional().nullable(),
});

export const updateFolderInput = z
  .object({
    name: z.string().trim().min(1, 'Folder name is required').max(100).optional(),
    visibility: visibilityEnum.optional(),
    teamId: z.string().optional().nullable(),
  })
  .refine((value) => value.name !== undefined || value.visibility !== undefined || value.teamId !== undefined, {
    message: 'Provide a change to update the folder',
  });

export const updateFileInput = z
  .object({
    name: z.string().trim().min(1, 'File name is required').max(200).optional(),
    visibility: visibilityEnum.optional(),
    teamId: z.string().optional().nullable(),
  })
  .refine((value) => value.name !== undefined || value.visibility !== undefined || value.teamId !== undefined, {
    message: 'Provide a change to update the file',
  })
  .refine((value) => {
    if (value.visibility === 'team') {
      return Boolean(value.teamId);
    }
    return true;
  }, { message: 'Team updates require a team id.' });

export const rosterUploadInput = z.object({
  text: z.string().min(1, 'Roster file cannot be empty'),
});

export const createTeamInput = z.object({
  name: z.string().trim().min(1, 'Team name is required').max(80),
  description: z.string().trim().max(280).optional().nullable(),
});

export const inviteTeamMembersInput = z.object({
  userIds: z.array(z.string().min(1)).min(1, 'Select at least one user'),
});

export const updateTeamMemberRoleInput = z.object({
  role: z.enum(['member', 'manager', 'owner']),
});

export const updateFileSharingInput = z.object({
  visibility: visibilityEnum,
  teamId: z.string().optional().nullable(),
  permissions: z
    .array(
      z.object({
        userId: z.string().min(1),
        accessLevel: z.enum(['viewer', 'editor']),
      }),
    )
    .optional()
    .default([]),
});

export const directoryQuerySchema = z.object({
  q: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }),
});
