import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  API_BASE,
  createFolder,
  deleteFile,
  deleteFolder,
  fetchFiles,
  fetchFolders,
  type FileSummary,
  type FolderSummary,
  type Visibility,
  updateFile,
  updateFolder,
  uploadFile,
} from '../lib/api';

const VAULT_VISIBILITY_STORAGE_KEY = 'marble-vault-visibility';

interface FileManagerProps {
  currentUserId: string;
}

interface UploadDialogProps {
  open: boolean;
  visibility: Visibility;
  folders: FolderSummary[];
  onClose: () => void;
  onUpload: (args: { file: File; folderId: string; visibility: Visibility; name?: string }) => void;
  isUploading: boolean;
  defaultFolderId?: string | null;
}

function UploadDialog({
  open,
  visibility,
  folders,
  onClose,
  onUpload,
  isUploading,
  defaultFolderId,
}: UploadDialogProps) {
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const ACCEPTED_EXTENSIONS = ['.txt', '.pdf', '.docx'];
  const [selectedVisibility, setSelectedVisibility] = useState<Visibility>(visibility);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedVisibility(visibility);
  }, [visibility]);

  const scopedFolders = useMemo(
    () => folders.filter((folder) => folder.visibility === selectedVisibility),
    [folders, selectedVisibility],
  );

  useEffect(() => {
    if (defaultFolderId && scopedFolders.some((folder) => folder.id === defaultFolderId)) {
      setSelectedFolderId(defaultFolderId);
      return;
    }
    setSelectedFolderId(scopedFolders[0]?.id ?? null);
  }, [scopedFolders, defaultFolderId]);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setName('');
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog-card">
        <header>
          <h3>Upload File</h3>
        </header>
        <div className="dialog-body">
          <label className="field">
            <span>Mode</span>
            <div className="segmented">
              <button
                type="button"
                className={selectedVisibility === 'private' ? 'active' : ''}
                onClick={() => setSelectedVisibility('private')}
                disabled={isUploading}
              >
                Private
              </button>
              <button
                type="button"
                className={selectedVisibility === 'public' ? 'active' : ''}
                onClick={() => setSelectedVisibility('public')}
                disabled={isUploading}
              >
                Org Shared
              </button>
            </div>
          </label>

          <label className="field">
            <span>Folder</span>
            <select
              value={selectedFolderId ?? ''}
              onChange={(event) => setSelectedFolderId(event.target.value || null)}
              disabled={isUploading || scopedFolders.length === 0}
            >
              {scopedFolders.length === 0 && <option value="">No folders available</option>}
              {scopedFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>File</span>
            <input
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(',')}
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                if (!chosen) {
                  setFile(null);
                  setName('');
                  return;
                }
                const lower = chosen.name.toLowerCase();
                const supported = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
                if (!supported) {
                  setError('Only .pdf, .docx, or .txt files are supported.');
                  setFile(null);
                  return;
                }
                if (chosen.size > MAX_UPLOAD_BYTES) {
                  setError('File must be 5 MB or smaller.');
                  setFile(null);
                  return;
                }
                setError(null);
                setFile(chosen);
                setName(chosen.name.replace(/\.[^.]+$/, ''));
              }}
              disabled={isUploading}
            />
          </label>

          <label className="field">
            <span>Display Name</span>
            <input
              type="text"
              value={name}
              placeholder="Optional custom name"
              onChange={(event) => setName(event.target.value)}
              disabled={isUploading}
            />
          </label>

          {error && <p className="error-text">{error}</p>}
          <p className="helper-text">
            PDF, DOCX, or TXT files up to 5&nbsp;MB are converted to plain text before ingesting.
          </p>
        </div>
        <footer className="dialog-footer">
          <button type="button" className="link" onClick={onClose} disabled={isUploading}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!file || !selectedFolderId) {
                setError('Select a folder and file to continue.');
                return;
              }
              const trimmed = name.trim();
              const finalName = trimmed
                ? trimmed.toLowerCase().endsWith('.txt')
                  ? trimmed
                  : `${trimmed}.txt`
                : undefined;
              onUpload({
                file,
                folderId: selectedFolderId,
                visibility: selectedVisibility,
                name: finalName,
              });
            }}
            disabled={isUploading || !file || !selectedFolderId}
          >
            {isUploading ? 'Uploading…' : 'Upload'}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface FolderDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (args: { name: string; visibility: Visibility }) => void;
  isSaving: boolean;
  defaultVisibility: Visibility;
}

