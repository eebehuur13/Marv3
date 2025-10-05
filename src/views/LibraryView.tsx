import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFolders, fetchFiles, fetchTeams, type FileSummary, type FolderSummary, type TeamSummary } from '../lib/api';
import { PlaceholderView } from './PlaceholderView';

interface LibraryViewProps {
  currentUserId: string;
}

export function LibraryView(_props: LibraryViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const foldersQuery = useQuery({
    queryKey: ['library', 'folders'],
    queryFn: () => fetchFolders({ visibility: 'organization' }),
  });
  const filesQuery = useQuery({
    queryKey: ['library', 'files'],
    queryFn: () => fetchFiles({ visibility: 'organization' }),
  });
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: fetchTeams });

  const folders = foldersQuery.data?.folders ?? [];
  const files = filesQuery.data?.files ?? [];
  const teams = teamsQuery.data?.teams ?? [];

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
          </header>
          <div className="library-view__section-body">
            {teamsQuery.isLoading ? (
              <div className="library-view__loading">Loading teams…</div>
            ) : !teams.length ? (
              <PlaceholderView
                title="No teams yet"
                description="Create a team to share files with a focused group before promoting them to the organization library."
              />
            ) : (
              <div className="library-view__grid">
                {teams.map((team) => (
                  <TeamCard key={team.id} team={team} />
                ))}
              </div>
            )}
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
                  <FolderCard key={folder.id} folder={folder} />
                ))}
                {filteredFiles.map((file) => (
                  <FileCard key={file.id} file={file} />
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

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function TeamCard({ team }: { team: TeamSummary }) {
  const activeMembers = team.members.filter((member) => member.status === 'active');
  return (
    <article className="library-card">
      <header>
        <h4>{team.name}</h4>
        <span className="library-card__badge">Team</span>
      </header>
      <p className="library-card__meta">
        {team.description ?? 'No description provided.'}
      </p>
      <p className="library-card__meta">
        {pluralize(activeMembers.length, 'active member', 'active members')}
      </p>
      <footer>
        <button type="button" className="link" disabled>
          Manage team
        </button>
      </footer>
    </article>
  );
}

function FolderCard({ folder }: { folder: FolderSummary }) {
  return (
    <article className="library-card">
      <header>
        <h4>{folder.name}</h4>
        <span className="library-card__badge">Folder</span>
      </header>
      <p className="library-card__meta">
        Updated {formatDate(folder.updatedAt)} · {pluralize(folder.fileCount, 'file', 'files')}
      </p>
      <footer>
        <button type="button" className="link" disabled>
          View folder
        </button>
      </footer>
    </article>
  );
}

function FileCard({ file }: { file: FileSummary }) {
  return (
    <article className="library-card">
      <header>
        <h4>{file.name}</h4>
        <span className="library-card__badge library-card__badge--file">File</span>
      </header>
      <p className="library-card__meta">Shared by {file.owner.displayName ?? file.owner.email}</p>
      <footer>
        <button type="button" className="link" disabled>
          Preview
        </button>
      </footer>
    </article>
  );
}
