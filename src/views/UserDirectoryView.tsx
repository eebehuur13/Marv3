import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchDirectoryUsers, type DirectoryEntry } from '../lib/api';

export function UserDirectoryView() {
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const normalizedQuery = query.trim();

  const directoryQuery = useQuery({
    queryKey: ['directory', normalizedQuery],
    queryFn: () => searchDirectoryUsers(normalizedQuery),
  });

  const results = directoryQuery.data?.results ?? [];

  const teamOptions = useMemo(() => buildTeamOptions(results), [results]);

  useEffect(() => {
    if (teamFilter !== 'all' && !teamOptions.includes(teamFilter)) {
      setTeamFilter('all');
    }
  }, [teamFilter, teamOptions]);

  const filteredResults = useMemo(() => applyTeamFilter(results, teamFilter), [results, teamFilter]);

  return (
    <section className="user-directory-view panel-surface">
      <header className="user-directory-view__header">
        <div>
          <h2>User directory</h2>
          <p>Search for teammates to share files, add to teams, or assign permissions.</p>
        </div>
        <div className="user-directory-view__filters">
          <input
            type="search"
            placeholder="Search by name, email, or username"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
            <option value="all">All teams</option>
            {teamOptions.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="user-directory-view__results">
        {directoryQuery.isLoading ? (
          <p className="muted">Loading directory…</p>
        ) : filteredResults.length === 0 ? (
          <p className="muted">No users match that search just yet.</p>
        ) : (
          <ul className="user-directory-list">
            {filteredResults.map((user) => (
              <li key={user.id}>
                <div className="user-directory-list__main">
                  <strong>{user.display_name ?? user.email}</strong>
                  <span>{user.email}</span>
                </div>
                <div className="user-directory-list__meta">
                  <span>@{user.username ?? '—'}</span>
                  <span>{user.teams.length ? user.teams.join(', ') : 'No teams yet'}</span>
                </div>
                <div className="user-directory-list__actions">
                  <button type="button" className="secondary" disabled>
                    Share file
                  </button>
                  <button type="button" className="link" disabled>
                    Add to team
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function buildTeamOptions(entries: DirectoryEntry[]): string[] {
  const unique = new Set<string>();
  for (const entry of entries) {
    for (const team of entry.teams) {
      unique.add(team);
    }
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function applyTeamFilter(entries: DirectoryEntry[], selectedTeam: string): DirectoryEntry[] {
  if (selectedTeam === 'all') return entries;
  return entries.filter((entry) => entry.teams.includes(selectedTeam));
}
