import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFolders, fetchFiles, type FolderSummary } from '../lib/api';
import { PlaceholderView } from './PlaceholderView';

interface LibraryViewProps {
  currentUserId: string;
}

export function LibraryView(_props: LibraryViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const foldersQuery = useQuery({
    queryKey: ['library', 'folders'],
    queryFn: () => fetchFolders({ visibility: 'public' }),
  });
  const filesQuery = useQuery({
    queryKey: ['library', 'files'],
    queryFn: () => fetchFiles({ visibility: 'public' }),
  });

  const folders = foldersQuery.data?.folders ?? [];
  const files = filesQuery.data?.files ?? [];

  const filteredFolders = useMemo(() => filterBySearch(folders, searchTerm), [folders, searchTerm]);
  const filteredFiles = useMemo(() => filterBySearch(files, searchTerm), [files, searchTerm]);

  return (
    <section className="library-view panel-surface">
      <header className="library-view__header">
        <div>
          <h2>Library</h2>
          <p>Discover team and organization knowledge shared across Marble.</p>
        </div>
        <div className="library-view__search">
          <input
            type="search"
            placeholder="Search organization files"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <button type="button" disabled>
            Advanced filters
          </button>
        </div>
      </header>

      <div className="library-view__sections">
        <section className="library-view__section">
          <header>
            <h3>Team spaces</h3>
            <p>Invite teammates and curate shared knowledge hubs.</p>
            <button type="button" className="secondary" disabled>
              Create team space
            </button>
          </header>
          <div className="library-view__section-body">
            <PlaceholderView
              title="Team library coming soon"
              description="Teams will appear here once Marble roles and invites are enabled."
              hint="We’ll surface shared team folders, recent activity, and quick access actions in this area."
            />
          </div>
        </section>

        <section className="library-view__section">
          <header>
            <h3>Organization library</h3>
            <p>Browse documents your organization has shared with everyone.</p>
          </header>
          <div className="library-view__section-body">
            {foldersQuery.isLoading || filesQuery.isLoading ? (
              <div className="library-view__loading">Fetching shared content…</div>
            ) : !filteredFolders.length && !filteredFiles.length ? (
              <PlaceholderView
                title="No shared documents yet"
                description="Move files to the organization space from your Personal Files tab to populate the library."
              />
            ) : (
              <div className="library-view__grid">
                {filteredFolders.map((folder) => (
                  <article key={folder.id} className="library-card">
                    <header>
                      <h4>{folder.name}</h4>
                      <span className="library-card__badge">Folder</span>
                    </header>
                    <p className="library-card__meta">
                      Updated {formatDate(folder.updatedAt)} · {folder.fileCount}{' '}
                      {folder.fileCount === 1 ? 'file' : 'files'}
                    </p>
                    <footer>
                      <button type="button" className="link" disabled>
                        View folder
                      </button>
                    </footer>
                  </article>
                ))}
                {filteredFiles.map((file) => (
                  <article key={file.id} className="library-card">
                    <header>
                      <h4>{file.name}</h4>
                      <span className="library-card__badge library-card__badge--file">File</span>
                    </header>
                    <p className="library-card__meta">
                      Shared by {file.owner.displayName ?? file.owner.email}
                    </p>
                    <footer>
                      <button type="button" className="link" disabled>
                        Preview
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function filterBySearch<T extends { name: string }>(items: T[], term: string): T[] {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => item.name.toLowerCase().includes(normalized));
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}
