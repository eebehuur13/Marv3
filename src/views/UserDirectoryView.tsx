import { useMemo, useState } from 'react';

const MOCK_USERS = [
  { id: '1', name: 'Harish Adithya', email: 'harish@example.com', username: 'harish', team: 'Knowledge Ops' },
  { id: '2', name: 'Ravi Kumar', email: 'ravi@example.com', username: 'ravi', team: 'Knowledge Ops' },
  { id: '3', name: 'Jaya Rao', email: 'jaya@example.com', username: 'jaya', team: 'Product Marketing' },
  { id: '4', name: 'Irene Chen', email: 'irene@example.com', username: 'ichen', team: 'Design' },
];

export function UserDirectoryView() {
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');

  const teamOptions = useMemo(() => {
    const unique = new Set<string>();
    MOCK_USERS.forEach((user) => unique.add(user.team));
    return Array.from(unique).sort();
  }, []);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return MOCK_USERS.filter((user) => {
      if (teamFilter !== 'all' && user.team !== teamFilter) return false;
      if (!normalized) return true;
      return (
        user.name.toLowerCase().includes(normalized) ||
        user.email.toLowerCase().includes(normalized) ||
        user.username.toLowerCase().includes(normalized)
      );
    });
  }, [query, teamFilter]);

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
        {results.length === 0 ? (
          <p className="muted">No users match that search just yet.</p>
        ) : (
          <ul className="user-directory-list">
            {results.map((user) => (
              <li key={user.id}>
                <div className="user-directory-list__main">
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>
                <div className="user-directory-list__meta">
                  <span>@{user.username}</span>
                  <span>{user.team}</span>
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