function FolderDialog({ open, onClose, onCreate, isSaving, defaultVisibility }: FolderDialogProps) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setError(null);
      return;
    }
    setName('');
    setError(null);
    setVisibility(defaultVisibility);
  }, [open, defaultVisibility]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog-card">
        <header>
          <h3>New Folder</h3>
        </header>
        <div className="dialog-body">
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Q1 Plans"
              disabled={isSaving}
            />
          </label>
          <label className="field">
            <span>Visibility</span>
            <div className="segmented">
              <button
                type="button"
                className={visibility === 'private' ? 'active' : ''}
                onClick={() => setVisibility('private')}
                disabled={isSaving}
              >
                Private
              </button>
              <button
                type="button"
                className={visibility === 'public' ? 'active' : ''}
                onClick={() => setVisibility('public')}
                disabled={isSaving}
              >
                Org Shared
              </button>
            </div>
          </label>
          {error && <p className="error-text">{error}</p>}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="link" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!name.trim()) {
                setError('Folder name is required');
                return;
              }
              onCreate({ name: name.trim(), visibility });
            }}
            disabled={isSaving}
          >
            {isSaving ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

type FileSortField = 'name' | 'owner' | 'visibility' | 'updatedAt';

export function FileManager({ currentUserId }: FileManagerProps) {
  const [visibilityFilter, setVisibilityFilter] = useState<Visibility>(() => {
    if (typeof window === 'undefined') {
      return 'private';
    }
    const stored = window.sessionStorage.getItem(VAULT_VISIBILITY_STORAGE_KEY);
    return stored === 'public' ? 'public' : 'private';
  });
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<FileSortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showUpload, setShowUpload] = useState(false);
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [folderRenameId, setFolderRenameId] = useState<string | null>(null);
  const [folderRenameDraft, setFolderRenameDraft] = useState('');
  const [alert, setAlert] = useState<{ type: 'info' | 'error'; message: string } | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [activeFileMenuId, setActiveFileMenuId] = useState<string | null>(null);
  const [activeFolderMenuId, setActiveFolderMenuId] = useState<string | null>(null);
  const [isFolderToolbarMenuOpen, setIsFolderToolbarMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.sessionStorage.setItem(VAULT_VISIBILITY_STORAGE_KEY, visibilityFilter);
  }, [visibilityFilter]);

  function canManageFolder(folder: FolderSummary | null): boolean {
    if (!folder) {
      return false;
    }
    if (folder.visibility === 'public') {
      return folder.owner?.id === currentUserId;
    }
    if (!folder.owner?.id) {
      return true;
    }
    return folder.owner.id === currentUserId;
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const closeMenus = () => {
      setActiveFileMenuId(null);
      setActiveFolderMenuId(null);
      setIsFolderToolbarMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeMenus);
    return () => window.removeEventListener('pointerdown', closeMenus);
  }, []);

  const foldersQuery = useQuery({
    queryKey: ['folders', 'all'],
    queryFn: () => fetchFolders({ visibility: 'all' }),
  });

  const folders: FolderSummary[] = foldersQuery.data?.folders ?? [];

  const manageableFolders = useMemo(
    () => folders.filter((folder) => canManageFolder(folder)),
    [folders, currentUserId],
  );

  const privateFolders = useMemo(
    () => folders.filter((folder) => folder.visibility === 'private'),
    [folders],
  );
  const publicFolders = useMemo(
    () => folders.filter((folder) => folder.visibility === 'public'),
    [folders],
  );

  useEffect(() => {
    const scoped = visibilityFilter === 'private' ? privateFolders : publicFolders;
    setSelectedFolderId((prev) => {
      if (prev && scoped.some((folder) => folder.id === prev)) {
        return prev;
      }
      const preferred = scoped.find((folder) => canManageFolder(folder)) ?? scoped[0];
      return preferred ? preferred.id : null;
    });
  }, [visibilityFilter, privateFolders, publicFolders, currentUserId]);

  useEffect(() => {
    setIsFolderToolbarMenuOpen(false);
  }, [selectedFolderId]);

  const scopedFolders = visibilityFilter === 'private' ? privateFolders : publicFolders;
  const selectedFolder = scopedFolders.find((folder) => folder.id === selectedFolderId) ?? null;

  const filesQuery = useQuery({
    queryKey: ['files', visibilityFilter, selectedFolderId ?? 'all'],
    queryFn: () =>
      fetchFiles({
        visibility: visibilityFilter,
        folderId: selectedFolderId ?? undefined,
      }),
    enabled: Boolean(selectedFolderId) || visibilityFilter === 'public',
  });

  const files = filesQuery.data?.files ?? [];
  const isLoadingFiles = filesQuery.isLoading;

  useEffect(() => {
    setSelectedFileIds((prev) =>
      prev.filter((id) => files.some((file) => file.id === id && file.owner.id === currentUserId)),
    );
  }, [files, currentUserId]);

  useEffect(() => {
    if (!inlineRenameId) return;
    if (!files.some((file) => file.id === inlineRenameId)) {
      setInlineRenameId(null);
      setRenameDraft('');
    }
  }, [files, inlineRenameId]);

  useEffect(() => {
    if (!folderRenameId) return;
    if (!folders.some((folder) => folder.id === folderRenameId)) {
      setFolderRenameId(null);
      setFolderRenameDraft('');
    }
  }, [folders, folderRenameId]);

  const timestampFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    [],
  );

  const visibleFiles = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    const filtered = files.filter((file) => {
      if (!normalized) return true;
      const ownerLabel = (file.owner.displayName ?? file.owner.email).toLowerCase();
      return file.name.toLowerCase().includes(normalized) || ownerLabel.includes(normalized);
    });
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let result = 0;
      if (sortField === 'name') {
        result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      } else if (sortField === 'owner') {
        const ownerA = (a.owner.displayName ?? a.owner.email).toLowerCase();
        const ownerB = (b.owner.displayName ?? b.owner.email).toLowerCase();
        result = ownerA.localeCompare(ownerB);
      } else if (sortField === 'visibility') {
        result = a.visibility.localeCompare(b.visibility);
      } else {
        result = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return result * multiplier;
    });
  }, [files, searchTerm, sortField, sortDirection]);

  const isOwner = (file: FileSummary) => file.owner.id === currentUserId;
  const selectableFiles = files.filter(isOwner);
  const allSelectableSelected =
    selectableFiles.length > 0 && selectableFiles.every((file) => selectedFileIds.includes(file.id));
  const isBulkActionDisabled = selectedFileIds.length === 0;

  const uploadMutation = useMutation({
    mutationFn: async ({
      file,
      folderId,
      folderName,
      visibility,
      name,
    }: {
      file: File;
      folderId: string;
      folderName?: string;
      visibility: Visibility;
      name?: string;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folderId', folderId);
      formData.append('visibility', visibility);
      if (name) {
        formData.append('name', name);
      }
      if (folderName) {
        formData.append('folderName', folderName);
      }
      await uploadFile(formData);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files'] }),
        queryClient.invalidateQueries({ queryKey: ['folders'] }),
      ]);
      setShowUpload(false);
      setAlert({ type: 'info', message: 'Upload complete. Document is ready for search.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setAlert({ type: 'error', message });
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: createFolder,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folders', 'all'] });
      setShowFolderDialog(false);
      setAlert({ type: 'info', message: 'Folder created.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to create folder';
      setAlert({ type: 'error', message });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateFile(id, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
      setInlineRenameId(null);
      setRenameDraft('');
      setAlert({ type: 'info', message: 'File renamed.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Rename failed';
      setAlert({ type: 'error', message });
    },
  });

  const folderRenameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateFolder(id, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folders', 'all'] });
      setFolderRenameId(null);
      setFolderRenameDraft('');
      setAlert({ type: 'info', message: 'Folder renamed.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to rename folder';
      setAlert({ type: 'error', message });
    },
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: Visibility }) => updateFile(id, { visibility }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files'] }),
        queryClient.invalidateQueries({ queryKey: ['folders'] }),
      ]);
      setAlert({ type: 'info', message: 'Visibility updated.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to update visibility';
      setAlert({ type: 'error', message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFile(id),
    onSuccess: async (_, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files'] }),
        queryClient.invalidateQueries({ queryKey: ['folders'] }),
      ]);
      setSelectedFileIds((prev) => prev.filter((value) => value !== id));
      setActiveFileMenuId(null);
      setAlert({ type: 'info', message: 'File deleted.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Delete failed';
      setAlert({ type: 'error', message });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await deleteFile(id);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files'] }),
        queryClient.invalidateQueries({ queryKey: ['folders'] }),
      ]);
      setSelectedFileIds([]);
      setAlert({ type: 'info', message: 'Files removed.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Bulk delete failed';
      setAlert({ type: 'error', message });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: ({ id }: { id: string; name: string; fileCount: number }) => deleteFolder(id),
    onSuccess: async (result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['folders', 'all'] }),
        queryClient.invalidateQueries({ queryKey: ['files'] }),
      ]);
      setSelectedFolderId((prev) => (prev === variables.id ? null : prev));
      setSelectedFileIds([]);
      setActiveFolderMenuId(null);
      setFolderRenameId(null);
      const removedFiles = result?.removedFiles ?? 0;
      const descriptor = removedFiles === 1 ? 'file' : 'files';
      const message =
        removedFiles > 0
          ? `Deleted "${variables.name}" and ${removedFiles} ${descriptor}.`
          : `Deleted "${variables.name}".`;
      setAlert({ type: 'info', message });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to delete folder';
      setAlert({ type: 'error', message });
    },
  });

  const toggleFileSelection = (id: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    );
  };

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedFileIds([]);
    } else {
      setSelectedFileIds(selectableFiles.map((file) => file.id));
    }
  };

  const clearSelection = () => setSelectedFileIds([]);

  const handleSort = (field: FileSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'updatedAt' ? 'desc' : 'asc');
    }
  };

  const getAriaSort = (field: FileSortField): 'ascending' | 'descending' | 'none' => {
    if (sortField !== field) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  const startFileRename = (file: FileSummary) => {
    setInlineRenameId(file.id);
    setRenameDraft(file.name);
    setActiveFileMenuId(null);
  };

  const cancelFileRename = () => {
    setInlineRenameId(null);
    setRenameDraft('');
  };

  const commitFileRename = () => {
    if (!inlineRenameId) return;
    const target = files.find((file) => file.id === inlineRenameId);
    if (!target) {
      cancelFileRename();
      return;
    }
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setAlert({ type: 'error', message: 'File name is required.' });
      return;
    }
    if (trimmed === target.name) {
      cancelFileRename();
      return;
    }
    renameMutation.mutate({ id: inlineRenameId, name: trimmed });
  };

  const startFolderRename = (folder: FolderSummary) => {
    setFolderRenameId(folder.id);
    setFolderRenameDraft(folder.name);
    setActiveFolderMenuId(null);
  };

  const cancelFolderRename = () => {
    setFolderRenameId(null);
    setFolderRenameDraft('');
  };

  const commitFolderRename = () => {
    if (!folderRenameId) return;
    const target = folders.find((folder) => folder.id === folderRenameId);
    if (!target) {
      cancelFolderRename();
      return;
    }
    const trimmed = folderRenameDraft.trim();
    if (!trimmed) {
      setAlert({ type: 'error', message: 'Folder name is required.' });
      return;
    }
    if (trimmed === target.name) {
      cancelFolderRename();
      return;
    }
    folderRenameMutation.mutate({ id: folderRenameId, name: trimmed });
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    const target = selectedFolder;
    if (!target || !canManageFolder(target)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
      setIsDragging(false);
      return;
    }
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const target = selectedFolder;
    if (!target || !canManageFolder(target)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!selectedFolder) {
      setIsDragging(false);
      return;
    }
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) {
      return;
    }
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const targetFolder = selectedFolder;
    if (!targetFolder) {
      setIsDragging(false);
      setAlert({ type: 'error', message: 'Pick a folder before uploading.' });
      return;
    }
    if (!canManageFolder(targetFolder)) {
      setIsDragging(false);
      setAlert({
        type: 'error',
        message:
          targetFolder.visibility === 'public'
            ? 'Only the folder owner can upload to this shared folder.'
            : 'You do not have permission to upload to this folder.',
      });
      return;
    }
    setIsDragging(false);
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length === 0) {
      return;
    }
    const allowed = droppedFiles.filter((file) => file.name.toLowerCase().endsWith('.txt'));
    if (allowed.length === 0) {
      setAlert({ type: 'error', message: 'Only .txt files are supported right now.' });
      return;
    }
    if (allowed.length !== droppedFiles.length) {
      setAlert({ type: 'info', message: 'Unsupported files skipped. Uploading .txt documents only.' });
    }
    void (async () => {
      try {
        for (const file of allowed) {
          await uploadMutation.mutateAsync({
            file,
            folderId: targetFolder.id,
            folderName: targetFolder.name,
            visibility: targetFolder.visibility,
            name: file.name,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        setAlert({ type: 'error', message });
      }
    })();
  };

  const getFolderDeleteMeta = (folder: FolderSummary) => {
    if (folder.id === 'public-root' || folder.id === 'private-root') {
      return { disabled: true, reason: 'This folder is required by Marble.', requiresConfirm: false };
    }
    if (!canManageFolder(folder)) {
      const reason =
        folder.visibility === 'public'
          ? 'Shared folders you do not own are view-only.'
          : 'Only the folder owner can manage this space.';
      return { disabled: true, reason, requiresConfirm: false };
    }
    return {
      disabled: false,
      reason: undefined as string | undefined,
      requiresConfirm: folder.fileCount > 0,
    };
  };

  const selectedFolderUpdatedLabel = selectedFolder
    ? timestampFormatter.format(new Date(selectedFolder.updatedAt))
    : null;
  const selectedFolderOwnerLabel = selectedFolder?.owner
    ? selectedFolder.owner.displayName ?? selectedFolder.owner.email
    : null;
  const isOrgSpace = visibilityFilter === 'public';
  const spaceLabel = isOrgSpace ? 'Org Shared' : 'Private';
  const sidebarTitle = isOrgSpace ? 'Org folders' : 'Private folders';
  const selectedFolderFileCountLabel = selectedFolder
    ? `${selectedFolder.fileCount} ${selectedFolder.fileCount === 1 ? 'file' : 'files'}`
    : null;
  const selectedFolderDeleteMeta = selectedFolder ? getFolderDeleteMeta(selectedFolder) : null;
  const canManageSelectedFolder = canManageFolder(selectedFolder);
  const canDeleteSelectedFolder = Boolean(canManageSelectedFolder && selectedFolderDeleteMeta && !selectedFolderDeleteMeta.disabled);
  const uploadButtonLabel = 'Upload file';

  return (
    <section className="files-workspace">
      <header className="files-workspace__hero">
        <div className="files-workspace__hero-summary">
          <h2>Files &amp; Folders</h2>
          <p className="files-workspace__hero-subtitle">Curate the documents Marble references across your workspace.</p>
        </div>
        <div className="files-workspace__hero-controls">
          <div className="files-workspace__space-toggle" role="tablist" aria-label="Workspace visibility">
            <button
              type="button"
              role="tab"
              aria-selected={!isOrgSpace}
              className={!isOrgSpace ? 'is-active' : ''}
              onClick={() => setVisibilityFilter('private')}
            >
              <span className="files-workspace__space-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
                  <path
                    d="M6.5 8.5V7a3.5 3.5 0 1 1 7 0v1.5h1.75c.41 0 .75.34.75.75v7c0 .41-.34.75-.75.75H4.75A.75.75 0 0 1 4 17.25v-7c0-.41.34-.75.75-.75H6.5Zm1.5 0h4V7a2 2 0 0 0-4 0v1.5Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span>Private</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isOrgSpace}
              className={isOrgSpace ? 'is-active' : ''}
              onClick={() => setVisibilityFilter('public')}
            >
              <span className="files-workspace__space-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
                  <path
                    d="M6.5 9a2.5 2.5 0 1 1 2.45 2.5H9a4 4 0 0 1 4 4v1a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 16.5v-1a4 4 0 0 1 4-4h.05A2.5 2.5 0 0 1 6.5 9Zm7.75-.5a2 2 0 1 1-1.6 3.2 4.01 4.01 0 0 1 2.35 3.3H17a.5.5 0 0 0 .5-.5v-.65a3.5 3.5 0 0 0-2.76-3.43 2 2 0 0 1-.49-1.37v-.55Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span>Org Shared</span>
            </button>
          </div>
        </div>
      </header>

      {alert && (
        <div className={`files-workspace__alert files-workspace__alert--${alert.type}`}>
          <span>{alert.message}</span>
          <button type="button" onClick={() => setAlert(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}

      <div className="files-workspace__grid">
        <aside className="files-workspace__sidebar">
          <div className="files-workspace__sidebar-header">
            <span>{sidebarTitle}</span>
            <span className="files-workspace__sidebar-count">{scopedFolders.length}</span>
          </div>

          {scopedFolders.length === 0 ? (
            <div className="files-workspace__sidebar-empty">
              <p className="muted">No folders yet. Use the New Folder button below to get started.</p>
            </div>
          ) : (
            <ul className="files-workspace__folder-list">
              {scopedFolders.map((folder) => {
                const isActive = selectedFolderId === folder.id;
                const canManage = canManageFolder(folder);
                const { disabled, reason, requiresConfirm } = getFolderDeleteMeta(folder);
                const isRenaming = folderRenameId === folder.id;
                const menuOpen = activeFolderMenuId === folder.id;
                return (
                  <li key={folder.id}>
                    {isRenaming ? (
                      <form
                        className="folder-rename"
                        onSubmit={(event) => {
                          event.preventDefault();
                          commitFolderRename();
                        }}
                      >
                        <input
                          autoFocus
                          value={folderRenameDraft}
                          onChange={(event) => setFolderRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelFolderRename();
                            } else if (event.key === 'Enter') {
                              event.preventDefault();
                              commitFolderRename();
                            }
                          }}
                          onBlur={commitFolderRename}
                          disabled={folderRenameMutation.isPending}
                        />
                        <div className="folder-rename__actions">
                          <button type="button" className="link" onClick={cancelFolderRename}>
                            Cancel
                          </button>
                          <button type="submit" disabled={folderRenameMutation.isPending}>
                            {folderRenameMutation.isPending ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className={`folder-row${isActive ? ' is-active' : ''}`}>
                        <button
                          type="button"
                          className="folder-row__main"
                          onClick={() => setSelectedFolderId(folder.id)}
                        >
                          <span className="folder-row__name">{folder.name}</span>
                          <span className="folder-row__count">{folder.fileCount}</span>
                        </button>
                        {canManage && (
                          <div className="folder-row__actions">
                            <button
                              type="button"
                              className="icon-button"
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                              aria-label="Folder actions"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveFolderMenuId((prev) => (prev === folder.id ? null : folder.id));
                              }}
                            >
                              <span aria-hidden="true">...</span>
                            </button>
                            {menuOpen && (
                              <div
                                className="folder-row__menu"
                                role="menu"
                                onPointerDown={(event) => event.stopPropagation()}
                              >
                                <button type="button" role="menuitem" onClick={() => startFolderRename(folder)}>
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={disabled || deleteFolderMutation.isPending}
                                  title={disabled ? reason : undefined}
                                  onClick={() => {
                                    if (requiresConfirm && typeof window !== 'undefined') {
                                      const descriptor = folder.fileCount === 1 ? 'file' : 'files';
                                      const confirmed = window.confirm(
                                        `Delete "${folder.name}" and its ${folder.fileCount} ${descriptor}? This cannot be undone.`,
                                      );
                                      if (!confirmed) {
                                        return;
                                      }
                                    }
                                    deleteFolderMutation.mutate({
                                      id: folder.id,
                                      name: folder.name,
                                      fileCount: folder.fileCount,
                                    });
                                  }}
                                >
                                  {deleteFolderMutation.isPending ? 'One moment…' : 'Delete'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="files-workspace__sidebar-footer">
            <button type="button" className="secondary" onClick={() => setShowFolderDialog(true)}>
              New Folder
            </button>
          </div>
        </aside>

        <div
          className={`files-workspace__content${isDragging ? ' is-dragging' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && selectedFolder && (
            <div className="files-workspace__drop-hint">
              <span>Drop to upload into {selectedFolder.name}</span>
            </div>
          )}
          <div className="files-workspace__content-header">
            <div className="files-workspace__context" role="heading" aria-level={2}>
              <span className="files-workspace__context-label">{spaceLabel}</span>
              <span className="files-workspace__context-name">
                {selectedFolder ? selectedFolder.name : 'Choose a folder'}
              </span>
              {selectedFolder && (
                <div className="files-workspace__context-meta">
                  {selectedFolderUpdatedLabel && <span>{selectedFolderUpdatedLabel}</span>}
                  {selectedFolderFileCountLabel && <span>{selectedFolderFileCountLabel}</span>}
                </div>
              )}
            </div>
            <div className="files-workspace__header-actions">
              <div className="files-workspace__search">
                <input
                  type="search"
                  placeholder="Search files"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
              <div className="files-workspace__action-buttons">
                {selectedFileIds.length > 0 && (
                  <div className="files-workspace__bulk-actions">
                    <button
                      type="button"
                      className="danger"
                      onClick={() => bulkDeleteMutation.mutate(selectedFileIds)}
                      disabled={bulkDeleteMutation.isPending}
                    >
                      {bulkDeleteMutation.isPending ? 'Deleting…' : `Delete ${selectedFileIds.length}`}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowUpload(true)}
                  disabled={!selectedFolder || !canManageSelectedFolder}
                  title={!selectedFolder ? 'Choose a folder first.' : !canManageSelectedFolder ? 'Uploads are limited to folders you own.' : undefined}
                >
                  Upload File
                </button>
              </div>
            </div>
          </div>

          <div className="files-workspace__body">
            <div className="files-workspace__meta">
              <span>
                {isLoadingFiles
                  ? 'Loading documents…'
                  : `Showing ${visibleFiles.length} ${visibleFiles.length === 1 ? 'item' : 'items'}`}
              </span>
              <div className="files-workspace__selection">
                {selectedFileIds.length > 0 && (
                  <>
                    <span>{selectedFileIds.length} selected</span>
                    <button type="button" className="link" onClick={clearSelection}>
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>

            {alert && (
              <div className={`files-workspace__alert files-workspace__alert--${alert.type}`}>
                <span>{alert.message}</span>
                <button type="button" onClick={() => setAlert(null)} aria-label="Dismiss notification">
                  ×
                </button>
              </div>
            )}

            {isLoadingFiles ? (
              <div className="files-workspace__loading">Loading documents…</div>
            ) : visibleFiles.length === 0 ? (
              <div className="files-workspace__empty">
                <div className="files-workspace__empty-illustration" aria-hidden="true" />
                <h3>
                  {selectedFolder
                    ? 'No documents yet'
                    : `No ${spaceLabel.toLowerCase()} folders yet`}
                </h3>
                {selectedFolder && (
                  <p>Upload a .txt file or drag and drop to stock this space.</p>
                )}
              </div>
            ) : (
              <div className="files-workspace__table-wrapper">
                <table className="files-table">
                  <thead>
                    <tr>
                      <th className="files-table__select">
                        <input
                          type="checkbox"
                          aria-label="Select all manageable files"
                          onChange={toggleSelectAll}
                          checked={allSelectableSelected}
                          disabled={selectableFiles.length === 0}
                        />
                      </th>
                    <th className="files-table__name" aria-sort={getAriaSort('name')}>
                      <button type="button" onClick={() => handleSort('name')}>
                        Name
                        <span aria-hidden="true">
                          {sortField === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                    <th className="files-table__owner" aria-sort={getAriaSort('owner')}>
                      <button type="button" onClick={() => handleSort('owner')}>
                        Owner
                        <span aria-hidden="true">
                          {sortField === 'owner' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                    {isOrgSpace && (
                      <th className="files-table__visibility" aria-sort={getAriaSort('visibility')}>
                        <button type="button" onClick={() => handleSort('visibility')}>
                          Visibility
                          <span aria-hidden="true">
                            {sortField === 'visibility' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                          </span>
                        </button>
                      </th>
                    )}
                    <th className="files-table__updated" aria-sort={getAriaSort('updatedAt')}>
                      <button type="button" onClick={() => handleSort('updatedAt')}>
                        Updated
                        <span aria-hidden="true">
                          {sortField === 'updatedAt' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                    <th className="files-table__actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map((file) => {
                    const ownerLabel = file.owner.displayName ?? file.owner.email;
                    const updatedLabel = timestampFormatter.format(new Date(file.updatedAt));
                    const selected = selectedFileIds.includes(file.id);
                    const canManage = isOwner(file);
                    const menuOpen = activeFileMenuId === file.id;
                    const isRenaming = inlineRenameId === file.id;
                    const visibilityLabel = file.visibility === 'public' ? 'Org Shared' : 'Private';
                    return (
                      <tr key={file.id} className={selected ? 'is-selected' : undefined}>
                        <td className="files-table__select">
                          {canManage ? (
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleFileSelection(file.id)}
                              aria-label={`Select ${file.name}`}
                            />
                          ) : (
                            <span className="checkbox-placeholder" aria-hidden="true" />
                          )}
                        </td>
                        <td className="files-table__name">
                          <div className="file-name-cell">
                            <div className="file-name-cell__body">
                              {isRenaming ? (
                                <input
                                  autoFocus
                                  value={renameDraft}
                                  onChange={(event) => setRenameDraft(event.target.value)}
                                  onBlur={commitFileRename}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      cancelFileRename();
                                    } else if (event.key === 'Enter') {
                                      event.preventDefault();
                                      commitFileRename();
                                    }
                                  }}
                                  disabled={renameMutation.isPending}
                                />
                              ) : (
                                <a
                                  className="file-name-cell__name"
                                  href={`${API_BASE}/api/files/${file.id}/download`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {file.name}
                                </a>
                              )}
                            </div>
                            {file.status !== 'ready' && (
                              <span
                                className="file-name-cell__status"
                                aria-label="Processing for search"
                                title="Processing for search"
                              >
                                <span className="file-name-cell__status-dot" aria-hidden="true" />
                                <span>Processing…</span>
                              </span>
                            )}
                          </div>
                        </td>
                        {isOrgSpace && (
                          <td className="files-table__visibility">
                            <span className={`pill pill--${file.visibility}`}>{visibilityLabel}</span>
                          </td>
                        )}
                        <td className="files-table__owner">{ownerLabel}</td>
                        <td className="files-table__updated">{updatedLabel}</td>
                        <td className="files-table__actions">
                          <div className="file-row-actions">
                            <button
                              type="button"
                              className="icon-button"
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                              aria-label="File actions"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveFileMenuId((prev) => (prev === file.id ? null : file.id));
                              }}
                            >
                              <span aria-hidden="true">...</span>
                            </button>
                            {menuOpen && (
                              <div
                                className="file-row-actions__menu"
                                role="menu"
                                onPointerDown={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    window
                                      .open(`${API_BASE}/api/files/${file.id}/download`, '_blank')
                                      ?.focus?.();
                                    setActiveFileMenuId(null);
                                  }}
                                >
                                  Open
                                </button>
                                {canManage && (
                                  <>
                                    <button type="button" role="menuitem" onClick={() => startFileRename(file)}>
                                      Rename
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        toggleVisibilityMutation.mutate({
                                          id: file.id,
                                          visibility: file.visibility === 'public' ? 'private' : 'public',
                                        });
                                        setActiveFileMenuId(null);
                                      }}
                                    >
                                      Make {file.visibility === 'public' ? 'Private' : 'Org Shared'}
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => deleteMutation.mutate(file.id)}
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      </div>

      <UploadDialog
        open={showUpload}
        visibility={visibilityFilter}
        folders={manageableFolders}
        defaultFolderId={selectedFolder?.id ?? null}
        onClose={() => setShowUpload(false)}
        onUpload={({ file, folderId, visibility, name }) => {
          uploadMutation.mutate({
            file,
            folderId,
            folderName: folders.find((folder) => folder.id === folderId)?.name,
            visibility,
            name,
          });
        }}
        isUploading={uploadMutation.isPending}
      />

      <FolderDialog
        open={showFolderDialog}
        onClose={() => setShowFolderDialog(false)}
        onCreate={({ name, visibility }) => createFolderMutation.mutate({ name, visibility })}
        isSaving={createFolderMutation.isPending}
        defaultVisibility={visibilityFilter}
      />
    </section>
  );
}
